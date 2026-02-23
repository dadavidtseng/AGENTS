/**
 * Worker Agent for KĀDI Protocol
 * ================================
 *
 * Generic worker agent for the KĀDI multi-agent system.
 * Supports multiple roles (artist, programmer, designer) via role configuration.
 *
 * Architecture (Task 3.15):
 * - BaseAgent provides KadiClient + ProviderManager + MemoryService
 * - RoleLoader loads role config from config/roles/{role}.json
 * - WorkerAgentFactory creates BaseWorkerAgent with tool-calling loop
 * - BaseWorkerAgent.setProviderManager() injects ProviderManager from BaseAgent
 * - BaseWorkerAgent.applyRoleConfig() applies role-specific settings
 *
 * Event Topics:
 * - Listens: task.assigned (filtered by role in payload)
 * - Publishes: task.completed, task.failed, task.rejected
 *
 * @module agent-worker
 */

import 'dotenv/config';
import fs from 'fs';
import {
  BaseAgent,
  type BaseAgentConfig,
  createWorkerAgent,
  logger,
  MODULE_AGENT,
  timer
} from 'agents-library';
import { RoleLoader } from './roles/RoleLoader.js';

// ============================================================================
// Agent Registration and Heartbeat
// ============================================================================

/**
 * Register agent with mcp-server-quest
 */
async function registerAgent(client: any, role: string, capabilities: string[], maxConcurrentTasks: number): Promise<void> {
  try {
    logger.info(MODULE_AGENT, '📝 Registering agent with mcp-server-quest...', timer.elapsed('main'));

    const result = await client.invokeRemote('quest_quest_register_agent', {
      agentId: `agent-worker-${role}`,
      name: `${role.charAt(0).toUpperCase() + role.slice(1)} Agent`,
      role,
      capabilities,
      maxConcurrentTasks
    });

    const resultText = result.content[0].text;
    const registrationData = JSON.parse(resultText);

    logger.info(MODULE_AGENT, `✅ Agent registered: ${registrationData.message}`, timer.elapsed('main'));
  } catch (error: any) {
    logger.error(MODULE_AGENT, `Failed to register agent: ${error.message}`, timer.elapsed('main'), error);
  }
}

/**
 * Send heartbeat to mcp-server-quest
 */
async function sendHeartbeat(client: any, role: string): Promise<void> {
  try {
    await client.invokeRemote('quest_quest_agent_heartbeat', {
      agentId: `agent-worker-${role}`,
      status: 'available',
      currentTasks: [],
      timestamp: new Date().toISOString()
    });
    logger.debug(MODULE_AGENT, '💓 Heartbeat sent', timer.elapsed('main'));
  } catch (error: any) {
    logger.warn(MODULE_AGENT, `Heartbeat failed: ${error.message}`, timer.elapsed('main'));
  }
}

/**
 * Start heartbeat interval (every 30 seconds)
 */
function startHeartbeat(client: any, role: string): NodeJS.Timeout {
  logger.info(MODULE_AGENT, '💓 Starting heartbeat (30s interval)...', timer.elapsed('main'));
  sendHeartbeat(client, role).catch(() => {});
  return setInterval(() => sendHeartbeat(client, role).catch(() => {}), 30000);
}

/**
 * Unregister agent from mcp-server-quest
 */
async function unregisterAgent(client: any, role: string): Promise<void> {
  try {
    logger.info(MODULE_AGENT, '📝 Unregistering agent...', timer.elapsed('main'));
    await client.invokeRemote('quest_quest_unregister_agent', {
      agentId: `agent-worker-${role}`,
      reason: 'Graceful shutdown'
    });
    logger.info(MODULE_AGENT, '✅ Agent unregistered', timer.elapsed('main'));
  } catch (error: any) {
    logger.error(MODULE_AGENT, `Failed to unregister: ${error.message}`, timer.elapsed('main'), error);
  }
}

// ============================================================================
// Main Application Entry Point
// ============================================================================

async function main() {
  timer.start('main');

  // Validate required environment variables
  const brokerUrl = process.env.KADI_BROKER_URL;
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  const modelManagerBaseUrl = process.env.MODEL_MANAGER_BASE_URL;
  const modelManagerApiKey = process.env.MODEL_MANAGER_API_KEY;
  const dataPath = process.env.DATA_PATH || './data';

  if (!brokerUrl) {
    logger.error(MODULE_AGENT, 'KADI_BROKER_URL environment variable is required', timer.elapsed('main'));
    process.exit(1);
  }
  if (!anthropicApiKey) {
    logger.error(MODULE_AGENT, 'ANTHROPIC_API_KEY environment variable is required', timer.elapsed('main'));
    process.exit(1);
  }

  // Step 1: Load role configuration
  logger.info(MODULE_AGENT, '📋 Loading role configuration...', timer.elapsed('main'));
  const roleLoader = new RoleLoader(process.cwd());
  const roleName = process.env.AGENT_ROLE || 'artist';
  const roleConfig = roleLoader.loadRole(roleName);
  logger.info(MODULE_AGENT, `   ✅ Role loaded: ${roleConfig.role}`, timer.elapsed('main'));
  logger.info(MODULE_AGENT, `   Model: ${roleConfig.provider?.model || 'default'}`, timer.elapsed('main'));
  logger.info(MODULE_AGENT, `   Tools: ${roleConfig.tools?.join(', ') || 'none'}`, timer.elapsed('main'));

  // Step 1.5: Auto-create git worktree if it doesn't exist
  if (roleConfig.mainRepoPath && roleConfig.worktreePath) {
    if (!fs.existsSync(roleConfig.worktreePath)) {
      logger.info(MODULE_AGENT, `   📂 Worktree not found at ${roleConfig.worktreePath} — creating...`, timer.elapsed('main'));
      try {
        const branch = `agent-playground-${roleConfig.role}`;
        const { execSync } = await import('child_process');
        execSync(`git worktree add "${roleConfig.worktreePath}" -b "${branch}"`, {
          cwd: roleConfig.mainRepoPath,
          stdio: 'pipe',
        });
        logger.info(MODULE_AGENT, `   ✅ Worktree created: ${roleConfig.worktreePath} (branch: ${branch})`, timer.elapsed('main'));
      } catch (error: any) {
        // Branch may already exist — try without -b
        try {
          const branch = `agent-playground-${roleConfig.role}`;
          const { execSync } = await import('child_process');
          execSync(`git worktree add "${roleConfig.worktreePath}" "${branch}"`, {
            cwd: roleConfig.mainRepoPath,
            stdio: 'pipe',
          });
          logger.info(MODULE_AGENT, `   ✅ Worktree created (existing branch): ${roleConfig.worktreePath}`, timer.elapsed('main'));
        } catch (retryError: any) {
          logger.error(MODULE_AGENT, `   ❌ Failed to create worktree: ${retryError.message}`, timer.elapsed('main'));
          process.exit(1);
        }
      }
    } else {
      logger.info(MODULE_AGENT, `   📂 Worktree exists: ${roleConfig.worktreePath}`, timer.elapsed('main'));
    }
  }

  // Step 2: Create BaseAgent for shared infrastructure
  const baseAgentConfig: BaseAgentConfig = {
    agentId: `agent-worker-${roleConfig.role}`,
    agentRole: roleConfig.role,
    version: '1.0.0',
    brokerUrl,
    networks: roleConfig.networks || ['utility', 'global'],
    provider: {
      anthropicApiKey,
      modelManagerBaseUrl,
      modelManagerApiKey,
      primaryProvider: modelManagerBaseUrl ? 'model-manager' : 'anthropic',
      fallbackProvider: modelManagerBaseUrl ? 'anthropic' : undefined,
    },
    ...(roleConfig.memory?.enabled && {
      memory: {
        dataPath,
        arcadedbUrl: process.env.ARCADEDB_URL,
        arcadedbPassword: process.env.ARCADEDB_PASSWORD
      }
    })
  };

  const baseAgent = new BaseAgent(baseAgentConfig);

  // Step 3: Create worker agent using factory
  const workerAgent = createWorkerAgent({
    agentId: `agent-worker-${roleConfig.role}`,
    role: roleConfig.role as 'artist' | 'designer' | 'programmer',
    worktreePath: roleConfig.worktreePath,
    brokerUrl,
    anthropicApiKey,
    networks: roleConfig.networks || ['utility', 'quest', 'global'],
    claudeModel: roleConfig.provider?.model,
    capabilities: roleConfig.capabilities,
    customBehaviors: {
      formatCommitMessage: (taskId: string) =>
        roleConfig.commitFormat.replace('{taskId}', taskId)
    }
  });

  // Step 4: Inject ProviderManager from BaseAgent into WorkerAgent
  if (baseAgent.providerManager) {
    workerAgent.setProviderManager(baseAgent.providerManager);
    logger.info(MODULE_AGENT, '   ✅ ProviderManager injected into WorkerAgent', timer.elapsed('main'));
  }

  // Step 5: Apply role config (capabilities, tools, temperature, maxTokens)
  workerAgent.applyRoleConfig(roleConfig);
  logger.info(MODULE_AGENT, '   ✅ Role config applied', timer.elapsed('main'));

  // Step 6: Start worker agent (connects to broker, subscribes to events)
  await workerAgent.start();

  // Step 7: Register with quest server and start heartbeat
  const client = (workerAgent as any).client;
  await registerAgent(client, roleConfig.role, roleConfig.capabilities, roleConfig.maxConcurrentTasks);
  const heartbeatInterval = startHeartbeat(client, roleConfig.role);

  // Step 8: Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info(MODULE_AGENT, `${signal} received, shutting down...`, timer.elapsed('main'));
    clearInterval(heartbeatInterval);
    await unregisterAgent(client, roleConfig.role);
    await workerAgent.stop();
    // BaseAgent cleanup (ProviderManager, MemoryService)
    await baseAgent.shutdown();
    logger.info(MODULE_AGENT, 'Shutdown complete', timer.elapsed('main'));
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((error) => {
  logger.error(MODULE_AGENT, 'Fatal error', timer.elapsed('main'), error);
  process.exit(1);
});
