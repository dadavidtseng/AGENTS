/**
 * Worker Agent for KĀDI Protocol
 * ================================
 *
 * Generic worker agent for the KĀDI multi-agent system.
 * Supports multiple roles (artist, programmer, designer) via role configuration.
 *
 * Architecture:
 * - BaseWorkerAgent extends BaseAgent (single KadiClient, single broker connection)
 * - RoleLoader loads role config from config/roles/{role}.toml
 * - ProviderManager + MemoryService inherited from BaseAgent
 *
 * Event Topics:
 * - Listens: task.assigned (filtered by role in payload)
 * - Publishes: task.completed, task.failed, task.rejected
 *
 * @module agent-worker
 */

import fs from 'fs';
import {
  createWorkerAgent,
  loadVaultCredentials,
  readConfig,
  setLogLevel,
  setAgentTag,
  logger,
  timer,
} from 'agents-library';
import { RoleLoader } from './roles/RoleLoader.js';

const cfg = readConfig();

// ============================================================================
// Agent identity + logging
// ============================================================================

const agentId = cfg.string('agent.ID');
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
  ? (process.env.KADI_BROKER_URL_LOCAL ?? cfg.string('broker.local.URL'))
  : (process.env.KADI_BROKER_URL_REMOTE ?? cfg.string('broker.remote.URL'));
const networks = hasLocal
  ? (process.env.KADI_NETWORK_LOCAL?.split(',') ?? cfg.strings('broker.local.NETWORKS'))
  : (process.env.KADI_NETWORK_REMOTE?.split(',') ?? cfg.strings('broker.remote.NETWORKS'));

const additionalBrokerUrl = hasLocal && hasRemote
  ? (process.env.KADI_BROKER_URL_REMOTE ?? cfg.string('broker.remote.URL'))
  : undefined;
const additionalBrokerNetworks = hasLocal && hasRemote
  ? (process.env.KADI_NETWORK_REMOTE?.split(',') ?? cfg.strings('broker.remote.NETWORKS'))
  : undefined;

// Credentials: env vars take priority over vault
const vault = await loadVaultCredentials();
const anthropicApiKey = process.env.ANTHROPIC_API_KEY || vault.ANTHROPIC_API_KEY;
const modelManagerBaseUrl = process.env.MODEL_MANAGER_BASE_URL || vault.MODEL_MANAGER_BASE_URL;
const modelManagerApiKey = process.env.MODEL_MANAGER_API_KEY || vault.MODEL_MANAGER_API_KEY;

// ============================================================================
// Agent Registration and Heartbeat
// ============================================================================

async function registerAgent(client: any, role: string, capabilities: string[], maxConcurrentTasks: number): Promise<void> {
  try {
    logger.info(agentId, 'Registering with quest server...', timer.elapsed('main'));
    const result = await client.invokeRemote('quest_quest_register_agent', {
      agentId: `agent-worker-${role}`,
      name: `${role.charAt(0).toUpperCase() + role.slice(1)} Agent`,
      role,
      capabilities,
      maxConcurrentTasks,
    });
    const resultText = result.content[0].text;
    const registrationData = JSON.parse(resultText);
    logger.info(agentId, `Registered: ${registrationData.message}`, timer.elapsed('main'));
  } catch (error: any) {
    logger.error(agentId, `Registration failed: ${error.message}`, timer.elapsed('main'), error);
  }
}

async function sendHeartbeat(client: any, role: string): Promise<void> {
  try {
    await client.invokeRemote('quest_quest_agent_heartbeat', {
      agentId: `agent-worker-${role}`,
      status: 'available',
      currentTasks: [],
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    logger.warn(agentId, `Heartbeat failed: ${error.message}`, timer.elapsed('main'));
  }
}

function startHeartbeat(client: any, role: string): NodeJS.Timeout {
  logger.debug(agentId, 'Starting heartbeat (30s interval)', timer.elapsed('main'));
  sendHeartbeat(client, role).catch(() => {});
  return setInterval(() => sendHeartbeat(client, role).catch(() => {}), 30000);
}

async function unregisterAgent(client: any, role: string): Promise<void> {
  try {
    logger.info(agentId, 'Unregistering from quest server...', timer.elapsed('main'));
    await client.invokeRemote('quest_quest_unregister_agent', {
      agentId: `agent-worker-${role}`,
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

  try {
    // Load role configuration
    const roleLoader = new RoleLoader(process.cwd());
    const roleName = process.env.AGENT_ROLE || cfg.string('agent.ROLE');
    const roleConfig = roleLoader.loadRole(roleName);

    // Provider config: role overrides config.toml defaults
    const primaryProvider = cfg.string('provider.PRIMARY');
    const primaryModel = roleConfig.provider?.model || cfg.string(`provider.${primaryProvider}.MODEL`);
    const fallbackProvider = cfg.has('provider.FALLBACK') ? cfg.string('provider.FALLBACK') : undefined;
    const fallbackModel = fallbackProvider ? cfg.string(`provider.${fallbackProvider}.MODEL`) : undefined;

    // Startup summary
    const workerAgentId = `agent-worker-${roleConfig.role}`;
    logger.info(agentId, `Starting ${workerAgentId} v${agentVersion} (role: ${roleConfig.role})`, timer.elapsed('main'));
    const brokerSummary = [
      hasLocal ? `local=${process.env.KADI_BROKER_URL_LOCAL ?? cfg.string('broker.local.URL')}` : null,
      hasRemote ? `remote=${process.env.KADI_BROKER_URL_REMOTE ?? cfg.string('broker.remote.URL')}` : null,
    ].filter(Boolean).join(', ');
    logger.info(agentId, `Broker: ${brokerSummary}`, timer.elapsed('main'));
    logger.info(agentId, `Networks: ${(roleConfig.networks || networks).join(', ')}`, timer.elapsed('main'));
    logger.info(agentId, `LLM: ${primaryProvider}/${primaryModel}${fallbackProvider ? ` (fallback: ${fallbackProvider}/${fallbackModel})` : ''}`, timer.elapsed('main'));
    logger.info(agentId, `Tools: ${roleConfig.tools?.join(', ') || 'none'}`, timer.elapsed('main'));
    logger.debug(agentId, `Worktree: ${roleConfig.worktreePath}`, timer.elapsed('main'));

    // Auto-create git worktree if it doesn't exist
    if (roleConfig.mainRepoPath && roleConfig.worktreePath) {
      // Auto-init main playground repo if missing
      if (!fs.existsSync(roleConfig.mainRepoPath)) {
        logger.info(agentId, `Initializing playground repo at ${roleConfig.mainRepoPath}...`, timer.elapsed('main'));
        fs.mkdirSync(roleConfig.mainRepoPath, { recursive: true });
        const { execSync } = await import('child_process');
        execSync('git init', { cwd: roleConfig.mainRepoPath, stdio: 'pipe' });
        execSync(`git config user.name "agent-worker"`, { cwd: roleConfig.mainRepoPath, stdio: 'pipe' });
        execSync(`git config user.email "agent-worker@dadavidtseng.com"`, { cwd: roleConfig.mainRepoPath, stdio: 'pipe' });
        // Create initial commit so worktrees can branch from HEAD
        execSync('git commit --allow-empty -m "init: agent-playground"', {
          cwd: roleConfig.mainRepoPath,
          stdio: 'pipe',
        });
        logger.info(agentId, 'Playground repo initialized', timer.elapsed('main'));
      }

      if (!fs.existsSync(roleConfig.worktreePath)) {
        logger.info(agentId, `Creating worktree at ${roleConfig.worktreePath}...`, timer.elapsed('main'));
        try {
          const branch = `agent-playground-${roleConfig.role}`;
          const { execSync } = await import('child_process');
          execSync(`git worktree add "${roleConfig.worktreePath}" -b "${branch}"`, {
            cwd: roleConfig.mainRepoPath,
            stdio: 'pipe',
          });
          logger.info(agentId, `Worktree created (branch: ${branch})`, timer.elapsed('main'));
          // Set per-worktree git identity for this role
          execSync(`git config user.name "agent-worker-${roleConfig.role}"`, { cwd: roleConfig.worktreePath, stdio: 'pipe' });
          execSync(`git config user.email "agent-worker-${roleConfig.role}@dadavidtseng.com"`, { cwd: roleConfig.worktreePath, stdio: 'pipe' });
        } catch {
          try {
            const branch = `agent-playground-${roleConfig.role}`;
            const { execSync } = await import('child_process');
            execSync(`git worktree add "${roleConfig.worktreePath}" "${branch}"`, {
              cwd: roleConfig.mainRepoPath,
              stdio: 'pipe',
            });
            logger.info(agentId, 'Worktree created (existing branch)', timer.elapsed('main'));
            // Set per-worktree git identity for this role
            execSync(`git config user.name "agent-worker-${roleConfig.role}"`, { cwd: roleConfig.worktreePath, stdio: 'pipe' });
            execSync(`git config user.email "agent-worker-${roleConfig.role}@dadavidtseng.com"`, { cwd: roleConfig.worktreePath, stdio: 'pipe' });
          } catch (retryError: any) {
            logger.error(agentId, `Failed to create worktree: ${retryError.message}`, timer.elapsed('main'));
            process.exit(1);
          }
        }
      } else {
        logger.debug(agentId, `Worktree exists: ${roleConfig.worktreePath}`, timer.elapsed('main'));
      }
    }

    // Create worker agent (extends BaseAgent — single client, single connection)
    const workerAgent = createWorkerAgent({
      // BaseAgentConfig fields
      agentId: workerAgentId,
      agentRole: roleConfig.role,
      version: agentVersion,
      brokerUrl,
      networks: roleConfig.networks || networks,
      ...(additionalBrokerUrl && {
        additionalBrokers: {
          remote: { url: additionalBrokerUrl, networks: additionalBrokerNetworks! },
        },
      }),
      provider: {
        anthropicApiKey: anthropicApiKey!,
        ...(modelManagerBaseUrl && modelManagerApiKey && {
          modelManagerBaseUrl,
          modelManagerApiKey,
        }),
        primaryProvider,
        fallbackProvider,
      },
      memory: {
        dataPath: process.env.MEMORY_DATA_PATH ?? cfg.string('memory.DATA_PATH'),
      },

      // Worker-specific fields
      role: roleConfig.role as 'artist' | 'designer' | 'programmer',
      worktreePath: roleConfig.worktreePath!,
      claudeModel: primaryModel,
      capabilities: roleConfig.capabilities,
      customBehaviors: {
        formatCommitMessage: (taskId: string) =>
          roleConfig.commitFormat.replace('{taskId}', taskId),
      },
    });

    // Single connect() — inherited from BaseAgent
    await workerAgent.connect();

    // Apply role config and start (subscribes to events, no reconnect)
    workerAgent.applyRoleConfig(roleConfig);
    await workerAgent.start();

    // Register with quest server and start heartbeat
    await registerAgent(workerAgent.client, roleConfig.role, roleConfig.capabilities, roleConfig.maxConcurrentTasks);
    const heartbeatInterval = startHeartbeat(workerAgent.client, roleConfig.role);

    // Graceful shutdown
    const shutdown = async (signal: string) => {
      logger.info(agentId, `${signal} received, shutting down...`, timer.elapsed('main'));
      clearInterval(heartbeatInterval);
      await unregisterAgent(workerAgent.client, roleConfig.role);
      await workerAgent.stop();
      logger.info(agentId, 'Shutdown complete', timer.elapsed('main'));
      process.exit(0);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));

    logger.info(agentId, `Ready (${timer.elapsed('main')})`, timer.elapsed('main'));

  } catch (error: any) {
    logger.error(agentId, 'Fatal error', '+0ms', error);
    process.exit(1);
  }
}

main().catch((error) => {
  logger.error(agentId, 'Fatal error', '+0ms', error);
  process.exit(1);
});
