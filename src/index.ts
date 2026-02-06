/**
 * Shadow Agent Artist for KĀDI Protocol
 * ======================================
 *
 * Shadow agent specialized in monitoring and backing up artist worker agent worktree
 * using ShadowAgentFactory for configuration-driven instantiation.
 *
 * Event Topics:
 * - Publishes: shadow-artist.backup.completed, shadow-artist.backup.failed
 *
 * Commit Format: Shadow: {OPERATION} {filename}
 * - Examples: "Shadow: Created artwork.png", "Shadow: Modified logo.svg", "Shadow: Deleted old.png"
 *
 * Environment Variables:
 * - KADI_BROKER_URL: WebSocket URL for KĀDI broker (required)
 * - KADI_NETWORK: Comma-separated list of networks to join (optional, default: global)
 * - WORKER_WORKTREE_PATH: Absolute path to worker agent worktree (required)
 * - SHADOW_WORKTREE_PATH: Absolute path to shadow agent worktree (required)
 * - WORKER_BRANCH: Git branch in worker worktree (optional, default: agent-artist)
 * - SHADOW_BRANCH: Git branch in shadow worktree (optional, default: shadow-agent-artist)
 *
 * @module shadow-agent-artist
 */

import 'dotenv/config';
import { createShadowAgent, logger, MODULE_AGENT, timer } from 'agents-library';

async function main() {
  // Start main timer for application lifetime tracking
  timer.start('main');

  // Validate required environment variables
  const brokerUrl = process.env.KADI_BROKER_URL;
  const workerWorktreePath = process.env.WORKER_WORKTREE_PATH;
  const shadowWorktreePath = process.env.SHADOW_WORKTREE_PATH;
  const workerBranch = process.env.WORKER_BRANCH || 'agent-artist';
  const shadowBranch = process.env.SHADOW_BRANCH || 'shadow-agent-artist';
  const networks = process.env.KADI_NETWORK?.split(',').map(n => n.trim()) || ['global'];

  if (!brokerUrl) {
    logger.error(MODULE_AGENT, 'KADI_BROKER_URL environment variable is required', timer.elapsed('main'));
    process.exit(1);
  }

  if (!workerWorktreePath) {
    logger.error(MODULE_AGENT, 'WORKER_WORKTREE_PATH environment variable is required', timer.elapsed('main'));
    process.exit(1);
  }

  if (!shadowWorktreePath) {
    logger.error(MODULE_AGENT, 'SHADOW_WORKTREE_PATH environment variable is required', timer.elapsed('main'));
    process.exit(1);
  }

  // Create shadow agent using createShadowAgent factory
  const agent = createShadowAgent({
    role: 'artist',
    workerWorktreePath,
    shadowWorktreePath,
    workerBranch,
    shadowBranch,
    brokerUrl,
    networks
  });

  // Start agent
  await agent.start();

  // Graceful shutdown
  process.on('SIGINT', async () => {
    logger.info(MODULE_AGENT, 'Shutting down shadow agent artist...', timer.elapsed('main'));
    await agent.stop();
    logger.info(MODULE_AGENT, 'Shutdown complete', timer.elapsed('main'));
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    logger.info(MODULE_AGENT, 'Shutting down shadow agent artist...', timer.elapsed('main'));
    await agent.stop();
    logger.info(MODULE_AGENT, 'Shutdown complete', timer.elapsed('main'));
    process.exit(0);
  });
}

main().catch((error) => {
  logger.error(MODULE_AGENT, 'Fatal error', timer.elapsed('main'), error);
  process.exit(1);
});
