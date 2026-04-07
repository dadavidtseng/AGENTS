/**
 * Game Process Utilities
 *
 * Shared helpers for managing the DaemonAgent game process:
 * - Finding running game processes
 * - Killing game processes
 * - Launching the game executable
 * - Waiting for KĀDI reconnection via event subscription
 */

import { execSync, spawn } from 'child_process';
import type { KadiClient } from '@kadi.build/core';
import { logger, MODULE_AGENT, timer, readConfig } from 'agents-library';

// ============================================================================
// Configuration (from config.toml)
// ============================================================================

const cfg = readConfig();

export function getConfig() {
  return {
    gameExePath: cfg.string('game.EXE_PATH'),
    gameWorkingDir: cfg.string('game.WORKING_DIR'),
    msbuildPath: cfg.string('build.MSBUILD_PATH'),
    solutionPath: cfg.string('build.SOLUTION_PATH'),
    buildConfiguration: cfg.string('build.CONFIGURATION'),
    buildPlatform: cfg.string('build.PLATFORM'),
    gameReadyTimeoutMs: cfg.number('game.READY_TIMEOUT_MS'),
    processKillTimeoutMs: cfg.number('game.KILL_TIMEOUT_MS'),
  };
}

// ============================================================================
// Process Management
// ============================================================================

/**
 * Find running game process PIDs by executable name.
 * Uses tasklist on Windows.
 */
export function findGameProcesses(): number[] {
  const config = getConfig();
  const exeName = config.gameExePath.split('/').pop() || '';

  try {
    const output = execSync(`tasklist /FI "IMAGENAME eq ${exeName}" /FO CSV /NH`, {
      encoding: 'utf-8',
      timeout: 5000,
    });

    const pids: number[] = [];
    for (const line of output.trim().split('\n')) {
      // CSV format: "name.exe","PID","Session Name","Session#","Mem Usage"
      const match = line.match(/"[^"]+","(\d+)"/);
      if (match) {
        pids.push(parseInt(match[1], 10));
      }
    }
    return pids;
  } catch {
    return [];
  }
}

/**
 * Kill the game process. Tries graceful taskkill first, then force-kills.
 * Returns true if a process was found and killed.
 */
export async function killGameProcess(): Promise<boolean> {
  const pids = findGameProcesses();
  if (pids.length === 0) {
    logger.info(MODULE_AGENT, 'No game process found', timer.elapsed('main'));
    return false;
  }

  const config = getConfig();

  for (const pid of pids) {
    logger.info(MODULE_AGENT, `Killing game process PID ${pid}...`, timer.elapsed('main'));
    try {
      // Force kill — game doesn't have a graceful shutdown signal handler
      execSync(`taskkill /PID ${pid} /F`, { encoding: 'utf-8', timeout: config.processKillTimeoutMs });
      logger.info(MODULE_AGENT, `Process ${pid} terminated`, timer.elapsed('main'));
    } catch (error: unknown) {
      logger.warn(MODULE_AGENT, `Failed to kill PID ${pid}: ${(error as Error).message}`, timer.elapsed('main'));
    }
  }

  // Wait briefly for process to fully exit
  await sleep(1000);

  // Verify it's gone
  const remaining = findGameProcesses();
  if (remaining.length > 0) {
    logger.warn(MODULE_AGENT, `${remaining.length} game process(es) still running after kill`, timer.elapsed('main'));
    return false;
  }

  return true;
}

/**
 * Launch the game executable as a detached process.
 * Returns the child PID.
 */
export function launchGame(): number {
  const config = getConfig();

  logger.info(MODULE_AGENT, `Launching: ${config.gameExePath}`, timer.elapsed('main'));
  logger.info(MODULE_AGENT, `Working dir: ${config.gameWorkingDir}`, timer.elapsed('main'));

  const child = spawn(config.gameExePath, [], {
    cwd: config.gameWorkingDir,
    detached: true,
    stdio: 'ignore',
  });

  child.unref();

  const pid = child.pid ?? 0;
  logger.info(MODULE_AGENT, `Game launched with PID ${pid}`, timer.elapsed('main'));
  return pid;
}

// ============================================================================
// MSBuild
// ============================================================================

/**
 * Run MSBuild to compile the solution.
 * Returns { success, output, durationMs }.
 */
export function runMSBuild(): { success: boolean; output: string; durationMs: number } {
  const config = getConfig();
  const cmd = `"${config.msbuildPath}" "${config.solutionPath}" /p:Configuration=${config.buildConfiguration} /p:Platform=${config.buildPlatform} /m /nologo /v:minimal`;

  logger.info(MODULE_AGENT, `Running MSBuild: ${config.buildConfiguration}|${config.buildPlatform}`, timer.elapsed('main'));

  const startTime = Date.now();
  try {
    const output = execSync(cmd, {
      encoding: 'utf-8',
      timeout: 300000, // 5 minute build timeout
      maxBuffer: 10 * 1024 * 1024, // 10MB output buffer
    });

    const durationMs = Date.now() - startTime;
    logger.info(MODULE_AGENT, `MSBuild completed in ${durationMs}ms`, timer.elapsed('main'));
    return { success: true, output: output.trim(), durationMs };
  } catch (error: unknown) {
    const durationMs = Date.now() - startTime;
    const err = error as { stdout?: string; stderr?: string; message: string };
    const output = (err.stdout || '') + '\n' + (err.stderr || err.message);
    logger.error(MODULE_AGENT, `MSBuild failed after ${durationMs}ms`, timer.elapsed('main'));
    return { success: false, output: output.trim(), durationMs };
  }
}

// ============================================================================
// KĀDI Reconnection Detection
// ============================================================================

/**
 * Wait for DaemonAgent to reconnect to the broker by subscribing to
 * the `game.ready` event topic. DaemonAgent publishes this event
 * after completing KĀDI tool registration.
 *
 * @returns Promise that resolves when game.ready is received, or rejects on timeout.
 */
export function waitForGameReady(client: KadiClient): Promise<{ agentName: string; toolCount: number }> {
  const config = getConfig();

  return new Promise((resolve, reject) => {
    let settled = false;

    const handler = (event: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);

      // Unsubscribe to prevent duplicate handlers on subsequent calls
      client.unsubscribe('game.ready', handler, { broker: 'default' }).catch(() => {});

      const data = event as { data?: { agentName?: string; toolCount?: number } };
      const payload = data.data || data as { agentName?: string; toolCount?: number };
      logger.info(MODULE_AGENT, `Received game.ready event`, timer.elapsed('main'));
      resolve({
        agentName: payload.agentName || 'DaemonAgent',
        toolCount: payload.toolCount || 0,
      });
    };

    const timeoutId = setTimeout(() => {
      if (settled) return;
      settled = true;
      client.unsubscribe('game.ready', handler, { broker: 'default' }).catch(() => {});
      reject(new Error(`Timed out waiting for game.ready event (${config.gameReadyTimeoutMs}ms)`));
    }, config.gameReadyTimeoutMs);

    client.subscribe('game.ready', handler, { broker: 'default' }).catch((err: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      reject(new Error(`Failed to subscribe to game.ready: ${(err as Error).message}`));
    });
  });
}

// ============================================================================
// Helpers
// ============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
