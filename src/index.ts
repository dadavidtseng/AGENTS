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
import { KadiEventPublisher } from './kadi-publisher.js';

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
  KADI_BROKER_URL: z.string().url('KADI_BROKER_URL must be a valid WebSocket URL').describe('KĀDI broker WebSocket URL'),
  SLACK_BOT_USER_ID: z.string().regex(/^U[A-Z0-9]+$/, 'SLACK_BOT_USER_ID must be a valid Slack user ID (format: U*)').describe('Slack bot user ID for event routing'),
});

export type Config = z.infer<typeof ConfigSchema>;

function loadConfig(): Config {
  try {
    return ConfigSchema.parse({
      SLACK_BOT_TOKEN: process.env.SLACK_BOT_TOKEN,
      SLACK_APP_TOKEN: process.env.SLACK_APP_TOKEN,
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
      MCP_LOG_LEVEL: process.env.MCP_LOG_LEVEL || 'info',
      KADI_BROKER_URL: process.env.KADI_BROKER_URL,
      SLACK_BOT_USER_ID: process.env.SLACK_BOT_USER_ID,
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

// ============================================================================
// Slack Client Manager
// ============================================================================

class SlackManager {
  private app: App | null = null;
  private publisher: KadiEventPublisher | null = null;
  private enabled: boolean = false;
  private botUserId: string = '';

  constructor(config: Config, publisher: KadiEventPublisher | null = null) {
    this.publisher = publisher;

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

      // Publish to KĀDI event bus (non-blocking)
      if (this.publisher && this.botUserId) {
        this.publisher.publishMention(mention, this.botUserId).catch(error => {
          console.error('[KĀDI] Failed to publish mention event:', error);
          // Don't block Slack processing on publish failure
        });
      }

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

    // Extract bot user ID from Slack SDK
    try {
      const authResult = await this.app.client.auth.test();
      this.botUserId = authResult.user_id || '';
      console.log(`🤖 Bot user ID: ${this.botUserId}`);
    } catch (error) {
      console.error('❌ Failed to retrieve bot user ID:', error);
    }
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
  private publisher: KadiEventPublisher;
  private config: Config;

  constructor() {
    this.config = loadConfig();
    this.publisher = new KadiEventPublisher(this.config);
    this.slackManager = new SlackManager(this.config, this.publisher);

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
      tools: [],
    }));

    // Handle tool execution
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      throw new Error(`Unknown tool: ${request.params.name}`);
    });
  }

  /**
   * Start both Slack listener and MCP server
   */
  async run(): Promise<void> {
    console.log('🚀 Starting MCP_Slack_Client...');
    console.log('📋 Configuration:');
    console.log(`   - Log Level: ${this.config.MCP_LOG_LEVEL}`);

    // Start Slack Socket Mode
    await this.slackManager.start();

    // Connect to KĀDI broker FIRST (before MCP stdio transport)
    await this.publisher.connect();

    // Check if running in standalone mode (no stdio parent process)
    const isStandalone = process.env.STANDALONE_MODE === 'true';

    if (isStandalone) {
      console.log('✅ MCP_Slack_Client ready (standalone KĀDI client mode)');
      console.log('🎧 Listening for Slack @mentions...');

      // Keep process alive in standalone mode
      process.on('SIGINT', async () => {
        console.log('\n🛑 Shutting down gracefully...');
        await this.slackManager.stop();
        await this.publisher.disconnect();
        process.exit(0);
      });
    } else {
      // Start MCP server with stdio transport (for broker-managed mode)
      const transport = new StdioServerTransport();
      await this.server.connect(transport);

      console.log('✅ MCP_Slack_Client ready (MCP upstream mode)');
      console.log('🎧 Listening for Slack @mentions...');
    }
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
