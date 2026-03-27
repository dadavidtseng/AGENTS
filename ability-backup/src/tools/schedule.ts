/**
 * backup-schedule tool — create/remove in-memory backup schedules.
 *
 * Schedules use `setInterval` and do not survive agent restarts (v1).
 *
 * @module tools/schedule
 */

import type { KadiClient } from '@kadi.build/core';
import { z } from '@kadi.build/core';
import {
  createSchedule,
  removeSchedule,
  listSchedules,
  removeSchedulesByDatabase,
} from '../lib/scheduler.js';

/**
 * Register the `backup-schedule` tool.
 */
export function registerScheduleTool(client: KadiClient): void {
  client.registerTool(
    {
      name: 'backup-schedule',
      description:
        'Create, update, or remove a periodic backup schedule. ' +
        'Schedules are in-memory only — they do not survive agent restarts. ' +
        'Set enabled: false to remove a schedule. ' +
        'Min interval: 1 hour, max interval: 720 hours (30 days).',
      input: z.object({
        database: z
          .string()
          .optional()
          .describe('Database to schedule backups for (default: "kadi")'),
        provider: z
          .string()
          .optional()
          .describe('Cloud provider for backup uploads (default: "dropbox")'),
        intervalHours: z
          .number()
          .min(1)
          .max(720)
          .optional()
          .describe('Hours between backups (default: 24, min: 1, max: 720)'),
        enabled: z
          .boolean()
          .optional()
          .describe('true to create/update schedule, false to remove (default: true)'),
      }),
    },
    async (input) => {
      try {
        const database = input.database || 'kadi';
        const provider = input.provider || 'dropbox';
        const intervalHours = input.intervalHours ?? 24;
        const enabled = input.enabled !== false;

        if (!enabled) {
          // Remove all schedules for this database
          const count = removeSchedulesByDatabase(database);
          if (count === 0) {
            return {
              success: true,
              status: 'removed',
              message: `No active schedules found for database "${database}"`,
              database,
              activeSchedules: listSchedules(),
            };
          }
          return {
            success: true,
            status: 'removed',
            message: `Removed ${count} schedule(s) for database "${database}"`,
            database,
            removed: count,
            activeSchedules: listSchedules(),
          };
        }

        // Create / update schedule
        const entry = createSchedule({ database, provider, intervalHours }, client);

        return {
          success: true,
          scheduleId: entry.scheduleId,
          status: entry.status,
          database: entry.database,
          provider: entry.provider,
          intervalHours: entry.intervalHours,
          nextRun: entry.nextRun,
          message: `Backup scheduled: "${database}" every ${intervalHours}h to ${provider}`,
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          success: false,
          error: message,
          hint: 'Check that the database name and provider are valid.',
        };
      }
    },
  );
}
