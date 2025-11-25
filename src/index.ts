/**
 * MCP_Discord_Client - Discord Event Listener with Claude-Powered Auto-Response
 * =============================================================================
 *
 * This MCP server listens for Discord @mentions and automatically responds using
 * Claude API. It queues incoming mentions for Agent_TypeScript to retrieve and
 * process through the KADI broker.
 *
 * Architecture:
 * - Discord Gateway: Receives @mention events in real-time
 * - Mention Queue: In-memory queue of unprocessed mentions
 * - Claude API Client: Processes user messages with AI
 * - MCP Server: Exposes get_mentions tool for broker integration
 *
 * Flow:
 * 1. User @mentions DiscordBot in channel
 * 2. Gateway receives messageCreate event
 * 3. Event queued in mentions queue
 * 4. Agent_TypeScript polls get_mentions via broker
 * 5. Agent processes with Claude API
 * 6. Agent replies via MCP_Discord_Server
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { Client, GatewayIntentBits, Message, Partials } from 'discord.js';
import { z } from 'zod';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// ============================================================================
// Configuration & Validation
// ============================================================================

const ConfigSchema = z.object({
  DISCORD_TOKEN: z.string().min(1, 'DISCORD_TOKEN is required'),
  DISCORD_GUILD_ID: z.string().optional(),
  MCP_LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

type Config = z.infer<typeof ConfigSchema>;

function loadConfig(): Config {
  try {
    return ConfigSchema.parse({
      DISCORD_TOKEN: process.env.DISCORD_TOKEN,
      DISCORD_GUILD_ID: process.env.DISCORD_GUILD_ID,
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
 * Discord mention event representation
 */
interface DiscordMention {
  /** Unique mention ID (message ID) */
  id: string;
  /** User who mentioned the bot */
  user: string;
  /** User display name */
  username: string;
  /** Message text (with @bot mention removed) */
  text: string;
  /** Channel ID where mention occurred */
  channel: string;
  /** Channel name */
  channelName: string;
  /** Guild ID */
  guild: string;
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

// ============================================================================
// Mention Queue Manager
// ============================================================================

class MentionQueue {
  private queue: DiscordMention[] = [];
  private readonly maxSize = 100;

  /**
   * Add mention to queue
   */
  add(mention: DiscordMention): void {
    this.queue.push(mention);

    // Prevent memory overflow
    if (this.queue.length > this.maxSize) {
      this.queue.shift(); // Remove oldest
    }

    console.log(`📬 Queued mention from @${mention.username} in #${mention.channelName} (queue size: ${this.queue.length})`);
  }

  /**
   * Get and remove mentions from queue
   */
  getAndClear(limit: number): DiscordMention[] {
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
// Discord Client Manager
// ============================================================================

class DiscordManager {
  private client: Client | null = null;
  private mentionQueue: MentionQueue;
  private enabled: boolean = false;
  private botUserId: string | null = null;

  constructor(config: Config, mentionQueue: MentionQueue) {
    this.mentionQueue = mentionQueue;

    // Check if token looks valid (not placeholder)
    const hasValidToken =
      config.DISCORD_TOKEN.length > 50 &&
      !config.DISCORD_TOKEN.includes('YOUR_');

    if (hasValidToken) {
      // Initialize Discord client with Gateway intents
      this.client = new Client({
        intents: [
          GatewayIntentBits.Guilds,
          GatewayIntentBits.GuildMessages,
          GatewayIntentBits.MessageContent,
          GatewayIntentBits.DirectMessages,
        ],
        partials: [Partials.Channel],
      });

      this.registerEventHandlers();
      this.enabled = true;
    } else {
      console.log('⚠️  Discord token appears to be placeholder - running in stub mode');
      console.log('   Token must be a valid Discord bot token to enable connection');
    }
  }

  /**
   * Register Discord event handlers
   */
  private registerEventHandlers(): void {
    if (!this.client) return;

    // Listen for ready event to get bot user ID
    this.client.on('ready', () => {
      if (!this.client?.user) return;
      this.botUserId = this.client.user.id;
      console.log(`✅ Discord bot logged in as ${this.client.user.tag}`);
    });

    // Listen for @mentions
    this.client.on('messageCreate', async (message: Message) => {
      await this.handleMessage(message);
    });

    // Error handler
    this.client.on('error', (error) => {
      console.error('❌ Discord client error:', error);
    });
  }

  /**
   * Handle incoming message events (check for @mentions)
   */
  private async handleMessage(message: Message): Promise<void> {
    try {
      // Ignore messages from bots
      if (message.author.bot) return;

      // Check if bot was mentioned
      if (!this.botUserId || !message.mentions.has(this.botUserId)) return;

      // Remove bot mention from text
      const cleanText = message.content
        .replace(new RegExp(`<@!?${this.botUserId}>`, 'g'), '')
        .trim();

      // Create mention object
      const mention: DiscordMention = {
        id: message.id,
        user: message.author.id,
        username: message.author.username,
        text: cleanText,
        channel: message.channelId,
        channelName: message.channel.isDMBased() ? 'DM' : (message.channel.isTextBased() ? (message.channel as any).name || 'unknown' : 'unknown'),
        guild: message.guildId || 'DM',
        ts: message.createdAt.toISOString(),
      };

      // Queue for processing
      this.mentionQueue.add(mention);

      console.log(`💬 Received mention: "${cleanText}" from @${message.author.username}`);
    } catch (error) {
      console.error('❌ Error handling message:', error);
    }
  }

  /**
   * Start Discord Gateway listener
   */
  async start(): Promise<void> {
    if (!this.client || !this.enabled) {
      console.log('ℹ️  Discord connection disabled (using stub mode)');
      return;
    }

    const config = loadConfig();
    await this.client.login(config.DISCORD_TOKEN);
    console.log('🔗 Discord Gateway connection initiated...');
  }

  /**
   * Stop Discord client
   */
  async stop(): Promise<void> {
    if (!this.client || !this.enabled) {
      return;
    }

    this.client.destroy();
    console.log('🛑 Discord Gateway listener stopped');
  }
}

// ============================================================================
// MCP Server
// ============================================================================

class DiscordClientMCPServer {
  private server: Server;
  private discordManager: DiscordManager;
  private mentionQueue: MentionQueue;
  private config: Config;

  constructor() {
    this.config = loadConfig();
    this.mentionQueue = new MentionQueue();
    this.discordManager = new DiscordManager(this.config, this.mentionQueue);

    // Create MCP server
    this.server = new Server(
      {
        name: 'mcp-discord-client',
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
          name: 'get_discord_mentions',
          description:
            'Retrieve pending Discord @mentions that need AI-powered responses. Returns queued mentions for processing by Agent_TypeScript with Claude API.',
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
      if (request.params.name === 'get_discord_mentions') {
        return await this.handleGetMentions(request.params.arguments);
      }

      throw new Error(`Unknown tool: ${request.params.name}`);
    });
  }

  /**
   * Handle get_discord_mentions tool
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
      console.error('❌ Error in get_discord_mentions:', error);
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
   * Start both Discord listener and MCP server
   */
  async run(): Promise<void> {
    console.log('🚀 Starting MCP_Discord_Client...');
    console.log('📋 Configuration:');
    console.log(`   - Log Level: ${this.config.MCP_LOG_LEVEL}`);
    console.log(`   - Queue Max Size: 100`);

    // Start Discord Gateway
    await this.discordManager.start();

    // Start MCP server with stdio transport
    const transport = new StdioServerTransport();
    await this.server.connect(transport);

    console.log('✅ MCP_Discord_Client ready');
    console.log('🎧 Listening for Discord @mentions...');
  }
}

// ============================================================================
// Main Entry Point
// ============================================================================

async function main(): Promise<void> {
  try {
    const server = new DiscordClientMCPServer();
    await server.run();
  } catch (error) {
    console.error('💥 Fatal error:', error);
    process.exit(1);
  }
}

main();
