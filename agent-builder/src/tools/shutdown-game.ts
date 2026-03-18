/**
 * shutdown_game Tool
 *
 * Terminates the running DaemonAgent game process.
 */

import { z } from '@kadi.build/core';
import type { KadiClient } from '@kadi.build/core';
import { logger, MODULE_AGENT, timer } from 'agents-library';
import { killGameProcess, findGameProcesses } from './game-process.js';

const inputSchema = z.object({});

const outputSchema = z.object({
  success: z.boolean().describe('Whether the game was successfully shut down'),
  message: z.string().describe('Status message'),
  pidsKilled: z.number().describe('Number of processes terminated'),
});

type Input = z.infer<typeof inputSchema>;
type Output = z.infer<typeof outputSchema>;

export function registerShutdownGameTool(client: KadiClient): void {
  client.registerTool({
    name: 'shutdown_game',
    description: 'Shut down the running DaemonAgent game process',
    input: inputSchema,
    output: outputSchema,
  }, async (_params: Input): Promise<Output> => {
    logger.info(MODULE_AGENT, 'shutdown_game: Starting...', timer.elapsed('main'));

    const pidsBefore = findGameProcesses();
    if (pidsBefore.length === 0) {
      return { success: true, message: 'No game process was running', pidsKilled: 0 };
    }

    const killed = await killGameProcess();
    if (killed) {
      return {
        success: true,
        message: `Game shut down successfully (${pidsBefore.length} process(es) terminated)`,
        pidsKilled: pidsBefore.length,
      };
    }

    return {
      success: false,
      message: 'Failed to terminate game process — it may still be running',
      pidsKilled: 0,
    };
  });
}
