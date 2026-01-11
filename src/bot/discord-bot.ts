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
import type {ProviderManager} from '../providers/provider-manager.js';
import type {MemoryService} from '../memory/memory-service.js';
import type {Message} from '../providers/types.js';

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
    providerManager: ProviderManager;
    memoryService: MemoryService;
}

// ============================================================================
// Discord Bot Manager with Resilience
// ============================================================================

export class DiscordBot extends BaseBot {
    private readonly providerManager: ProviderManager;
    private readonly memoryService: MemoryService;

    constructor(config: DiscordBotConfig) {
        super(config);
        this.providerManager = config.providerManager;
        this.memoryService = config.memoryService;
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
     * Process a single Discord mention with ProviderManager and MemoryService
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
            // Step 1: Retrieve conversation context from MemoryService
            const contextResult = await this.memoryService.retrieveContext(mention.user, mention.channel);

            if (!contextResult.success) {
                logger.warn(MODULE_DISCORD_BOT, `Failed to retrieve context: ${contextResult.error.message}`, timer.elapsed('main'));
            }

            const context = contextResult.success ? contextResult.data : [];

            // Step 2: Build messages array (context + new user message)
            const messages: Message[] = [
                ...context.map(msg => ({
                    role: msg.role,
                    content: msg.content,
                })),
                {
                    role: 'user' as const,
                    content: mention.text,
                },
            ];

            // Step 3: Detect model from message using regex /\[([^\]]+)\]/
            const modelMatch = mention.text.match(/\[([^\]]+)\]/);
            const detectedModel = modelMatch ? modelMatch[1] : undefined;

            if (detectedModel) {
                logger.info(MODULE_DISCORD_BOT, `Model detected from message: ${detectedModel}`, timer.elapsed('main'));
            }

            // Step 4: Get available tools and convert to OpenAI format
            const anthropicTools = await this.getAvailableTools();
            const openaiTools = this.convertToolsToOpenAIFormat(anthropicTools);
            
            logger.info(MODULE_DISCORD_BOT, `Passing ${openaiTools.length} tools to LLM`, timer.elapsed('main'));

            // Step 5: Tool calling loop - keep calling until we get a final text response
            let maxIterations = 10;
            let iteration = 0;
            let finalResponse: string | null = null;
            let toolsExecuted = false; // Track if tools have been executed

            while (iteration < maxIterations && !finalResponse) {
                iteration++;

                logger.info(MODULE_DISCORD_BOT, `=== Iteration ${iteration} ===`, timer.elapsed('main'));
                logger.info(MODULE_DISCORD_BOT, `Sending ${messages.length} messages to LLM with model: ${detectedModel || 'default'}${toolsExecuted ? ' (tools disabled - already executed)' : ''}`, timer.elapsed('main'));

                // Log message roles for debugging
                const msgSummary = messages.map(m => `${m.role}${m.tool_call_id ? `(tool:${m.tool_call_id.substring(0,8)})` : ''}`).join(', ');
                logger.info(MODULE_DISCORD_BOT, `Message roles: [${msgSummary}]`, timer.elapsed('main'));

                // Generate response using ProviderManager with tools
                // IMPORTANT: After tools have been executed, don't send tools again to prevent
                // server-side re-execution by some LLM gateways (e.g., model-manager with GPT-5)
                const responseResult = await this.providerManager.chat(messages, {
                    model: detectedModel,
                    tools: toolsExecuted ? undefined : openaiTools,
                    tool_choice: toolsExecuted ? undefined : 'auto',
                });

                // Handle error
                if (!responseResult.success) {
                logger.error(MODULE_DISCORD_BOT, `Provider failed: ${responseResult.error.message}`, timer.elapsed('main'));

                // Record failure for circuit breaker
                const error = new Error(responseResult.error.message);
                this.recordFailure(error);

                // Publish detailed error event
                this.client.publishEvent('artist.task.failed', {
                    error: responseResult.error.message,
                    errorType: responseResult.error.type,
                    isTransient: responseResult.error.type === 'RATE_LIMIT' || responseResult.error.type === 'TIMEOUT' || responseResult.error.type === 'NETWORK_ERROR',
                    context: {
                        mentionId: mention.id,
                        user: mention.user,
                        channel: mention.channel,
                        textPreview: mention.text.substring(0, 100),
                        provider: responseResult.error.provider,
                    },
                    agent: 'agent-artist',
                    timestamp: new Date().toISOString(),
                });

                    // Send user-friendly error message (no stack traces)
                    const userMessage = 'Sorry, I encountered an issue generating a response. The issue has been logged.';
                    await this.sendDiscordReply(mention.channel, mention.id, userMessage);
                    return;
                }

                const botResponse = responseResult.data;

                // Check if response contains tool calls
                const toolCallData = this.parseToolCalls(botResponse);

                if (toolCallData && toolCallData.toolCalls.length > 0) {
                    // LLM wants to execute tools
                    logger.info(MODULE_DISCORD_BOT, `LLM requested ${toolCallData.toolCalls.length} tool call(s)`, timer.elapsed('main'));

                    // Add assistant message with tool calls to conversation
                    messages.push({
                        role: 'assistant',
                        content: toolCallData.message || null,
                        tool_calls: toolCallData.toolCalls,
                    });

                    // Execute each tool and collect results
                    for (const toolCall of toolCallData.toolCalls) {
                        const toolResult = await this.executeToolCall(toolCall);

                        logger.info(MODULE_DISCORD_BOT, `Tool ${toolCall.function.name} result: ${toolResult.substring(0, 200)}...`, timer.elapsed('main'));
                        logger.info(MODULE_DISCORD_BOT, `Tool call ID: ${toolCall.id}`, timer.elapsed('main'));

                        // Add tool result to conversation using OpenAI tool format
                        messages.push({
                            role: 'tool',
                            content: toolResult,
                            tool_call_id: toolCall.id,
                        });
                    }

                    logger.info(MODULE_DISCORD_BOT, `Messages array now has ${messages.length} messages, continuing to iteration ${iteration + 1}`, timer.elapsed('main'));

                    // Continue loop - keep tools available for multi-step tasks
                    // NOTE: toolsExecuted flag removed to allow chained tool execution
                    continue;
                }

                // No tool calls - this is the final text response
                logger.info(MODULE_DISCORD_BOT, `Received final text response (no tool calls), breaking loop`, timer.elapsed('main'));
                finalResponse = botResponse;
                break;
            }

            logger.info(MODULE_DISCORD_BOT, `Completed iteration ${iteration}, maxIterations: ${maxIterations}, finalResponse: ${finalResponse ? 'YES' : 'NO'}`, timer.elapsed('main'));

            // Check if we got a final response
            if (!finalResponse) {
                logger.error(MODULE_DISCORD_BOT, `Tool calling loop exceeded maximum iterations (${maxIterations})`, timer.elapsed('main'));
                await this.sendDiscordReply(mention.channel, mention.id, 'Sorry, I encountered an issue completing your request.');
                return;
            }

            const botResponse = finalResponse;

            // Step 6: Store messages in MemoryService
            // Store user message
            await this.memoryService.storeMessage(mention.user, mention.channel, {
                role: 'user',
                content: mention.text,
                timestamp: Date.now(),
            });

            // Store bot response
            await this.memoryService.storeMessage(mention.user, mention.channel, {
                role: 'assistant',
                content: botResponse,
                timestamp: Date.now(),
            });

            // Step 7: Send response to channel
            logger.info(MODULE_DISCORD_BOT, `Sending final response (${botResponse.length} chars) to Discord...`, timer.elapsed('main'));
            await this.sendDiscordReply(mention.channel, mention.id, botResponse);

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

            // Send appropriate error message to Discord (no stack traces)
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
            logger.info(MODULE_DISCORD_BOT, `Invoking discord_server_send_reply for message_id: ${message_id}, text length: ${text.length}`, timer.elapsed('main'));
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
            logger.info(MODULE_DISCORD_BOT, `Discord reply sent successfully for message_id: ${message_id}`, timer.elapsed('main'));
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
     * @deprecated This method is unused in the current implementation (tool use removed)
     * @returns Array of network tools in Anthropic format
     */
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
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
                input_schema: (tool.inputSchema || {type: 'object'}) as Anthropic.Tool.InputSchema
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
     *
     * @deprecated This method is unused in the current implementation (tool use removed)
     */
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
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
     * Convert Anthropic tool format to OpenAI tool format
     */
    private convertToolsToOpenAIFormat(anthropicTools: Anthropic.Tool[]): Array<{
        type: 'function';
        function: {
            name: string;
            description: string;
            parameters: any;
        };
    }> {
        return anthropicTools.map(tool => ({
            type: 'function' as const,
            function: {
                name: tool.name,
                description: tool.description || '',
                parameters: tool.input_schema,
            },
        }));
    }

    /**
     * Parse tool calls from provider response
     * Format: __TOOL_CALLS__{"tool_calls":[...],"message":"..."}
     */
    private parseToolCalls(response: string): { toolCalls: any[]; message: string } | null {
        if (!response.startsWith('__TOOL_CALLS__')) {
            return null;
        }

        try {
            const jsonStr = response.substring('__TOOL_CALLS__'.length);
            const data = JSON.parse(jsonStr);
            return {
                toolCalls: data.tool_calls || [],
                message: data.message || ''
            };
        } catch (error) {
            logger.error(MODULE_DISCORD_BOT, 'Failed to parse tool calls', timer.elapsed('main'), error as Error);
            return null;
        }
    }

    /**
     * Execute a single tool call
     *
     * Handles both synchronous and asynchronous tool responses.
     * If tool returns {status: 'pending', requestId: ...}, waits for async result.
     */
    private async executeToolCall(toolCall: any): Promise<string> {
        const toolName = toolCall.function.name;
        const toolArgs = JSON.parse(toolCall.function.arguments);

        logger.info(MODULE_DISCORD_BOT, `Executing tool: ${toolName}`, timer.elapsed('main'));

        try {
            // Determine target agent based on tool name
            const targetAgent = this.resolveTargetAgent(toolName);

            // Use invokeToolWithRetry for resilient tool execution
            const result = await this.invokeToolWithRetry({
                targetAgent,
                toolName,
                toolInput: toolArgs,
                timeout: 30000,
            });

            // Check if result is async pending - wait for actual result
            if (result && typeof result === 'object' &&
                result.status === 'pending' && result.requestId) {
                logger.info(MODULE_DISCORD_BOT, `Tool ${toolName} returned pending, waiting for async result: ${result.requestId}`, timer.elapsed('main'));

                try {
                    const asyncResult = await this.waitForAbilityResponse(result.requestId, 30000);
                    logger.info(MODULE_DISCORD_BOT, `Async result received for ${toolName}`, timer.elapsed('main'));
                    return JSON.stringify(asyncResult);
                } catch (asyncError: any) {
                    logger.error(MODULE_DISCORD_BOT, `Async tool timeout for ${toolName}: ${asyncError.message}`, timer.elapsed('main'));
                    return JSON.stringify({ error: `Tool timeout: ${asyncError.message}` });
                }
            }

            return JSON.stringify(result);
        } catch (error: any) {
            logger.error(MODULE_DISCORD_BOT, `Tool execution failed: ${toolName}`, timer.elapsed('main'), error);
            return JSON.stringify({ error: error.message || String(error) });
        }
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
