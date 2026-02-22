/**
 * agent-chatbot — KĀDI Chat Platform Agent
 * ==========================================
 *
 * Consolidated agent that handles both inbound (event listening) and outbound
 * (message sending) for Discord and Slack. Replaces 4 separate repos:
 * - mcp-client-discord  → Discord listener
 * - mcp-client-slack    → Slack listener
 * - mcp-server-discord  → Discord tools
 * - mcp-server-slack    → Slack tools
 *
 * Each platform can be independently enabled/disabled via env vars.
 * Single broker connection serves both event publishing and tool registration.
 */

import * as dotenv from 'dotenv';
import { z } from 'zod';
import { KadiClient } from '@kadi.build/core';

// Platform modules
import { DiscordPlatformClient } from './platforms/discord/client.js';
import { registerDiscordTools } from './platforms/discord/tools.js';
import { DiscordListener } from './platforms/discord/listener.js';
import { SlackPlatformClient } from './platforms/slack/client.js';
import { registerSlackTools } from './platforms/slack/tools.js';
import { SlackListener } from './platforms/slack/listener.js';

dotenv.config();

// ============================================================================
// Configuration
// ============================================================================

const ConfigSchema = z.object({
  // Platform toggles
  DISCORD_ENABLED: z.coerce.boolean().default(true),
  SLACK_ENABLED: z.coerce.boolean().default(true),

  // KĀDI Broker
  KADI_BROKER_URL: z.string().url(),

  // Discord
  DISCORD_TOKEN: z.string().default(''),
  DISCORD_BOT_USER_ID: z.string().default(''),
  DISCORD_GUILD_ID: z.string().default(''),

  // Slack
  SLACK_BOT_TOKEN: z.string().default(''),
  SLACK_SIGNING_SECRET: z.string().default(''),
  SLACK_BOT_USER_ID: z.string().default(''),
  SLACK_HTTP_PORT: z.coerce.number().int().positive().default(3700),

  // Network (comma-separated list of KĀDI networks to join)
  KADI_NETWORKS: z.string().default('text'),

  // Logging
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

type Config = z.infer<typeof ConfigSchema>;

// ============================================================================
// Agent
// ============================================================================

class ChatbotAgent {
  private config: Config;
  private kadiClient!: KadiClient;
  private discordClient?: DiscordPlatformClient;
  private discordListener?: DiscordListener;
  private slackClient?: SlackPlatformClient;
  private slackListener?: SlackListener;

  constructor() {
    this.config = this.loadConfig();
  }

  private loadConfig(): Config {
    try {
      return ConfigSchema.parse(process.env);
    } catch (error) {
      console.error('❌ Configuration validation failed:', error);
      throw new Error('Missing or invalid environment variables. Check .env file.');
    }
  }

  private get isDiscordEnabled(): boolean {
    return this.config.DISCORD_ENABLED && !!this.config.DISCORD_TOKEN;
  }

  private get isSlackEnabled(): boolean {
    return this.config.SLACK_ENABLED && this.config.SLACK_BOT_TOKEN.startsWith('xoxb-');
  }

  async run(): Promise<void> {
    const startTime = Date.now();
    const networks = this.config.KADI_NETWORKS.split(',').map(n => n.trim()).filter(Boolean);
    const enabledPlatforms: string[] = [];
    if (this.isDiscordEnabled) enabledPlatforms.push('discord');
    if (this.isSlackEnabled) enabledPlatforms.push('slack');

    if (enabledPlatforms.length === 0) {
      console.error('❌ No platforms enabled. Set DISCORD_ENABLED=true or SLACK_ENABLED=true with valid tokens.');
      process.exit(1);
    }

    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('🤖 Starting agent-chatbot...');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`📋 Platforms: ${enabledPlatforms.join(', ')}`);
    console.log(`📋 Network: ${networks.join(', ')}`);
    console.log(`📋 Broker: ${this.config.KADI_BROKER_URL}`);
    console.log(`📋 Log Level: ${this.config.LOG_LEVEL}`);
    console.log();

    // Step 1: Create KĀDI client via BaseAgent
    const { BaseAgent } = await import('agents-library');
    const baseAgent = new BaseAgent({
      agentId: 'agent-chatbot',
      agentRole: 'chatbot',
      version: '1.0.0',
      brokerUrl: this.config.KADI_BROKER_URL,
      networks,
    });
    this.kadiClient = baseAgent.client;

    // Step 2: Initialize enabled platforms
    if (this.isDiscordEnabled) {
      console.log('[PLATFORM] Initializing Discord...');
      this.discordClient = new DiscordPlatformClient(
        this.config.DISCORD_TOKEN,
        this.config.DISCORD_GUILD_ID || undefined,
      );
      registerDiscordTools(this.kadiClient, this.discordClient);
      this.discordListener = new DiscordListener(
        this.discordClient,
        this.kadiClient,
        this.config.DISCORD_BOT_USER_ID,
        this.config.LOG_LEVEL,
      );
      this.discordListener.start();
      console.log('✅ Discord platform ready');
    }

    if (this.isSlackEnabled) {
      console.log('[PLATFORM] Initializing Slack...');
      this.slackClient = new SlackPlatformClient(this.config.SLACK_BOT_TOKEN);
      registerSlackTools(this.kadiClient, this.slackClient);
      this.slackListener = new SlackListener(
        {
          botToken: this.config.SLACK_BOT_TOKEN,
          signingSecret: this.config.SLACK_SIGNING_SECRET,
          httpPort: this.config.SLACK_HTTP_PORT,
          botUserId: this.config.SLACK_BOT_USER_ID,
          logLevel: this.config.LOG_LEVEL,
        },
        this.kadiClient,
      );
      await this.slackListener.start();
      console.log('✅ Slack platform ready');
    }

    // Step 3: Connect to broker
    console.log('\n[BROKER] Connecting to KĀDI broker...');
    baseAgent.registerShutdownHandlers(async () => {
      if (this.discordClient) this.discordClient.destroy();
      if (this.slackListener) await this.slackListener.stop();
    });
    await baseAgent.connect();
    console.log('✅ Connected to KĀDI broker');

    const totalTime = Date.now() - startTime;
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('✅ agent-chatbot ready');
    console.log(`🎧 Platforms: ${enabledPlatforms.join(', ')}`);
    console.log(`🌐 Network: ${networks.join(', ')}`);
    console.log(`⏱️  Startup: ${totalTime}ms`);
    console.log('═══════════════════════════════════════════════════════════\n');
  }
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  try {
    const agent = new ChatbotAgent();
    await agent.run();
  } catch (error) {
    console.error('💥 Fatal error:', error);
    process.exit(1);
  }
}

main();
