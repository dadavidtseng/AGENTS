/**
 * agent-builder - KĀDI Agent for Game Lifecycle Management
 * =========================================================
 *
 * Provides tools to shut down, rebuild (MSBuild), and relaunch DaemonAgent.
 * Detects game reconnection via KĀDI event subscription (game.ready topic).
 *
 * Tools:
 * - shutdown_game: Terminate the running game process
 * - restart_game: Kill → relaunch (no rebuild)
 * - rebuild_game: Kill → MSBuild → relaunch → wait for KĀDI reconnect
 *
 * @module agent-builder
 */

import 'dotenv/config';
import { BaseAgent, logger, MODULE_AGENT, timer } from 'agents-library';
import type { BaseAgentConfig } from 'agents-library';
import { registerAllTools } from './tools/index.js';

// ============================================================================
// Configuration
// ============================================================================

const brokerUrl = process.env.KADI_BROKER_URL || 'ws://localhost:8080';
const networks = (process.env.KADI_NETWORK || 'utility').split(',');

// ============================================================================
// BaseAgent Instance
// ============================================================================

const baseAgentConfig: BaseAgentConfig = {
  agentId: 'agent-builder',
  agentRole: 'builder',
  version: '1.0.0',
  brokerUrl,
  networks,
};

const baseAgent = new BaseAgent(baseAgentConfig);
const client = baseAgent.client;

// Register tools before connecting
registerAllTools(client);

// ============================================================================
// Main
// ============================================================================

async function main() {
  timer.start('main');

  try {
    logger.info(MODULE_AGENT, '='.repeat(50), timer.elapsed('main'));
    logger.warn(MODULE_AGENT, 'Starting Agent Builder', timer.elapsed('main'));
    logger.info(MODULE_AGENT, '='.repeat(50), timer.elapsed('main'));
    logger.info(MODULE_AGENT, `Broker: ${brokerUrl}`, timer.elapsed('main'));
    logger.info(MODULE_AGENT, `Networks: ${networks.join(', ')}`, timer.elapsed('main'));

    // List registered tools
    const tools = client.readAgentJson().tools;
    logger.info(MODULE_AGENT, `Tools: ${tools.length} registered`, timer.elapsed('main'));
    for (const tool of tools) {
      logger.info(MODULE_AGENT, `  • ${tool.name} - ${tool.description || ''}`, timer.elapsed('main'));
    }

    // Shutdown handlers
    baseAgent.registerShutdownHandlers(async () => {
      logger.info(MODULE_AGENT, 'Cleaning up...', timer.elapsed('main'));
    });

    // Connect to broker
    logger.info(MODULE_AGENT, 'Connecting to broker...', timer.elapsed('main'));
    await baseAgent.connect();
    logger.info(MODULE_AGENT, '✅ Connected to broker', timer.elapsed('main'));

    logger.info(MODULE_AGENT, '='.repeat(50), timer.elapsed('main'));
    logger.info(MODULE_AGENT, '✅ Agent Builder ready', timer.elapsed('main'));
    logger.info(MODULE_AGENT, '='.repeat(50), timer.elapsed('main'));

  } catch (error: unknown) {
    logger.error(MODULE_AGENT, 'Fatal error', '+0ms', error as Error);
    process.exit(1);
  }
}

main().catch((error) => {
  logger.error(MODULE_AGENT, 'Fatal error', '+0ms', error);
  process.exit(1);
});
