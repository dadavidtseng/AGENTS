/**
 * MCP_Discord_Server - Discord Message Sending Service
 * ======================================================
 *
 * This MCP server provides Discord message sending capabilities for Claude Desktop
 * and KADI agents via the broker. It exposes minimal tools for sending messages
 * and replying in threads.
 *
 * Architecture:
 * - Stateless design (no Gateway connection for events)
 * - Discord REST API client for HTTP-based messaging
 * - MCP Server exposing send_message and send_reply tools
 * - Channel name resolution for user-friendly addressing
 *
 * Transport modes (MCP_TRANSPORT_TYPE env var):
 *   - "stdio" (default): Standard I/O transport for local/broker usage
 *   - "http": Streamable HTTP transport for containerized broker or remote access
 *     Configure port via MCP_PORT (default: 3200)
 *
 * Flow:
 * 1. Claude Desktop / Agent calls tool via broker
 * 2. MCP server resolves channel names to IDs
 * 3. Sends message via Discord REST API
 * 4. Returns success confirmation with message ID
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  isInitializeRequest,
} from '@modelcontextprotocol/sdk/types.js';
import { Client, GatewayIntentBits, TextChannel, Message } from 'discord.js';
import { z } from 'zod';
import * as dotenv from 'dotenv';
import express from 'express';
import { randomUUID } from 'node:crypto';

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
// Input Schemas
// ============================================================================

const SendMessageInputSchema = z.object({
  channel: z.string().describe('Channel ID or name (e.g., general, 1234567890)'),
  text: z.string().describe('Message text to send'),
  message_id: z
    .string()
    .optional()
    .describe('Optional message ID to reply to'),
});

const SendReplyInputSchema = z.object({
  channel: z.string().describe('Channel ID where the message exists'),
  message_id: z.string().describe('Message ID to reply to'),
  text: z.string().describe('Reply message text'),
});

// ============================================================================
// Discord Client Manager
// ============================================================================

class DiscordClient {
  private client: Client;
  private channelCache: Map<string, string> = new Map(); // name → ID mapping
  private ready: boolean = false;

  constructor(token: string) {
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
      ],
    });

    // Initialize connection
    this.initialize(token);
  }

  /**
   * Initialize Discord client connection
   */
  private async initialize(token: string): Promise<void> {
    try {
      this.client.on('ready', () => {
        this.ready = true;
        console.log(`✅ Discord client ready as ${this.client.user?.tag}`);
      });

      await this.client.login(token);
    } catch (error) {
      console.error('❌ Failed to initialize Discord client:', error);
      throw error;
    }
  }

  /**
   * Wait for client to be ready
   */
  private async waitForReady(): Promise<void> {
    if (this.ready) return;

    // Wait up to 10 seconds for ready
    let attempts = 0;
    while (!this.ready && attempts < 100) {
      await new Promise(resolve => setTimeout(resolve, 100));
      attempts++;
    }

    if (!this.ready) {
      throw new Error('Discord client not ready after timeout');
    }
  }

  /**
   * Resolve channel name to ID
   */
  private async resolveChannelId(channel: string, guildId?: string): Promise<string> {
    await this.waitForReady();

    // Already an ID (18-19 digit snowflake)
    if (/^\d{17,19}$/.test(channel)) {
      return channel;
    }

    // Remove # prefix if present
    const channelName = channel.replace(/^#/, '');

    // Check cache
    if (this.channelCache.has(channelName)) {
      return this.channelCache.get(channelName)!;
    }

    // Fetch from Discord API
    try {
      if (guildId) {
        // Search in specific guild
        const guild = await this.client.guilds.fetch(guildId);
        const channels = await guild.channels.fetch();

        for (const [id, ch] of channels) {
          if (ch?.name === channelName) {
            this.channelCache.set(channelName, id);
            return id;
          }
        }
      } else {
        // Search in all guilds
        for (const [, guild] of this.client.guilds.cache) {
          const channels = await guild.channels.fetch();
          for (const [id, ch] of channels) {
            if (ch?.name === channelName) {
              this.channelCache.set(channelName, id);
              return id;
            }
          }
        }
      }

      throw new Error(`Channel '${channelName}' not found`);
    } catch (error) {
      throw new Error(
        `Failed to resolve channel '${channel}': ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Send message to channel
   */
  async sendMessage(
    channel: string,
    text: string,
    messageId?: string,
    guildId?: string
  ): Promise<{ id: string; channelId: string }> {
    await this.waitForReady();
    const channelId = await this.resolveChannelId(channel, guildId);

    try {
      const textChannel = await this.client.channels.fetch(channelId) as TextChannel;

      if (!textChannel?.isTextBased()) {
        throw new Error('Channel is not a text channel');
      }

      let message: Message;

      if (messageId) {
        // Reply to specific message
        const targetMessage = await textChannel.messages.fetch(messageId);
        message = await targetMessage.reply(text);
      } else {
        // Send new message
        message = await textChannel.send(text);
      }

      return {
        id: message.id,
        channelId: message.channelId,
      };
    } catch (error) {
      throw new Error(
        `Failed to send message: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Send reply to message
   */
  async sendReply(
    channel: string,
    messageId: string,
    text: string,
    guildId?: string
  ): Promise<{ id: string; channelId: string }> {
    return await this.sendMessage(channel, text, messageId, guildId);
  }
}

// ============================================================================
// MCP Server
// ============================================================================

class DiscordServerMCPServer {
  private server: Server;
  private discordClient: DiscordClient;
  private config: Config;

  constructor() {
    this.config = loadConfig();
    this.discordClient = new DiscordClient(this.config.DISCORD_TOKEN);

    // Create MCP server (used for stdio transport)
    this.server = this.createServer();
  }

  /**
   * Create a new MCP Server instance with handlers registered.
   * Called once for stdio, and once per session for HTTP transport.
   */
  private createServer(): Server {
    const server = new Server(
      {
        name: 'mcp-discord-server',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.registerHandlers(server);
    return server;
  }

  /**
   * Register MCP protocol handlers
   */
  private registerHandlers(server: Server): void {
    // List available tools
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'send_message',
          description:
            'Send a message to a Discord channel. Can be used by Claude Desktop and KADI agents to send messages to channels or reply to messages.',
          inputSchema: {
            type: 'object',
            properties: {
              channel: {
                type: 'string',
                description: 'Channel ID or name (e.g., general, 1234567890)',
              },
              text: {
                type: 'string',
                description: 'Message text to send',
              },
              message_id: {
                type: 'string',
                description:
                  'Optional message ID to reply to',
              },
            },
            required: ['channel', 'text'],
          },
        },
        {
          name: 'send_reply',
          description:
            'Reply to a message in a Discord channel. Useful for maintaining conversation context.',
          inputSchema: {
            type: 'object',
            properties: {
              channel: {
                type: 'string',
                description: 'Channel ID where the message exists',
              },
              message_id: {
                type: 'string',
                description: 'Message ID to reply to',
              },
              text: {
                type: 'string',
                description: 'Reply message text',
              },
            },
            required: ['channel', 'message_id', 'text'],
          },
        },
      ],
    }));

    // Handle tool execution
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      switch (request.params.name) {
        case 'send_message':
          return await this.handleSendMessage(request.params.arguments);
        case 'send_reply':
          return await this.handleSendReply(request.params.arguments);
        default:
          throw new Error(`Unknown tool: ${request.params.name}`);
      }
    });
  }

  /**
   * Handle send_message tool
   */
  private async handleSendMessage(args: unknown): Promise<{
    content: Array<{ type: string; text: string }>;
  }> {
    try {
      const input = SendMessageInputSchema.parse(args);
      const result = await this.discordClient.sendMessage(
        input.channel,
        input.text,
        input.message_id,
        this.config.DISCORD_GUILD_ID
      );

      console.log(
        `✅ Message sent to ${input.channel} (id: ${result.id})`
      );

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                message: 'Message sent successfully',
                messageId: result.id,
                channelId: result.channelId,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      console.error('❌ Error in send_message:', error);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: error instanceof Error ? error.message : 'Unknown error',
            }),
          },
        ],
      };
    }
  }

  /**
   * Handle send_reply tool
   */
  private async handleSendReply(args: unknown): Promise<{
    content: Array<{ type: string; text: string }>;
  }> {
    try {
      const input = SendReplyInputSchema.parse(args);
      const result = await this.discordClient.sendReply(
        input.channel,
        input.message_id,
        input.text,
        this.config.DISCORD_GUILD_ID
      );

      console.log(
        `✅ Reply sent to message ${input.message_id} in ${input.channel}`
      );

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                message: 'Reply sent successfully',
                messageId: result.id,
                channelId: result.channelId,
                replyTo: input.message_id,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      console.error('❌ Error in send_reply:', error);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: error instanceof Error ? error.message : 'Unknown error',
            }),
          },
        ],
      };
    }
  }

  /**
   * Start MCP server with stdio transport
   */
  private async startStdioTransport(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.log('✅ MCP_Discord_Server ready (stdio)');
    console.log('📤 Awaiting message send requests...');
  }

  /**
   * Start MCP server with HTTP transport (Streamable HTTP)
   */
  private async startHttpTransport(): Promise<void> {
    const port = parseInt(process.env.MCP_PORT || '3200', 10);
    const app = express();
    app.use(express.json());

    const transports = new Map<string, StreamableHTTPServerTransport>();

    app.get('/healthz', (_req, res) => res.json({ status: 'ok' }));

    app.get('/mcp', async (req, res) => {
      const sessionId = req.headers['mcp-session-id'] as string | undefined;
      if (!sessionId || !transports.has(sessionId)) {
        res.status(400).json({ error: 'Invalid or missing session ID' });
        return;
      }
      await transports.get(sessionId)!.handleRequest(req, res);
    });

    app.post('/mcp', async (req, res) => {
      const sessionId = req.headers['mcp-session-id'] as string | undefined;
      try {
        if (sessionId && transports.has(sessionId)) {
          await transports.get(sessionId)!.handleRequest(req, res, req.body);
          return;
        }
        if (!sessionId && isInitializeRequest(req.body)) {
          const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (sid) => {
              transports.set(sid, transport);
              console.log(`[MCP/HTTP] Session initialized: ${sid}`);
            },
          });
          transport.onclose = () => {
            const sid = transport.sessionId;
            if (sid) transports.delete(sid);
          };
          const server = this.createServer();
          await server.connect(transport);
          await transport.handleRequest(req, res, req.body);
          return;
        }
        res.status(400).json({
          jsonrpc: '2.0',
          error: { code: -32000, message: 'Bad Request: No valid session ID provided' },
          id: null,
        });
      } catch (error: any) {
        const msg = error?.message ?? String(error);
        const stack = error?.stack ?? '(no stack)';
        console.error(`[MCP/HTTP] Error: ${msg}\n${stack}`);
        if (!res.headersSent) {
          res.status(500).json({
            jsonrpc: '2.0',
            error: { code: -32603, message: `Internal server error: ${msg}` },
            id: null,
          });
        }
      }
    });

    app.delete('/mcp', async (req, res) => {
      const sessionId = req.headers['mcp-session-id'] as string | undefined;
      if (!sessionId || !transports.has(sessionId)) {
        res.status(400).json({ error: 'Invalid or missing session ID' });
        return;
      }
      await transports.get(sessionId)!.handleRequest(req, res);
    });

    app.listen(port, () => {
      console.log(`✅ MCP_Discord_Server ready (http) → http://0.0.0.0:${port}/mcp`);
      console.log('📤 Awaiting message send requests...');
    });
  }

  /**
   * Start MCP server
   */
  async run(): Promise<void> {
    console.log('🚀 Starting MCP_Discord_Server...');
    console.log('📋 Configuration:');
    console.log(`   - Log Level: ${this.config.MCP_LOG_LEVEL}`);
    if (this.config.DISCORD_GUILD_ID) {
      console.log(`   - Guild ID: ${this.config.DISCORD_GUILD_ID}`);
    }

    const transportType = (process.env.MCP_TRANSPORT_TYPE || 'stdio').toLowerCase();
    console.log(`   - Transport: ${transportType}`);

    if (transportType === 'http') {
      await this.startHttpTransport();
    } else {
      await this.startStdioTransport();
    }
  }
}

// ============================================================================
// Main Entry Point
// ============================================================================

async function main(): Promise<void> {
  try {
    const server = new DiscordServerMCPServer();
    await server.run();
  } catch (error) {
    console.error('💥 Fatal error:', error);
    process.exit(1);
  }
}

main();
