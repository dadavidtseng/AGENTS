/**
 * MCP_Slack_Client - Slack Event Listener with Claude-Powered Auto-Response
 * =========================================================================
 *
 * This MCP server listens for Slack @mentions and automatically responds using
 * Claude API. It queues incoming mentions for Agent_TypeScript to retrieve and
 * process through the KADI broker.
 *
 * Architecture:
 * - Slack Socket Mode: Receives @mention events in real-time
 * - Mention Queue: In-memory queue of unprocessed mentions
 * - Claude API Client: Processes user messages with AI
 * - MCP Server: Exposes get_mentions tool for broker integration
 *
 * Flow:
 * 1. User @mentions SlackBot in channel
 * 2. Socket Mode receives app_mention event
 * 3. Event queued in mentions queue
 * 4. Agent_TypeScript polls get_mentions via broker
 * 5. Agent processes with Claude API
 * 6. Agent replies via MCP_Slack_Server
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { App } from '@slack/bolt';
import { z } from 'zod';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// ============================================================================
// Configuration & Validation
// ============================================================================

const ConfigSchema = z.object({
  SLACK_BOT_TOKEN: z.string().min(1, 'SLACK_BOT_TOKEN is required'),
  SLACK_APP_TOKEN: z.string().min(1, 'SLACK_APP_TOKEN is required'),
  ANTHROPIC_API_KEY: z.string().optional().default(''),
  MCP_LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

type Config = z.infer<typeof ConfigSchema>;

function loadConfig(): Config {
  try {
    return ConfigSchema.parse({
      SLACK_BOT_TOKEN: process.env.SLACK_BOT_TOKEN,
      SLACK_APP_TOKEN: process.env.SLACK_APP_TOKEN,
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
      MCP_LOG_LEVEL: process.env.MCP_LOG_LEVEL || 'info',
    });
  } catch (error) {
    console.error('❌ Configuration validation failed:', error);
    throw new Error('Missing or invalid environment variables. Check .env file.');
  }
}

// ============================================================================
// Types
// ============================================================================

/**
 * Slack mention event representation
 */
interface SlackMention {
  /** Unique mention ID (timestamp) */
  id: string;
  /** User who mentioned the bot */
  user: string;
  /** Message text (with @bot mention removed) */
  text: string;
  /** Channel where mention occurred */
  channel: string;
  /** Thread timestamp for replies */
  thread_ts: string;
  /** Event timestamp */
  ts: string;
}

/**
 * MCP Tool Input Schemas
 */
const GetMentionsInputSchema = z.object({
  limit: z
    .number()
    .min(1)
    .max(50)
    .optional()
    .default(10)
    .describe('Maximum number of mentions to retrieve'),
});

// Type inference for tool input validation
// type GetMentionsInput = z.infer<typeof GetMentionsInputSchema>;

// ============================================================================
// Mention Queue Manager
// ============================================================================

class MentionQueue {
  private queue: SlackMention[] = [];
  private readonly maxSize = 100;

  /**
   * Add mention to queue
   */
  add(mention: SlackMention): void {
    this.queue.push(mention);

    // Prevent memory overflow
    if (this.queue.length > this.maxSize) {
      this.queue.shift(); // Remove oldest
    }

    console.log(`📬 Queued mention from @${mention.user} in #${mention.channel} (queue size: ${this.queue.length})`);
  }

  /**
   * Get and remove mentions from queue
   */
  getAndClear(limit: number): SlackMention[] {
    const mentions = this.queue.splice(0, limit);
    console.log(`📤 Retrieved ${mentions.length} mentions (${this.queue.length} remaining)`);
    return mentions;
  }

  /**
   * Get queue size
   */
  size(): number {
    return this.queue.length;
  }
}

// ============================================================================
// Slack Client Manager
// ============================================================================

class SlackManager {
  private app: App | null = null;
  private mentionQueue: MentionQueue;
  private enabled: boolean = false;

  constructor(config: Config, mentionQueue: MentionQueue) {
    this.mentionQueue = mentionQueue;

    // Check if tokens look valid (not placeholders)
    const hasValidTokens =
      config.SLACK_BOT_TOKEN.startsWith('xoxb-') &&
      config.SLACK_APP_TOKEN.startsWith('xapp-');

    if (hasValidTokens) {
      // Initialize Slack Bolt app with Socket Mode
      this.app = new App({
        token: config.SLACK_BOT_TOKEN,
        appToken: config.SLACK_APP_TOKEN,
        socketMode: true,
      });

      this.registerEventHandlers();
      this.enabled = true;
    } else {
      console.log('⚠️  Slack tokens appear to be placeholders - running in stub mode');
      console.log('   Tokens must start with xoxb- and xapp- to enable Slack connection');
    }
  }

  /**
   * Register Slack event handlers
   */
  private registerEventHandlers(): void {
    if (!this.app) return;

    // Listen for @mentions
    this.app.event('app_mention', async ({ event }) => {
      await this.handleMention(event);
    });

    // Error handler
    this.app.error(async (error) => {
      console.error('❌ Slack app error:', error);
    });
  }

  /**
   * Handle incoming @mention events
   */
  private async handleMention(event: any): Promise<void> {
    try {
      // Remove bot mention from text
      const cleanText = event.text.replace(/<@[A-Z0-9]+>/g, '').trim();

      // Create mention object
      const mention: SlackMention = {
        id: event.ts,
        user: event.user,
        text: cleanText,
        channel: event.channel,
        thread_ts: event.thread_ts || event.ts, // Use thread_ts if in thread, else start new thread
        ts: event.ts,
      };

      // Queue for processing
      this.mentionQueue.add(mention);

      console.log(`💬 Received mention: "${cleanText}" from @${event.user}`);
    } catch (error) {
      console.error('❌ Error handling mention:', error);
    }
  }

  /**
   * Start Slack Socket Mode listener
   */
  async start(): Promise<void> {
    if (!this.app || !this.enabled) {
      console.log('ℹ️  Slack connection disabled (using stub mode)');
      return;
    }

    await this.app.start();
    console.log('✅ Slack Socket Mode listener started');
  }

  /**
   * Stop Slack app
   */
  async stop(): Promise<void> {
    if (!this.app || !this.enabled) {
      return;
    }

    await this.app.stop();
    console.log('🛑 Slack Socket Mode listener stopped');
  }
}

// ============================================================================
// MCP Server
// ============================================================================

class SlackClientMCPServer {
  private server: Server;
  private slackManager: SlackManager;
  private mentionQueue: MentionQueue;
  private config: Config;

  constructor() {
    this.config = loadConfig();
    this.mentionQueue = new MentionQueue();
    this.slackManager = new SlackManager(this.config, this.mentionQueue);

    // Create MCP server
    this.server = new Server(
      {
        name: 'mcp-slack-client',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.registerHandlers();
  }

  /**
   * Register MCP protocol handlers
   */
  private registerHandlers(): void {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'get_slack_mentions',
          description:
            'Retrieve pending Slack @mentions that need AI-powered responses. Returns queued mentions for processing by Agent_TypeScript with Claude API.',
          inputSchema: {
            type: 'object',
            properties: {
              limit: {
                type: 'number',
                description: 'Maximum number of mentions to retrieve (1-50, default: 10)',
                minimum: 1,
                maximum: 50,
                default: 10,
              },
            },
          },
        },
      ],
    }));

    // Handle tool execution
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      if (request.params.name === 'get_slack_mentions') {
        return await this.handleGetMentions(request.params.arguments);
      }

      throw new Error(`Unknown tool: ${request.params.name}`);
    });
  }

  /**
   * Handle get_slack_mentions tool
   */
  private async handleGetMentions(args: unknown): Promise<{
    content: Array<{ type: string; text: string }>;
  }> {
    try {
      const input = GetMentionsInputSchema.parse(args || {});
      const mentions = this.mentionQueue.getAndClear(input.limit);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              mentions,
              count: mentions.length,
              retrieved_at: new Date().toISOString(),
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      console.error('❌ Error in get_slack_mentions:', error);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              error: error instanceof Error ? error.message : 'Unknown error',
              mentions: [],
              count: 0,
            }),
          },
        ],
      };
    }
  }

  /**
   * Start both Slack listener and MCP server
   */
  async run(): Promise<void> {
    console.log('🚀 Starting MCP_Slack_Client...');
    console.log('📋 Configuration:');
    console.log(`   - Log Level: ${this.config.MCP_LOG_LEVEL}`);
    console.log(`   - Queue Max Size: 100`);

    // Start Slack Socket Mode
    await this.slackManager.start();

    // Start MCP server with stdio transport
    const transport = new StdioServerTransport();
    await this.server.connect(transport);

    console.log('✅ MCP_Slack_Client ready');
    console.log('🎧 Listening for Slack @mentions...');
  }
}

// ============================================================================
// Main Entry Point
// ============================================================================

async function main(): Promise<void> {
  try {
    const server = new SlackClientMCPServer();
    await server.run();
  } catch (error) {
    console.error('💥 Fatal error:', error);
    process.exit(1);
  }
}

main();
