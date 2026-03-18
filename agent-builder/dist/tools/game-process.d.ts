import type { KadiClient } from '@kadi.build/core';
export declare function getConfig(): {
    gameExePath: string;
    gameWorkingDir: string;
    msbuildPath: string;
    solutionPath: string;
    buildConfiguration: string;
    buildPlatform: string;
    gameReadyTimeoutMs: number;
    processKillTimeoutMs: number;
};
export declare function findGameProcesses(): number[];
export declare function killGameProcess(): Promise<boolean>;
export declare function launchGame(): number;
export declare function runMSBuild(): {
    success: boolean;
    output: string;
    durationMs: number;
};
export declare function waitForGameReady(client: KadiClient): Promise<{
    agentName: string;
    toolCount: number;
}>;
//# sourceMappingURL=game-process.d.ts.map