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
import { createWorkerAgent } from 'agents-library';

async function main() {
  // Validate required environment variables
  const brokerUrl = process.env.KADI_BROKER_URL;
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;

  if (!brokerUrl) {
    console.error('❌ KADI_BROKER_URL environment variable is required');
    process.exit(1);
  }
  if (!anthropicApiKey) {
    console.error('❌ ANTHROPIC_API_KEY environment variable is required');
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
    console.log('\n🛑 Shutting down artist agent...');
    await agent.stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('\n🛑 Shutting down artist agent...');
    await agent.stop();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error('💥 Fatal error:', error);
  process.exit(1);
});
