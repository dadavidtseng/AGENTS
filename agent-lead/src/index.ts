import 'dotenv/config';
import { BaseAgent, loadVaultCredentials, logger, MODULE_AGENT, timer } from 'agents-library';
import type { BaseAgentConfig, AgentRole } from 'agents-library';
import type { KadiClient } from '@kadi.build/core';
import { setupTaskReceptionHandler } from './handlers/task-reception.js';
import { setupTaskVerificationHandler } from './handlers/task-verification.js';
import { setupPrWorkflowHandler } from './handlers/pr-workflow.js';
import { setupQuestCleanupHandler } from './handlers/quest-cleanup.js';


// Role-based network mapping
const ROLE_NETWORKS: Record<string, string[]> = {
  artist: ['producer', 'artist', 'git', 'qa', 'quest', 'file', 'global'],
  designer: ['producer', 'designer', 'git', 'qa', 'quest', 'file', 'global'],
  programmer: ['producer', 'programmer', 'git', 'qa', 'deploy', 'quest', 'file', 'global'],
};

const VALID_ROLES = ['artist', 'designer', 'programmer'];

const role = process.env.AGENT_ROLE ?? 'programmer';
if (!VALID_ROLES.includes(role)) {
  console.error(`Invalid AGENT_ROLE: ${role}. Must be one of: ${VALID_ROLES.join(', ')}`);
  process.exit(1);
}

const agentName = `agent-lead-${role}`;
const networks = ROLE_NETWORKS[role];
const brokerUrl = process.env.KADI_BROKER_URL ?? 'ws://localhost:8080/kadi';

// ============================================================================
// Agent Registration & Heartbeat
// ============================================================================

const LEAD_CAPABILITIES = [
  'task-coordination',
  'task-verification',
  'pr-creation',
  'workflow-management',
];

async function registerAgent(kadiClient: KadiClient, agentRole: string, agentId: string): Promise<void> {
  try {
    logger.info(MODULE_AGENT, '📝 Registering agent with mcp-server-quest...', timer.elapsed('main'));

    const result = await kadiClient.invokeRemote<{
      content: Array<{ type: string; text: string }>;
    }>('quest_quest_register_agent', {
      agentId,
      name: `Lead ${agentRole.charAt(0).toUpperCase() + agentRole.slice(1)} Agent`,
      role: agentRole,
      capabilities: LEAD_CAPABILITIES,
      maxConcurrentTasks: 10,
    });

    const resultText = result.content[0].text;
    const data = JSON.parse(resultText);
    logger.info(MODULE_AGENT, `✅ Agent registered: ${data.message}`, timer.elapsed('main'));
  } catch (error: any) {
    logger.error(MODULE_AGENT, `Failed to register agent: ${error.message}`, timer.elapsed('main'), error);
  }
}

async function sendHeartbeat(kadiClient: KadiClient, agentId: string): Promise<void> {
  try {
    await kadiClient.invokeRemote('quest_quest_agent_heartbeat', {
      agentId,
      status: 'available',
      currentTasks: [],
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    logger.warn(MODULE_AGENT, `Heartbeat failed: ${error.message}`, timer.elapsed('main'));
  }
}

function startHeartbeat(kadiClient: KadiClient, agentId: string): NodeJS.Timeout {
  logger.info(MODULE_AGENT, '💓 Starting heartbeat (30s interval)...', timer.elapsed('main'));
  sendHeartbeat(kadiClient, agentId).catch(() => {});
  return setInterval(() => sendHeartbeat(kadiClient, agentId).catch(() => {}), 30_000);
}

async function unregisterAgent(kadiClient: KadiClient, agentId: string): Promise<void> {
  try {
    logger.info(MODULE_AGENT, '📝 Unregistering agent...', timer.elapsed('main'));
    await kadiClient.invokeRemote('quest_quest_unregister_agent', {
      agentId,
      reason: 'Graceful shutdown',
    });
    logger.info(MODULE_AGENT, '✅ Agent unregistered', timer.elapsed('main'));
  } catch (error: any) {
    logger.error(MODULE_AGENT, `Failed to unregister: ${error.message}`, timer.elapsed('main'), error);
  }
}

// ============================================================================
// Provider Config Builder
// ============================================================================

/** Build provider config. Model Manager is primary, Anthropic is fallback. */
function buildProviderConfig(
  modelManagerBaseUrl?: string,
  modelManagerApiKey?: string,
  anthropicApiKey?: string,
): { provider: BaseAgentConfig['provider'] } | Record<string, never> {

  if (modelManagerBaseUrl && modelManagerApiKey) {
    return {
      provider: {
        modelManagerBaseUrl,
        modelManagerApiKey,
        primaryProvider: 'model-manager',
        ...(anthropicApiKey && {
          anthropicApiKey,
          fallbackProvider: 'anthropic',
        }),
      },
    };
  }

  if (anthropicApiKey) {
    return {
      provider: {
        anthropicApiKey,
        primaryProvider: 'anthropic',
      },
    };
  }

  return {};
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  timer.start('main');

  logger.info(MODULE_AGENT, `Starting ${agentName}`, timer.elapsed('main'));
  logger.info(MODULE_AGENT, `Networks: ${networks.join(', ')}`, timer.elapsed('main'));

  // Load credentials: env vars take priority over vault
  const vault = await loadVaultCredentials();
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY || vault.ANTHROPIC_API_KEY;
  const modelManagerBaseUrl = process.env.MODEL_MANAGER_BASE_URL || vault.MODEL_MANAGER_BASE_URL;
  const modelManagerApiKey = process.env.MODEL_MANAGER_API_KEY || vault.MODEL_MANAGER_API_KEY;

  // Build BaseAgent config
  const baseAgentConfig: BaseAgentConfig = {
    agentId: agentName,
    agentRole: role as AgentRole,
    version: '1.0.0',
    brokerUrl,
    networks,
    ...buildProviderConfig(modelManagerBaseUrl, modelManagerApiKey, anthropicApiKey),
    memory: {
      dataPath: process.env.MEMORY_DATA_PATH || './data/memory',
    },
  };

  const baseAgent = new BaseAgent(baseAgentConfig);
  const client = baseAgent.client;

  await baseAgent.connect();
  logger.info(MODULE_AGENT, `Connected to broker at ${brokerUrl}`, timer.elapsed('main'));

  // Task 4.10 + 4.11: Subscribe to quest.tasks_ready and dispatch tasks to workers
  await setupTaskReceptionHandler(client, role, agentName);

  // Task 4.12: Subscribe to task.completed and task.failed for verification
  await setupTaskVerificationHandler(client, role, agentName, baseAgent.providerManager);

  // Task 4.14: Subscribe to quest.verification_complete for PR creation
  await setupPrWorkflowHandler(client, role, agentName, baseAgent.providerManager, baseAgent.memoryService);

  // Post-merge cleanup: delete quest/<questId> branches after PR merge
  await setupQuestCleanupHandler(client, role, agentName);

  // Register with mcp-server-quest and start heartbeat
  await registerAgent(client, role, agentName);
  const heartbeatInterval = startHeartbeat(client, agentName);

  if (baseAgent.providerManager) {
    const primary = modelManagerBaseUrl ? 'Model Manager' : 'Anthropic';
    logger.info(MODULE_AGENT, `LLM orchestration enabled (primary: ${primary})`, timer.elapsed('main'));
  } else {
    logger.warn(MODULE_AGENT, 'No LLM provider configured — using rule-based orchestration only', timer.elapsed('main'));
  }

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info(MODULE_AGENT, `${signal} received, shutting down...`, timer.elapsed('main'));
    clearInterval(heartbeatInterval);
    await unregisterAgent(client, agentName);
    await baseAgent.shutdown();
    logger.info(MODULE_AGENT, 'Shutdown complete', timer.elapsed('main'));
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  logger.info(MODULE_AGENT, `${agentName} ready`, timer.elapsed('main'));
}

main().catch((err) => {
  logger.error(MODULE_AGENT, `Fatal error: ${err}`, timer.elapsed('main'));
  process.exit(1);
});
