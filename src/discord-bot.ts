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
import {DiscordMentionEventSchema} from './types/discord-events.js';
import {BaseBot, BaseBotConfig} from '@agents/shared';

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
        console.log('🤖 Starting Discord bot (event-driven mode)...');

        // Initialize protocol from BaseBot
        this.initializeProtocol();

        // Subscribe to Discord mention events
        this.subscribeToMentions();
    }

    /**
     * Stop Discord bot
     */
    stop(): void {
        console.log('🛑 Discord bot stopped');
    }

    /**
     * Subscribe to Discord mention events via KĀDI event bus
     */
    private subscribeToMentions(): void {
        const topic = `discord.mention.${this.botUserId}`;

        console.log(`[KĀDI] Subscriber: Registering subscription {topic: ${topic}, botUserId: ${this.botUserId}}`);

        try {
            this.client.subscribeToEvent(topic, async (event: unknown) => {
                // Check circuit breaker before processing
                if (this.checkCircuitBreaker()) {
                    console.warn('[KĀDI] Subscriber: Event processing skipped {reason: circuit breaker OPEN}');
                    return;
                }

                // Extract event data from KĀDI envelope
                // KĀDI wraps events in: { eventName, data, timestamp, source, metadata }
                const eventData = (event as any)?.data || event;

                // Validate event payload with schema
                const validationResult = DiscordMentionEventSchema.safeParse(eventData);

                if (!validationResult.success) {
                    const errorDetails = validationResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
                    console.error(`[KĀDI] Subscriber: Event validation failed {errors: [${errorDetails}]}`);
                    return;
                }

                const mention = validationResult.data;

                // Truncate text for logging (don't log full message content)
                const textPreview = mention.text.length > 50
                    ? mention.text.substring(0, 50) + '...'
                    : mention.text;

                console.log(`[KĀDI] Subscriber: Event received {mentionId: ${mention.id}, user: ${mention.username}, channel: ${mention.channelName}, guild: ${mention.guild}, textPreview: "${textPreview}", timestamp: ${mention.timestamp}}`);

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

            console.log(`[KĀDI] Subscriber: Subscription registered successfully {topic: ${topic}}`);
        } catch (error: any) {
            console.error(`[KĀDI] Subscriber: Subscription registration failed {topic: ${topic}, error: ${error.message || 'Unknown error'}}`);
        }
    }

    /**
     * Handle a Discord mention event from KĀDI broker
     */
    protected async handleMention(mention: DiscordMention): Promise<void> {
        try {
            console.log(`💬 Processing mention from @${mention.user}: "${mention.text}"`);

            // Process mention using existing logic
            await this.processMention(mention);
        } catch (error: any) {
            console.error(`❌ Error handling mention from @${mention.user}:`, error);

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
            // Get list of available KADI tools
            const availableTools = this.getAvailableTools();

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

            console.log(`✅ Replied to @${mention.user}`);
        } catch (error: any) {
            console.error(`❌ Error processing mention from @${mention.user}:`, error);

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
        if (!this.protocol) {
            return {success: false, error: 'Protocol not initialized'};
        }

        try {
            console.log(`🔧 Executing tool: ${toolName}`);

            // Determine target agent based on tool name
            const targetAgent = this.resolveTargetAgent(toolName);

            const result = await this.protocol.invokeTool({
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
            console.error(`❌ Tool execution failed (${toolName}):`, error);
            return {success: false, error: String(error)};
        }
    }

    /**
     * Send reply to Discord via MCP_Discord_Server
     */
    private async sendDiscordReply(
        channel: string,
        message_id: string,
        text: string
    ): Promise<void> {
        if (!this.protocol) {
            console.error('❌ Cannot send Discord reply: protocol not initialized');
            return;
        }

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
    }

    /**
     * Get available KADI tools formatted for Claude API
     */
    private getAvailableTools(): Anthropic.Tool[] {
        // Hardcoded list of available tools
        // TODO: Dynamically fetch from broker via kadi.tools.list
        return [
            {
                name: 'format_text',
                description: 'Format text to uppercase, lowercase, capitalize, or title case. Use this when user asks to convert text case or format text in different styles.',
                input_schema: {
                    type: 'object',
                    properties: {
                        text: {type: 'string', description: 'Text to format'},
                        style: {
                            type: 'string',
                            enum: ['uppercase', 'lowercase', 'capitalize', 'title'],
                            description: 'Formatting style: uppercase (ALL CAPS), lowercase (all lowercase), capitalize (First letter), title (Each Word Capitalized)',
                        },
                    },
                    required: ['text', 'style'],
                },
            },
            {
                name: 'reverse_text',
                description: 'Reverse the character order in text. Use this when user asks to reverse, flip, or mirror text.',
                input_schema: {
                    type: 'object',
                    properties: {
                        text: {type: 'string', description: 'Text to reverse'},
                    },
                    required: ['text'],
                },
            },
            {
                name: 'count_words',
                description: 'Count words, characters, and lines in text. Use this when user asks how many words, characters, or lines are in text.',
                input_schema: {
                    type: 'object',
                    properties: {
                        text: {type: 'string', description: 'Text to count words in'},
                    },
                    required: ['text'],
                },
            },
            {
                name: 'trim_text',
                description: 'Remove whitespace from text. Use this when user asks to trim, remove spaces, or clean up whitespace.',
                input_schema: {
                    type: 'object',
                    properties: {
                        text: {type: 'string', description: 'Text to trim'},
                        mode: {
                            type: 'string',
                            enum: ['both', 'start', 'end'],
                            description: 'Trimming mode: both (trim both sides), start (trim beginning only), end (trim ending only)',
                        },
                    },
                    required: ['text', 'mode'],
                },
            },
            {
                name: 'validate_json',
                description: 'Validate and parse JSON strings. Use this when user asks to validate JSON, check if JSON is valid, or parse JSON.',
                input_schema: {
                    type: 'object',
                    properties: {
                        json_string: {type: 'string', description: 'JSON string to validate and parse'},
                    },
                    required: ['json_string'],
                },
            },
            {
                name: 'git_git_status',
                description: 'Get current git repository status showing branch, staged/unstaged changes, untracked files, and conflicts. Use when user asks about git status, current changes, or repository state. Returns structured status information.',
                input_schema: {
                    type: 'object',
                    properties: {},
                    required: [],
                },
            },
            {
                name: 'git_git_log',
                description: 'Show git commit history. Use this when user asks about recent commits, commit history, or git log.',
                input_schema: {
                    type: 'object',
                    properties: {
                        maxCount: {
                            type: 'number',
                            description: 'Maximum number of commits to show (default: 10)',
                        },
                    },
                    required: [],
                },
            },
            {
                name: 'git_git_diff',
                description: 'Show differences between working directory and last commit, or between commits. Use when user asks what changed, show diff, or compare versions.',
                input_schema: {
                    type: 'object',
                    properties: {
                        target: {
                            type: 'string',
                            description: 'Optional: commit hash, branch name, or file path to diff',
                        },
                    },
                    required: [],
                },
            },
            {
                name: 'git_git_branch',
                description: 'List, create, or delete git branches. Use when user asks about branches, create branch, or delete branch.',
                input_schema: {
                    type: 'object',
                    properties: {
                        action: {
                            type: 'string',
                            enum: ['list', 'create', 'delete'],
                            description: 'Action to perform: list (show all branches), create (new branch), delete (remove branch)',
                        },
                        branchName: {
                            type: 'string',
                            description: 'Branch name (required for create/delete actions)',
                        },
                    },
                    required: ['action'],
                },
            },
            {
                name: 'git_git_set_working_dir',
                description: 'Set the working directory for subsequent git operations. Use this BEFORE other git commands when user specifies a directory path. This persists the directory across tool calls in the same session.',
                input_schema: {
                    type: 'object',
                    properties: {
                        path: {
                            type: 'string',
                            description: 'Absolute path to the git repository directory (e.g., "C:\\\\p4\\\\Personal\\\\SD\\\\template-agent-typescript")',
                        },
                    },
                    required: ['path'],
                },
            },
        ];
    }

    /**
     * Resolve target agent for a tool name
     */
    private resolveTargetAgent(toolName: string): string {
        // Simple prefix-based routing
        if (toolName.startsWith('format_') || toolName.startsWith('count_') || toolName.startsWith('validate_') || toolName.startsWith('reverse_') || toolName.startsWith('trim_')) {
            return 'text-processor'; // Agent_TypeScript's own name
        }
        if (toolName.startsWith('discord_')) {
            return 'discord-server';
        }
        if (toolName.startsWith('git_')) {
            return 'git';
        }

        // Default: assume it's a global tool
        return 'text-processor';
    }
}
