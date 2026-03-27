/**
 * backup-status tool — list schedules and recent cloud backups.
 *
 * @module tools/status
 */

import type { KadiClient } from '@kadi.build/core';
import { z } from '@kadi.build/core';
import { listSchedules, getSchedulesByDatabase } from '../lib/scheduler.js';
import { loadConfig } from '../lib/config.js';

/**
 * Register the `backup-status` tool.
 */
export function registerStatusTool(client: KadiClient): void {
  client.registerTool(
    {
      name: 'backup-status',
      description:
        'List active backup schedules and recent cloud backups for a database. ' +
        'Shows schedule metadata, recent backup files (newest 10), and current configuration.',
      input: z.object({
        database: z
          .string()
          .optional()
          .describe('Database to check status for (default: all databases)'),
      }),
    },
    async (input) => {
      try {
        const database = input.database;

        // ── Schedules ─────────────────────────────────────────────
        const schedules = database
          ? getSchedulesByDatabase(database)
          : listSchedules();

        // ── Recent cloud backups ──────────────────────────────────
        const cloudConfig = loadConfig('cloud', 'CLOUD');
        const backupConfig = loadConfig('backup', 'BACKUP');
        const defaultProvider = cloudConfig.default_provider || 'dropbox';
        const cloudBasePath = '/kadi-backups';

        let recentBackups: Array<{
          path: string;
          size?: number;
          modified?: string;
        }> = [];

        try {
          const listPath = database
            ? `${cloudBasePath}/${database}/`
            : `${cloudBasePath}/`;

          const listResult = await client.invokeRemote<any>('cloud-list', {
            provider: defaultProvider,
            path: listPath,
          });

          if (listResult.success && Array.isArray(listResult.files ?? listResult.items)) {
            // Sort by modified date descending, take newest 10
            recentBackups = (listResult.files ?? listResult.items)
              .filter((item: any) => item.type !== 'folder' && (item.name?.endsWith('.tar.gz') || item.name?.endsWith('.zip')))
              .sort((a: any, b: any) => {
                const dateA = new Date(a.modified ?? 0).getTime();
                const dateB = new Date(b.modified ?? 0).getTime();
                return dateB - dateA;
              })
              .slice(0, 10)
              .map((item: any) => ({
                path: item.path ?? item.name,
                size: item.size,
                modified: item.modified,
              }));
          }
        } catch (err: unknown) {
          // Cloud listing may fail if no backups exist yet — non-fatal
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(`[status] Could not list cloud backups: ${msg}`);
        }

        return {
          success: true,
          schedules,
          recentBackups,
          config: {
            defaultProvider,
            cloudBasePath,
            compressionFormat: 'tar.gz',
            retentionCount: 10,
            stagingDir: backupConfig.staging_dir || '/tmp/kadi-staging',
            distributedMode: backupConfig.distributed_mode || 'auto',
          },
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          success: false,
          error: message,
          hint: 'Check that the broker is running and cloud-storage-ability is connected.',
        };
      }
    },
  );
}
