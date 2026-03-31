/**
 * Template Agent TypeScript for KĀDI Protocol
 * =============================================
 *
 * Starter template for building KĀDI agents.
 * Uses BaseAgent for broker connection, ProviderManager, and MemoryService.
 *
 * Features:
 * - config.toml-based configuration (no .env)
 * - Optional LLM provider (model-manager + anthropic fallback)
 * - Native ability loading via loadNative() + bridge
 * - Graceful shutdown
 *
 * @module template-agent-typescript
 */

import {
  BaseAgent,
  loadVaultCredentials,
  readConfig,
  setLogLevel,
  setAgentTag,
  logger,
  timer,
} from 'agents-library';
import type { BaseAgentConfig } from 'agents-library';
import { registerAllTools } from './tools/index.js';

const cfg = readConfig();

// ============================================================================
// Agent identity + logging
// ============================================================================

const agentId = cfg.string('agent.ID');
const agentVersion = cfg.string('agent.VERSION');
const logLevel = cfg.has('logging.LEVEL') ? cfg.string('logging.LEVEL') : 'info';
setLogLevel(logLevel);
setAgentTag(agentId);

// ============================================================================
// Configuration
// ============================================================================

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
  ? cfg.strings('broker.local.NETWORKS')
  : cfg.strings('broker.remote.NETWORKS');

const additionalBrokerUrl = hasLocal && hasRemote
  ? (process.env.KADI_BROKER_URL_REMOTE ?? cfg.string('broker.remote.URL'))
  : undefined;
const additionalBrokerNetworks = hasLocal && hasRemote
  ? cfg.strings('broker.remote.NETWORKS')
  : undefined;

// Provider config
const primaryProvider = cfg.has('provider.PRIMARY') ? cfg.string('provider.PRIMARY') : undefined;
const fallbackProvider = cfg.has('provider.FALLBACK') ? cfg.string('provider.FALLBACK') : undefined;

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  timer.start('main');

  // Startup summary
  logger.info(agentId, `Starting ${agentId} v${agentVersion}`, timer.elapsed('main'));
  const brokerSummary = [
    hasLocal ? `local=${process.env.KADI_BROKER_URL_LOCAL ?? cfg.string('broker.local.URL')}` : null,
    hasRemote ? `remote=${process.env.KADI_BROKER_URL_REMOTE ?? cfg.string('broker.remote.URL')}` : null,
  ].filter(Boolean).join(', ');
  logger.info(agentId, `Broker: ${brokerSummary}`, timer.elapsed('main'));
  logger.info(agentId, `Networks: ${networks.join(', ')}`, timer.elapsed('main'));
  if (primaryProvider) {
    const primaryModel = cfg.string(`provider.${primaryProvider}.MODEL`);
    const fallbackModel = fallbackProvider ? cfg.string(`provider.${fallbackProvider}.MODEL`) : undefined;
    logger.info(agentId, `LLM: ${primaryProvider}/${primaryModel}${fallbackProvider ? ` (fallback: ${fallbackProvider}/${fallbackModel})` : ''}`, timer.elapsed('main'));
  }

  // Load credentials: env vars take priority over vault
  const vault = await loadVaultCredentials();
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY || vault.ANTHROPIC_API_KEY;
  const modelManagerBaseUrl = process.env.MODEL_MANAGER_BASE_URL || vault.MODEL_MANAGER_BASE_URL;
  const modelManagerApiKey = process.env.MODEL_MANAGER_API_KEY || vault.MODEL_MANAGER_API_KEY;

  // Build BaseAgent config
  const baseAgentConfig: BaseAgentConfig = {
    agentId,
    agentRole: cfg.has('agent.ROLE') ? cfg.string('agent.ROLE') : 'programmer',
    version: agentVersion,
    brokerUrl,
    networks,
    ...(additionalBrokerUrl ? {
      additionalBrokers: {
        remote: { url: additionalBrokerUrl, networks: additionalBrokerNetworks! },
      },
    } : {}),
    ...((anthropicApiKey || (modelManagerBaseUrl && modelManagerApiKey)) ? {
      provider: {
        ...(anthropicApiKey ? { anthropicApiKey } : {}),
        ...(modelManagerBaseUrl && modelManagerApiKey ? {
          modelManagerBaseUrl,
          modelManagerApiKey,
        } : {}),
        ...(primaryProvider ? { primaryProvider } : {}),
        ...(fallbackProvider ? { fallbackProvider } : {}),
      },
    } : {}),
    memory: {
      dataPath: process.env.MEMORY_DATA_PATH ?? cfg.string('memory.DATA_PATH'),
    },
  };

  const baseAgent = new BaseAgent(baseAgentConfig);
  const client = baseAgent.client;

  // Register local tools before connecting
  registerAllTools(client);
  logger.info(agentId, `Tools: ${client.readAgentJson().tools.length} registered`, timer.elapsed('main'));

  // Connect to broker
  await baseAgent.connect();

  // Start bots if configured
  if (cfg.has('bot.slack.ENABLED') && cfg.string('bot.slack.ENABLED') === 'true') {
    const { SlackBot } = await import('./bot/slack-bot.js');
    const slackBot = new SlackBot({
      client,
      anthropicApiKey: anthropicApiKey!,
      botUserId: cfg.string('bot.slack.USER_ID'),
      providerManager: baseAgent.providerManager!,
      memoryService: baseAgent.memoryService!,
    });
    slackBot.start();
    logger.info(agentId, 'Slack bot started', timer.elapsed('main'));
  }

  if (cfg.has('bot.discord.ENABLED') && cfg.string('bot.discord.ENABLED') === 'true') {
    const { DiscordBot } = await import('./bot/discord-bot.js');
    const discordBot = new DiscordBot({
      client,
      anthropicApiKey: anthropicApiKey!,
      botUserId: cfg.string('bot.discord.USER_ID'),
      providerManager: baseAgent.providerManager!,
      memoryService: baseAgent.memoryService!,
    });
    discordBot.start();
    logger.info(agentId, 'Discord bot started', timer.elapsed('main'));
  }

  // Load native abilities (in-process, no separate broker connection needed)
  // Uncomment and configure the abilities you want to load:
  //
  // try {
  //   const { registerNativeAbilityTools } = await import('./tools/native-ability-bridge.js');
  //   const abilityPath = resolve(process.cwd(), '../ability-file-local/dist/index.js');
  //   const fileAbility = await client.loadNative('ability-file-local', { path: abilityPath });
  //   const count = registerNativeAbilityTools(client, fileAbility);
  //   await client.refreshBrokerTools();
  //   logger.info(agentId, `Loaded ability-file-local natively (${count} tools)`, timer.elapsed('main'));
  // } catch (error: any) {
  //   logger.warn(agentId, `ability-file-local unavailable: ${error.message}`, timer.elapsed('main'));
  // }

  if (baseAgent.providerManager) {
    logger.info(agentId, 'LLM provider enabled', timer.elapsed('main'));
  } else {
    logger.warn(agentId, 'No LLM provider configured', timer.elapsed('main'));
  }

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info(agentId, `${signal} received, shutting down...`, timer.elapsed('main'));
    await baseAgent.shutdown();
    logger.info(agentId, 'Shutdown complete', timer.elapsed('main'));
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  logger.info(agentId, `Ready (${timer.elapsed('main')})`, timer.elapsed('main'));
}

main().catch((err) => {
  logger.error(agentId, `Fatal error: ${err}`, '+0ms');
  process.exit(1);
});
