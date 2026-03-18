import { execSync, spawn } from 'child_process';
import { logger, MODULE_AGENT, timer } from 'agents-library';
export function getConfig() {
    return {
        gameExePath: process.env.GAME_EXE_PATH || 'C:/GitHub/DaemonAgent/Run/ProtogameJS3D_Debug_x64.exe',
        gameWorkingDir: process.env.GAME_WORKING_DIR || 'C:/GitHub/DaemonAgent/Run',
        msbuildPath: process.env.MSBUILD_PATH || 'C:/Program Files/Microsoft Visual Studio/2022/Community/MSBuild/Current/Bin/MSBuild.exe',
        solutionPath: process.env.SOLUTION_PATH || 'C:/GitHub/DaemonAgent/ProtogameJS3D.sln',
        buildConfiguration: process.env.BUILD_CONFIGURATION || 'Debug',
        buildPlatform: process.env.BUILD_PLATFORM || 'x64',
        gameReadyTimeoutMs: parseInt(process.env.GAME_READY_TIMEOUT_MS || '60000', 10),
        processKillTimeoutMs: parseInt(process.env.PROCESS_KILL_TIMEOUT_MS || '10000', 10),
    };
}
export function findGameProcesses() {
    const config = getConfig();
    const exeName = config.gameExePath.split('/').pop() || '';
    try {
        const output = execSync(`tasklist /FI "IMAGENAME eq ${exeName}" /FO CSV /NH`, {
            encoding: 'utf-8',
            timeout: 5000,
        });
        const pids = [];
        for (const line of output.trim().split('\n')) {
            const match = line.match(/"[^"]+","(\d+)"/);
            if (match) {
                pids.push(parseInt(match[1], 10));
            }
        }
        return pids;
    }
    catch {
        return [];
    }
}
export async function killGameProcess() {
    const pids = findGameProcesses();
    if (pids.length === 0) {
        logger.info(MODULE_AGENT, 'No game process found', timer.elapsed('main'));
        return false;
    }
    const config = getConfig();
    for (const pid of pids) {
        logger.info(MODULE_AGENT, `Killing game process PID ${pid}...`, timer.elapsed('main'));
        try {
            execSync(`taskkill /PID ${pid} /F`, { encoding: 'utf-8', timeout: config.processKillTimeoutMs });
            logger.info(MODULE_AGENT, `Process ${pid} terminated`, timer.elapsed('main'));
        }
        catch (error) {
            logger.warn(MODULE_AGENT, `Failed to kill PID ${pid}: ${error.message}`, timer.elapsed('main'));
        }
    }
    await sleep(1000);
    const remaining = findGameProcesses();
    if (remaining.length > 0) {
        logger.warn(MODULE_AGENT, `${remaining.length} game process(es) still running after kill`, timer.elapsed('main'));
        return false;
    }
    return true;
}
export function launchGame() {
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
export function runMSBuild() {
    const config = getConfig();
    const cmd = `"${config.msbuildPath}" "${config.solutionPath}" /p:Configuration=${config.buildConfiguration} /p:Platform=${config.buildPlatform} /m /nologo /v:minimal`;
    logger.info(MODULE_AGENT, `Running MSBuild: ${config.buildConfiguration}|${config.buildPlatform}`, timer.elapsed('main'));
    const startTime = Date.now();
    try {
        const output = execSync(cmd, {
            encoding: 'utf-8',
            timeout: 300000,
            maxBuffer: 10 * 1024 * 1024,
        });
        const durationMs = Date.now() - startTime;
        logger.info(MODULE_AGENT, `MSBuild completed in ${durationMs}ms`, timer.elapsed('main'));
        return { success: true, output: output.trim(), durationMs };
    }
    catch (error) {
        const durationMs = Date.now() - startTime;
        const err = error;
        const output = (err.stdout || '') + '\n' + (err.stderr || err.message);
        logger.error(MODULE_AGENT, `MSBuild failed after ${durationMs}ms`, timer.elapsed('main'));
        return { success: false, output: output.trim(), durationMs };
    }
}
export function waitForGameReady(client) {
    const config = getConfig();
    return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
            reject(new Error(`Timed out waiting for game.ready event (${config.gameReadyTimeoutMs}ms)`));
        }, config.gameReadyTimeoutMs);
        client.subscribe('game.ready', (event) => {
            clearTimeout(timeoutId);
            const data = event;
            logger.info(MODULE_AGENT, `Received game.ready event: ${JSON.stringify(data)}`, timer.elapsed('main'));
            resolve({
                agentName: data.agentName || 'DaemonAgent',
                toolCount: data.toolCount || 0,
            });
        }, { broker: 'default' }).catch((err) => {
            clearTimeout(timeoutId);
            reject(new Error(`Failed to subscribe to game.ready: ${err.message}`));
        });
    });
}
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
//# sourceMappingURL=game-process.js.map