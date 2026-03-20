/**
 * Backup & restore tools — create, verify, and restore ArcadeDB database backups.
 *
 * These tools wrap the vendored BackupManager AND add file-sharing support
 * so that backup files can be transferred across machines in distributed
 * deployments (e.g., every ability on its own Akash provider).
 *
 * ## Distributed file transfer
 *
 * The key challenge: the backup .zip lives on the arcadedb-ability's
 * filesystem.  Other services (backup-ability, cloud-storage-ability) are
 * on different machines and cannot access local paths.
 *
 *   - `arcade-backup`  → creates the backup locally, optionally compresses
 *     it, then starts a temporary `FileSharingServer` so the file can be
 *     downloaded over HTTP.  Returns both the local `path` (co-located fast
 *     path) and a `downloadUrl` + `authKey` (distributed path).
 *
 *   - `arcade-restore` → accepts either a local `path` or a `sourceUrl`.
 *     When a URL is provided, it downloads the file first, then restores.
 *
 * The file-sharing server auto-stops after a configurable timeout or when
 * explicitly cleaned up via `arcade-backup-cleanup`.
 *
 * ## Tools registered
 *
 *   1. `arcade-backup`          — create backup, compress, serve file
 *   2. `arcade-restore`         — download (if URL) → decompress → restore
 *   3. `arcade-backup-cleanup`  — stop the file-sharing server early
 *
 * @module tools/backup
 */

import { KadiClient, z } from '@kadi.build/core';
import { FileSharingServer } from '@kadi.build/file-sharing';
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  openSync,
  readSync,
  closeSync,
  readdirSync,
  statSync,
} from 'fs';
import { basename, dirname, join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { execSync } from 'child_process';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';

import { errorMessage } from '../lib/errors.js';
import { loadConfig } from '../lib/backup-config.js';
import type { ArcadeManagers } from '../lib/types.js';

// ── Staging server state (module-level singleton) ─────────────────────

interface StagingState {
  server: FileSharingServer;
  authKey: string;
  localUrl: string;
  publicUrl?: string;
  servingPath: string;
  servingFilename: string;
  timeoutHandle: ReturnType<typeof setTimeout>;
}

let activeStagingState: StagingState | null = null;

/** How long to keep the file-sharing server alive (ms).  Default: 10 min. */
const STAGING_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Start a temporary file-sharing HTTP server that serves a single file.
 *
 * Uses `@kadi.build/file-sharing`'s `FileSharingServer` pointing at the
 * directory containing the backup file.
 */
async function startStagingServer(
  filePath: string,
  tunnelConfig?: Record<string, any>,
  tunnelToken?: string,
): Promise<{ localUrl: string; publicUrl?: string; authKey: string; filename: string }> {
  // Stop any previous staging server
  await stopStagingServer();

  const stagingDir = dirname(filePath);
  const filename = basename(filePath);
  const authKey = randomUUID();

  const serverOpts: Record<string, any> = {
    staticDir: stagingDir,
    port: Number(process.env.KADI_STAGING_PORT) || 9090, // fixed port — must match exposed port in agent.json
    enableS3: false,
    auth: { apiKey: authKey },
  };

  // Add KĀDI tunnel config if available (for cross-network access)
  // autoFallback: false — don't fall back to localtunnel/ngrok which inject HTML
  if (tunnelToken && tunnelConfig?.server_addr) {
    serverOpts.tunnel = {
      enabled: true,
      service: 'kadi',
      autoFallback: false,
      kadiToken: tunnelToken,
      kadiServer: tunnelConfig.server_addr,
      kadiDomain: tunnelConfig.tunnel_domain,
      kadiPort: Number(tunnelConfig.server_port) || 7000,
      kadiSshPort: Number(tunnelConfig.ssh_port) || 2200,
      kadiMode: tunnelConfig.mode || 'auto',
      kadiTransport: tunnelConfig.transport || 'wss',
      kadiWssControlHost: tunnelConfig.wss_control_host,
      kadiAgentId: tunnelConfig.agent_id || 'arcadedb-ability',
    };
  }

  const server = new FileSharingServer(serverOpts);
  const info = await server.start();

  const localUrl = info.localUrl;
  // @ts-ignore — tunnelUrl may exist
  const publicUrl: string | undefined = (server as any).tunnelUrl || info.publicUrl;

  // Auto-stop after timeout
  const timeoutHandle = setTimeout(async () => {
    console.log('[arcade-backup] Staging server auto-stopping after timeout');
    await stopStagingServer();
  }, STAGING_TIMEOUT_MS);
  timeoutHandle.unref(); // don't keep the process alive

  activeStagingState = {
    server,
    authKey,
    localUrl,
    publicUrl,
    servingPath: filePath,
    servingFilename: filename,
    timeoutHandle,
  };

  // Brief delay for tunnel to become routable
  if (publicUrl) {
    await new Promise((r) => setTimeout(r, 2000));
  }

  console.log(`[arcade-backup] Staging server started (local: ${localUrl}, public: ${publicUrl ?? 'none'})`);

  return { localUrl, publicUrl, authKey, filename };
}

/** Stop the staging server if running. */
async function stopStagingServer(): Promise<boolean> {
  if (!activeStagingState) return false;
  const state = activeStagingState;
  activeStagingState = null;
  clearTimeout(state.timeoutHandle);
  try {
    await state.server.stop();
    console.log('[arcade-backup] Staging server stopped');
    return true;
  } catch {
    console.warn('[arcade-backup] Warning: could not stop staging server');
    return false;
  }
}

// ── Compression helpers ───────────────────────────────────────────────

/**
 * Compress a file or directory to .tar.gz using the system `tar` command.
 * This avoids needing the `tar` npm package.
 */
async function compressToTarGz(sourcePath: string): Promise<{ outputPath: string; size: number }> {
  const outputPath = sourcePath + '.tar.gz';
  const sourceDir = dirname(sourcePath);
  const sourceBase = basename(sourcePath);

  execSync(`tar -czf "${outputPath}" -C "${sourceDir}" "${sourceBase}"`, {
    stdio: 'pipe',
  });

  const stats = statSync(outputPath);
  return { outputPath, size: stats.size };
}

/**
 * Decompress a .tar.gz file using the system `tar` command.
 *
 * @returns Path to the extracted directory.
 */
function decompressTarGz(archivePath: string, outputDir?: string): string {
  const extractDir = outputDir ?? archivePath.replace(/\.tar\.gz$/, '') + '-extracted';
  if (!existsSync(extractDir)) {
    mkdirSync(extractDir, { recursive: true });
  }

  execSync(`tar -xzf "${archivePath}" -C "${extractDir}"`, {
    stdio: 'pipe',
  });

  return extractDir;
}

/**
 * Detect if a file is gzip-compressed by reading its magic bytes.
 * Gzip files start with `1f 8b`.
 */
function isGzipFile(filePath: string): boolean {
  try {
    const buf = Buffer.alloc(2);
    const fd = openSync(filePath, 'r');
    readSync(fd, buf, 0, 2, 0);
    closeSync(fd);
    return buf[0] === 0x1f && buf[1] === 0x8b;
  } catch {
    return false;
  }
}

/**
 * Download a file from a URL to a local path.
 */
async function downloadFile(
  url: string,
  destPath: string,
  authHeader?: string,
): Promise<void> {
  const headers: Record<string, string> = {};
  if (authHeader) headers['Authorization'] = authHeader;

  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`Download failed: ${response.status} ${response.statusText}`);
  }
  if (!response.body) {
    throw new Error('Download failed: empty response body');
  }

  const destDir = dirname(destPath);
  if (!existsSync(destDir)) {
    mkdirSync(destDir, { recursive: true });
  }

  const fileStream = createWriteStream(destPath);
  // Convert ReadableStream to Node Readable
  const nodeStream = Readable.fromWeb(response.body as any);
  await pipeline(nodeStream, fileStream);
}

// ── Tool registrations ────────────────────────────────────────────────

/**
 * Register backup tools with the KadiClient.
 *
 * @param client     KadiClient instance
 * @param managers   Vendored CJS manager instances (includes backup manager)
 */
export function registerBackupTools(
  client: KadiClient,
  managers: ArcadeManagers,
): void {

  // ==== arcade-backup ======================================================

  client.registerTool(
    {
      name: 'arcade-backup',
      description:
        'Create a database backup. The backup file is made available for ' +
        'download over HTTP (via a temporary file-sharing server) so it can ' +
        'be transferred to other services in distributed deployments. ' +
        'Returns both the local path (co-located fast path) and a downloadUrl ' +
        '(distributed path). Call arcade-backup-cleanup when done downloading.',
      input: z.object({
        database: z
          .string()
          .optional()
          .describe('Database name to back up (default: "kadi")'),
        verify: z
          .boolean()
          .optional()
          .describe('Verify backup integrity after creation (default: true)'),
        compress: z
          .boolean()
          .optional()
          .describe('Compress to .tar.gz after backup (default: true)'),
        serveFile: z
          .boolean()
          .optional()
          .describe(
            'Start a file-sharing server so the backup can be downloaded ' +
            'over HTTP by other services (default: true)',
          ),
      }),
    },
    async (input) => {
      const database = input.database || 'kadi';
      const verify = input.verify !== false;
      const compress = input.compress !== false;
      const serveFile = input.serveFile !== false;

      try {
        // Step 1: Create backup via BackupManager (local to this machine)
        console.log(`[arcade-backup] Creating backup of database "${database}"…`);
        const backupInfo = await managers.backup.createBackup(database, { verify });

        let finalPath = backupInfo.fullPath;
        let finalSize = backupInfo.size;
        let compressed = false;

        // Step 2: Optionally compress to .tar.gz
        if (compress) {
          console.log(`[arcade-backup] Compressing ${backupInfo.fileName}…`);
          const { outputPath, size } = await compressToTarGz(backupInfo.fullPath);
          finalPath = outputPath;
          finalSize = size;
          compressed = true;
          console.log(`[arcade-backup] Compressed: ${basename(outputPath)} (${size} bytes)`);
        }

        // Step 3: Start file-sharing server so others can download
        let downloadUrl: string | undefined;
        let authKey: string | undefined;

        if (serveFile) {
          // Load tunnel config from config.yml if available
          let tunnelConfig: Record<string, any> = {};
          let tunnelToken: string | undefined;
          try {
            tunnelConfig = loadConfig('tunnel', 'KADI_TUNNEL');
          } catch {
            // No tunnel config — staging server will be local-only
          }
          // 1. Try vault via broker (primary — secret-ability)
          try {
            const secretResult = await client.invokeRemote<any>('secret-get', {
              key: 'KADI_TUNNEL_TOKEN',
              vault: 'arcadedb',
            });
            tunnelToken = secretResult?.value ?? secretResult?.data?.value;
          } catch {
            // Vault unavailable — fall through to env
          }

          // 2. Fall back to env var (set by `kadi secret receive --vault arcadedb` at startup)
          if (!tunnelToken) {
            tunnelToken = process.env.KADI_TUNNEL_TOKEN;
          }

          if (!tunnelToken) {
            console.log('[arcade-backup] No tunnel token — staging server will be local-only');
          }

          const staging = await startStagingServer(finalPath, tunnelConfig, tunnelToken);
          // Use public (tunnel) URL if available, otherwise local
          downloadUrl = staging.publicUrl
            ? `${staging.publicUrl}/${encodeURIComponent(staging.filename)}`
            : `${staging.localUrl}/${encodeURIComponent(staging.filename)}`;
          authKey = staging.authKey;
        }

        const result: Record<string, any> = {
          success: true,
          database,
          fileName: basename(finalPath),
          path: finalPath,
          size: finalSize,
          sizeFormatted: backupInfo.sizeFormatted,
          compressed,
          verified: verify,
          created: new Date().toISOString(),
        };

        if (downloadUrl) {
          result.downloadUrl = downloadUrl;
          result.authKey = authKey;
          result.hint =
            'Use downloadUrl and authKey to download the backup from another machine. ' +
            'Call arcade-backup-cleanup when the download is complete.';
        }

        console.log(`[arcade-backup] ✅ Backup ready: ${result.fileName}`);
        return result;
      } catch (err: unknown) {
        return { success: false, error: errorMessage(err) };
      }
    },
  );

  // ==== arcade-restore =====================================================

  client.registerTool(
    {
      name: 'arcade-restore',
      description:
        'Restore a database from a backup. Accepts either a local path ' +
        '(co-located) or a sourceUrl (distributed — downloads the file first). ' +
        'Handles .tar.gz decompression automatically. ' +
        'Refuses to overwrite an existing database unless overwrite: true.',
      input: z.object({
        database: z
          .string()
          .describe('Target database name for restoration'),
        path: z
          .string()
          .optional()
          .describe('Local filesystem path to the backup file (co-located mode)'),
        sourceUrl: z
          .string()
          .optional()
          .describe(
            'HTTP(S) URL to download the backup from (distributed mode). ' +
            'Use this when the backup file is on another machine.',
          ),
        authHeader: z
          .string()
          .optional()
          .describe('Authorization header for sourceUrl (e.g., "Bearer <key>")'),
        overwrite: z
          .boolean()
          .optional()
          .describe('Allow overwriting an existing database (default: false)'),
      }),
    },
    async (input) => {
      const { database } = input;
      const overwrite = input.overwrite === true;

      if (!input.path && !input.sourceUrl) {
        return {
          success: false,
          error: 'Either path or sourceUrl must be provided',
          hint: 'Use path for local backups, sourceUrl for distributed (cross-machine) restores.',
        };
      }

      try {
        let backupFilePath: string;

        // Step 1: Obtain the backup file locally
        if (input.sourceUrl) {
          // Distributed mode: download from URL first
          console.log(`[arcade-restore] Downloading backup from ${input.sourceUrl}…`);
          const tmpDir = join(
            tmpdir(),
            `kadi-restore-${randomUUID().slice(0, 8)}`,
          );
          mkdirSync(tmpDir, { recursive: true });

          const filename = basename(new URL(input.sourceUrl).pathname) || 'backup.tar.gz';
          backupFilePath = join(tmpDir, filename);

          await downloadFile(input.sourceUrl, backupFilePath, input.authHeader);
          console.log(`[arcade-restore] Downloaded to ${backupFilePath}`);
        } else {
          // Co-located mode: use local path directly
          backupFilePath = input.path!;
          if (!existsSync(backupFilePath)) {
            return {
              success: false,
              error: `Backup file not found: ${backupFilePath}`,
            };
          }
        }

        // Step 2: Decompress if gzip/tar.gz — detect by magic bytes, not
        // filename extension, because Dropbox signed URLs strip the
        // original filename from the URL path.
        let restoreFilePath = backupFilePath;
        const fileIsGzip = isGzipFile(backupFilePath);
        const nameHintsTarGz =
          backupFilePath.endsWith('.tar.gz') || backupFilePath.endsWith('.tgz');

        if (fileIsGzip || nameHintsTarGz) {
          console.log(`[arcade-restore] Detected gzip — decompressing ${basename(backupFilePath)}…`);
          const extractDir = decompressTarGz(backupFilePath);
          // Find the .zip inside the extracted directory
          const extracted = readdirSync(extractDir);
          const zipFile = extracted.find((f) => f.endsWith('.zip'));
          if (zipFile) {
            restoreFilePath = join(extractDir, zipFile);
          } else if (extracted.length === 1) {
            restoreFilePath = join(extractDir, extracted[0]);
          } else {
            restoreFilePath = extractDir;
          }
          console.log(`[arcade-restore] Extracted → ${restoreFilePath}`);
        }

        // Step 3: Restore via BackupManager
        console.log(`[arcade-restore] Restoring database "${database}" from ${basename(restoreFilePath)}…`);
        const restored = await managers.backup.restoreBackup(database, restoreFilePath, {
          overwrite,
        });

        if (!restored) {
          return {
            success: false,
            error: `Restore of database "${database}" returned false`,
          };
        }

        console.log(`[arcade-restore] ✅ Database "${database}" restored successfully`);
        return {
          success: true,
          database,
          restoredFrom: input.sourceUrl ? 'url' : 'local',
          source: input.sourceUrl ?? input.path,
        };
      } catch (err: unknown) {
        return { success: false, error: errorMessage(err) };
      }
    },
  );

  // ==== arcade-backup-cleanup ==============================================

  client.registerTool(
    {
      name: 'arcade-backup-cleanup',
      description:
        'Stop the temporary file-sharing server started by arcade-backup. ' +
        'Call this after the backup file has been downloaded.',
      input: z.object({}),
    },
    async () => {
      const stopped = await stopStagingServer();
      return {
        success: true,
        stopped,
        message: stopped
          ? 'Staging server stopped'
          : 'No staging server was running',
      };
    },
  );
}
