/**
 * Shadow Agent for KĀDI Protocol
 * ===============================
 *
 * Generic shadow agent for monitoring and backing up worker agent worktrees.
 * Uses BaseAgent for broker connection and ShadowRoleLoader for role configuration.
 *
 * Supports multiple roles (artist, programmer, designer) via config/roles/{role}.json.
 * Role is determined by AGENT_ROLE environment variable (default: from .env AGENT_NAME suffix).
 *
 * Event Topics:
 * - Publishes: shadow-{role}.backup.completed, shadow-{role}.backup.failed
 *
 * Environment Variables:
 * - KADI_BROKER_URL: WebSocket URL for KĀDI broker (required)
 * - KADI_NETWORK: Comma-separated list of networks to join (optional, default: global)
 * - AGENT_ROLE: Shadow role to load from config/roles/ (optional, default: artist)
 *
 * @module shadow-agent-worker
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createShadowAgent, BaseAgent, logger, MODULE_AGENT, timer } from 'agents-library';
import { ShadowRoleLoader } from './roles/ShadowRoleLoader.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  // Start main timer for application lifetime tracking
  timer.start('main');

  // Determine role from environment (default: artist)
  const role = process.env.AGENT_ROLE || 'artist';

  // Load role configuration from config/roles/{role}.json
  logger.info(MODULE_AGENT, '📋 Loading shadow role configuration...', timer.elapsed('main'));
  const projectRoot = path.resolve(__dirname, '..');
  const roleLoader = new ShadowRoleLoader(projectRoot);
  const roleConfig = roleLoader.loadRole(role);
  logger.info(MODULE_AGENT, `   ✅ Shadow role loaded: ${roleConfig.role}`, timer.elapsed('main'));
  logger.info(MODULE_AGENT, `   Worker worktree: ${roleConfig.workerWorktreePath}`, timer.elapsed('main'));
  logger.info(MODULE_AGENT, `   Shadow worktree: ${roleConfig.shadowWorktreePath}`, timer.elapsed('main'));
  logger.info(MODULE_AGENT, `   Worker branch: ${roleConfig.workerBranch}`, timer.elapsed('main'));
  logger.info(MODULE_AGENT, `   Shadow branch: ${roleConfig.shadowBranch}`, timer.elapsed('main'));
  logger.info(MODULE_AGENT, `   Monitoring interval: ${roleConfig.monitoringInterval}ms`, timer.elapsed('main'));

  // Auto-create worktrees if they don't exist
  const mainRepoPath = (roleConfig as any).mainRepoPath;
  if (mainRepoPath) {
    const { execSync } = await import('child_process');
    for (const [wtPath, branch] of [
      [roleConfig.workerWorktreePath, roleConfig.workerBranch],
      [roleConfig.shadowWorktreePath, roleConfig.shadowBranch],
    ] as const) {
      if (!fs.existsSync(wtPath)) {
        logger.info(MODULE_AGENT, `   📂 Worktree not found at ${wtPath} — creating...`, timer.elapsed('main'));
        try {
          execSync(`git worktree add "${wtPath}" -b "${branch}"`, { cwd: mainRepoPath, stdio: 'pipe' });
          logger.info(MODULE_AGENT, `   ✅ Worktree created: ${wtPath} (branch: ${branch})`, timer.elapsed('main'));
        } catch {
          try {
            execSync(`git worktree add "${wtPath}" "${branch}"`, { cwd: mainRepoPath, stdio: 'pipe' });
            logger.info(MODULE_AGENT, `   ✅ Worktree created (existing branch): ${wtPath}`, timer.elapsed('main'));
          } catch (retryError: any) {
            logger.error(MODULE_AGENT, `   ❌ Failed to create worktree: ${retryError.message}`, timer.elapsed('main'));
            process.exit(1);
          }
        }
      } else {
        logger.info(MODULE_AGENT, `   📂 Worktree exists: ${wtPath}`, timer.elapsed('main'));
      }
    }
  }

  // Validate required environment variables
  const brokerUrl = process.env.KADI_BROKER_URL;
  const networks = process.env.KADI_NETWORK?.split(',').map(n => n.trim()) || ['global'];

  if (!brokerUrl) {
    logger.error(MODULE_AGENT, 'KADI_BROKER_URL environment variable is required', timer.elapsed('main'));
    process.exit(1);
  }

  // Create BaseAgent for broker connection management
  const baseAgent = new BaseAgent({
    agentId: `shadow-agent-${roleConfig.role}`,
    agentRole: roleConfig.role,
    brokerUrl,
    networks,
    // Wire up ProviderManager if role config has provider section (future shadow intelligence)
    ...(roleConfig.provider && process.env.MODEL_MANAGER_BASE_URL ? {
      provider: {
        anthropicApiKey: process.env.ANTHROPIC_API_KEY,
        modelManagerBaseUrl: process.env.MODEL_MANAGER_BASE_URL,
        modelManagerApiKey: process.env.MODEL_MANAGER_API_KEY,
      }
    } : {}),
  });

  // Connect BaseAgent to broker
  logger.info(MODULE_AGENT, '', timer.elapsed('main'));
  logger.info(MODULE_AGENT, '============================================================', timer.elapsed('main'));
  logger.info(MODULE_AGENT, `Starting Shadow Agent: ${roleConfig.role}`, timer.elapsed('main'));
  logger.info(MODULE_AGENT, '============================================================', timer.elapsed('main'));
  logger.info(MODULE_AGENT, `Broker URL: ${brokerUrl}`, timer.elapsed('main'));
  logger.info(MODULE_AGENT, `Networks: ${networks.join(', ')}`, timer.elapsed('main'));
  logger.info(MODULE_AGENT, '============================================================', timer.elapsed('main'));
  logger.info(MODULE_AGENT, '', timer.elapsed('main'));

  await baseAgent.connect();

  // Create shadow agent with BaseAgent (delegates connection management)
  const agent = createShadowAgent({
    role: roleConfig.role,
    workerWorktreePath: roleConfig.workerWorktreePath,
    shadowWorktreePath: roleConfig.shadowWorktreePath,
    workerBranch: roleConfig.workerBranch,
    shadowBranch: roleConfig.shadowBranch,
    brokerUrl,
    networks,
    debounceMs: roleConfig.debounceMs,
  }, baseAgent);

  // Start shadow agent (watchers only — connection already handled by BaseAgent)
  await agent.start();

  // Register graceful shutdown via BaseAgent
  baseAgent.registerShutdownHandlers(async () => {
    await agent.stop();
  });
}

main().catch((error) => {
  logger.error(MODULE_AGENT, 'Fatal error', timer.elapsed('main'), error);
  process.exit(1);
});
