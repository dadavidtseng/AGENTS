/**
 * Artist Agent for KĀDI Protocol
 * ================================
 *
 * Worker agent specialized in creative and artistic tasks using WorkerAgentFactory.
 *
 * Event Topics:
 * - Listens: artist.task.assigned
 * - Publishes: artist.task.completed, artist.task.failed, artist.file.created
 *
 * Commit Format: feat: create artwork for task {taskId}
 *
 * Agent Registration:
 * - Registers with mcp-server-quest on startup
 * - Sends heartbeat every 30 seconds
 * - Unregisters on graceful shutdown
 *
 * Environment Variables:
 * - KADI_BROKER_URL: WebSocket URL for KĀDI broker (required)
 * - ANTHROPIC_API_KEY: Anthropic API key for Claude (required)
 * - DISCORD_BOT_TOKEN: Discord bot token (optional)
 * - SLACK_BOT_TOKEN: Slack bot token (optional)
 *
 * @module agent-artist
 */

import 'dotenv/config';
import { createWorkerAgent, logger, MODULE_AGENT, timer } from 'agents-library';

// ============================================================================
// Agent Registration and Heartbeat
// ============================================================================

/**
 * Register agent with mcp-server-quest
 *
 * @param agent - Worker agent instance with KĀDI client
 */
async function registerAgent(agent: any): Promise<void> {
  try {
    logger.info(MODULE_AGENT, '📝 Registering agent with mcp-server-quest...', timer.elapsed('main'));

    const result = await agent.client.invokeRemote('quest_quest_register_agent', {
      agentId: 'agent-artist',
      name: 'Artist Agent',
      role: 'artist',
      capabilities: ['file-creation', 'image-generation', 'creative-content'],
      maxConcurrentTasks: 3
    });

    const resultText = result.content[0].text;
    const registrationData = JSON.parse(resultText);

    logger.info(MODULE_AGENT, `✅ Agent registered successfully`, timer.elapsed('main'));
    logger.info(MODULE_AGENT, `   Agent ID: ${registrationData.agentId}`, timer.elapsed('main'));
    logger.info(MODULE_AGENT, `   Message: ${registrationData.message}`, timer.elapsed('main'));
  } catch (error: any) {
    logger.error(MODULE_AGENT, `Failed to register agent: ${error.message}`, timer.elapsed('main'), error);
    // Don't throw - agent can still function without registration
  }
}

/**
 * Send heartbeat to mcp-server-quest
 *
 * @param agent - Worker agent instance with KĀDI client
 */
async function sendHeartbeat(agent: any): Promise<void> {
  try {
    await agent.client.invokeRemote('quest_quest_agent_heartbeat', {
      agentId: 'agent-artist',
      status: 'available',
      currentTasks: [], // TODO: Track current tasks
      timestamp: new Date().toISOString()
    });

    logger.debug(MODULE_AGENT, '💓 Heartbeat sent', timer.elapsed('main'));
  } catch (error: any) {
    logger.warn(MODULE_AGENT, `Heartbeat failed: ${error.message}`, timer.elapsed('main'));
    // Don't throw - heartbeat failures should not crash the agent
  }
}

/**
 * Start heartbeat interval (every 30 seconds)
 *
 * @param agent - Worker agent instance with KĀDI client
 * @returns Interval ID for cleanup
 */
function startHeartbeat(agent: any): NodeJS.Timeout {
  logger.info(MODULE_AGENT, '💓 Starting heartbeat (30s interval)...', timer.elapsed('main'));

  // Send initial heartbeat immediately
  sendHeartbeat(agent).catch((error) => {
    logger.warn(MODULE_AGENT, `Initial heartbeat failed: ${error.message}`, timer.elapsed('main'));
  });

  // Set up 30-second interval
  const intervalId = setInterval(() => {
    sendHeartbeat(agent).catch((error) => {
      logger.warn(MODULE_AGENT, `Heartbeat failed: ${error.message}`, timer.elapsed('main'));
    });
  }, 30000); // 30 seconds

  logger.info(MODULE_AGENT, '✅ Heartbeat started', timer.elapsed('main'));

  return intervalId;
}

/**
 * Unregister agent from mcp-server-quest
 *
 * @param agent - Worker agent instance with KĀDI client
 */
async function unregisterAgent(agent: any): Promise<void> {
  try {
    logger.info(MODULE_AGENT, '📝 Unregistering agent from mcp-server-quest...', timer.elapsed('main'));

    await agent.client.invokeRemote('quest_quest_unregister_agent', {
      agentId: 'agent-artist',
      reason: 'Graceful shutdown'
    });

    logger.info(MODULE_AGENT, '✅ Agent unregistered successfully', timer.elapsed('main'));
  } catch (error: any) {
    logger.error(MODULE_AGENT, `Failed to unregister agent: ${error.message}`, timer.elapsed('main'), error);
    // Don't throw - shutdown should continue even if unregistration fails
  }
}

// ============================================================================
// Main Application Entry Point
// ============================================================================

async function main() {
  // Start main timer for application lifetime tracking
  timer.start('main');

  // Validate required environment variables
  const brokerUrl = process.env.KADI_BROKER_URL;
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;

  if (!brokerUrl) {
    logger.error(MODULE_AGENT, 'KADI_BROKER_URL environment variable is required', timer.elapsed('main'));
    process.exit(1);
  }
  if (!anthropicApiKey) {
    logger.error(MODULE_AGENT, 'ANTHROPIC_API_KEY environment variable is required', timer.elapsed('main'));
    process.exit(1);
  }

  // Create artist agent using createWorkerAgent factory
  const agent = createWorkerAgent({
    role: 'artist',
    worktreePath: 'C:/GitHub/agent-playground-artist',
    brokerUrl,
    anthropicApiKey,
    networks: ['utility','global'],
    claudeModel: 'claude-sonnet-4-5-20250929',
    customBehaviors: {
      // Preserve original commit message format
      formatCommitMessage: (taskId: string) => `feat: create artwork for task ${taskId}`
    }
  });

  // Start agent
  await agent.start();

  // Register agent with mcp-server-quest
  await registerAgent(agent);

  // Start heartbeat interval
  const heartbeatInterval = startHeartbeat(agent);

  // Graceful shutdown handler
  const shutdown = async (signal: string) => {
    logger.info(MODULE_AGENT, `${signal} received, shutting down artist agent...`, timer.elapsed('main'));

    // Stop heartbeat
    clearInterval(heartbeatInterval);
    logger.info(MODULE_AGENT, '💓 Heartbeat stopped', timer.elapsed('main'));

    // Unregister agent
    await unregisterAgent(agent);

    // Stop agent
    await agent.stop();

    logger.info(MODULE_AGENT, 'Shutdown complete', timer.elapsed('main'));
    process.exit(0);
  };

  // Register shutdown handlers
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((error) => {
  logger.error(MODULE_AGENT, 'Fatal error', timer.elapsed('main'), error);
  process.exit(1);
});
