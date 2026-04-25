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

import { KadiClient } from '@kadi.build/core';
import {
  readConfig,
  loadVaultCredentials,
  setLogLevel,
  setAgentTag,
  logger,
  timer,
} from 'agents-library';

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

// Agent identity
const agentId = cfg.string('agent.ID');
const agentRole = cfg.string('agent.ROLE');
const agentVersion = cfg.string('agent.VERSION');
const logLevel = cfg.has('logging.LEVEL') ? cfg.string('logging.LEVEL') : 'info';
setLogLevel(logLevel);
setAgentTag(agentId);

// Broker resolution: at least one of local/remote required
const hasLocal = cfg.has('broker.local.URL');
const hasRemote = cfg.has('broker.remote.URL');
if (!hasLocal && !hasRemote) {
  throw new Error('At least one broker required: set [broker.local] or [broker.remote] in config.toml');
}

const brokerUrl = hasLocal
  ? (process.env.KADI_BROKER_URL_LOCAL ?? cfg.string('broker.local.URL'))
  : (process.env.KADI_BROKER_URL_REMOTE ?? cfg.string('broker.remote.URL'));
const networks = hasLocal
  ? (process.env.KADI_NETWORK_LOCAL?.split(',') ?? cfg.strings('broker.local.NETWORKS'))
  : (process.env.KADI_NETWORK_REMOTE?.split(',') ?? cfg.strings('broker.remote.NETWORKS'));

// Additional broker (if both exist, the non-primary becomes additional)
const additionalBrokerUrl = hasLocal && hasRemote
  ? (process.env.KADI_BROKER_URL_REMOTE ?? cfg.string('broker.remote.URL'))
  : undefined;
const additionalBrokerNetworks = hasLocal && hasRemote
  ? (process.env.KADI_NETWORK_REMOTE?.split(',') ?? cfg.strings('broker.remote.NETWORKS'))
  : undefined;

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
    timer.start('main');

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
      logger.error(agentId, 'No platforms enabled. Set bot.discord.ENABLED or bot.slack.ENABLED in config.toml with valid tokens in vault.', '+0ms');
      process.exit(1);
    }

    // Startup summary
    logger.info(agentId, `Starting ${agentId} v${agentVersion} (role: ${agentRole})`, timer.elapsed('main'));
    const brokerSummary = [
      hasLocal ? `local=${process.env.KADI_BROKER_URL_LOCAL ?? cfg.string('broker.local.URL')}` : null,
      hasRemote ? `remote=${process.env.KADI_BROKER_URL_REMOTE ?? cfg.string('broker.remote.URL')}` : null,
    ].filter(Boolean).join(', ');
    logger.info(agentId, `Broker: ${brokerSummary}`, timer.elapsed('main'));
    logger.info(agentId, `Networks: ${networks.join(', ')}`, timer.elapsed('main'));
    logger.info(agentId, `Platforms: ${enabledPlatforms.join(', ')}`, timer.elapsed('main'));

    // Step 1: Create KĀDI client via BaseAgent
    const { BaseAgent } = await import('agents-library');
    const baseAgent = new BaseAgent({
      agentId,
      agentRole,
      version: agentVersion,
      brokerUrl,
      networks,
      ...(additionalBrokerUrl && {
        additionalBrokers: {
          remote: { url: additionalBrokerUrl, networks: additionalBrokerNetworks! },
        },
      }),
    });
    this.kadiClient = baseAgent.client;

    // Build broker networks map for tool registration
    const brokerNetworksMap: Record<string, string[]> = {
      default: networks,
      ...(additionalBrokerNetworks && { remote: additionalBrokerNetworks }),
    };

    // Step 2: Initialize enabled platforms
    if (isDiscordReady) {
      logger.debug(agentId, 'Initializing Discord platform...', timer.elapsed('main'));
      this.discordClient = new DiscordPlatformClient(
        discordToken,
        discordGuildId || undefined,
      );
      registerDiscordTools(this.kadiClient, this.discordClient, brokerNetworksMap);
      this.discordListener = new DiscordListener(
        this.discordClient,
        this.kadiClient,
        discordBotUserId,
        logLevel,
        networks[0],
      );
      this.discordListener.start();
      logger.info(agentId, 'Discord platform ready', timer.elapsed('main'));
    }

    if (isSlackReady) {
      logger.debug(agentId, 'Initializing Slack platform...', timer.elapsed('main'));
      this.slackClient = new SlackPlatformClient(slackBotToken);
      registerSlackTools(this.kadiClient, this.slackClient, brokerNetworksMap);
      this.slackListener = new SlackListener(
        {
          botToken: slackBotToken,
          signingSecret: slackSigningSecret,
          httpPort: slackHttpPort,
          botUserId: slackBotUserId,
          logLevel,
          publishNetwork: networks[0],
        },
        this.kadiClient,
      );
      await this.slackListener.start();
      logger.info(agentId, 'Slack platform ready', timer.elapsed('main'));
    }

    // Step 3: Connect to broker
    logger.debug(agentId, 'Connecting to KĀDI broker...', timer.elapsed('main'));
    baseAgent.registerShutdownHandlers(async () => {
      if (this.discordClient) this.discordClient.destroy();
      if (this.slackListener) await this.slackListener.stop();
    });
    await baseAgent.connect(vault);

    // Ready
    logger.info(agentId, `Ready (${timer.elapsed('main')})`, timer.elapsed('main'));
  }
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  try {
    const agent = new ChatbotAgent();
    await agent.run();
  } catch (error: any) {
    logger.error(agentId, 'Fatal error', '+0ms', error);
    process.exit(1);
  }
}

main();
