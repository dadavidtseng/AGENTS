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
import {DiscordMentionEventSchema} from '../types/discord-events.js';
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
    async start(): Promise<void> {
        logger.info(MODULE_DISCORD_BOT, 'Starting Discord bot (event-driven mode)...', timer.elapsed('main'));

        // Initialize ability response subscription from BaseBot
        await this.initializeAbilityResponseSubscription();

        // Subscribe to Discord mention events
        await this.subscribeToMentions();
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
    private async subscribeToMentions(): Promise<void> {
        const topic = `discord.mention.${this.botUserId}`;

        logger.info(MODULE_DISCORD_BOT, `Subscriber: Registering subscription {topic: ${topic}, botUserId: ${this.botUserId}}`, timer.elapsed('main'));

        try {
            await this.client.subscribe(topic, async (event: any) => {
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
                    const errorDetails = validationResult.error.issues.map((e: any) => `${e.path.join('.')}: ${e.message}`).join(', ');
                    logger.error(MODULE_DISCORD_BOT, `Subscriber: Event validation failed {errors: [${errorDetails}]}`, timer.elapsed('main'));
                    return;
                }

                const mention = validationResult.data;

                // Truncate text for logging (don't log full message content)
                const textPreview = mention.text.length > 50
                    ? mention.text.substring(0, 50) + '...'
                    : mention.text;

                logger.info(MODULE_DISCORD_BOT, `Subscriber: Event received {mentionId: ${mention.id}, user: ${mention.username}, channel: ${mention.channelName}, guild: ${mention.guild}, textPreview: \"${textPreview}\", timestamp: ${mention.timestamp}}`, timer.elapsed('main'));

                // Convert to DiscordMention format for existing processing logic
                const discordMention: DiscordMention = {
                    id: mention.id,
                    user: mention.user,
                    text: mention.text,
                    channel: mention.channel,
                    thread_ts: mention.id, // Use message ID as thread identifier
                    ts: mention.ts,
                };

                // Process mention using existing logic (non-blocking to prevent event queue backup)
                this.handleMention(discordMention).catch(error => {
                    logger.error(MODULE_DISCORD_BOT, `Subscriber: Error handling mention {mentionId: ${discordMention.id}}`, timer.elapsed('main'), error);
                });
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
            logger.info(MODULE_DISCORD_BOT, `Processing mention from @${mention.user}: \"${mention.text}\"`, timer.elapsed('main'));

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
        try {
            // Get list of available KADI tools (dynamically from client and broker)
            const availableTools = await this.getAvailableTools();

            // Call Claude API
            let response = await this.anthropic.messages.create({
                model: process.env.BOT_CLAUDE_MODEL || 'claude-3-haiku-20240307',
                max_tokens: parseInt(process.env.BOT_CLAUDE_MAX_TOKENS || '4096'),
                tools: availableTools,
                system: `You are KADI Bot, an AI assistant that helps manage tasks using the KADI protocol.

CRITICAL: When using the list_active_tasks tool, ALWAYS format the results as follows:
1. Display tasks in numerical order (sorted by task ID)
2. Use this exact format for each task:
   [Task ID] - [Task Name]
3. Include a header showing the total count
4. Example format:

   Active Tasks (Total: 3):
   1. 08532952-04c1-4afb-93bd-ed674446bfd8 - Implement Monitoring and Auditing
   2. 14bc4c95-fd88-4680-957f-5185ad522501 - Create placeholder task for testing purposes
   3. 5166ce3c-fdc6-42f6-a1e6-d9975ba38bdc - Placeholder Task for Testing

Do NOT summarize or paraphrase task lists - always show the complete numbered list with IDs and names.

CRITICAL: When approving a task using the approve_completion tool:
1. Extract the task ID from the user's message
2. Provide a meaningful summary (e.g., "Task approved by user via Discord")
3. Provide a score between 0-100 (default to 90 if user doesn't specify)
4. Example: User says "I approve task abc-123" -> call approve_completion with:
   - taskId: "abc-123"
   - summary: "Task approved by user via Discord"
   - score: 90

CRITICAL: When responding to users after using tools:
- Be concise and user-friendly
- For approve_completion: Say "✅ Task [taskId] has been approved!" (not technical details about the function)
- For assign_task: Say "✅ Task assigned to [role] agent"
- Avoid mentioning technical details like "the function was used" or internal implementation details`,
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

            // Track if plan_task, list_active_tasks, or get_task_status was called and their results
            let planTaskResult: any = null;
            let listTasksResult: any = null;
            let taskStatusResult: any = null;

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

                    // If this is assign_task, record channel context for notifications
                    if (toolBlock.name === 'assign_task' && result && typeof result === 'object' && result.taskId) {
                        const { taskChannelMap } = await import('../index.js');
                        taskChannelMap.set(result.taskId, {
                            type: 'discord',
                            channelId: mention.channel,
                            userId: mention.user
                        });
                        logger.info(MODULE_DISCORD_BOT, `Recorded Discord channel context for task ${result.taskId}`, timer.elapsed('main'));
                    }

                    // If this is plan_task, save the result
                    if (toolBlock.name === 'plan_task' && result && typeof result === 'object' && result.message) {
                        planTaskResult = result;
                    }

                    // If this is list_active_tasks, save the result and format it
                    if (toolBlock.name === 'list_active_tasks' && result && typeof result === 'object' && result.tasks) {
                        listTasksResult = result;
                    }

                    // If this is get_task_status, save the result and format it
                    if (toolBlock.name === 'get_task_status' && result && typeof result === 'object' && result.taskId) {
                        taskStatusResult = result;
                    }

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

            // Determine final response text
            let finalText: string;

            if (planTaskResult && planTaskResult.message) {
                // Use the pre-formatted message from plan_task directly
                finalText = planTaskResult.message;
            } else if (listTasksResult && listTasksResult.tasks) {
                // Format list_active_tasks results directly
                const tasks = listTasksResult.tasks;
                const total = listTasksResult.total || tasks.length;

                // Sort tasks by ID
                const sortedTasks = [...tasks].sort((a: any, b: any) => a.id.localeCompare(b.id));

                // Format as numbered list
                finalText = `Active Tasks (Total: ${total}):\n`;
                sortedTasks.forEach((task: any, index: number) => {
                    finalText += `${index + 1}. ${task.id} - ${task.name}\n`;
                });
            } else if (taskStatusResult && taskStatusResult.taskId) {
                // Format get_task_status results directly
                finalText = `Task Status:\n`;
                finalText += `ID: ${taskStatusResult.taskId}\n`;
                finalText += `Name: ${taskStatusResult.description}\n`;
                finalText += `Status: ${taskStatusResult.status}\n`;
                if (taskStatusResult.role) {
                    finalText += `Role: ${taskStatusResult.role}\n`;
                }
                if (taskStatusResult.progress) {
                    finalText += `\nProgress:\n`;
                    if (taskStatusResult.progress.filesCreated && taskStatusResult.progress.filesCreated.length > 0) {
                        finalText += `  - Files Created: ${taskStatusResult.progress.filesCreated.join(', ')}\n`;
                    }
                    if (taskStatusResult.progress.filesModified && taskStatusResult.progress.filesModified.length > 0) {
                        finalText += `  - Files Modified: ${taskStatusResult.progress.filesModified.join(', ')}\n`;
                    }
                    if (taskStatusResult.progress.commitSha) {
                        finalText += `  - Commit SHA: ${taskStatusResult.progress.commitSha}\n`;
                    }
                    if (taskStatusResult.progress.errorMessage) {
                        finalText += `  - Error: ${taskStatusResult.progress.errorMessage}\n`;
                    }
                }
            } else {
                // For other tools, use Claude's response
                finalText = response.content
                    .filter((block) => block.type === 'text')
                    .map((block: any) => block.text)
                    .join('\n');
            }

            // Reply to Discord
            await this.sendDiscordReply(mention.channel, mention.id, finalText);

            logger.info(MODULE_DISCORD_BOT, `Replied to @${mention.user}`, timer.elapsed('main'));
        } catch (error: any) {
            logger.error(MODULE_DISCORD_BOT, `Error processing mention from @${mention.user}`, timer.elapsed('main'), error);

            // Send error message to Discord
            await this.sendDiscordReply(
                mention.channel,
                mention.id,
                'Sorry, I encountered an error processing your message. Please try again later.'
            );
        }
    }

    /**
     * Execute a KADI tool via broker
     */
    private async executeKadiTool(
        toolName: string,
        input: Record<string, unknown>
    ): Promise<any> {
        try {
            logger.info(MODULE_DISCORD_BOT, `Executing tool: ${toolName}`, timer.elapsed('main'));
            logger.debug(MODULE_DISCORD_BOT, `Tool input: ${JSON.stringify(input).substring(0, 200)}...`, timer.elapsed('main'));

            // Determine target agent based on tool name
            const targetAgent = this.resolveTargetAgent(toolName);
            logger.info(MODULE_DISCORD_BOT, `Target agent: ${targetAgent}`, timer.elapsed('main'));

            let result: any;

            // Handle local tools (registered on this agent)
            if (targetAgent === 'local') {
                logger.info(MODULE_DISCORD_BOT, `Invoking local tool handler...`, timer.elapsed('main'));
                // Get the tool handler from the client's registered tools
                const agentInfo = this.client.readAgentJson();
                const toolDef = agentInfo.tools.find((t: any) => t.name === toolName);

                if (!toolDef) {
                    throw new Error(`Local tool ${toolName} not found in registered tools`);
                }

                // For local tools, we need to invoke them through the client
                // Since we don't have direct access to handlers, use invokeRemote
                result = await this.client.invokeRemote(toolName, input, { timeout: 30000 });
            } else {
                // Handle network tools via client.invokeRemote
                result = await this.client.invokeRemote(toolName, input, { timeout: 30000 });
            }

            const resultStr = result ? JSON.stringify(result) : 'undefined';
            logger.debug(MODULE_DISCORD_BOT, `Tool result received: ${resultStr.substring(0, 300)}...`, timer.elapsed('main'));

            // Handle MCP tool response format
            if (result && typeof result === 'object') {
                // MCP tools return { content: [{ type: 'text', text: '...' }] }
                if (Array.isArray(result.content)) {
                    const textContent = result.content
                        .filter((item: any) => item.type === 'text')
                        .map((item: any) => item.text)
                        .join('\n');
                    return textContent || JSON.stringify(result);
                }

                // Handle list_tools special format with presentation layer
                if (result.presentation && result.presentation.details) {
                    // Return formatted presentation for list_tools
                    return `${result.presentation.summary}\n\n${result.presentation.details}`;
                }

                // Some tools return { result: { ... } }
                if (result.result !== undefined) {
                    return result.result;
                }

                // Return the whole result object as fallback
                return result;
            }

            return result;
        } catch (error: any) {
            logger.error(MODULE_DISCORD_BOT, `Tool execution failed (${toolName})`, timer.elapsed('main'), error);

            // Extract useful error message for Claude
            const errorMessage = error.message || String(error);
            return `Error executing tool: ${errorMessage}`;
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
            // Check if client is connected to any broker
            if (!this.client.isConnected()) {
                logger.debug(MODULE_DISCORD_BOT, 'No broker connection available for network tool discovery', timer.elapsed('main'));
                return [];
            }

            // Use kadi-core v0.6.0+ API to discover tools from broker
            // The broker returns tools with their schemas in the format:
            // { tools: [{ name, description, inputSchema, tags, providers }] }
            const response = await this.client.invokeRemote<{ tools: Array<{
                name: string;
                description?: string;
                inputSchema?: Record<string, unknown>;
                tags?: string[];
            }> }>('kadi.ability.list', { includeProviders: false });

            if (!response?.tools || !Array.isArray(response.tools)) {
                logger.warn(MODULE_DISCORD_BOT, 'Invalid response from kadi.ability.list', timer.elapsed('main'));
                return [];
            }

            // Convert broker tools to Anthropic format
            const networkTools: Anthropic.Tool[] = response.tools.map(tool => ({
                name: tool.name,
                description: tool.description || '',
                input_schema: tool.inputSchema as Anthropic.Tool.InputSchema || {
                    type: 'object',
                    properties: {},
                    required: []
                }
            }));

            logger.debug(MODULE_DISCORD_BOT, `Discovered ${networkTools.length} network tools from broker`, timer.elapsed('main'));
            return networkTools;
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
        const agentInfo = this.client.readAgentJson();
        const localTools = agentInfo.tools.map((tool: any) => ({
            name: tool.name,
            description: tool.description || '',
            input_schema: tool.inputSchema as Anthropic.Tool.InputSchema
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
        // Local tools on agent-producer (exact matches to avoid conflicts)
        const localTools = ['plan_task', 'list_active_tasks', 'get_task_status', 'assign_task', 'approve_completion'];
        if (localTools.includes(toolName)) {
            return 'local'; // Special marker for local tools on this agent
        }
        if (toolName.startsWith('slack_')) {
            return 'slack-server';
        }
        if (toolName.startsWith('discord_')) {
            return 'discord-server';
        }
        if (toolName.startsWith('git_')) {
            return 'git';
        }
        if (toolName.startsWith('shrimp_')) {
            return 'mcp-server-shrimp-agent-playground';
        }

        // Default: assume it's a network tool
        return 'unknown';
    }
}
