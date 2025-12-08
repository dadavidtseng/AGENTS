/**
 * Discord Bot Integration for Agent_TypeScript with Resilience
 * ===========================================================
 *
 * Subscribes to Discord @mention events from KĀDI broker and responds using Claude API.
 * Includes retry logic, circuit breaker, and timeout metrics.
 *
 * Flow:
 * 1. Subscribe to discord.mention.{botId} topic on KĀDI broker
 * 2. Receive @mention events in real-time
 * 3. For each mention, call Claude API with user message
 * 4. Execute any tool calls Claude requests via KADI broker
 * 5. Reply to Discord channel via send_discord_message MCP tool
 *
 * Resilience Features:
 * - Exponential backoff retry (3 attempts with 1s, 2s, 4s delays)
 * - Circuit breaker (opens after 5 failures, resets after 1 minute)
 * - Timeout metrics tracking
 */

import Anthropic from '@anthropic-ai/sdk';
import {DiscordMentionEvent, DiscordMentionEventSchema} from '../types/discord-events.js';
import {BaseBot, BaseBotConfig, logger, MODULE_DISCORD_BOT, timer} from 'agents-library';

// ============================================================================
// Types
// ============================================================================

interface DiscordMention {
    id: string;
    user: string;
    text: string;
    channel: string;
    thread_ts: string;
    ts: string;
}

interface DiscordBotConfig extends BaseBotConfig {
    // No additional config needed - extends BaseBotConfig
}

// ============================================================================
// Discord Bot Manager with Resilience
// ============================================================================

export class DiscordBot extends BaseBot {
    constructor(config: DiscordBotConfig) {
        super(config);
    }

    /**
     * Start Discord bot - initialize protocol and subscribe to events
     */
    start(): void {
        logger.info(MODULE_DISCORD_BOT, 'Starting Discord bot (event-driven mode)...', timer.elapsed('main'));

        // Initialize protocol from BaseBot
        this.initializeProtocol();

        // Subscribe to Discord mention events
        this.subscribeToMentions();
    }

    /**
     * Stop Discord bot
     */
    stop(): void {
        logger.info(MODULE_DISCORD_BOT, 'Discord bot stopped', timer.elapsed('main'));
    }

    /**
     * Subscribe to Discord mention events via KĀDI event bus
     */
    private subscribeToMentions(): void {
        const topic = `discord.mention.${this.botUserId}`;

        logger.info(MODULE_DISCORD_BOT, `Subscriber: Registering subscription {topic: ${topic}, botUserId: ${this.botUserId}}`, timer.elapsed('main'));

        try {
            this.client.subscribeToEvent(topic, async (event: unknown) => {
                // Check circuit breaker before processing
                if (this.checkCircuitBreaker()) {
                    logger.warn(MODULE_DISCORD_BOT, 'Subscriber: Event processing skipped {reason: circuit breaker OPEN}', timer.elapsed('main'));
                    return;
                }

                // Extract event data from KĀDI envelope
                // KĀDI wraps events in: { eventName, data, timestamp, source, metadata }
                const eventData = (event as any)?.data || event;

                // Validate event payload with schema
                const validationResult = DiscordMentionEventSchema.safeParse(eventData);

                if (!validationResult.success) {
                    const errorDetails = validationResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
                    logger.error(MODULE_DISCORD_BOT, `Subscriber: Event validation failed {errors: [${errorDetails}]}`, timer.elapsed('main'));
                    return;
                }

                const mention: DiscordMentionEvent = validationResult.data;

                // Truncate text for logging (don't log full message content)
                const textPreview = mention.text.length > 50
                    ? mention.text.substring(0, 50) + '...'
                    : mention.text;

                logger.info(MODULE_DISCORD_BOT, `Subscriber: Event received {mentionId: ${mention.id}, user: ${mention.username}, channel: ${mention.channelName}, guild: ${mention.guild}, textPreview: "${textPreview}", timestamp: ${mention.timestamp}}`, timer.elapsed('main'));

                // Convert to DiscordMention format for existing processing logic
                const discordMention: DiscordMention = {
                    id: mention.id,
                    user: mention.user,
                    text: mention.text,
                    channel: mention.channel,
                    thread_ts: mention.id, // Use message ID as thread identifier
                    ts: mention.ts,
                };

                // Process mention using existing logic
                await this.handleMention(discordMention);
            });

            logger.info(MODULE_DISCORD_BOT, `Subscriber: Subscription registered successfully {topic: ${topic}}`, timer.elapsed('main'));
        } catch (error: any) {
            logger.error(MODULE_DISCORD_BOT, `Subscriber: Subscription registration failed {topic: ${topic}}`, timer.elapsed('main'), error);
        }
    }

    /**
     * Handle a Discord mention event from KĀDI broker
     */
    protected async handleMention(mention: DiscordMention): Promise<void> {
        try {
            logger.info(MODULE_DISCORD_BOT, `Processing mention from @${mention.user}: "${mention.text}"`, timer.elapsed('main'));

            // Process mention using existing logic
            await this.processMention(mention);
        } catch (error: any) {
            logger.error(MODULE_DISCORD_BOT, `Error handling mention from @${mention.user}`, timer.elapsed('main'), error);

            // Send error message to Discord
            await this.sendDiscordReply(
                mention.channel,
                mention.id,
                'Sorry, I encountered an error processing your message. Please try again later.'
            );
        }
    }

    /**
     * Process a single Discord mention with Claude API
     */
    private async processMention(mention: DiscordMention): Promise<void> {
        // Check circuit breaker before processing
        if (this.checkCircuitBreaker()) {
            logger.warn(MODULE_DISCORD_BOT, `Circuit breaker OPEN - skipping mention from @${mention.user}`, timer.elapsed('main'));

            // Publish error event
            this.client.publishEvent('artist.task.failed', {
                error: 'Circuit breaker open',
                errorType: 'circuit_breaker',
                context: {
                    mentionId: mention.id,
                    user: mention.user,
                    channel: mention.channel,
                },
                agent: 'agent-artist',
                timestamp: new Date().toISOString(),
            });

            // Send user-friendly error message
            await this.sendDiscordReply(
                mention.channel,
                mention.id,
                '⚠️ Service temporarily unavailable due to repeated failures. Please try again in a few minutes.'
            );
            return;
        }

        try {
            // Get list of available KADI tools (dynamically from client and broker)
            const availableTools = await this.getAvailableTools();

            // Call Claude API
            let response = await this.anthropic.messages.create({
                model: process.env.BOT_CLAUDE_MODEL || 'claude-3-haiku-20240307',
                max_tokens: parseInt(process.env.BOT_CLAUDE_MAX_TOKENS || '4096'),
                tools: availableTools,
                messages: [
                    {
                        role: 'user',
                        content: mention.text,
                    },
                ],
            });

            // Handle tool use loop
            let conversationMessages: any[] = [
                {role: 'user', content: mention.text},
            ];

            while (response.stop_reason === 'tool_use') {
                // Extract tool calls
                const toolBlocks = response.content.filter((block) => block.type === 'tool_use');

                // Add assistant response to conversation
                conversationMessages.push({
                    role: 'assistant',
                    content: response.content,
                });

                // Execute tool calls
                const toolResults = [];
                for (const toolBlock of toolBlocks) {
                    if (toolBlock.type !== 'tool_use') continue;

                    const result = await this.executeKadiTool(
                        toolBlock.name,
                        toolBlock.input as Record<string, unknown>
                    );

                    toolResults.push({
                        type: 'tool_result',
                        tool_use_id: toolBlock.id,
                        content: JSON.stringify(result),
                    });
                }

                // Add tool results to conversation
                conversationMessages.push({
                    role: 'user',
                    content: toolResults,
                });

                // Get next Claude response
                response = await this.anthropic.messages.create({
                    model: process.env.BOT_CLAUDE_MODEL || 'claude-3-haiku-20240307',
                    max_tokens: parseInt(process.env.BOT_CLAUDE_MAX_TOKENS || '4096'),
                    tools: availableTools,
                    messages: conversationMessages,
                });
            }

            // Extract final text response
            const finalText = response.content
                .filter((block) => block.type === 'text')
                .map((block: any) => block.text)
                .join('\n');

            // Reply to Discord
            await this.sendDiscordReply(mention.channel, mention.id, finalText);

            logger.info(MODULE_DISCORD_BOT, `Replied to @${mention.user}`, timer.elapsed('main'));

            // Record success for circuit breaker
            this.recordSuccess();
        } catch (error: any) {
            logger.error(MODULE_DISCORD_BOT, `Error processing mention from @${mention.user}`, timer.elapsed('main'), error);

            // Classify error type
            const errorType = this.classifyError(error);
            const isTransient = errorType === 'network' || errorType === 'timeout' || errorType === 'rate_limit';

            // Record failure for circuit breaker
            this.recordFailure(error);

            // Publish detailed error event
            this.client.publishEvent('artist.task.failed', {
                error: error.message || String(error),
                errorType,
                isTransient,
                stack: error.stack,
                context: {
                    mentionId: mention.id,
                    user: mention.user,
                    channel: mention.channel,
                    textPreview: mention.text.substring(0, 100),
                },
                agent: 'agent-artist',
                timestamp: new Date().toISOString(),
            });

            // Send appropriate error message to Discord
            const userMessage = isTransient
                ? 'Sorry, I encountered a temporary issue. Please try again in a moment.'
                : 'Sorry, I encountered an error processing your message. The issue has been logged.';

            try {
                await this.sendDiscordReply(mention.channel, mention.id, userMessage);
            } catch (replyError: any) {
                logger.error(MODULE_DISCORD_BOT, 'Failed to send error reply', timer.elapsed('main'), replyError);
            }
        }
    }

    /**
     * Classify error type for appropriate handling
     *
     * @param error - Error object
     * @returns Error type classification
     */
    private classifyError(error: any): string {
        const message = error.message?.toLowerCase() || '';

        // Network-related errors (transient)
        if (message.includes('econnrefused') || message.includes('enotfound') ||
            message.includes('network') || message.includes('socket')) {
            return 'network';
        }

        // Timeout errors (transient)
        if (message.includes('timeout') || message.includes('timed out')) {
            return 'timeout';
        }

        // Rate limiting (transient)
        if (message.includes('rate limit') || message.includes('429') ||
            message.includes('too many requests')) {
            return 'rate_limit';
        }

        // API errors (non-transient)
        if (message.includes('api') || message.includes('invalid') ||
            message.includes('unauthorized') || message.includes('403')) {
            return 'api_error';
        }

        // Validation errors (non-transient)
        if (message.includes('validation') || message.includes('invalid input') ||
            message.includes('schema')) {
            return 'validation_error';
        }

        // Unknown error type
        return 'unknown';
    }

    /**
     * Execute a KADI tool via broker with retry logic
     */
    private async executeKadiTool(
        toolName: string,
        input: Record<string, unknown>
    ): Promise<any> {
        if (!this.protocol) {
            return {success: false, error: 'Protocol not initialized'};
        }

        try {
            logger.info(MODULE_DISCORD_BOT, `Executing tool: ${toolName}`, timer.elapsed('main'));

            // Determine target agent based on tool name
            const targetAgent = this.resolveTargetAgent(toolName);

            // Use invokeToolWithRetry for resilient tool execution
            const result = await this.invokeToolWithRetry({
                targetAgent,
                toolName,
                toolInput: input,
                timeout: 30000,
            });

            // Handle the result - invokeTool may return different structures
            if (result && typeof result === 'object') {
                return {success: true, result: result.result || result};
            }

            return {success: true, result};
        } catch (error: any) {
            logger.error(MODULE_DISCORD_BOT, `Tool execution failed (${toolName})`, timer.elapsed('main'), error);

            // Classify error and publish event
            const errorType = this.classifyError(error);
            const isTransient = errorType === 'network' || errorType === 'timeout' || errorType === 'rate_limit';

            this.client.publishEvent('artist.task.failed', {
                error: error.message || String(error),
                errorType,
                isTransient,
                stack: error.stack,
                context: {
                    toolName,
                    targetAgent: this.resolveTargetAgent(toolName),
                    input: JSON.stringify(input).substring(0, 200),
                },
                agent: 'agent-artist',
                timestamp: new Date().toISOString(),
            });

            return {success: false, error: String(error)};
        }
    }

    /**
     * Send reply to Discord via MCP_Discord_Server
     *
     * Handles Discord's 2,000 character limit by splitting long messages
     * into multiple sequential replies.
     */
    private async sendDiscordReply(
        channel: string,
        message_id: string,
        text: string
    ): Promise<void> {
        if (!this.protocol) {
            logger.error(MODULE_DISCORD_BOT, 'Cannot send Discord reply: protocol not initialized', timer.elapsed('main'));
            return;
        }

        const MAX_DISCORD_MESSAGE_LENGTH = 2000;

        // If message fits in one reply, send directly
        if (text.length <= MAX_DISCORD_MESSAGE_LENGTH) {
            await this.invokeToolWithRetry({
                targetAgent: 'mcp-server-discord',
                toolName: 'discord_server_send_reply',
                toolInput: {
                    channel,
                    message_id,
                    text,
                },
                timeout: parseInt(process.env.BOT_TOOL_TIMEOUT_MS || '10000'),
            });
            return;
        }

        // Split long message into chunks
        logger.info(MODULE_DISCORD_BOT, `Message too long (${text.length} chars), splitting into chunks...`, timer.elapsed('main'));

        const chunks = this.splitMessage(text, MAX_DISCORD_MESSAGE_LENGTH);

        logger.info(MODULE_DISCORD_BOT, `Sending ${chunks.length} message chunks to Discord`, timer.elapsed('main'));

        // Send first chunk as a reply to the original message
        await this.invokeToolWithRetry({
            targetAgent: 'mcp-server-discord',
            toolName: 'discord_server_send_reply',
            toolInput: {
                channel,
                message_id,
                text: chunks[0],
            },
            timeout: parseInt(process.env.BOT_TOOL_TIMEOUT_MS || '10000'),
        });

        // Send remaining chunks as regular messages (not replies)
        for (let i = 1; i < chunks.length; i++) {
            await this.invokeToolWithRetry({
                targetAgent: 'mcp-server-discord',
                toolName: 'discord_server_send_message',
                toolInput: {
                    channel,
                    text: chunks[i],
                },
                timeout: parseInt(process.env.BOT_TOOL_TIMEOUT_MS || '10000'),
            });

            // Small delay between messages to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 500));
        }
    }

    /**
     * Split message into chunks that respect Discord's character limit
     *
     * Tries to split on newlines to keep formatting intact.
     *
     * @param text - Full message text
     * @param maxLength - Maximum length per chunk (default: 2000)
     * @returns Array of message chunks
     */
    private splitMessage(text: string, maxLength: number = 2000): string[] {
        const chunks: string[] = [];
        let currentChunk = '';

        // Split by lines to preserve formatting
        const lines = text.split('\n');

        for (const line of lines) {
            // If single line exceeds limit, force-split it
            if (line.length > maxLength) {
                // Save current chunk if not empty
                if (currentChunk) {
                    chunks.push(currentChunk);
                    currentChunk = '';
                }

                // Force-split the long line
                let remainingLine = line;
                while (remainingLine.length > maxLength) {
                    chunks.push(remainingLine.substring(0, maxLength));
                    remainingLine = remainingLine.substring(maxLength);
                }
                currentChunk = remainingLine + '\n';
                continue;
            }

            // Check if adding this line would exceed limit
            if (currentChunk.length + line.length + 1 > maxLength) {
                // Save current chunk and start new one
                chunks.push(currentChunk.trim());
                currentChunk = line + '\n';
            } else {
                // Add line to current chunk
                currentChunk += line + '\n';
            }
        }

        // Add final chunk if not empty
        if (currentChunk.trim()) {
            chunks.push(currentChunk.trim());
        }

        return chunks;
    }

    /**
     * Query broker for tools available on connected networks
     *
     * Uses KĀDI broker's kadi.ability.list API to discover tools available
     * on the networks this agent is connected to (global, text, git, slack, discord).
     *
     * @returns Array of network tools in Anthropic format
     */
    private async queryNetworkTools(): Promise<Anthropic.Tool[]> {
        try {
            const networks = this.client.config.networks || [];

            // Get broker protocol to access connection
            const protocol = this.client.getBrokerProtocol();

            // Query broker for tools on connected networks
            const result = await (protocol as any).connection.sendRequest({
                jsonrpc: '2.0',
                method: 'kadi.ability.list',
                params: {
                    networks,
                    includeProviders: false  // We don't need provider info for Claude
                },
                id: `tools_${Date.now()}`
            }) as {
                tools: Array<{
                    name: string;
                    description?: string;
                    inputSchema?: any;
                }>;
            };

            logger.info(MODULE_DISCORD_BOT, `Discovered ${result.tools.length} network tools from broker`, timer.elapsed('main'));

            // Convert to Anthropic format
            return result.tools.map((tool: any) => ({
                name: tool.name,
                description: tool.description || '',
                input_schema: (tool.inputSchema || { type: 'object' }) as Anthropic.Tool.InputSchema
            }));
        } catch (error) {
            logger.error(MODULE_DISCORD_BOT, 'Failed to query network tools from broker', timer.elapsed('main'), error as Error | string);
            return [];  // Fallback to empty array on error
        }
    }

    /**
     * Get available KADI tools formatted for Claude API
     *
     * Combines tools from two sources:
     * 1. Local tools: Registered directly on this agent via client.registerTool()
     * 2. Network tools: Available via broker on connected networks
     *
     * This enables dynamic discovery - when broker tools change, they're
     * automatically available to Claude without code changes.
     */
    private async getAvailableTools(): Promise<Anthropic.Tool[]> {
        // 1. Get locally registered tools (tools on THIS agent)
        const localTools = this.client.getAllRegisteredTools().map(tool => ({
            name: tool.definition.name,
            description: tool.definition.description || '',
            input_schema: tool.definition.inputSchema as Anthropic.Tool.InputSchema
        }));

        // 2. Query broker for tools available on connected networks
        const networkTools = await this.queryNetworkTools();

        // 3. Deduplicate: prefer local tools over network tools (local tools are authoritative)
        const localToolNames = new Set(localTools.map(t => t.name));
        const uniqueNetworkTools = networkTools.filter(t => !localToolNames.has(t.name));

        // 4. Combine and return (local tools first, then unique network tools)
        logger.info(MODULE_DISCORD_BOT, `Available tools: ${localTools.length} local + ${uniqueNetworkTools.length} network (${networkTools.length - uniqueNetworkTools.length} duplicates removed) = ${localTools.length + uniqueNetworkTools.length} total`, timer.elapsed('main'));

        return [...localTools, ...uniqueNetworkTools];
    }

    /**
     * Resolve target agent for a tool name
     */
    private resolveTargetAgent(toolName: string): string {
        // Simple prefix-based routing
        if (toolName.startsWith('format_') || toolName.startsWith('count_') || toolName.startsWith('validate_') || toolName.startsWith('reverse_') || toolName.startsWith('trim_') || toolName.startsWith('echo')) {
            return 'template-agent-typescript'; // This agent's own tools
        }
        if (toolName.startsWith('discord_')) {
            return 'discord-server';
        }
        if (toolName.startsWith('git_')) {
            return 'git';
        }

        // Default: assume it's a tool on this agent
        return 'template-agent-typescript';
    }
}
