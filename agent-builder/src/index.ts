/**
 * agent-builder - KADI Agent for Game Lifecycle Management
 * =========================================================
 *
 * Provides tools to shut down, rebuild (MSBuild), and relaunch DaemonAgent.
 * Detects game reconnection via KADI event subscription (game.ready topic).
 *
 * Tools:
 * - shutdown_game: Terminate the running game process
 * - restart_game: Kill → relaunch (no rebuild)
 * - rebuild_game: Kill → MSBuild → relaunch → wait for KADI reconnect
 *
 * @module agent-builder
 */

import { BaseAgent, readConfig, setLogLevel, setAgentTag, logger, timer } from 'agents-library';
import type { BaseAgentConfig } from 'agents-library';
import { registerAllTools } from './tools/index.js';

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

// Broker resolution: at least one of local/remote required
const hasLocal = cfg.has('broker.local.URL');
const hasRemote = cfg.has('broker.remote.URL');
if (!hasLocal && !hasRemote) {
  throw new Error('At least one broker required: set [broker.local] or [broker.remote] in config.toml');
}

const brokerUrl = hasLocal
  ? cfg.string('broker.local.URL')
  : cfg.string('broker.remote.URL');
const networks = hasLocal
  ? cfg.strings('broker.local.NETWORKS')
  : cfg.strings('broker.remote.NETWORKS');

const additionalBrokerUrl = hasLocal && hasRemote
  ? cfg.string('broker.remote.URL')
  : undefined;
const additionalBrokerNetworks = hasLocal && hasRemote
  ? cfg.strings('broker.remote.NETWORKS')
  : undefined;

// ============================================================================
// BaseAgent Instance
// ============================================================================

const baseAgentConfig: BaseAgentConfig = {
  agentId,
  agentRole,
  version: agentVersion,
  brokerUrl,
  networks,
  ...(additionalBrokerUrl && {
    additionalBrokers: {
      remote: { url: additionalBrokerUrl, networks: additionalBrokerNetworks! },
    },
  }),
};

const baseAgent = new BaseAgent(baseAgentConfig);
const client = baseAgent.client;

// ============================================================================
// Tool Registration
// ============================================================================

registerAllTools(client);

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  timer.start('main');

  try {
    // Startup summary
    logger.info(agentId, `Starting ${agentId} v${agentVersion} (role: ${agentRole})`, timer.elapsed('main'));
    const brokerSummary = [
      hasLocal ? `local=${cfg.string('broker.local.URL')}` : null,
      hasRemote ? `remote=${cfg.string('broker.remote.URL')}` : null,
    ].filter(Boolean).join(', ');
    logger.info(agentId, `Broker: ${brokerSummary}`, timer.elapsed('main'));
    logger.info(agentId, `Networks: ${networks.join(', ')}`, timer.elapsed('main'));

    // Log registered tools
    const registeredTools = client.readAgentJson().tools;
    logger.info(agentId, `Tools: ${registeredTools.length} registered`, timer.elapsed('main'));
    for (const tool of registeredTools) {
      logger.debug(agentId, `  ${tool.name} - ${tool.description || 'No description'}`, timer.elapsed('main'));
    }

    // Step 1: Register shutdown handlers
    baseAgent.registerShutdownHandlers(async () => {
      logger.info(agentId, 'Cleaning up...', timer.elapsed('main'));
    });

    // Step 2: Connect to broker
    await baseAgent.connect();

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
