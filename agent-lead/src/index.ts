/**
 * Lead Agent for KĀDI Protocol
 * ==============================
 *
 * Orchestration agent for the KĀDI multi-agent system.
 * Coordinates task assignment, verification, PR creation, and cleanup.
 *
 * Architecture:
 * - BaseAgent provides KadiClient + ProviderManager + MemoryService
 * - Event-driven: subscribes to broker events, dispatches tasks to workers
 * - Optional LLM enhancement for PR descriptions, conflict resolution, fix instructions
 *
 * Event Topics:
 * - Listens: quest.tasks_ready, task.validated, task.failed, task.revision_needed,
 *            quest.cascade_needed, quest.verification_complete, quest.merged
 * - Publishes: task.assigned, quest.verification_complete, conflict.escalation
 *
 * @module agent-lead
 */

import {
  BaseAgent,
  loadVaultCredentials,
  readConfig,
  setLogLevel,
  setAgentTag,
  logger,
  timer,
} from 'agents-library';
import type { BaseAgentConfig, AgentRole } from 'agents-library';
import type { KadiClient } from '@kadi.build/core';
import { setupTaskReceptionHandler } from './handlers/task-reception.js';
import { setupTaskVerificationHandler } from './handlers/task-verification.js';
import { setupPrWorkflowHandler } from './handlers/pr-workflow.js';
import { setupQuestCleanupHandler } from './handlers/quest-cleanup.js';

const cfg = readConfig();

// ============================================================================
// Agent identity + logging
// ============================================================================

const agentId = cfg.string('agent.ID');
const agentVersion = cfg.string('agent.VERSION');
const logLevel = cfg.has('logging.LEVEL') ? cfg.string('logging.LEVEL') : 'info';
setLogLevel(logLevel);
setAgentTag(agentId);

// Wire repo path from config.toml → env (used by pr-workflow, quest-cleanup)
if (cfg.has('repo.PATH') && !process.env.REPO_PATH) {
  process.env.REPO_PATH = cfg.string('repo.PATH');
}

// ============================================================================
// Configuration
// ============================================================================

// Role resolution: env var (from kadi run start:artist) takes priority over config.toml
const roleName = process.env.AGENT_ROLE ?? cfg.string('agent.ROLE');
const agentName = `agent-lead-${roleName}`;

// Networks from per-role config section
const roleNetworksKey = `roles.${roleName}.NETWORKS`;
if (!cfg.has(roleNetworksKey)) {
  throw new Error(`Unknown role '${roleName}': no [roles.${roleName}] section in config.toml`);
}
const roleNetworks = cfg.strings(roleNetworksKey);

// Broker resolution: at least one of local/remote required
const hasLocal = cfg.has('broker.local.URL');
const hasRemote = cfg.has('broker.remote.URL');
if (!hasLocal && !hasRemote) {
  throw new Error('At least one broker required: set [broker.local] or [broker.remote] in config.toml');
}

const brokerUrl = hasLocal
  ? (process.env.KADI_BROKER_URL_LOCAL ?? cfg.string('broker.local.URL'))
  : (process.env.KADI_BROKER_URL_REMOTE ?? cfg.string('broker.remote.URL'));

// Always use role-specific networks for the primary broker connection
const networks = roleNetworks;

const additionalBrokerUrl = hasLocal && hasRemote
  ? (process.env.KADI_BROKER_URL_REMOTE ?? cfg.string('broker.remote.URL'))
  : undefined;
const additionalBrokerNetworks = hasLocal && hasRemote
  ? (process.env.KADI_NETWORK_REMOTE?.split(',') ?? cfg.strings('broker.remote.NETWORKS'))
  : undefined;

// Provider config
const primaryProvider = cfg.has('provider.PRIMARY') ? cfg.string('provider.PRIMARY') : undefined;
const fallbackProvider = cfg.has('provider.FALLBACK') ? cfg.string('provider.FALLBACK') : undefined;

// ============================================================================
// Agent Registration & Heartbeat
// ============================================================================

const LEAD_CAPABILITIES = [
  'task-coordination',
  'task-verification',
  'pr-creation',
  'workflow-management',
];

async function registerAgent(kadiClient: KadiClient, agentRole: string, leadAgentId: string): Promise<void> {
  try {
    logger.info(agentId, 'Registering with quest server...', timer.elapsed('main'));
    const result = await kadiClient.invokeRemote<{
      content: Array<{ type: string; text: string }>;
    }>('quest_quest_register_agent', {
      agentId: leadAgentId,
      name: `Lead ${agentRole.charAt(0).toUpperCase() + agentRole.slice(1)} Agent`,
      role: agentRole,
      capabilities: LEAD_CAPABILITIES,
      maxConcurrentTasks: 10,
    });
    const resultText = result.content[0].text;
    const data = JSON.parse(resultText);
    logger.info(agentId, `Registered: ${data.message}`, timer.elapsed('main'));
  } catch (error: any) {
    logger.error(agentId, `Registration failed: ${error.message}`, timer.elapsed('main'), error);
  }
}

async function sendHeartbeat(kadiClient: KadiClient, leadAgentId: string): Promise<void> {
  try {
    await kadiClient.invokeRemote('quest_quest_agent_heartbeat', {
      agentId: leadAgentId,
      status: 'available',
      currentTasks: [],
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    logger.warn(agentId, `Heartbeat failed: ${error.message}`, timer.elapsed('main'));
  }
}

function startHeartbeat(kadiClient: KadiClient, leadAgentId: string): NodeJS.Timeout {
  logger.debug(agentId, 'Starting heartbeat (30s interval)', timer.elapsed('main'));
  sendHeartbeat(kadiClient, leadAgentId).catch(() => {});
  return setInterval(() => sendHeartbeat(kadiClient, leadAgentId).catch(() => {}), 30_000);
}

async function unregisterAgent(kadiClient: KadiClient, leadAgentId: string): Promise<void> {
  try {
    logger.info(agentId, 'Unregistering from quest server...', timer.elapsed('main'));
    await kadiClient.invokeRemote('quest_quest_unregister_agent', {
      agentId: leadAgentId,
      reason: 'Graceful shutdown',
    });
    logger.info(agentId, 'Unregistered', timer.elapsed('main'));
  } catch (error: any) {
    logger.error(agentId, `Unregister failed: ${error.message}`, timer.elapsed('main'), error);
  }
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  timer.start('main');

  // Startup summary
  logger.info(agentId, `Starting ${agentName} v${agentVersion} (role: ${roleName})`, timer.elapsed('main'));
  const brokerSummary = [
    hasLocal ? `local=${process.env.KADI_BROKER_URL_LOCAL ?? cfg.string('broker.local.URL')}` : null,
    hasRemote ? `remote=${process.env.KADI_BROKER_URL_REMOTE ?? cfg.string('broker.remote.URL')}` : null,
  ].filter(Boolean).join(', ');
  logger.info(agentId, `Broker: ${brokerSummary}`, timer.elapsed('main'));
  logger.info(agentId, `Networks: ${networks.join(', ')}`, timer.elapsed('main'));
  if (primaryProvider) {
    const primaryModel = cfg.string(`provider.${primaryProvider}.MODEL`);
    const fallbackModel = fallbackProvider ? cfg.string(`provider.${fallbackProvider}.MODEL`) : undefined;
    logger.info(agentId, `LLM: ${primaryProvider}/${primaryModel}${fallbackProvider ? ` (fallback: ${fallbackProvider}/${fallbackModel})` : ''}`, timer.elapsed('main'));
  }

  // Load credentials: env vars take priority over vault
  const vault = await loadVaultCredentials();
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY || vault.ANTHROPIC_API_KEY;
  const modelManagerBaseUrl = process.env.MODEL_MANAGER_BASE_URL || vault.MODEL_MANAGER_BASE_URL;
  const modelManagerApiKey = process.env.MODEL_MANAGER_API_KEY || vault.MODEL_MANAGER_API_KEY;

  // Build BaseAgent config
  const baseAgentConfig: BaseAgentConfig = {
    agentId: agentName,
    agentRole: roleName as AgentRole,
    version: agentVersion,
    brokerUrl,
    networks,
    ...(additionalBrokerUrl && {
      additionalBrokers: {
        remote: { url: additionalBrokerUrl, networks: additionalBrokerNetworks! },
      },
    }),
    ...((anthropicApiKey || (modelManagerBaseUrl && modelManagerApiKey)) ? {
      provider: {
        ...(anthropicApiKey && { anthropicApiKey }),
        ...(modelManagerBaseUrl && modelManagerApiKey && {
          modelManagerBaseUrl,
          modelManagerApiKey,
        }),
        ...(primaryProvider && { primaryProvider }),
        ...(fallbackProvider && { fallbackProvider }),
      },
    } : {}),
    memory: {
      dataPath: process.env.MEMORY_DATA_PATH ?? cfg.string('memory.DATA_PATH'),
    },
  };

  const baseAgent = new BaseAgent(baseAgentConfig);
  await baseAgent.connect(vault);

  const client = baseAgent.client;

  // Load ability-file-local natively (zero-latency file ops for conflict resolution)
  let nativeFileLocal: Awaited<ReturnType<KadiClient['loadNative']>> | null = null;
  try {
    nativeFileLocal = await client.loadNative('ability-file-local');
    logger.info(agentId, 'Loaded ability-file-local natively', timer.elapsed('main'));
  } catch (err: any) {
    logger.warn(agentId, `Could not load ability-file-local: ${err.message}`, timer.elapsed('main'));
  }

  // Subscribe to all event handlers
  await setupTaskReceptionHandler(client, roleName, agentName);
  await setupTaskVerificationHandler(client, roleName, agentName, baseAgent.providerManager);
  await setupPrWorkflowHandler(client, roleName, agentName, baseAgent.providerManager, baseAgent.memoryService, nativeFileLocal);
  await setupQuestCleanupHandler(client, roleName, agentName);

  // Register with quest server and start heartbeat
  await registerAgent(client, roleName, agentName);
  const heartbeatInterval = startHeartbeat(client, agentName);

  if (baseAgent.providerManager) {
    logger.info(agentId, 'LLM orchestration enabled', timer.elapsed('main'));
  } else {
    logger.warn(agentId, 'No LLM provider — rule-based orchestration only', timer.elapsed('main'));
  }

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info(agentId, `${signal} received, shutting down...`, timer.elapsed('main'));
    clearInterval(heartbeatInterval);
    await unregisterAgent(client, agentName);
    await baseAgent.shutdown();
    logger.info(agentId, 'Shutdown complete', timer.elapsed('main'));
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  logger.info(agentId, `Ready (${timer.elapsed('main')})`, timer.elapsed('main'));
}

main().catch((error) => {
  logger.error(agentId, 'Fatal error', '+0ms', error);
  process.exit(1);
});
