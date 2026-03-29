/**
 * agent-producer - KĀDI Agent for Multi-Agent Orchestration
 * ===========================================================
 *
 * Purpose:
 * Agent orchestrator that coordinates worker agents (artist, designer, programmer)
 * via KĀDI event-driven protocol. Provides tools accessible from Claude Code/Desktop
 * and Slack/Discord channels through KĀDI broker.
 *
 * Architecture:
 * - KĀDI Agent: Registers tools with broker via kadiClient.registerTool()
 * - MCP Upstream: Forwards task management to mcp-shrimp-task-manager via kadiClient.load()
 * - Event Publisher: Publishes task assignment events to worker agents
 *
 * Tools:
 * - echo: Simple echo tool for testing
 * - list_tools: List all available tools
 *
 * Event Flow:
 * 1. User calls tool (via Claude Code/Desktop or Slack/Discord)
 * 2. agent-producer validates and forwards to mcp-shrimp-task-manager
 * 3. agent-producer publishes 'quest.tasks_ready' event via KĀDI
 * 4. agent-lead receives event, assigns tasks to worker agents by role
 * 5. Worker agent executes task, commits to playground
 * 6. agent-lead verifies completion, publishes 'task.verified'
 * 7. agent-producer relays status to HUMAN via Discord/Slack
 *
 * @module agent-producer
 * @version 1.0.0
 * @license MIT
 */

import 'dotenv/config';
import {BaseAgent, loadVaultCredentials, readConfig, setLogLevel, setAgentTag, logger, timer} from 'agents-library';
import type {BaseAgentConfig} from 'agents-library';
import {registerAllTools, injectOrchestrator} from './tools/index.js';
import {subscribeToTaskRejections} from './tools/task-execution.js';

const cfg = readConfig();

// ============================================================================
// Agent identity + logging
// ============================================================================

const agentId = cfg.string('agent.ID');
const agentRole = cfg.string('agent.ROLE');
const agentVersion = cfg.string('agent.VERSION');
const logLevel = cfg.has('logging.LEVEL') ? cfg.string('logging.LEVEL') : 'info';
setLogLevel(logLevel);
setAgentTag(agentId);

// ============================================================================
// Configuration
// ============================================================================

// Primary broker (local)
const brokerUrl = process.env.KADI_BROKER_URL_LOCAL ?? cfg.string('broker.local.URL');
const networks = process.env.KADI_NETWORK_LOCAL?.split(',') ?? cfg.strings('broker.local.NETWORKS');

// Remote broker
const remoteBrokerUrl = process.env.KADI_BROKER_URL_REMOTE ?? cfg.string('broker.remote.URL');
const remoteBrokerNetworks = process.env.KADI_NETWORK_REMOTE?.split(',') ?? cfg.strings('broker.remote.NETWORKS');

// Credentials: env vars take priority over vault
const vault = await loadVaultCredentials();
const anthropicApiKey = process.env.ANTHROPIC_API_KEY || vault.ANTHROPIC_API_KEY;
const modelManagerBaseUrl = process.env.MODEL_MANAGER_BASE_URL || vault.MODEL_MANAGER_BASE_URL;
const modelManagerApiKey = process.env.MODEL_MANAGER_API_KEY || vault.MODEL_MANAGER_API_KEY;

const llmEnabled = !!(anthropicApiKey && anthropicApiKey !== 'YOUR_ANTHROPIC_API_KEY_HERE');

// ============================================================================
// BaseAgent Instance
// ============================================================================

const baseAgentConfig: BaseAgentConfig = {
  agentId,
  agentRole,
  version: agentVersion,
  brokerUrl,
  networks,
  additionalBrokers: {
    remote: { url: remoteBrokerUrl, networks: remoteBrokerNetworks },
  },
  ...(llmEnabled && {
    provider: {
      anthropicApiKey: anthropicApiKey!,
      ...(modelManagerBaseUrl && modelManagerApiKey && {
        modelManagerBaseUrl,
        modelManagerApiKey,
      }),
      primaryProvider: cfg.string('provider.PRIMARY'),
      fallbackProvider: cfg.has('provider.FALLBACK') ? cfg.string('provider.FALLBACK') : undefined,
      retryAttempts: 3,
      retryDelayMs: 1000,
      healthCheckIntervalMs: 60000,
    },
    memory: {
      dataPath: process.env.MEMORY_DATA_PATH ?? cfg.string('memory.DATA_PATH'),
    },
  }),
};

const baseAgent = new BaseAgent(baseAgentConfig);
const client = baseAgent.client;

// ============================================================================
// Channel Context Tracking
// ============================================================================

/** Maps task IDs to their originating channel context for reply routing */
export const taskChannelMap = new Map<string, {
    type: 'slack' | 'discord' | 'desktop';
    channelId?: string;
    userId?: string;
    threadTs?: string;
}>();

// ============================================================================
// Tool Registration
// ============================================================================

const brokerNetworksMap: Record<string, string[]> = {
  default: networks,
  remote: remoteBrokerNetworks,
};
registerAllTools(client, brokerNetworksMap);

// ============================================================================
// Bot Instances (initialized in main after broker connection)
// ============================================================================

let slackBot: any = null;
let discordBot: any = null;

/**
 * Resolve a boolean toggle from env var (string) with config.toml fallback.
 * Env var presence takes priority; if absent, reads from config.toml.
 */
function envBoolOrConfig(envVar: string | undefined, configKey: string): boolean {
    if (envVar !== undefined) return envVar === 'true';
    return cfg.bool(configKey);
}

/** Gracefully stop a bot instance, swallowing errors. */
async function stopBot(bot: any, name: string): Promise<void> {
    if (!bot) return;
    logger.info(agentId, `Stopping ${name} bot...`, timer.elapsed('main'));
    try {
        if (typeof bot.stop === 'function') await bot.stop();
    } catch (error) {
        logger.error(agentId, `Error stopping ${name} bot`, '+0ms', error as Error | string);
    }
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
    timer.start('main');

    try {
        // Startup summary
        const primaryProvider = cfg.string('provider.PRIMARY');
        const primaryModel = cfg.string(`provider.${primaryProvider}.MODEL`);
        const fallbackProvider = cfg.has('provider.FALLBACK') ? cfg.string('provider.FALLBACK') : undefined;
        const fallbackModel = fallbackProvider ? cfg.string(`provider.${fallbackProvider}.MODEL`) : undefined;

        logger.info(agentId, `Starting ${agentId} v${agentVersion} (role: ${agentRole})`, timer.elapsed('main'));
        logger.info(agentId, `Broker: local=${brokerUrl}, remote=${remoteBrokerUrl}`, timer.elapsed('main'));
        logger.info(agentId, `Networks: ${networks.join(', ')}`, timer.elapsed('main'));
        logger.info(agentId, `LLM: ${llmEnabled ? `${primaryProvider}/${primaryModel}${fallbackProvider ? ` (fallback: ${fallbackProvider}/${fallbackModel})` : ''}` : 'disabled'}`, timer.elapsed('main'));

        // Log registered tools (summary at info, detail at debug)
        const registeredTools = client.readAgentJson().tools;
        logger.info(agentId, `Tools: ${registeredTools.length} registered`, timer.elapsed('main'));
        for (const tool of registeredTools) {
            logger.debug(agentId, `  ${tool.name} - ${tool.description || 'No description'}`, timer.elapsed('main'));
        }

        // Step 1: Register shutdown handlers (before connect)
        baseAgent.registerShutdownHandlers(async () => {
            await stopBot(slackBot, 'Slack');
            await stopBot(discordBot, 'Discord');
        });

        // Step 2: Connect to broker
        await baseAgent.connect();

        // Step 3: Initialize LLM-dependent services
        if (llmEnabled && baseAgent.providerManager) {
            const { LlmOrchestrator } = await import('./services/llm-orchestrator.js');
            const orchestrator = new LlmOrchestrator(baseAgent.providerManager, client);
            injectOrchestrator(orchestrator);
            logger.info(agentId, 'LlmOrchestrator created and injected', timer.elapsed('main'));

            try {
                const { setupTaskFailureHandler } = await import('./handlers/task-failure.js');
                await setupTaskFailureHandler(client);
                logger.info(agentId, 'Task failure event handler registered', timer.elapsed('main'));
            } catch (error) {
                logger.error(agentId, 'Failed to setup task failure event handler', '+0ms', error as Error | string);
            }

            // Start bots if enabled
            if (envBoolOrConfig(process.env.ENABLE_SLACK_BOT, 'bot.slack.ENABLED')) {
                const { SlackBot } = await import('./bot/slack-bot.js');
                slackBot = new SlackBot({
                    client,
                    anthropicApiKey: anthropicApiKey!,
                    botUserId: process.env.SLACK_BOT_USER_ID ?? cfg.string('bot.slack.USER_ID'),
                    providerManager: baseAgent.providerManager,
                    memoryService: baseAgent.memoryService!,
                });
                slackBot.start();
                logger.info(agentId, 'Slack bot started', timer.elapsed('main'));
            }

            if (envBoolOrConfig(process.env.ENABLE_DISCORD_BOT, 'bot.discord.ENABLED')) {
                const { DiscordBot } = await import('./bot/discord-bot.js');
                discordBot = new DiscordBot({
                    client,
                    anthropicApiKey: anthropicApiKey!,
                    botUserId: process.env.DISCORD_BOT_USER_ID ?? cfg.string('bot.discord.USER_ID'),
                    providerManager: baseAgent.providerManager,
                    memoryService: baseAgent.memoryService!,
                });
                discordBot.start();
                logger.info(agentId, 'Discord bot started', timer.elapsed('main'));
            }
        } else {
            logger.info(agentId, 'LLM features disabled (configure ANTHROPIC_API_KEY to enable)', timer.elapsed('main'));
        }

        // Step 4: Event subscriptions (always active, no LLM needed)
        try {
            await subscribeToTaskRejections(client);
            logger.info(agentId, 'Task rejection event handler registered', timer.elapsed('main'));
        } catch (error) {
            logger.error(agentId, 'Failed to setup task rejection handler', '+0ms', error as Error | string);
        }

        try {
            const { setupStatusRelay } = await import('./handlers/status-relay.js');
            await setupStatusRelay(client);
            logger.info(agentId, 'Status relay subscriptions registered', timer.elapsed('main'));
        } catch (error) {
            logger.error(agentId, 'Failed to setup status relay', '+0ms', error as Error | string);
        }

        // Ready
        logger.info(agentId, `Ready (${timer.elapsed('main')})`, timer.elapsed('main'));

    } catch (error: any) {
        logger.error(agentId, 'Fatal error', '+0ms', error);
        if (error.stack) logger.error(agentId, 'Stack trace', '+0ms', error.stack);
        process.exit(1);
    }
}

main().catch((error) => {
    logger.error(agentId, 'Fatal error', '+0ms', error);
    process.exit(1);
});
