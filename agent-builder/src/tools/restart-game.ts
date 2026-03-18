/**
 * restart_game Tool
 *
 * Kill the running game process and relaunch it (no rebuild).
 * Waits for DaemonAgent to reconnect to the KĀDI broker via game.ready event.
 */

import { z } from '@kadi.build/core';
import type { KadiClient } from '@kadi.build/core';
import { logger, MODULE_AGENT, timer } from 'agents-library';
import { killGameProcess, launchGame, waitForGameReady, findGameProcesses } from './game-process.js';

const inputSchema = z.object({});

const outputSchema = z.object({
  success: z.boolean().describe('Whether the game was successfully restarted'),
  message: z.string().describe('Status message'),
  pid: z.number().describe('New game process PID (0 if failed)'),
  toolCount: z.number().describe('Number of tools registered by reconnected game'),
});

type Input = z.infer<typeof inputSchema>;
type Output = z.infer<typeof outputSchema>;

export function registerRestartGameTool(client: KadiClient): void {
  client.registerTool({
    name: 'restart_game',
    description: 'Restart the DaemonAgent game (kill → relaunch → wait for KĀDI reconnect, no rebuild)',
    input: inputSchema,
    output: outputSchema,
  }, async (_params: Input): Promise<Output> => {
    logger.info(MODULE_AGENT, 'restart_game: Starting...', timer.elapsed('main'));

    // Step 1: Kill existing process (if any)
    const pidsBefore = findGameProcesses();
    if (pidsBefore.length > 0) {
      logger.info(MODULE_AGENT, 'restart_game: Killing existing game process...', timer.elapsed('main'));
      const killed = await killGameProcess();
      if (!killed) {
        return { success: false, message: 'Failed to kill existing game process', pid: 0, toolCount: 0 };
      }
    }

    // Step 2: Set up game.ready listener BEFORE launching
    logger.info(MODULE_AGENT, 'restart_game: Subscribing to game.ready event...', timer.elapsed('main'));
    const readyPromise = waitForGameReady(client);

    // Step 3: Launch game
    const pid = launchGame();
    if (pid === 0) {
      return { success: false, message: 'Failed to launch game process', pid: 0, toolCount: 0 };
    }

    // Step 4: Wait for KĀDI reconnection
    try {
      logger.info(MODULE_AGENT, 'restart_game: Waiting for game.ready event...', timer.elapsed('main'));
      const readyData = await readyPromise;
      return {
        success: true,
        message: `Game restarted and reconnected to KĀDI (${readyData.toolCount} tools)`,
        pid,
        toolCount: readyData.toolCount,
      };
    } catch (error: unknown) {
      return {
        success: false,
        message: `Game launched (PID ${pid}) but did not reconnect: ${(error as Error).message}`,
        pid,
        toolCount: 0,
      };
    }
  });
}
