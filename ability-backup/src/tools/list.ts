/**
 * backup-list tool — list available cloud backups that can be restored.
 *
 * Queries the configured cloud storage provider for backup files stored
 * under the configured base path (`/kadi-backups/{database}/`).
 *
 * Each backup entry includes the remote path (which can be passed directly
 * to `backup-restore`), file size, and modification date.
 *
 * @module tools/list
 */

import type { KadiClient } from '@kadi.build/core';
import { z } from '@kadi.build/core';
import { loadConfig } from '../lib/config.js';

/**
 * Register the `backup-list` tool.
 */
export function registerListTool(client: KadiClient): void {
  client.registerTool(
    {
      name: 'backup-list',
      description:
        'List available database backups stored in the cloud. ' +
        'Returns backup files sorted newest-first with path, size, and date. ' +
        'The returned `remotePath` values can be passed directly to `backup-restore`.',
      input: z.object({
        database: z
          .string()
          .optional()
          .describe(
            'Filter by database name. If omitted, lists backups for all databases.',
          ),
        provider: z
          .string()
          .optional()
          .describe(
            'Cloud provider to query (dropbox, googledrive, box). ' +
            'Uses the configured default if omitted.',
          ),
        limit: z
          .number()
          .optional()
          .describe('Maximum number of results to return (default: 20)'),
      }),
    },
    async (input) => {
      try {
        // ── Resolve config ──────────────────────────────────────────
        const cloudConfig = loadConfig('cloud', 'CLOUD');
        const backupConfig = loadConfig('backup', 'BACKUP');
        const provider = input.provider || cloudConfig.default_provider || 'dropbox';
        const basePath = backupConfig.cloud_backup_path || cloudConfig.cloud_backup_path || '/kadi-backups';
        const limit = input.limit ?? 20;

        // ── Build the listing path ──────────────────────────────────
        const listPath = input.database
          ? `${basePath}/${input.database}/`
          : `${basePath}/`;

        console.log(`[backup-list] Listing backups at ${provider}:${listPath}`);

        // ── Query cloud-storage-ability ─────────────────────────────
        const listResult = await client.invokeRemote<any>('cloud-list', {
          provider,
          path: listPath,
          recursive: !input.database, // recurse if listing all databases
        });

        if (!listResult.success) {
          // Treat "path not found" as empty — the backup folder doesn't exist yet
          const errStr = String(listResult.error ?? '');
          if (errStr.includes('not_found') || errStr.includes('not found')) {
            console.log(`[backup-list] Backup path does not exist yet — returning empty list`);
          } else {
            return {
              success: false,
              error: listResult.error ?? 'cloud-list failed',
              hint: `Check that cloud-storage-ability is online and ${provider} is configured.`,
            };
          }
        }

        // cloud-list returns { files: [...] }
        const rawFiles: any[] = listResult.files ?? listResult.items ?? [];

        // ── Filter & normalise ──────────────────────────────────────
        const backups = rawFiles
          .filter((f: any) => {
            // Only include actual backup files (not folders)
            if (f.type === 'folder' || f['.tag'] === 'folder') return false;
            const name: string = f.name ?? f.path ?? '';
            return name.endsWith('.tar.gz') || name.endsWith('.zip');
          })
          .map((f: any) => {
            const remotePath: string = f.path ?? f.pathDisplay ?? f.name;
            const name: string = f.name ?? remotePath.split('/').pop() ?? '';

            // Try to extract database name from path
            // Expected format: /kadi-backups/{database}/{timestamp}.tar.gz
            let database: string | undefined;
            const pathParts = remotePath.split('/').filter(Boolean);
            const baseIdx = pathParts.indexOf('kadi-backups');
            if (baseIdx >= 0 && pathParts.length > baseIdx + 1) {
              database = pathParts[baseIdx + 1];
            }

            // Try to extract timestamp from filename
            // Expected format: 2026-02-27T12-00-00-000Z.tar.gz
            let timestamp: string | undefined;
            const tsMatch = name.match(
              /(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)/,
            );
            if (tsMatch) {
              // Convert back to ISO: 2026-02-27T12-00-00-000Z → 2026-02-27T12:00:00.000Z
              timestamp = tsMatch[1]
                .replace(/(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/, '$1:$2:$3.$4Z');
            }

            return {
              remotePath,
              name,
              database,
              size: f.size ?? null,
              modified: f.modified ?? f.modifiedTime ?? f.server_modified ?? null,
              timestamp,
            };
          })
          // Sort newest first (by modified date or extracted timestamp)
          .sort((a, b) => {
            const dateA = new Date(a.modified ?? a.timestamp ?? 0).getTime();
            const dateB = new Date(b.modified ?? b.timestamp ?? 0).getTime();
            return dateB - dateA;
          })
          .slice(0, limit);

        // ── Group by database for summary ───────────────────────────
        const databaseSummary: Record<string, number> = {};
        for (const b of backups) {
          if (b.database) {
            databaseSummary[b.database] = (databaseSummary[b.database] ?? 0) + 1;
          }
        }

        return {
          success: true,
          provider,
          basePath,
          backups,
          count: backups.length,
          databases: databaseSummary,
          hint: 'Use backup-restore with the remotePath to restore any of these backups.',
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          success: false,
          error: message,
          hint: 'Ensure cloud-storage-ability is online and the broker is running.',
        };
      }
    },
  );
}

