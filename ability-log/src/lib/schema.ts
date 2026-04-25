/**
 * Database schema initialization for ability-log.
 *
 * Creates the `agents_logs` database (if needed) and ensures vertex types
 * + indexes exist. All statements are idempotent (IF NOT EXISTS).
 */

import type { ArcadeClient } from './arcade-client.js';

const SCHEMA_COMMANDS = [
  // --- LogEntry ---
  'CREATE VERTEX TYPE LogEntry IF NOT EXISTS',
  'CREATE PROPERTY LogEntry.agentId IF NOT EXISTS STRING',
  'CREATE PROPERTY LogEntry.agentRole IF NOT EXISTS STRING',
  'CREATE PROPERTY LogEntry.level IF NOT EXISTS STRING',
  'CREATE PROPERTY LogEntry.module IF NOT EXISTS STRING',
  'CREATE PROPERTY LogEntry.message IF NOT EXISTS STRING',
  'CREATE PROPERTY LogEntry.networkId IF NOT EXISTS STRING',
  'CREATE PROPERTY LogEntry.timestamp IF NOT EXISTS STRING',
  'CREATE PROPERTY LogEntry.source IF NOT EXISTS STRING',

  // --- SystemEvent ---
  'CREATE VERTEX TYPE SystemEvent IF NOT EXISTS',
  'CREATE PROPERTY SystemEvent.type IF NOT EXISTS STRING',
  'CREATE PROPERTY SystemEvent.agentId IF NOT EXISTS STRING',
  'CREATE PROPERTY SystemEvent.data IF NOT EXISTS STRING',
  'CREATE PROPERTY SystemEvent.timestamp IF NOT EXISTS STRING',
];

// Indexes — run separately because CREATE INDEX doesn't support IF NOT EXISTS
// in all ArcadeDB versions. We catch errors silently.
const INDEX_COMMANDS = [
  'CREATE INDEX ON LogEntry(agentId, timestamp) NOTUNIQUE',
  'CREATE INDEX ON LogEntry(timestamp) NOTUNIQUE',
  'CREATE INDEX ON SystemEvent(timestamp) NOTUNIQUE',
  'CREATE INDEX ON SystemEvent(type, timestamp) NOTUNIQUE',
];

/**
 * Ensure database + schema exist. Safe to call on every startup.
 * Returns true if schema is ready, false if ArcadeDB is unreachable.
 */
export async function ensureSchema(db: ArcadeClient): Promise<boolean> {
  // Step 1: ensure database exists
  const dbReady = await db.ensureDatabase();
  if (!dbReady) return false;

  // Step 2: create vertex types + properties (idempotent)
  for (const sql of SCHEMA_COMMANDS) {
    const res = await db.command(sql);
    if (!res.success) {
      console.error(`[ability-log] Schema command failed: ${sql} — ${res.error}`);
      return false;
    }
  }

  // Step 3: create indexes (may already exist — ignore errors)
  for (const sql of INDEX_COMMANDS) {
    await db.command(sql).catch(() => {});
  }

  return true;
}
