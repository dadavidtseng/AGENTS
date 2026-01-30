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
 * Environment Variables:
 * - KADI_BROKER_URL: WebSocket URL for KĀDI broker (required)
 * - ANTHROPIC_API_KEY: Anthropic API key for Claude (optional, for Slack/Discord bots)
 * - DISCORD_BOT_TOKEN: Discord bot token (optional)
 * - SLACK_BOT_TOKEN: Slack bot token (optional)
 *
 * @module agent-artist
 */

import 'dotenv/config';
import { createWorkerAgent, logger, MODULE_AGENT, timer } from 'agents-library';

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
    worktreePath: 'C:/p4/Personal/SD/agent-playground-artist',
    brokerUrl,
    anthropicApiKey,
    networks: ['utility'], // Changed from 'utility' to 'global' to match agent-producer networks
    claudeModel: 'claude-sonnet-4-5-20250929',
    customBehaviors: {
      // Preserve original commit message format
      formatCommitMessage: (taskId: string) => `feat: create artwork for task ${taskId}`
    }
  });

  // Start agent
  await agent.start();

  // Graceful shutdown
  process.on('SIGINT', async () => {
    logger.info(MODULE_AGENT, 'Shutting down artist agent...', timer.elapsed('main'));
    await agent.stop();
    logger.info(MODULE_AGENT, 'Shutdown complete', timer.elapsed('main'));
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    logger.info(MODULE_AGENT, 'Shutting down artist agent...', timer.elapsed('main'));
    await agent.stop();
    logger.info(MODULE_AGENT, 'Shutdown complete', timer.elapsed('main'));
    process.exit(0);
  });
}

main().catch((error) => {
  logger.error(MODULE_AGENT, 'Fatal error', timer.elapsed('main'), error);
  process.exit(1);
});
