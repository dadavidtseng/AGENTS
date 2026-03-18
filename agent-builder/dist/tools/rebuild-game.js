import { z } from '@kadi.build/core';
import { logger, MODULE_AGENT, timer } from 'agents-library';
import { killGameProcess, launchGame, runMSBuild, waitForGameReady, findGameProcesses, } from './game-process.js';
const inputSchema = z.object({
    skipBuild: z.boolean().optional().describe('Skip MSBuild step (just kill and relaunch). Default: false'),
});
const outputSchema = z.object({
    success: z.boolean().describe('Whether the full rebuild cycle completed successfully'),
    message: z.string().describe('Status message'),
    buildOutput: z.string().describe('MSBuild output (truncated to last 2000 chars)'),
    buildDurationMs: z.number().describe('MSBuild duration in milliseconds'),
    pid: z.number().describe('New game process PID (0 if failed)'),
    toolCount: z.number().describe('Number of tools registered by reconnected game'),
});
export function registerRebuildGameTool(client) {
    client.registerTool({
        name: 'rebuild_game',
        description: 'Full rebuild cycle: shut down game → MSBuild compile → relaunch → wait for KĀDI reconnect',
        input: inputSchema,
        output: outputSchema,
    }, async (params) => {
        logger.info(MODULE_AGENT, 'rebuild_game: Starting full rebuild cycle...', timer.elapsed('main'));
        const pidsBefore = findGameProcesses();
        if (pidsBefore.length > 0) {
            logger.info(MODULE_AGENT, 'rebuild_game: Killing existing game process...', timer.elapsed('main'));
            const killed = await killGameProcess();
            if (!killed) {
                return {
                    success: false,
                    message: 'Failed to kill existing game process',
                    buildOutput: '',
                    buildDurationMs: 0,
                    pid: 0,
                    toolCount: 0,
                };
            }
        }
        let buildOutput = '';
        let buildDurationMs = 0;
        if (!params.skipBuild) {
            logger.info(MODULE_AGENT, 'rebuild_game: Running MSBuild...', timer.elapsed('main'));
            const buildResult = runMSBuild();
            buildOutput = buildResult.output;
            buildDurationMs = buildResult.durationMs;
            if (!buildResult.success) {
                const truncated = buildOutput.length > 2000
                    ? '...' + buildOutput.slice(-2000)
                    : buildOutput;
                return {
                    success: false,
                    message: `MSBuild failed after ${buildDurationMs}ms`,
                    buildOutput: truncated,
                    buildDurationMs,
                    pid: 0,
                    toolCount: 0,
                };
            }
            logger.info(MODULE_AGENT, `rebuild_game: MSBuild succeeded in ${buildDurationMs}ms`, timer.elapsed('main'));
        }
        else {
            logger.info(MODULE_AGENT, 'rebuild_game: Skipping MSBuild (skipBuild=true)', timer.elapsed('main'));
        }
        logger.info(MODULE_AGENT, 'rebuild_game: Subscribing to game.ready event...', timer.elapsed('main'));
        const readyPromise = waitForGameReady(client);
        const pid = launchGame();
        if (pid === 0) {
            return {
                success: false,
                message: 'Failed to launch game after build',
                buildOutput: buildOutput.slice(-2000),
                buildDurationMs,
                pid: 0,
                toolCount: 0,
            };
        }
        try {
            logger.info(MODULE_AGENT, 'rebuild_game: Waiting for game.ready event...', timer.elapsed('main'));
            const readyData = await readyPromise;
            const truncatedOutput = buildOutput.length > 2000
                ? '...' + buildOutput.slice(-2000)
                : buildOutput;
            return {
                success: true,
                message: `Rebuild complete: build ${buildDurationMs}ms, game reconnected (${readyData.toolCount} tools)`,
                buildOutput: truncatedOutput,
                buildDurationMs,
                pid,
                toolCount: readyData.toolCount,
            };
        }
        catch (error) {
            return {
                success: false,
                message: `Build succeeded but game did not reconnect: ${error.message}`,
                buildOutput: buildOutput.slice(-2000),
                buildDurationMs,
                pid,
                toolCount: 0,
            };
        }
    });
}
//# sourceMappingURL=rebuild-game.js.map