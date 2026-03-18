import { z } from '@kadi.build/core';
import { logger, MODULE_AGENT, timer } from 'agents-library';
import { killGameProcess, launchGame, waitForGameReady, findGameProcesses } from './game-process.js';
const inputSchema = z.object({});
const outputSchema = z.object({
    success: z.boolean().describe('Whether the game was successfully restarted'),
    message: z.string().describe('Status message'),
    pid: z.number().describe('New game process PID (0 if failed)'),
    toolCount: z.number().describe('Number of tools registered by reconnected game'),
});
export function registerRestartGameTool(client) {
    client.registerTool({
        name: 'restart_game',
        description: 'Restart the DaemonAgent game (kill → relaunch → wait for KĀDI reconnect, no rebuild)',
        input: inputSchema,
        output: outputSchema,
    }, async (_params) => {
        logger.info(MODULE_AGENT, 'restart_game: Starting...', timer.elapsed('main'));
        const pidsBefore = findGameProcesses();
        if (pidsBefore.length > 0) {
            logger.info(MODULE_AGENT, 'restart_game: Killing existing game process...', timer.elapsed('main'));
            const killed = await killGameProcess();
            if (!killed) {
                return { success: false, message: 'Failed to kill existing game process', pid: 0, toolCount: 0 };
            }
        }
        logger.info(MODULE_AGENT, 'restart_game: Subscribing to game.ready event...', timer.elapsed('main'));
        const readyPromise = waitForGameReady(client);
        const pid = launchGame();
        if (pid === 0) {
            return { success: false, message: 'Failed to launch game process', pid: 0, toolCount: 0 };
        }
        try {
            logger.info(MODULE_AGENT, 'restart_game: Waiting for game.ready event...', timer.elapsed('main'));
            const readyData = await readyPromise;
            return {
                success: true,
                message: `Game restarted and reconnected to KĀDI (${readyData.toolCount} tools)`,
                pid,
                toolCount: readyData.toolCount,
            };
        }
        catch (error) {
            return {
                success: false,
                message: `Game launched (PID ${pid}) but did not reconnect: ${error.message}`,
                pid,
                toolCount: 0,
            };
        }
    });
}
//# sourceMappingURL=restart-game.js.map