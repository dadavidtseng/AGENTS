/**
 * agent-shadow-worker - KADI Shadow Agent for Worktree Monitoring
 * ================================================================
 *
 * Generic shadow agent for monitoring and backing up worker agent worktrees.
 * Uses BaseAgent for broker connection and ShadowRoleLoader for role configuration.
 *
 * Supports multiple roles (artist, programmer, designer) via config/roles/{role}.toml.
 * Role is determined by AGENT_ROLE env var (for kadi run dev:artist) or config.toml default.
 *
 * Event Topics:
 * - Publishes: shadow-{role}.backup.completed, shadow-{role}.backup.failed
 *
 * @module agent-shadow-worker
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createShadowAgent, BaseAgent, loadVaultCredentials, readConfig, setLogLevel, setAgentTag, logger, timer } from 'agents-library';
import type { BaseAgentConfig } from 'agents-library';
import { ShadowRoleLoader } from './roles/ShadowRoleLoader.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

// Role: env var takes priority (for kadi run dev:artist), fallback to config.toml
const roleName = process.env.AGENT_ROLE ?? cfg.string('agent.ROLE');

// Broker resolution
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

// Credentials: vault for provider keys (optional — shadow agents may not need LLM)
const vault = await loadVaultCredentials();
const anthropicApiKey = process.env.ANTHROPIC_API_KEY || vault.ANTHROPIC_API_KEY;
const modelManagerBaseUrl = process.env.MODEL_MANAGER_BASE_URL || vault.MODEL_MANAGER_BASE_URL;
const modelManagerApiKey = process.env.MODEL_MANAGER_API_KEY || vault.MODEL_MANAGER_API_KEY;

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  timer.start('main');

  try {
    // Load role configuration from config/roles/{role}.toml
    logger.info(agentId, `Loading shadow role configuration: ${roleName}`, timer.elapsed('main'));
    const projectRoot = path.resolve(__dirname, '..');
    const roleLoader = new ShadowRoleLoader(projectRoot);
    const roleConfig = roleLoader.loadRole(roleName);
    logger.info(agentId, `Role: ${roleConfig.role}`, timer.elapsed('main'));
    logger.debug(agentId, `  Worker worktree: ${roleConfig.workerWorktreePath}`, timer.elapsed('main'));
    logger.debug(agentId, `  Shadow worktree: ${roleConfig.shadowWorktreePath}`, timer.elapsed('main'));
    logger.debug(agentId, `  Worker branch: ${roleConfig.workerBranch}`, timer.elapsed('main'));
    logger.debug(agentId, `  Shadow branch: ${roleConfig.shadowBranch}`, timer.elapsed('main'));
    logger.debug(agentId, `  Monitoring interval: ${roleConfig.monitoringInterval}ms`, timer.elapsed('main'));

    // Auto-create worktrees if they don't exist
    const mainRepoPath = roleConfig.mainRepoPath;
    if (mainRepoPath) {
      const { execSync } = await import('child_process');

      // Auto-init main playground repo if missing
      if (!fs.existsSync(mainRepoPath)) {
        logger.info(agentId, `Initializing playground repo at ${mainRepoPath}...`, timer.elapsed('main'));
        fs.mkdirSync(mainRepoPath, { recursive: true });
        execSync('git init', { cwd: mainRepoPath, stdio: 'pipe' });
        execSync(`git config user.name "shadow-agent"`, { cwd: mainRepoPath, stdio: 'pipe' });
        execSync(`git config user.email "shadow-agent@dadavidtseng.com"`, { cwd: mainRepoPath, stdio: 'pipe' });
        execSync('git commit --allow-empty -m "init: agent-playground"', {
          cwd: mainRepoPath,
          stdio: 'pipe',
        });
        logger.info(agentId, 'Playground repo initialized', timer.elapsed('main'));
      }

      for (const [wtPath, branch] of [
        [roleConfig.workerWorktreePath!, roleConfig.workerBranch],
        [roleConfig.shadowWorktreePath!, roleConfig.shadowBranch],
      ] as const) {
        if (!fs.existsSync(wtPath)) {
          logger.info(agentId, `Worktree not found at ${wtPath} — creating...`, timer.elapsed('main'));
          try {
            execSync(`git worktree add "${wtPath}" -b "${branch}"`, { cwd: mainRepoPath, stdio: 'pipe' });
            logger.info(agentId, `Worktree created: ${wtPath} (branch: ${branch})`, timer.elapsed('main'));
            // Set per-worktree git identity
            execSync(`git config user.name "shadow-agent-${roleConfig.role}"`, { cwd: wtPath, stdio: 'pipe' });
            execSync(`git config user.email "shadow-agent-${roleConfig.role}@dadavidtseng.com"`, { cwd: wtPath, stdio: 'pipe' });
          } catch {
            try {
              execSync(`git worktree add "${wtPath}" "${branch}"`, { cwd: mainRepoPath, stdio: 'pipe' });
              logger.info(agentId, `Worktree created (existing branch): ${wtPath}`, timer.elapsed('main'));
              // Set per-worktree git identity
              execSync(`git config user.name "shadow-agent-${roleConfig.role}"`, { cwd: wtPath, stdio: 'pipe' });
              execSync(`git config user.email "shadow-agent-${roleConfig.role}@dadavidtseng.com"`, { cwd: wtPath, stdio: 'pipe' });
            } catch (retryError: any) {
              logger.error(agentId, `Failed to create worktree: ${retryError.message}`, timer.elapsed('main'));
              process.exit(1);
            }
          }
        } else {
          logger.debug(agentId, `Worktree exists: ${wtPath}`, timer.elapsed('main'));
        }
      }
    }

    // Startup summary
    logger.info(agentId, `Starting ${agentId} v${agentVersion} (role: ${roleName})`, timer.elapsed('main'));
    const brokerSummary = [
      hasLocal ? `local=${cfg.string('broker.local.URL')}` : null,
      hasRemote ? `remote=${cfg.string('broker.remote.URL')}` : null,
    ].filter(Boolean).join(', ');
    logger.info(agentId, `Broker: ${brokerSummary}`, timer.elapsed('main'));
    logger.info(agentId, `Networks: ${networks.join(', ')}`, timer.elapsed('main'));

    // BaseAgent instance
    const baseAgentConfig: BaseAgentConfig = {
      agentId: `shadow-agent-${roleConfig.role}`,
      agentRole: roleConfig.role,
      version: agentVersion,
      brokerUrl,
      networks,
      ...(additionalBrokerUrl && {
        additionalBrokers: {
          remote: { url: additionalBrokerUrl, networks: additionalBrokerNetworks! },
        },
      }),
      ...(roleConfig.provider && modelManagerBaseUrl ? {
        provider: {
          anthropicApiKey: anthropicApiKey!,
          modelManagerBaseUrl,
          modelManagerApiKey: modelManagerApiKey!,
        }
      } : {}),
    };

    const baseAgent = new BaseAgent(baseAgentConfig);

    // Step 1: Connect to broker
    await baseAgent.connect();

    // Step 1b: Load ability-file-local natively (for watch_folder)
    let nativeFileLocal: any = null;
    try {
      nativeFileLocal = await baseAgent.client.loadNative('ability-file-local');
      logger.info(agentId, 'Loaded ability-file-local natively', timer.elapsed('main'));
    } catch (err: any) {
      logger.warn(agentId, `Could not load ability-file-local natively: ${err.message}`, timer.elapsed('main'));
    }

    // Step 2: Create shadow agent with BaseAgent
    const agent = createShadowAgent({
      role: roleConfig.role,
      workerWorktreePath: roleConfig.workerWorktreePath!,
      shadowWorktreePath: roleConfig.shadowWorktreePath!,
      workerBranch: roleConfig.workerBranch,
      shadowBranch: roleConfig.shadowBranch,
      brokerUrl,
      networks,
      debounceMs: roleConfig.debounceMs,
    }, baseAgent);

    // Step 2b: Wire native ability-file-local into shadow agent
    if (nativeFileLocal) {
      agent.setNativeFileLocal(nativeFileLocal);
    }

    // Step 3: Start shadow agent (watchers only — connection already handled)
    await agent.start();

    // Step 4: Register graceful shutdown
    baseAgent.registerShutdownHandlers(async () => {
      await agent.stop();
    });

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
