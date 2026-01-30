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
 * 3. agent-producer publishes '{role}.task.assigned' event via KĀDI
 * 4. Worker agent receives event, executes task, commits to playground
 * 5. Worker agent publishes '{role}.task.completed' event
 * 6. agent-producer receives completion, awaits user approval
 *
 * @module agent-producer
 * @version 1.0.0
 * @license MIT
 */

import 'dotenv/config';
import {KadiClient} from '@kadi.build/core';
import {logger, MODULE_AGENT, timer} from 'agents-library';

import {setupTaskCompletionNotifier} from './handlers/task-completion-notifier.js';
import {registerAllTools} from './tools/index.js';

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

const config = {
    brokerUrl: process.env.KADI_BROKER_URL || 'ws://localhost:8080',
    networks: (process.env.KADI_NETWORK || 'global,slack,discord,utility').split(',')
};

// ============================================================================
// KĀDI Client
// ============================================================================

/**
 * KĀDI protocol client instance
 *
 * This client handles:
 * - WebSocket connection to broker
 * - Tool registration with broker
 * - Event publishing to worker agents
 * - MCP upstream calls to mcp-shrimp-task-manager
 */
const client = new KadiClient({
    name: 'agent-producer',
    version: '1.0.0',
    brokers: {
        default: config.brokerUrl
    },
    defaultBroker: 'default',
    networks: config.networks
});

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
registerAllTools(client);

// ============================================================================
// Task Completion Event Handlers
// ============================================================================

/**
 * Setup event handlers for task completion notifications
 * Subscribes to {role}.task.completed events from worker agents
 */
async function setupTaskCompletionHandlers(client: KadiClient): Promise<void> {
    const roles = ['artist', 'designer', 'programmer'];
    for (const role of roles) {
        const topic = `${role}.task.completed`;
        await client.subscribe(topic, async (event) => {
            await handleTaskCompletion(event, role, client);
        });
        logger.info(MODULE_AGENT, `Subscribed to ${topic}`, timer.elapsed('main'));
    }
}

/**
 * Handle task completion event from worker agent
 * Validates completion criteria and publishes ready-for-approval event
 */
async function handleTaskCompletion(event: any, role: string, client: KadiClient): Promise<void> {
    try {
        const {taskId, filesCreated, filesModified, commitSha} = event.data || {};

        logger.info(MODULE_AGENT, `Received ${role}.task.completed event {taskId: ${taskId}, filesCreated: ${filesCreated?.length || 0}, filesModified: ${filesModified?.length || 0}, commitSha: ${commitSha?.substring(0, 7)}}`, timer.elapsed('main'));

        // Validate task exists and get current status using client.invokeRemote
        const taskStatusResult: any = await client.invokeRemote('shrimp_get_task_detail', {taskId}, {
            timeout: 30000
        });

        logger.debug(MODULE_AGENT, `Task status result: ${JSON.stringify(taskStatusResult, null, 2)}`, timer.elapsed('main'));

        // Parse task details from markdown format
        const detailContent = Array.isArray(taskStatusResult.content)
            ? taskStatusResult.data.content.filter((item: any) => item.type === 'text').map((item: any) => item.text).join('\n')
            : String(taskStatusResult.data);

        const nameMatch = detailContent.match(/###\s+([^\n]+)/);
        const statusMatch = detailContent.match(/\*\*Status:\*\*\s*(\w+)/i);

        if (!nameMatch || !statusMatch) {
            logger.error(MODULE_AGENT, `Failed to parse task status for ${taskId}`, "+0ms");
            client.publish('task.completion.processing.failed', {
                taskId,
                role,
                error: 'Task status parsing failed',
                agent: 'agent-producer'
            });
            return;
        }

        const taskStatus = {
            taskId,
            description: nameMatch[1].trim(),
            status: statusMatch[1].toLowerCase()
        };

        // Validate completion criteria
        const isValid = validateTaskCompletion({
            taskId,
            commitSha,
            filesCreated,
            filesModified,
            taskStatus
        });

        if (isValid) {
            // Auto-verify task completion to set status to COMPLETED
            try {
                await client.invokeRemote('shrimp_verify_task', {
                    taskId,
                    summary: `Task completed by ${role} agent. Created ${filesCreated?.length || 0} files, modified ${filesModified?.length || 0} files. Commit: ${commitSha}`,
                    score: 100
                }, {
                    timeout: 30000
                });

                logger.info(MODULE_AGENT, `Task ${taskId} auto-verified successfully`, timer.elapsed('main'));
            } catch (verifyError) {
                logger.warn(MODULE_AGENT, `Failed to auto-verify task ${taskId} (continuing anyway)`, timer.elapsed('main'), verifyError as Error | string);
                // Continue anyway - task is still completed
            }

            // Get channel context from map (if available)
            const channelContext = taskChannelMap.get(taskId);

            // Publish ready for approval event with channel context
            client.publish('task.ready_for_approval', {
                taskId,
                role,
                taskName: taskStatus.description,
                message: `✅ ${taskStatus.description} completed by ${role} agent`,
                completionDetails: {
                    filesCreated: filesCreated || [],
                    filesModified: filesModified || [],
                    commitSha,
                    completedAt: new Date().toISOString()
                },
                channel: channelContext || {type: 'desktop'}, // Default to desktop if no context
                agent: 'agent-producer'
            });
            logger.info(MODULE_AGENT, `Task ${taskId} ready for user approval${channelContext ? ` (notifying via ${channelContext.type})` : ' (desktop notification)'}`, timer.elapsed('main'));
        } else {
            // Publish review failed event
            client.publish('task.review.failed', {
                taskId,
                role,
                reason: 'Completion criteria not met',
                agent: 'agent-producer'
            });
            logger.error(MODULE_AGENT, `Task ${taskId} failed automated review`, "+0ms");
        }
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.error(MODULE_AGENT, `Failed to process ${role}.task.completed event: ${errorMsg}`, "+0ms");

        client.publish('task.completion.processing.failed', {
            taskId: event.data?.taskId,
            role,
            error: errorMsg,
            agent: 'agent-producer'
        });
    }
}

/**
 * Validate task completion data meets requirements
 * Checks for commit SHA, file changes, and task status
 */
function validateTaskCompletion(data: any): boolean {
    const checks = {
        hasCommit: !!data.commitSha,
        hasFileChanges: (data.filesCreated?.length > 0) || (data.filesModified?.length > 0),
        statusValid: data.taskStatus?.status !== 'completed'
    };

    const passed = Object.values(checks).every(check => check);

    if (!passed) {
        logger.warn(MODULE_AGENT, `Task completion validation failed: ${JSON.stringify(checks)}`, timer.elapsed('main'));
    }

    return passed;
}

// ============================================================================
// Bot Instance Tracking
// ============================================================================

/**
 * Track bot instances for graceful shutdown
 * These are initialized after broker connection in main()
 */
let slackBot: any = null;
let discordBot: any = null;

/**
 * Graceful shutdown sequence
 *
 * Handles SIGTERM/SIGINT signals to cleanly shut down all services:
 * 1. Stop Slack bot (cancels Slack event subscriptions)
 * 2. Stop Discord bot (cancels Discord event subscriptions)
 * 3. Call client.disconnect() - KĀDI's built-in cleanup that:
 *    - Stops broker protocol heartbeat
 *    - Disconnects from broker (triggers broker's session cleanup)
 *    - Unloads all loaded abilities
 *    - Clears all event subscriptions (both local and broker-side)
 *    - Clears protocol instances
 * 4. Exit process
 */
async function gracefulShutdown(signal: string) {
    logger.info(MODULE_AGENT, `${signal} received, shutting down gracefully...`, timer.elapsed('main'));

    try {
        // Step 1: Stop Slack bot if running
        if (slackBot) {
            logger.info(MODULE_AGENT, 'Stopping Slack bot...', timer.elapsed('main'));
            try {
                if (typeof slackBot.stop === 'function') {
                    await slackBot.stop();
                }
            } catch (error) {
                logger.error(MODULE_AGENT, 'Error stopping Slack bot', "+0ms", error as Error | string);
            }
        }

        // Step 2: Stop Discord bot if running
        if (discordBot) {
            logger.info(MODULE_AGENT, 'Stopping Discord bot...', timer.elapsed('main'));
            try {
                if (typeof discordBot.stop === 'function') {
                    await discordBot.stop();
                }
            } catch (error) {
                logger.error(MODULE_AGENT, 'Error stopping Discord bot', "+0ms", error as Error | string);
            }
        }

        // Step 3: Disconnect from broker and cleanup all subscriptions
        // This is the critical step that cleanly unregisters from broker
        logger.info(MODULE_AGENT, 'Disconnecting from KĀDI broker...', timer.elapsed('main'));
        await client.disconnect();

        logger.info(MODULE_AGENT, 'Graceful shutdown complete', timer.elapsed('main'));
        process.exit(0);
    } catch (error) {
        logger.error(MODULE_AGENT, 'Error during graceful shutdown', "+0ms", error as Error | string);
        process.exit(1);
    }
}

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
        logger.info(MODULE_AGENT, `Broker URL: ${config.brokerUrl}`, timer.elapsed('main'));
        logger.info(MODULE_AGENT, `Networks: ${config.networks.join(', ')}`, timer.elapsed('main'));
        logger.info(MODULE_AGENT, '', timer.elapsed('main'));

        logger.info(MODULE_AGENT, 'Connecting to broker...', timer.elapsed('main'));
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

        // CRITICAL: serve() is blocking - all logs must come BEFORE this line
        // Connect to broker and start serving tool invocations
        // The broker will route tool calls to this agent based on network membership

        // Setup signal handlers BEFORE starting serve()
        // This ensures graceful shutdown is ready before blocking serve() call
        process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
        process.on('SIGINT', () => gracefulShutdown('SIGINT'));

        // Initialize shared services for bots (ProviderManager and MemoryService)
        const shouldEnableBots = (process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY !== 'YOUR_ANTHROPIC_API_KEY_HERE');

        if (shouldEnableBots) {
            // Wait for broker connection before initializing services
            setTimeout(async () => {
                try {
                    // Step 1: Load environment variables
                    const anthropicApiKey = process.env.ANTHROPIC_API_KEY!;
                    const modelManagerBaseUrl = process.env.MODEL_MANAGER_BASE_URL;
                    const modelManagerApiKey = process.env.MODEL_MANAGER_API_KEY;
                    const memoryDataPath = process.env.MEMORY_DATA_PATH || './data/memory';
                    const arcadedbUrl = process.env.ARCADEDB_URL;
                    const arcadedbPassword = process.env.ARCADEDB_ROOT_PASSWORD || 'root';

                    logger.info(MODULE_AGENT, 'Initializing shared services for bots...', timer.elapsed('main'));

                    // Step 2: Import service classes
                    const { 
                        ProviderManager, 
                        AnthropicProvider, 
                        ModelManagerProvider,
                        MemoryService
                    } = await import('agents-library');

                    // Step 3: Instantiate providers
                    const anthropicProvider = new AnthropicProvider(anthropicApiKey);
                    const providers: any[] = [anthropicProvider];

                    // Add ModelManagerProvider if configured
                    if (modelManagerBaseUrl && modelManagerApiKey) {
                        const modelManagerProvider = new ModelManagerProvider(modelManagerBaseUrl, modelManagerApiKey);
                        providers.push(modelManagerProvider);
                        logger.info(MODULE_AGENT, '   - ModelManager provider configured', timer.elapsed('main'));
                    }

                    // Step 4: Create ProviderManager with configuration
                    const providerManager = new ProviderManager(
                        providers,
                        {
                            primaryProvider: 'anthropic',
                            fallbackProvider: providers.length > 1 ? 'model-manager' : undefined,
                            retryAttempts: 3,
                            retryDelayMs: 1000,
                            healthCheckIntervalMs: 60000,
                        }
                    );

                    logger.info(MODULE_AGENT, '   - ProviderManager initialized with ' + providers.length + ' provider(s)', timer.elapsed('main'));

                    // Step 5: Create and initialize MemoryService
                    const memoryService = new MemoryService(
                        memoryDataPath,
                        arcadedbUrl,
                        arcadedbPassword,
                        providerManager
                    );

                    await memoryService.initialize();
                    logger.info(MODULE_AGENT, '   - MemoryService initialized', timer.elapsed('main'));

                    // Store services for graceful shutdown
                    (global as any).__providerManager = providerManager;
                    (global as any).__memoryService = memoryService;

                    // Step 6: Start Slack Bot if enabled
                    const shouldEnableSlackBot = (process.env.ENABLE_SLACK_BOT === 'true' || process.env.ENABLE_SLACK_BOT === undefined);
                    if (shouldEnableSlackBot) {
                        logger.info(MODULE_AGENT, 'Starting Slack bot...', timer.elapsed('main'));
                        const { SlackBot } = await import('./bot/slack-bot.js');
                        slackBot = new SlackBot({
                            client,
                            anthropicApiKey,
                            botUserId: process.env.SLACK_BOT_USER_ID!,
                            providerManager,
                            memoryService,
                        });
                        slackBot.start();
                        logger.info(MODULE_AGENT, 'Slack bot started (subscribed to Slack mention events)', timer.elapsed('main'));
                    }

                    // Step 7: Start Discord Bot if enabled
                    const shouldEnableDiscordBot = (process.env.ENABLE_DISCORD_BOT === 'true' || process.env.ENABLE_DISCORD_BOT === undefined);
                    if (shouldEnableDiscordBot) {
                        logger.info(MODULE_AGENT, 'Starting Discord bot...', timer.elapsed('main'));
                        const { DiscordBot } = await import('./bot/discord-bot.js');
                        discordBot = new DiscordBot({
                            client,
                            anthropicApiKey,
                            botUserId: process.env.DISCORD_BOT_USER_ID!,
                            providerManager,
                            memoryService,
                        });
                        discordBot.start();
                        logger.info(MODULE_AGENT, 'Discord bot started (subscribed to Discord mention events)', timer.elapsed('main'));
                    }

                } catch (error) {
                    logger.error(MODULE_AGENT, 'Failed to initialize services or bots', "+0ms", error as Error | string);
                }
            }, 2000); // Wait 2 seconds for broker connection
        } else {
            logger.info(MODULE_AGENT, 'Bots disabled (configure ANTHROPIC_API_KEY to enable)', timer.elapsed('main'));
            logger.info(MODULE_AGENT, '', timer.elapsed('main'));
        }

        // Setup task completion event handlers after bots are initialized
        setTimeout(async () => {
            try {
                await setupTaskCompletionHandlers(client);
                logger.info(MODULE_AGENT, 'Task completion event handlers registered', timer.elapsed('main'));
            } catch (error) {
                logger.error(MODULE_AGENT, 'Failed to setup task completion handlers', "+0ms", error as Error | string);
            }
        }, 2000);

        // Setup task completion notifier for user notifications
        setTimeout(async () => {
            try {
                await setupTaskCompletionNotifier(client);
                logger.info(MODULE_AGENT, 'Task completion notifier registered', timer.elapsed('main'));
            } catch (error) {
                logger.error(MODULE_AGENT, 'Failed to setup task completion notifier', "+0ms", error as Error | string);
            }
        }, 2000);

        // Connect to KĀDI broker and start serving (BLOCKING - never returns)
        await client.serve('broker');
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
