/**
 * StagingServer — file-sharing staging lifecycle for distributed backup pipelines.
 *
 * This module wraps `@kadi.build/file-sharing`'s `FileSharingServer` and
 * `@kadi.build/tunnel-services` to provide a simple start/stop interface
 * for backup-ability.  It:
 *
 *   1. Creates a temporary staging directory
 *   2. Starts an HTTP file server on an OS-assigned port
 *   3. Optionally opens a KĀDI tunnel for cross-machine access
 *   4. Returns URLs that can be passed to `cloud-upload-from-url`
 *   5. Cleans up on stop
 *
 * ## Credential & Config Loading
 *
 * Following Convention Section 6:
 *
 * - **Tunnel token** — stored in `secrets.toml` vault `tunnel`, retrieved via
 *   `secret-get` (through broker or loadNative):
 *   ```ts
 *   const tunnelToken = await client.invokeRemote('secret-get', {
 *     key: 'KADI_TUNNEL_TOKEN', vault: 'tunnel'
 *   });
 *   // → { value: '<token-string>' }
 *   ```
 *
 * - **Tunnel settings** — stored in `config.yml` → `tunnel` section, loaded via
 *   walk-up `loadConfig('tunnel', 'KADI_TUNNEL')`:
 *   ```ts
 *   const tunnelConfig = loadConfig('tunnel', 'KADI_TUNNEL');
 *   // → { server_addr, tunnel_domain, server_port, ssh_port, mode, transport,
 *   //     wss_control_host, agent_id }
 *   ```
 *
 * @module staging-server
 * @see {@link https://github.com/kadi-build/file-sharing|@kadi.build/file-sharing}
 * @see {@link https://github.com/kadi-build/tunnel-services|@kadi.build/tunnel-services}
 */

import { FileSharingServer } from '@kadi.build/file-sharing';
import { randomUUID } from 'crypto';
import { mkdirSync, existsSync } from 'fs';

// ── Types ─────────────────────────────────────────────────────────────

/**
 * Configuration for the staging server.
 *
 * Required values are loaded from config.yml and secrets.toml vault at
 * runtime — see module JSDoc for the loading pattern.
 */
export interface StagingServerConfig {
  /** Directory where staged files are written. */
  stagingDir: string;

  /** Port to bind on. Default: 0 (OS picks a free port). */
  port?: number;

  /** Enable S3 endpoint for restore PUT operations. Default: true. */
  enableS3?: boolean;

  /** S3 port. Default: 0 (OS picks a free port). */
  s3Port?: number;

  /** Enable KĀDI tunnel for distributed deployments. */
  enableTunnel?: boolean;

  /** API key for authenticating file downloads. Auto-generated if not provided. */
  authKey?: string;

  /** Tunnel configuration — loaded from config.yml + vault. */
  tunnel?: StagingTunnelConfig;
}

/**
 * Tunnel configuration for the staging server.
 *
 * Maps to `FileSharingServer`'s flat `kadi*` tunnel keys via:
 * - `token`          → `kadiToken`
 * - `serverAddr`     → `kadiServer`
 * - `tunnelDomain`   → `kadiDomain`
 * - `serverPort`     → `kadiPort`
 * - `sshPort`        → `kadiSshPort`
 * - `mode`           → `kadiMode`
 * - `transport`      → `kadiTransport`
 * - `wssControlHost` → `kadiWssControlHost`
 * - `agentId`        → `kadiAgentId`
 */
export interface StagingTunnelConfig {
  /** KĀDI tunnel auth token — from vault `tunnel` → `KADI_TUNNEL_TOKEN`. */
  token: string;

  /** KĀDI broker address — from config.yml `tunnel.server_addr`. */
  serverAddr: string;

  /** KĀDI tunnel domain — from config.yml `tunnel.tunnel_domain`. */
  tunnelDomain: string;

  /** KĀDI frps server port — from config.yml `tunnel.server_port`. Default: 7000. */
  serverPort?: number;

  /** KĀDI SSH gateway port — from config.yml `tunnel.ssh_port`. Default: 2200. */
  sshPort?: number;

  /** Connection mode — from config.yml `tunnel.mode`. Default: 'auto'. */
  mode?: 'auto' | 'ssh' | 'frpc';

  /** Transport protocol — from config.yml `tunnel.transport`. Default: 'wss'. */
  transport?: 'wss' | 'tcp';

  /** WSS gateway hostname — from config.yml `tunnel.wss_control_host`. */
  wssControlHost?: string;

  /** Agent identifier for proxy naming — from config.yml `tunnel.agent_id`. */
  agentId?: string;
}

/**
 * Result returned by `StagingServer.start()`.
 */
export interface StagingStartResult {
  /** Local URL (always available). */
  localUrl: string;

  /** Public tunnel URL (only if tunnel is enabled and connected). */
  publicUrl?: string;

  /** Auth key for Bearer token authentication on file downloads. */
  authKey: string;
}

/**
 * StagingServer interface.
 *
 * Wraps `FileSharingServer` with lifecycle management, config loading
 * from vault + config.yml, and URL helpers for backup pipelines.
 */
export interface IStagingServer {
  start(): Promise<StagingStartResult>;
  stop(): Promise<void>;
  getFileUrl(filename: string): string;
  readonly isRunning: boolean;
  readonly authKey: string;
  readonly config: StagingServerConfig;
}

// ── Implementation ────────────────────────────────────────────────────

/**
 * Concrete staging server backed by `FileSharingServer`.
 *
 * Lazy — only starts when `start()` is called.  Stops the server and
 * tunnel when `stop()` is called.
 */
export class StagingServer implements IStagingServer {
  private _config: StagingServerConfig;
  private _server: FileSharingServer | null = null;
  private _localUrl: string = '';
  private _publicUrl: string | undefined;
  private _authKey: string;
  private _running = false;

  constructor(config: StagingServerConfig) {
    this._config = config;
    this._authKey = config.authKey ?? randomUUID();
  }

  // ── Getters ───────────────────────────────────────────────────────

  get isRunning(): boolean {
    return this._running;
  }

  get authKey(): string {
    return this._authKey;
  }

  get config(): StagingServerConfig {
    return this._config;
  }

  // ── Lifecycle ─────────────────────────────────────────────────────

  async start(): Promise<StagingStartResult> {
    if (this._running) {
      return {
        localUrl: this._localUrl,
        publicUrl: this._publicUrl,
        authKey: this._authKey,
      };
    }

    // Ensure staging directory exists
    if (!existsSync(this._config.stagingDir)) {
      mkdirSync(this._config.stagingDir, { recursive: true });
    }

    // Build FileSharingServer options
    // NOTE: S3 is intentionally disabled. The HTTP server handles both
    // PUT uploads and GET downloads from the staging directory, which is
    // all the restore pipeline needs.  When S3 was enabled, the tunnel
    // targeted the S3 port (FileSharingServer.enableTunnel defaults to
    // the S3 port when S3 is running), causing arcade-restore to receive
    // S3 XML responses instead of the tar.gz file content ("tar: invalid
    // magic" errors).
    //
    // NOTE: tunnel.enabled is set to FALSE here intentionally.
    // FileSharingServer.start() calls enableTunnel() before the OS-assigned
    // port is resolved, passing port 0 to the tunnel service which rejects
    // it ("Invalid port number: 0").  We pass the tunnel credentials so
    // the TunnelManager constructor receives them, but disable auto-start.
    // After start(), we resolve the real port and call enableTunnel() manually.
    const serverOpts: Record<string, any> = {
      staticDir: this._config.stagingDir,
      port: this._config.port ?? 0,
      enableS3: false,
      auth: { apiKey: this._authKey },
    };

    // Build tunnel options separately — we'll call enableTunnel() manually
    // after resolving the OS-assigned port.
    let tunnelOpts: Record<string, any> | null = null;
    if (this._config.enableTunnel && this._config.tunnel) {
      const t = this._config.tunnel;
      tunnelOpts = {
        service: 'kadi',
        autoFallback: false,
        kadiToken: t.token,
        kadiServer: t.serverAddr,
        kadiDomain: t.tunnelDomain,
        kadiPort: Number(t.serverPort) || 7000,
        kadiSshPort: Number(t.sshPort) || 2200,
        kadiMode: t.mode || 'auto',
        kadiTransport: t.transport || 'wss',
        kadiWssControlHost: t.wssControlHost,
        kadiAgentId: t.agentId || 'backup-ability',
      };

      // Pass kadi credentials to FileSharingServer so the TunnelManager
      // constructor receives them.  enabled: false prevents auto-creation
      // during start() (we create the tunnel manually after port resolution).
      serverOpts.tunnel = {
        enabled: false,
        ...tunnelOpts,
      };
    }

    console.log(`[staging-server] Starting on port ${serverOpts.port} (stagingDir: ${this._config.stagingDir})`);
    if (tunnelOpts) {
      console.log(`[staging-server] Tunnel will be created after port resolution (server=${tunnelOpts.kadiServer}, domain=${tunnelOpts.kadiDomain})`);
    } else {
      console.log(`[staging-server] Tunnel NOT enabled (enableTunnel=${this._config.enableTunnel}, hasTunnelConfig=${!!this._config.tunnel})`);
    }

    this._server = new FileSharingServer(serverOpts);

    // Listen for tunnel events so they aren't silently swallowed.
    // FileSharingServer extends EventEmitter (untyped JS) — use plain
    // callbacks to avoid TS2571 with strict unknown parameters.
    (this._server as any).on('tunnel:error', (err: any) => {
      console.error(`[staging-server] ⚠️ Tunnel creation failed: ${err?.message ?? err}`);
    });
    (this._server as any).on('tunnel:created', (tunnel: any) => {
      console.log(`[staging-server] Tunnel created: ${tunnel?.publicUrl || JSON.stringify(tunnel)}`);
    });

    const info = await this._server.start();

    // Work around FileSharingServer port-0 bug: getInfo() returns the
    // configured port (0) instead of the OS-assigned port.  The underlying
    // HttpServerProvider updates *its own* config.port but FileSharingServer
    // reads its top-level config.port.  Fix: read the actual port from the
    // underlying httpServer or the server info URL, then rebuild localUrl.
    let localUrl = info.localUrl;
    let resolvedPort = this._config.port ?? 0;
    // @ts-ignore — reach into internal httpServer to get actual port
    const httpSrv = (this._server as any).httpServer;
    const actualPort = httpSrv?.config?.port ?? httpSrv?.server?.address()?.port;
    if (actualPort && actualPort !== 0) {
      resolvedPort = actualPort;
      if (localUrl && localUrl.includes(':0')) {
        localUrl = localUrl.replace(':0', `:${actualPort}`);
      }
      console.log(`[staging-server] Resolved OS-assigned port → ${actualPort}`);
    }

    this._localUrl = localUrl;
    this._running = true;

    // ── Create tunnel AFTER port resolution ──────────────────────────
    // FileSharingServer.start() would pass port 0 to the tunnel service
    // (since it reads this.config.port before the OS assigns a port).
    // We create the tunnel manually with the resolved port instead.
    if (tunnelOpts && resolvedPort > 0) {
      try {
        console.log(`[staging-server] Creating tunnel on resolved port ${resolvedPort}…`);
        // @ts-ignore — enableTunnel is a public method on FileSharingServer
        await this._server.enableTunnel({ ...tunnelOpts, port: resolvedPort });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[staging-server] ⚠️ Tunnel creation failed: ${msg}`);
        // Don't fail server start — tunnel is best-effort
      }
    } else if (tunnelOpts && resolvedPort === 0) {
      console.error('[staging-server] ⚠️ Cannot create tunnel: port is still 0 after resolution');
    }

    // @ts-ignore — tunnelUrl may exist on the server instance
    this._publicUrl = this._server.tunnelUrl || info.publicUrl;

    console.log(`[staging-server] ✅ Started (local: ${this._localUrl}, public: ${this._publicUrl ?? 'none'})`);

    if (!this._publicUrl && this._config.enableTunnel) {
      console.error('[staging-server] ⚠️ Tunnel was enabled but no public URL was obtained. The tunnel may have failed silently. Check that frpc is installed and tunnel credentials are valid.');
    }

    // Brief delay for tunnel to become routable (S3.5 lesson learned)
    if (this._publicUrl) {
      console.log('[staging-server] Waiting 2s for tunnel to become routable…');
      await new Promise((r) => setTimeout(r, 2000));
    }

    return {
      localUrl: this._localUrl,
      publicUrl: this._publicUrl,
      authKey: this._authKey,
    };
  }

  async stop(): Promise<void> {
    if (!this._running || !this._server) {
      return;
    }

    console.log('[staging-server] Stopping…');
    try {
      await this._server.stop();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[staging-server] Stop warning: ${msg}`);
    }

    this._server = null;
    this._running = false;
    this._localUrl = '';
    this._publicUrl = undefined;
    console.log('[staging-server] ✅ Stopped');
  }

  // ── URL helpers ───────────────────────────────────────────────────

  /**
   * Build a full URL for a file in the staging directory.
   *
   * Uses the public tunnel URL if available, otherwise the local URL.
   */
  getFileUrl(filename: string): string {
    const base = this._publicUrl || this._localUrl;
    if (!base) {
      throw new Error('Staging server is not running — call start() first');
    }
    // URL-encode the filename in case it contains special characters
    return `${base}/${encodeURIComponent(filename)}`;
  }
}

// ── Factory ───────────────────────────────────────────────────────────

/**
 * Create a StagingServer instance from config.yml and vault values.
 *
 * This is the recommended factory function.  It maps the config.yml
 * `tunnel` and `backup` sections + vault token into a `StagingServerConfig`.
 *
 * @param tunnelConfig  Loaded via `loadConfig('tunnel', 'KADI_TUNNEL')`
 * @param backupConfig  Loaded via `loadConfig('backup', 'BACKUP')`
 * @param tunnelToken   From vault `tunnel` → `KADI_TUNNEL_TOKEN`
 * @returns             Configured StagingServer (not yet started)
 */
export function createStagingServer(
  tunnelConfig: Record<string, any>,
  backupConfig: Record<string, any>,
  tunnelToken?: string,
): StagingServer {
  const enableTunnel = !!tunnelToken && !!tunnelConfig.server_addr;

  const config: StagingServerConfig = {
    stagingDir: backupConfig.staging_dir || '/tmp/kadi-staging',
    port: Number(backupConfig.staging_port) || 0,
    enableS3: false,
    enableTunnel,
    tunnel: enableTunnel
      ? {
          token: tunnelToken!,
          serverAddr: tunnelConfig.server_addr,
          tunnelDomain: tunnelConfig.tunnel_domain,
          serverPort: Number(tunnelConfig.server_port) || 7000,
          sshPort: Number(tunnelConfig.ssh_port) || 2200,
          mode: tunnelConfig.mode || 'auto',
          transport: tunnelConfig.transport || 'wss',
          wssControlHost: tunnelConfig.wss_control_host,
          agentId: tunnelConfig.agent_id || 'backup-ability',
        }
      : undefined,
  };

  return new StagingServer(config);
}
