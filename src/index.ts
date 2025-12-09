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
 *
 * @module shadow-agent-artist
 */

import 'dotenv/config';
import { createShadowAgent } from 'agents-library';

async function main() {
  // Validate required environment variables
  const brokerUrl = process.env.KADI_BROKER_URL;

  if (!brokerUrl) {
    console.error('❌ KADI_BROKER_URL environment variable is required');
    process.exit(1);
  }

  // Create shadow agent using createShadowAgent factory
  const agent = createShadowAgent({
    role: 'artist',
    workerWorktreePath: 'C:/p4/Personal/SD/agent-playground-artist',
    shadowWorktreePath: 'C:/p4/Personal/SD/shadow-agent-playground-artist',
    workerBranch: 'agent-artist',
    shadowBranch: 'shadow-agent-artist',
    brokerUrl,
    networks: ['utility']
  });

  // Start agent
  await agent.start();

  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n🛑 Shutting down shadow agent artist...');
    await agent.stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('\n🛑 Shutting down shadow agent artist...');
    await agent.stop();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error('💥 Fatal error:', error);
  process.exit(1);
});
