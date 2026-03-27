/**
 * backup-database tool — orchestrates backup + cloud upload pipeline.
 *
 * Pipeline:
 *   1. arcade-backup → creates backup + compresses + starts file-sharing server
 *      (all on the arcadedb-ability's machine, which has local filesystem access)
 *   2. cloud-upload-from-url → cloud-storage-ability pulls the file from
 *      arcadedb-ability's download URL and uploads it to the cloud provider
 *   3. arcade-backup-cleanup → stops the file-sharing server on arcadedb-ability
 *
 * This design works across distributed deployments (separate Akash machines)
 * because file transfer happens over HTTP — no shared filesystem required.
 *
 * Progressive failure: each step returns partial results from prior steps.
 *
 * @module tools/backup
 */

import type { KadiClient } from '@kadi.build/core';
import { z } from '@kadi.build/core';
import type { StagingServer } from '../lib/staging-server.js';
import { loadConfig } from '../lib/config.js';
import {
  type BackupResult,
  type TransferMode,
  buildRemotePath,
  timed,
} from '../lib/types.js';

/**
 * Register the `backup-database` tool.
 *
 * @param client          KadiClient instance (tools registered before connect)
 * @param getStagingServer  Lazy factory — kept for future use but no longer
 *                          needed for backup (arcadedb-ability has its own staging)
 */
export function registerBackupTool(
  client: KadiClient,
  getStagingServer: () => Promise<StagingServer>,
): void {
  client.registerTool(
    {
      name: 'backup-database',
      description:
        'Back up a database and upload to cloud storage. ' +
        'Works across distributed deployments — arcadedb-ability creates the ' +
        'backup and serves it over HTTP, cloud-storage-ability pulls from that URL. ' +
        'Returns progressive partial results on failure.',
      input: z.object({
        database: z
          .string()
          .optional()
          .describe('Database name to back up (default: "kadi")'),
        provider: z
          .string()
          .optional()
          .describe('Cloud provider (dropbox, googledrive, box). Uses config default if omitted'),
        compress: z
          .boolean()
          .optional()
          .describe('Compress the backup to .tar.gz (default: true)'),
        verify: z
          .boolean()
          .optional()
          .describe('Verify backup integrity (default: true)'),
        skipUpload: z
          .boolean()
          .optional()
          .describe('Skip the cloud upload step (default: false)'),
      }),
    },
    async (input) => {
      const totalStart = performance.now();
      const cloudConfig = loadConfig('cloud', 'CLOUD');
      const database = input.database || 'kadi';
      const provider = input.provider || cloudConfig.default_provider || 'dropbox';
      const shouldCompress = input.compress !== false;
      const verify = input.verify !== false;
      const skipUpload = input.skipUpload === true;

      const result: BackupResult = {
        success: false,
        database,
        steps: {},
      };

      let needsCleanup = false;

      try {
        // ── Step 1: arcade-backup ───────────────────────────────────
        // This runs on the arcadedb-ability machine.
        // It creates the backup, optionally compresses, and starts a
        // file-sharing HTTP server so the file can be downloaded remotely.
        console.log(`[backup] Step 1: Backing up database "${database}"…`);

        const { result: backupResult, durationMs: backupMs } = await timed(() =>
          client.invokeRemote<any>('arcade-backup', {
            database,
            verify,
            compress: shouldCompress,
            serveFile: !skipUpload,  // only serve if we need to upload
          }),
        );

        if (!backupResult.success) {
          result.failedAt = 'backup';
          result.error = backupResult.error ?? 'arcade-backup failed';
          return result;
        }

        needsCleanup = !!backupResult.downloadUrl;

        result.steps!.backup = {
          path: backupResult.path,
          size: backupResult.size,
          durationMs: backupMs,
        };

        if (shouldCompress && backupResult.compressed) {
          result.steps!.compress = {
            path: backupResult.path,
            size: backupResult.size,
            ratio: undefined, // arcadedb-ability doesn't compute ratio
            durationMs: 0,    // compression included in backup step
          };
        }

        console.log(`[backup] Step 1 done: ${backupResult.fileName} (${backupMs}ms)`);
        if (backupResult.downloadUrl) {
          console.log(`[backup] Download URL: ${backupResult.downloadUrl}`);
        }

        // ── Step 2: Upload to cloud ─────────────────────────────────
        if (skipUpload) {
          result.success = true;
          result.totalDurationMs = Math.round(performance.now() - totalStart);
          result.transferMode = 'local';
          result.steps!.cleanup = { removed: false };
          return result;
        }

        const remotePath = buildRemotePath(database);
        let transferMode: TransferMode = 'distributed';

        console.log(`[backup] Step 2: Uploading to ${provider} → ${remotePath}`);

        // Use the download URL from arcade-backup.
        // cloud-storage-ability pulls the file from arcadedb-ability's
        // HTTP server and streams it up to the cloud provider.
        if (backupResult.downloadUrl) {
          const { result: uploadResult, durationMs: uploadMs } = await timed(() =>
            client.invokeRemote<any>('cloud-upload-from-url', {
              provider,
              sourceUrl: backupResult.downloadUrl,
              remotePath,
              authHeader: `Bearer ${backupResult.authKey}`,
            }),
          );

          if (!uploadResult.success) {
            result.failedAt = 'upload';
            result.error = uploadResult.error ?? 'cloud-upload-from-url failed';
            result.partialResult = {
              backupPath: backupResult.path,
              downloadUrl: backupResult.downloadUrl,
            };
            return result;
          }

          result.steps!.upload = {
            remotePath,
            provider,
            mode: 'distributed',
            durationMs: uploadMs,
          };
          console.log(`[backup] Step 2 done: distributed upload via URL (${uploadMs}ms)`);
        } else {
          // No download URL — backup-ability and arcadedb-ability might be
          // co-located. Try direct local path upload as fallback.
          transferMode = 'local';

          const { result: uploadResult, durationMs: uploadMs } = await timed(() =>
            client.invokeRemote<any>('cloud-upload', {
              provider,
              localPath: backupResult.path,
              remotePath,
            }),
          );

          if (!uploadResult.success) {
            result.failedAt = 'upload';
            result.error = uploadResult.error ?? 'cloud-upload failed';
            result.partialResult = { backupPath: backupResult.path };
            return result;
          }

          result.steps!.upload = {
            remotePath,
            provider,
            mode: 'local',
            durationMs: uploadMs,
          };
          console.log(`[backup] Step 2 done: co-located upload (${uploadMs}ms)`);
        }

        // ── Step 3: Cleanup — stop arcadedb-ability's staging server ─
        let removed = false;
        if (needsCleanup) {
          try {
            await client.invokeRemote<any>('arcade-backup-cleanup', {});
            removed = true;
            needsCleanup = false;
            console.log('[backup] Step 3: arcade-backup staging server stopped');
          } catch {
            console.warn('[backup] Step 3: Could not stop arcade-backup staging server');
          }
        }

        result.steps!.cleanup = { removed };
        result.success = true;
        result.transferMode = transferMode;
        result.remotePath = remotePath;
        result.totalDurationMs = Math.round(performance.now() - totalStart);

        console.log(
          `[backup] ✅ Complete: ${database} → ${remotePath} (${transferMode}, ${result.totalDurationMs}ms)`,
        );
        return result;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        result.error = message;
        return result;
      } finally {
        // Ensure arcade-backup's staging server is stopped even on errors
        if (needsCleanup) {
          try {
            await client.invokeRemote<any>('arcade-backup-cleanup', {});
          } catch {
            // best effort
          }
        }
      }
    },
  );
}
