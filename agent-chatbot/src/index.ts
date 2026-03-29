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
 * Each platform can be independently enabled/disabled via config.toml.
 * Single broker connection serves both event publishing and tool registration.
 */

import 'dotenv/config';
import { KadiClient } from '@kadi.build/core';
import { readConfig, loadVaultCredentials } from 'agents-library';

// Platform modules
import { DiscordPlatformClient } from './platforms/discord/client.js';
import { registerDiscordTools } from './platforms/discord/tools.js';
import { DiscordListener } from './platforms/discord/listener.js';
import { SlackPlatformClient } from './platforms/slack/client.js';
import { registerSlackTools } from './platforms/slack/tools.js';
import { SlackListener } from './platforms/slack/listener.js';

// ============================================================================
// Configuration
// ============================================================================

const cfg = readConfig();

// Broker
const brokerUrl = process.env.KADI_BROKER_URL_LOCAL ?? cfg.string('broker.local.URL');
const networks = process.env.KADI_NETWORK_LOCAL?.split(',') ?? cfg.strings('broker.local.NETWORKS');

// Platform toggles
const discordEnabled = process.env.DISCORD_ENABLED !== undefined
  ? process.env.DISCORD_ENABLED === 'true'
  : cfg.bool('bot.discord.ENABLED');
const slackEnabled = process.env.SLACK_ENABLED !== undefined
  ? process.env.SLACK_ENABLED === 'true'
  : cfg.bool('bot.slack.ENABLED');

// Platform config (non-secret)
const discordBotUserId = process.env.DISCORD_BOT_USER_ID ?? cfg.string('bot.discord.USER_ID');
const discordGuildId = process.env.DISCORD_GUILD_ID ?? (cfg.has('bot.discord.GUILD_ID') ? cfg.string('bot.discord.GUILD_ID') : '');
const slackBotUserId = process.env.SLACK_BOT_USER_ID ?? cfg.string('bot.slack.USER_ID');
const slackHttpPort = process.env.SLACK_HTTP_PORT ? parseInt(process.env.SLACK_HTTP_PORT, 10) : cfg.number('bot.slack.HTTP_PORT');
const logLevel = process.env.LOG_LEVEL ?? (cfg.has('logging.LEVEL') ? cfg.string('logging.LEVEL') : 'info');

// ============================================================================
// Agent
// ============================================================================

class ChatbotAgent {
  private kadiClient!: KadiClient;
  private discordClient?: DiscordPlatformClient;
  private discordListener?: DiscordListener;
  private slackClient?: SlackPlatformClient;
  private slackListener?: SlackListener;

  async run(): Promise<void> {
    const startTime = Date.now();

    // Load secrets from vault
    const vault = await loadVaultCredentials();
    const discordToken = process.env.DISCORD_TOKEN ?? vault.DISCORD_TOKEN ?? '';
    const slackBotToken = process.env.SLACK_BOT_TOKEN ?? vault.SLACK_BOT_TOKEN ?? '';
    const slackSigningSecret = process.env.SLACK_SIGNING_SECRET ?? vault.SLACK_SIGNING_SECRET ?? '';

    // Determine which platforms are actually usable
    const isDiscordReady = discordEnabled && !!discordToken;
    const isSlackReady = slackEnabled && slackBotToken.startsWith('xoxb-');

    const enabledPlatforms: string[] = [];
    if (isDiscordReady) enabledPlatforms.push('discord');
    if (isSlackReady) enabledPlatforms.push('slack');

    if (enabledPlatforms.length === 0) {
      console.error('No platforms enabled. Set bot.discord.ENABLED or bot.slack.ENABLED in config.toml with valid tokens in vault.');
      process.exit(1);
    }

    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('Starting agent-chatbot...');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`Platforms: ${enabledPlatforms.join(', ')}`);
    console.log(`Network: ${networks.join(', ')}`);
    console.log(`Broker: ${brokerUrl}`);
    console.log(`Log Level: ${logLevel}`);
    console.log();

    // Step 1: Create KĀDI client via BaseAgent
    const { BaseAgent } = await import('agents-library');
    const baseAgent = new BaseAgent({
      agentId: 'agent-chatbot',
      agentRole: 'chatbot',
      version: '1.0.0',
      brokerUrl,
      networks,
    });
    this.kadiClient = baseAgent.client;

    // Step 2: Initialize enabled platforms
    if (isDiscordReady) {
      console.log('[PLATFORM] Initializing Discord...');
      this.discordClient = new DiscordPlatformClient(
        discordToken,
        discordGuildId || undefined,
      );
      registerDiscordTools(this.kadiClient, this.discordClient);
      this.discordListener = new DiscordListener(
        this.discordClient,
        this.kadiClient,
        discordBotUserId,
        logLevel,
      );
      this.discordListener.start();
      console.log('Discord platform ready');
    }

    if (isSlackReady) {
      console.log('[PLATFORM] Initializing Slack...');
      this.slackClient = new SlackPlatformClient(slackBotToken);
      registerSlackTools(this.kadiClient, this.slackClient);
      this.slackListener = new SlackListener(
        {
          botToken: slackBotToken,
          signingSecret: slackSigningSecret,
          httpPort: slackHttpPort,
          botUserId: slackBotUserId,
          logLevel,
        },
        this.kadiClient,
      );
      await this.slackListener.start();
      console.log('Slack platform ready');
    }

    // Step 3: Connect to broker
    console.log('\n[BROKER] Connecting to KĀDI broker...');
    baseAgent.registerShutdownHandlers(async () => {
      if (this.discordClient) this.discordClient.destroy();
      if (this.slackListener) await this.slackListener.stop();
    });
    await baseAgent.connect();
    console.log('Connected to KĀDI broker');

    const totalTime = Date.now() - startTime;
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('agent-chatbot ready');
    console.log(`Platforms: ${enabledPlatforms.join(', ')}`);
    console.log(`Network: ${networks.join(', ')}`);
    console.log(`Startup: ${totalTime}ms`);
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
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

main();
