/**
 * In-memory scheduler for periodic backups.
 *
 * Uses `setInterval` — schedules do not survive agent restarts (v1).
 *
 * @module scheduler
 */

import { randomUUID } from 'crypto';
import type { KadiClient } from '@kadi.build/core';
import type { ScheduleConfig, ScheduleEntry, BackupResult } from './types.js';

// ── Internal state ────────────────────────────────────────────────────

interface InternalSchedule {
  id: string;
  config: ScheduleConfig;
  timer: ReturnType<typeof setInterval>;
  nextRun: Date;
  lastRun?: Date;
  lastResult?: BackupResult;
}

const schedules = new Map<string, InternalSchedule>();

// ── Scheduler functions ───────────────────────────────────────────────

/**
 * Create or update a backup schedule.
 *
 * If a schedule already exists for the same database, it is replaced.
 *
 * @param config   Schedule configuration
 * @param client   KadiClient for invoking `backup-database` via broker
 * @returns        The created schedule entry
 */
export function createSchedule(
  config: ScheduleConfig,
  client: KadiClient,
): ScheduleEntry {
  // Remove existing schedule for this database (if any)
  for (const [id, sched] of schedules) {
    if (sched.config.database === config.database) {
      clearInterval(sched.timer);
      schedules.delete(id);
      console.log(`[scheduler] Replaced existing schedule ${id} for database "${config.database}"`);
    }
  }

  const id = randomUUID().slice(0, 8);
  const intervalMs = config.intervalHours * 60 * 60 * 1000;
  const nextRun = new Date(Date.now() + intervalMs);

  const timer = setInterval(async () => {
    const entry = schedules.get(id);
    if (!entry) return;

    console.log(`[scheduler] Running scheduled backup for database "${config.database}"`);
    entry.lastRun = new Date();
    entry.nextRun = new Date(Date.now() + intervalMs);

    try {
      const result = await client.invokeRemote<any>('backup-database', {
        database: config.database,
        provider: config.provider,
      });
      entry.lastResult = result as BackupResult;
      console.log(
        `[scheduler] Scheduled backup ${result.success ? 'succeeded' : 'failed'}: ${config.database}`,
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      entry.lastResult = { success: false, error: message, failedAt: 'backup' };
      console.error(`[scheduler] Scheduled backup error for "${config.database}": ${message}`);
    }
  }, intervalMs);

  // Don't let the timer prevent process exit
  timer.unref();

  const entry: InternalSchedule = {
    id,
    config,
    timer,
    nextRun,
  };
  schedules.set(id, entry);

  console.log(
    `[scheduler] Created schedule ${id}: database="${config.database}" every ${config.intervalHours}h`,
  );

  return toEntry(entry);
}

/**
 * Remove a schedule by ID.
 *
 * @returns The removed schedule entry, or null if not found
 */
export function removeSchedule(scheduleId: string): ScheduleEntry | null {
  const sched = schedules.get(scheduleId);
  if (!sched) return null;

  clearInterval(sched.timer);
  schedules.delete(scheduleId);
  console.log(`[scheduler] Removed schedule ${scheduleId}`);

  return { ...toEntry(sched), status: 'removed' };
}

/**
 * Remove all schedules for a given database.
 *
 * @returns Number of schedules removed
 */
export function removeSchedulesByDatabase(database: string): number {
  let removed = 0;
  for (const [id, sched] of schedules) {
    if (sched.config.database === database) {
      clearInterval(sched.timer);
      schedules.delete(id);
      removed++;
    }
  }
  return removed;
}

/**
 * List all active schedules.
 */
export function listSchedules(): ScheduleEntry[] {
  return Array.from(schedules.values()).map(toEntry);
}

/**
 * Get schedules filtered by database name.
 */
export function getSchedulesByDatabase(database: string): ScheduleEntry[] {
  return Array.from(schedules.values())
    .filter((s) => s.config.database === database)
    .map(toEntry);
}

/**
 * Clear all schedules (for shutdown).
 */
export function clearAllSchedules(): void {
  for (const sched of schedules.values()) {
    clearInterval(sched.timer);
  }
  schedules.clear();
  console.log('[scheduler] All schedules cleared');
}

// ── Helpers ───────────────────────────────────────────────────────────

function toEntry(sched: InternalSchedule): ScheduleEntry {
  return {
    scheduleId: sched.id,
    database: sched.config.database,
    provider: sched.config.provider,
    intervalHours: sched.config.intervalHours,
    status: 'active',
    nextRun: sched.nextRun.toISOString(),
    lastRun: sched.lastRun?.toISOString(),
    lastResult: sched.lastResult,
  };
}
