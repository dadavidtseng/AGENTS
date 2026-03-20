/**
 * Ambient type declarations for @kadi.build/file-sharing.
 *
 * This package isn't installed locally during development; the real
 * dependency is resolved at deploy time via the KĀDI package registry.
 */
declare module '@kadi.build/file-sharing' {
  export interface FileSharingServerOptions {
    staticDir: string;
    port?: number;
    enableS3?: boolean;
    auth?: { apiKey: string };
    tunnel?: Record<string, any>;
    [key: string]: any;
  }

  export interface FileSharingServerInfo {
    localUrl: string;
    publicUrl?: string;
    port: number;
  }

  export class FileSharingServer {
    constructor(options: FileSharingServerOptions | Record<string, any>);
    start(): Promise<FileSharingServerInfo>;
    stop(): Promise<void>;
    tunnelUrl?: string;
  }
}
