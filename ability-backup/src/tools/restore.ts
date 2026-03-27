/**
 * backup-restore tool — orchestrates cloud download + database restore pipeline.
 *
 * Two-strategy pipeline:
 *
 *   **Primary (signed URL):**
 *     1. `cloud-get-download-url` → Dropbox/provider returns a time-limited
 *        signed download URL (~4 hours for Dropbox).
 *     2. `arcade-restore` fetches the file directly from that signed URL.
 *        No staging server, no tunnel — the simplest and fastest path.
 *
 *   **Fallback (staging server):**
 *     If `cloud-get-download-url` is unavailable or the provider doesn't
 *     support temporary links:
 *     1. Start a local staging server with a KĀDI tunnel.
 *     2. `cloud-download-to-url` → cloud-storage-ability PUTs the file into
 *        the staging server.
 *     3. `arcade-restore` fetches the file from the staging server URL
 *        (authenticated with Bearer token).
 *
 * Progressive failure: each step returns partial results from prior steps.
 *
 * @module tools/restore
 */

import type { KadiClient } from '@kadi.build/core';
import { z } from '@kadi.build/core';
import type { StagingServer } from '../lib/staging-server.js';
import { loadConfig } from '../lib/config.js';
import {
  type RestoreResult,
  type TransferMode,
  timed,
} from '../lib/types.js';

/**
 * Register the `backup-restore` tool.
 *
 * @param client           KadiClient instance (tools registered before connect)
 * @param getStagingServer Lazy factory — creates staging server on first use
 */
export function registerRestoreTool(
  client: KadiClient,
  getStagingServer: () => Promise<StagingServer>,
): void {
  client.registerTool(
    {
      name: 'backup-restore',
      description:
        'Restore a database from a cloud backup. ' +
        'Tries to get a signed download URL first (fastest path). ' +
        'Falls back to staging server + tunnel if the provider does not support signed URLs. ' +
        'Returns progressive partial results on failure.',
      input: z.object({
        database: z
          .string()
          .optional()
          .describe('Target database name (default: "kadi")'),
        provider: z
          .string()
          .optional()
          .describe('Cloud provider (dropbox, googledrive, box). Uses config default if omitted'),
        remotePath: z
          .string()
          .describe('Remote path of the backup file in cloud storage'),
        overwrite: z
          .boolean()
          .optional()
          .describe('Overwrite target database if it already exists (default: false)'),
      }),
    },
    async (input) => {
      const totalStart = performance.now();
      const cloudConfig = loadConfig('cloud', 'CLOUD');
      const database = input.database || 'kadi';
      const provider = input.provider || cloudConfig.default_provider || 'dropbox';
      const remotePath = input.remotePath;

      const result: RestoreResult = {
        success: false,
        database,
        source: remotePath,
        provider,
        steps: {},
      };

      let stagingServer: StagingServer | null = null;

      try {
        // ── Step 1: Get the backup file accessible to arcadedb-ability ──
        let backupSourceUrl: string;
        let backupAuthHeader: string | undefined;
        let transferMode: TransferMode = 'distributed';
        const targetFileName = remotePath.split('/').pop() || 'backup.tar.gz';

        // ── Strategy A: Signed download URL (preferred) ─────────────
        // Ask cloud-storage-ability for a temporary signed URL.
        // This lets arcade-restore download directly — no staging server.
        console.log(`[restore] Step 1: Trying cloud-get-download-url for ${remotePath}…`);

        let usedSignedUrl = false;

        try {
          const { result: urlResult, durationMs: urlMs } = await timed(() =>
            client.invokeRemote<any>('cloud-get-download-url', {
              provider,
              remotePath,
            }),
          );

          if (urlResult.success && urlResult.downloadUrl) {
            backupSourceUrl = urlResult.downloadUrl;
            usedSignedUrl = true;
            console.log(`[restore] Step 1 done: Got signed download URL (${urlMs}ms)`);

            result.steps!.download = {
              localPath: '(direct signed URL — no staging)',
              provider,
              mode: 'distributed',
              durationMs: urlMs,
            };
          } else {
            console.log(`[restore] cloud-get-download-url returned no URL, falling back to staging…`);
          }
        } catch (urlErr: unknown) {
          const msg = urlErr instanceof Error ? urlErr.message : String(urlErr);
          console.log(`[restore] cloud-get-download-url unavailable (${msg}), falling back to staging…`);
        }

        // ── Strategy B: Staging server fallback ─────────────────────
        // Start a staging server with KĀDI tunnel, have cloud-storage
        // push the file to it, then arcade-restore pulls from staging.
        if (!usedSignedUrl) {
          console.log(`[restore] Step 1b: Starting staging server for download…`);

          stagingServer = await getStagingServer();
          const stagingInfo = await stagingServer.start();

          // Prefer tunnel URL for distributed deployments
          const stagingBaseUrl = stagingInfo.publicUrl || stagingInfo.localUrl;
          if (!stagingBaseUrl) {
            result.failedAt = 'download';
            result.error = 'Staging server started but no URL available (tunnel may have failed)';
            return result;
          }

          console.log(`[restore] Staging server ready at: ${stagingBaseUrl}`);

          // Build the target PUT URL for the staging server's HTTP endpoint.
          // The path must match what getFileUrl() returns so that
          // arcade-restore can GET the same file after the PUT completes.
          const targetUrl = `${stagingBaseUrl}/${targetFileName}`;

          // Have cloud-storage-ability download from cloud and PUT to staging
          const { result: downloadResult, durationMs: downloadMs } = await timed(() =>
            client.invokeRemote<any>('cloud-download-to-url', {
              provider,
              remotePath,
              targetUrl,
              authHeader: `Bearer ${stagingServer!.authKey}`,
            }),
          );

          if (!downloadResult.success) {
            result.failedAt = 'download';
            result.error = downloadResult.error ?? 'cloud-download-to-url failed';
            result.partialResult = {
              stagingUrl: stagingBaseUrl,
              targetUrl,
            };
            return result;
          }

          // arcade-restore will fetch from the staging server
          backupSourceUrl = stagingServer.getFileUrl(targetFileName);
          backupAuthHeader = `Bearer ${stagingServer.authKey}`;

          result.steps!.download = {
            localPath: targetUrl,
            provider,
            mode: 'distributed',
            durationMs: downloadMs,
          };

          console.log(`[restore] Step 1b done: File staged (${downloadMs}ms)`);
        }

        // ── Step 2: arcade-restore ──────────────────────────────────
        // arcade-restore fetches the backup from the source URL and
        // imports it into ArcadeDB.
        console.log(`[restore] Step 2: Restoring database "${database}" from ${usedSignedUrl ? 'signed URL' : 'staging server'}…`);

        const restoreParams: Record<string, any> = {
          database,
          sourceUrl: backupSourceUrl!,
          overwrite: input.overwrite ?? false,
        };

        // Only pass auth header for staging server (signed URLs don't need auth)
        if (backupAuthHeader) {
          restoreParams.authHeader = backupAuthHeader;
        }

        const { result: restoreResult, durationMs: restoreMs } = await timed(() =>
          client.invokeRemote<any>('arcade-restore', restoreParams),
        );

        if (!restoreResult.success) {
          result.failedAt = 'restore';
          result.error = restoreResult.error ?? 'arcade-restore failed';
          result.partialResult = {
            downloadComplete: true,
            sourceUrl: backupSourceUrl!,
            usedSignedUrl,
          };
          console.error(`[restore] Step 2 failed: ${result.error}`);
          return result;
        }

        result.steps!.restore = {
          database,
          durationMs: restoreMs,
        };

        console.log(`[restore] Step 2 done: Database restored (${restoreMs}ms)`);

        // ── Success ─────────────────────────────────────────────────
        result.success = true;
        result.transferMode = transferMode;
        result.totalDurationMs = Math.round(performance.now() - totalStart);

        console.log(
          `[restore] ✅ Complete: ${remotePath} → ${database} (${usedSignedUrl ? 'signed URL' : 'staging'}, ${result.totalDurationMs}ms)`,
        );
        return result;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        result.error = message;
        console.error(`[restore] Unexpected error: ${message}`);
        return result;
      } finally {
        // Always stop staging server if we started one
        if (stagingServer?.isRunning) {
          try {
            await stagingServer.stop();
            console.log('[restore] Staging server stopped');
          } catch {
            // best effort
          }
        }
      }
    },
  );
}
