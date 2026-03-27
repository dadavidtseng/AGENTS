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
import {BaseAgent, loadVaultCredentials, loadConfig, logger, MODULE_AGENT, timer} from 'agents-library';
import type {BaseAgentConfig} from 'agents-library';

// Load config.toml (walk-up discovery) — env vars from .env take precedence
loadConfig();

import {registerAllTools, injectOrchestrator} from './tools/index.js';

// ============================================================================
// Tool Schemas (Imported from tool modules)
// ============================================================================

// planTaskInputSchema, planTaskOutputSchema - imported from ./tools/plan-task.js
// listActiveTasksInputSchema, listActiveTasksOutputSchema - imported from ./tools/list-tasks.js
// getTaskStatusInputSchema, getTaskStatusOutputSchema - imported from ./tools/task-status.js
// assignTaskInputSchema, assignTaskOutputSchema - imported from ./tools/assign-task.js

// ============================================================================
// Configuration
// ============================================================================

const brokerUrl = process.env.KADI_BROKER_URL || 'ws://localhost:8080';
const networks = (process.env.KADI_NETWORK || 'producer,quest,text').split(',');

// Optional second broker for multi-broker connectivity
const remoteBrokerUrl = process.env.KADI_BROKER_URL_2;
const remoteBrokerNetworks = (process.env.KADI_NETWORK_2 || 'global').split(',');

/**
 * Whether LLM-dependent features (bots, orchestrator, task handlers) are enabled.
 * Requires a valid ANTHROPIC_API_KEY in environment.
 */
// Load credentials: env vars take priority over vault
const _vault = await loadVaultCredentials();
const _anthropicApiKey = process.env.ANTHROPIC_API_KEY || _vault.ANTHROPIC_API_KEY;
const _modelManagerBaseUrl = process.env.MODEL_MANAGER_BASE_URL || _vault.MODEL_MANAGER_BASE_URL;
const _modelManagerApiKey = process.env.MODEL_MANAGER_API_KEY || _vault.MODEL_MANAGER_API_KEY;

const llmEnabled = !!(_anthropicApiKey && _anthropicApiKey !== 'YOUR_ANTHROPIC_API_KEY_HERE');

// ============================================================================
// BaseAgent Instance
// ============================================================================

/**
 * BaseAgent provides shared infrastructure:
 * - KadiClient for broker communication
 * - ProviderManager for LLM access (if configured)
 * - MemoryService for persistent memory (if configured)
 * - Graceful shutdown handling (SIGTERM/SIGINT)
 */
const baseAgentConfig: BaseAgentConfig = {
  agentId: 'agent-producer',
  agentRole: 'producer',
  version: '1.0.0',
  brokerUrl,
  networks,
  ...(remoteBrokerUrl && {
    additionalBrokers: {
      remote: { url: remoteBrokerUrl, networks: remoteBrokerNetworks },
    },
  }),
  ...(llmEnabled && {
    provider: {
      anthropicApiKey: _anthropicApiKey!,
      ...(_modelManagerBaseUrl && _modelManagerApiKey && {
        modelManagerBaseUrl: _modelManagerBaseUrl,
        modelManagerApiKey: _modelManagerApiKey,
      }),
      primaryProvider: (_modelManagerBaseUrl && _modelManagerApiKey) ? 'model-manager' : 'anthropic',
      fallbackProvider: (_modelManagerBaseUrl && _modelManagerApiKey) ? 'anthropic' : undefined,
      retryAttempts: 3,
      retryDelayMs: 1000,
      healthCheckIntervalMs: 60000,
    },
    memory: {
      dataPath: process.env.MEMORY_DATA_PATH || './data/memory',
    },
  }),
};

const baseAgent = new BaseAgent(baseAgentConfig);

/** Convenience alias — used by tool registrations and event handlers */
const client = baseAgent.client;

// ============================================================================
// Channel Context Tracking
// ============================================================================

/**
 * Maps task IDs to their originating channel context
 * Used to send notifications back to the channel where the task was assigned
 */
export const taskChannelMap = new Map<string, {
    type: 'slack' | 'discord' | 'desktop';
    channelId?: string;
    userId?: string;
    threadTs?: string; // Slack thread timestamp for replying in thread
}>();

// ============================================================================
// Custom Tool Registry
// ============================================================================
//
// Tools are registered via the src/tools/ directory and toolRegistry.
// See registerAllTools(client) call below.
//
// For more information on adding custom tools, see src/tools/index.ts
//
// Build broker networks map for per-tool scoping
const brokerNetworksMap: Record<string, string[]> = {
  default: networks,
};
if (remoteBrokerUrl) {
  brokerNetworksMap.remote = remoteBrokerNetworks;
}
registerAllTools(client, brokerNetworksMap);

// Task rejection subscription is set up in main() after broker connection
import { subscribeToTaskRejections } from './tools/task-execution.js';



// ============================================================================
// Bot Instance Tracking
// ============================================================================

/**
 * Track bot instances for graceful shutdown
 * These are initialized after broker connection in main()
 */
let slackBot: any = null;
let discordBot: any = null;

// gracefulShutdown is now handled by BaseAgent.registerShutdownHandlers()

// ============================================================================
// Main Application Entry Point
// ============================================================================

/**
 * Main application entry point
 * Connects to KĀDI broker and starts serving tools
 */
async function main() {
    // Start main timer for application lifetime tracking
    timer.start('main');

    try {
        logger.info(MODULE_AGENT, '='.repeat(60), timer.elapsed('main'));
        logger.warn(MODULE_AGENT, 'Starting Agent Producer', timer.elapsed('main'));
        logger.info(MODULE_AGENT, '='.repeat(60), timer.elapsed('main'));
        logger.info(MODULE_AGENT, `Broker URL: ${brokerUrl}`, timer.elapsed('main'));
        logger.info(MODULE_AGENT, `Networks: ${networks.join(', ')}`, timer.elapsed('main'));
        logger.info(MODULE_AGENT, `LLM features: ${llmEnabled ? 'enabled' : 'disabled'}`, timer.elapsed('main'));
        logger.info(MODULE_AGENT, '', timer.elapsed('main'));

        // Dynamically list all registered tools
        const registeredTools = client.readAgentJson().tools;
        logger.info(MODULE_AGENT, `Available Tools: ${registeredTools.length} registered`, timer.elapsed('main'));

        if (registeredTools.length > 0) {
            logger.info(MODULE_AGENT, '  Local Tools:', timer.elapsed('main'));
            for (const tool of registeredTools) {
                const description = tool.description || 'No description';
                logger.info(MODULE_AGENT, `    • ${tool.name} - ${description}`, timer.elapsed('main'));
            }
            logger.info(MODULE_AGENT, '', timer.elapsed('main'));
        }

        // ----------------------------------------------------------------
        // Step 1: Register shutdown handlers (before connect)
        // ----------------------------------------------------------------
        baseAgent.registerShutdownHandlers(async () => {
            // Agent-specific cleanup: stop bots before broker disconnect
            if (slackBot) {
                logger.info(MODULE_AGENT, 'Stopping Slack bot...', timer.elapsed('main'));
                try {
                    if (typeof slackBot.stop === 'function') await slackBot.stop();
                } catch (error) {
                    logger.error(MODULE_AGENT, 'Error stopping Slack bot', "+0ms", error as Error | string);
                }
            }
            if (discordBot) {
                logger.info(MODULE_AGENT, 'Stopping Discord bot...', timer.elapsed('main'));
                try {
                    if (typeof discordBot.stop === 'function') await discordBot.stop();
                } catch (error) {
                    logger.error(MODULE_AGENT, 'Error stopping Discord bot', "+0ms", error as Error | string);
                }
            }
        });

        // ----------------------------------------------------------------
        // Step 2: Connect to broker (non-blocking)
        // ----------------------------------------------------------------
        logger.info(MODULE_AGENT, 'Connecting to broker...', timer.elapsed('main'));
        await baseAgent.connect();
        logger.info(MODULE_AGENT, '✅ Connected to broker', timer.elapsed('main'));

        // ----------------------------------------------------------------
        // Step 3: Initialize LLM-dependent services
        // ----------------------------------------------------------------
        if (llmEnabled && baseAgent.providerManager) {
            // Create LlmOrchestrator and inject into tool handlers
            const { LlmOrchestrator } = await import('./services/llm-orchestrator.js');
            const orchestrator = new LlmOrchestrator(baseAgent.providerManager, client);
            injectOrchestrator(orchestrator);
            logger.info(MODULE_AGENT, '   ✅ LlmOrchestrator created and injected', timer.elapsed('main'));

            // Setup task failure event handler
            try {
                const { setupTaskFailureHandler } = await import('./handlers/task-failure.js');
                await setupTaskFailureHandler(client);
                logger.info(MODULE_AGENT, 'Task failure event handler registered successfully', timer.elapsed('main'));
            } catch (error) {
                logger.error(MODULE_AGENT, 'Failed to setup task failure event handler', "+0ms", error as Error | string);
            }

            // Start Slack Bot if enabled
            const shouldEnableSlackBot = (process.env.ENABLE_SLACK_BOT === 'true' || process.env.ENABLE_SLACK_BOT === undefined);
            if (shouldEnableSlackBot) {
                logger.info(MODULE_AGENT, 'Starting Slack bot...', timer.elapsed('main'));
                const { SlackBot } = await import('./bot/slack-bot.js');
                slackBot = new SlackBot({
                    client,
                    anthropicApiKey: process.env.ANTHROPIC_API_KEY!,
                    botUserId: process.env.SLACK_BOT_USER_ID!,
                    providerManager: baseAgent.providerManager,
                    memoryService: baseAgent.memoryService!,
                });
                slackBot.start();
                logger.info(MODULE_AGENT, 'Slack bot started (subscribed to Slack mention events)', timer.elapsed('main'));
            }

            // Start Discord Bot if enabled
            const shouldEnableDiscordBot = (process.env.ENABLE_DISCORD_BOT === 'true' || process.env.ENABLE_DISCORD_BOT === undefined);
            if (shouldEnableDiscordBot) {
                logger.info(MODULE_AGENT, 'Starting Discord bot...', timer.elapsed('main'));
                const { DiscordBot } = await import('./bot/discord-bot.js');
                discordBot = new DiscordBot({
                    client,
                    anthropicApiKey: process.env.ANTHROPIC_API_KEY!,
                    botUserId: process.env.DISCORD_BOT_USER_ID!,
                    providerManager: baseAgent.providerManager,
                    memoryService: baseAgent.memoryService!,
                });
                discordBot.start();
                logger.info(MODULE_AGENT, 'Discord bot started (subscribed to Discord mention events)', timer.elapsed('main'));
            }
        } else {
            logger.info(MODULE_AGENT, 'LLM features disabled (configure ANTHROPIC_API_KEY to enable)', timer.elapsed('main'));
            logger.info(MODULE_AGENT, '', timer.elapsed('main'));
        }

        // ----------------------------------------------------------------
        // Step 4: Setup event subscriptions (always active, no LLM needed)
        // ----------------------------------------------------------------

        // Task rejection handler
        try {
            await subscribeToTaskRejections(client);
            logger.info(MODULE_AGENT, 'Task rejection event handler registered', timer.elapsed('main'));
        } catch (error) {
            logger.error(MODULE_AGENT, 'Failed to setup task rejection handler', "+0ms", error as Error | string);
        }

        // Task completion notifier → replaced by status-relay (v2 events)
        try {
            const { setupStatusRelay } = await import('./handlers/status-relay.js');
            await setupStatusRelay(client);
            logger.info(MODULE_AGENT, 'Status relay subscriptions registered', timer.elapsed('main'));
        } catch (error) {
            logger.error(MODULE_AGENT, 'Failed to setup status relay', "+0ms", error as Error | string);
        }

        // ----------------------------------------------------------------
        // Ready
        // ----------------------------------------------------------------
        logger.info(MODULE_AGENT, '', timer.elapsed('main'));
        logger.info(MODULE_AGENT, '='.repeat(60), timer.elapsed('main'));
        logger.info(MODULE_AGENT, '✅ Agent Producer ready and listening for events', timer.elapsed('main'));
        logger.info(MODULE_AGENT, '='.repeat(60), timer.elapsed('main'));

    } catch (error: any) {
        logger.error(MODULE_AGENT, 'Fatal error', "+0ms", error);
        if (error.stack) {
            logger.error(MODULE_AGENT, 'Stack trace', "+0ms", error.stack);
        }
        process.exit(1);
    }
}

// Start the application
main().catch((error) => {
    logger.error(MODULE_AGENT, 'Fatal error', "+0ms", error);
    process.exit(1);
});
