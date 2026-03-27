/**
 * Ambient type declarations for @kadi.build/file-sharing
 *
 * The package ships JS-only without a "types" field in package.json.
 * This declaration bridges that gap for TypeScript compilation.
 */
declare module '@kadi.build/file-sharing' {
  export interface FileSharingServerOptions {
    port?: number;
    directory?: string;
    staticDir?: string;
    authKey?: string;
    tunnel?: { enabled?: boolean; [key: string]: unknown };
    [key: string]: unknown;
  }

  export interface FileSharingServerInfo {
    isRunning: boolean;
    localUrl: string;
    publicUrl: string | null;
    s3Endpoint: string | null;
    staticDir: string;
    stats: Record<string, unknown>;
    uptime: number;
    tunnelStatus: unknown;
  }

  export class FileSharingServer {
    constructor(options?: FileSharingServerOptions);
    start(): Promise<FileSharingServerInfo>;
    stop(): Promise<void>;
    getInfo(): FileSharingServerInfo;
    readonly isRunning: boolean;
    readonly port: number;
    readonly directory: string;
    readonly authKey: string;
    tunnelUrl?: string;
    [key: string]: unknown;
  }
}
