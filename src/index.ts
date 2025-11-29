/**
 * mcp-server-slack - Slack Message Sending Service
 * =================================================
 *
 * This MCP server provides Slack message sending capabilities for Claude Desktop
 * and KADI agents via the broker. It exposes minimal tools for sending messages
 * and replying in threads.
 *
 * Architecture:
 * - Stateless design (no Socket Mode, no event listening)
 * - Slack Web API client for HTTP-based messaging
 * - MCP Server exposing send_message and send_reply tools
 * - Channel name resolution for user-friendly addressing
 *
 * Flow:
 * 1. Claude Desktop / Agent calls tool via broker
 * 2. MCP server resolves channel names to IDs
 * 3. Sends message via Slack Web API
 * 4. Returns success confirmation with timestamp
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { WebClient } from '@slack/web-api';
import { z } from 'zod';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// ============================================================================
// Configuration & Validation
// ============================================================================

const ConfigSchema = z.object({
  SLACK_BOT_TOKEN: z.string().startsWith('xoxb-'),
  MCP_LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

type Config = z.infer<typeof ConfigSchema>;

function loadConfig(): Config {
  try {
    return ConfigSchema.parse({
      SLACK_BOT_TOKEN: process.env.SLACK_BOT_TOKEN,
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
  channel: z.string().describe('Channel ID or name (e.g., #general, C12345)'),
  text: z.string().describe('Message text to send'),
  thread_ts: z
    .string()
    .optional()
    .describe('Optional thread timestamp to reply in thread'),
});

const SendReplyInputSchema = z.object({
  channel: z.string().describe('Channel ID where the thread exists'),
  thread_ts: z.string().describe('Thread timestamp to reply to'),
  text: z.string().describe('Reply message text'),
});

// Type inference for tool input validation
// type SendMessageInput = z.infer<typeof SendMessageInputSchema>;
// type SendReplyInput = z.infer<typeof SendReplyInputSchema>;

// ============================================================================
// Slack Client Manager
// ============================================================================

class SlackClient {
  private client: WebClient;
  private channelCache: Map<string, string> = new Map(); // name → ID mapping

  constructor(token: string) {
    this.client = new WebClient(token);
  }

  /**
   * Resolve channel name to ID
   */
  private async resolveChannelId(channel: string): Promise<string> {
    // Already an ID
    if (channel.startsWith('C') || channel.startsWith('D')) {
      return channel;
    }

    // Remove # prefix
    const channelName = channel.replace(/^#/, '');

    // Check cache
    if (this.channelCache.has(channelName)) {
      return this.channelCache.get(channelName)!;
    }

    // Fetch from Slack API
    try {
      const result = await this.client.conversations.list({
        types: 'public_channel,private_channel',
        limit: 1000,
      });

      if (!result.channels) {
        throw new Error('Failed to fetch channels');
      }

      // Build cache
      for (const ch of result.channels) {
        if (ch.name && ch.id) {
          this.channelCache.set(ch.name, ch.id);
        }
      }

      // Lookup
      const channelId = this.channelCache.get(channelName);
      if (!channelId) {
        throw new Error(`Channel '#${channelName}' not found`);
      }

      return channelId;
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
    thread_ts?: string
  ): Promise<{ ts: string; channel: string }> {
    const channelId = await this.resolveChannelId(channel);

    try {
      const result = await this.client.chat.postMessage({
        channel: channelId,
        text,
        thread_ts,
      });

      if (!result.ok || !result.ts) {
        throw new Error('Message send failed');
      }

      return {
        ts: result.ts,
        channel: result.channel || channelId,
      };
    } catch (error) {
      throw new Error(
        `Failed to send message: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Send reply in thread
   */
  async sendReply(
    channel: string,
    thread_ts: string,
    text: string
  ): Promise<{ ts: string; channel: string }> {
    return await this.sendMessage(channel, text, thread_ts);
  }
}

// ============================================================================
// MCP Server
// ============================================================================

class SlackServerMCPServer {
  private server: Server;
  private slackClient: SlackClient;
  private config: Config;

  constructor() {
    this.config = loadConfig();
    this.slackClient = new SlackClient(this.config.SLACK_BOT_TOKEN);

    // Create MCP server
    this.server = new Server(
      {
        name: 'mcp-slack-server',
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
          name: 'send_message',
          description:
            'Send a message to a Slack channel. Can be used by Claude Desktop and KADI agents to send messages to channels or start new threads.',
          inputSchema: {
            type: 'object',
            properties: {
              channel: {
                type: 'string',
                description: 'Channel ID or name (e.g., #general, C09T6RU41HP)',
              },
              text: {
                type: 'string',
                description: 'Message text to send',
              },
              thread_ts: {
                type: 'string',
                description:
                  'Optional thread timestamp to reply in an existing thread',
              },
            },
            required: ['channel', 'text'],
          },
        },
        {
          name: 'send_reply',
          description:
            'Reply to a message in a Slack thread. Useful for maintaining conversation context.',
          inputSchema: {
            type: 'object',
            properties: {
              channel: {
                type: 'string',
                description: 'Channel ID where the thread exists',
              },
              thread_ts: {
                type: 'string',
                description: 'Thread timestamp to reply to',
              },
              text: {
                type: 'string',
                description: 'Reply message text',
              },
            },
            required: ['channel', 'thread_ts', 'text'],
          },
        },
      ],
    }));

    // Handle tool execution
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
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
      const result = await this.slackClient.sendMessage(
        input.channel,
        input.text,
        input.thread_ts
      );

      console.log(
        `✅ Message sent to ${input.channel} (ts: ${result.ts})`
      );

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                message: 'Message sent successfully',
                timestamp: result.ts,
                channel: result.channel,
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
      const result = await this.slackClient.sendReply(
        input.channel,
        input.thread_ts,
        input.text
      );

      console.log(
        `✅ Reply sent to thread ${input.thread_ts} in ${input.channel}`
      );

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                message: 'Reply sent successfully',
                timestamp: result.ts,
                channel: result.channel,
                thread_ts: input.thread_ts,
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
   * Start MCP server
   */
  async run(): Promise<void> {
    console.log('🚀 Starting MCP_Slack_Server...');
    console.log('📋 Configuration:');
    console.log(`   - Log Level: ${this.config.MCP_LOG_LEVEL}`);

    // Start MCP server with stdio transport
    const transport = new StdioServerTransport();
    await this.server.connect(transport);

    console.log('✅ MCP_Slack_Server ready');
    console.log('📤 Awaiting message send requests...');
  }
}

// ============================================================================
// Main Entry Point
// ============================================================================

async function main(): Promise<void> {
  try {
    const server = new SlackServerMCPServer();
    await server.run();
  } catch (error) {
    console.error('💥 Fatal error:', error);
    process.exit(1);
  }
}

main();
