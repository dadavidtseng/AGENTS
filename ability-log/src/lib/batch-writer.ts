/**
 * Batch writer for ability-log.
 *
 * Accumulates log entries and system events in memory, flushes to ArcadeDB
 * periodically (every 5s) or when buffer hits threshold (50 entries).
 * Fire-and-forget — flush failures are logged but never propagate.
 */

import type { ArcadeClient } from './arcade-client.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LogEntry {
  agentId: string;
  agentRole: string;
  level: string;
  module: string;
  message: string;
  networkId: string;
  source: string;
  timestamp: string;
}

export interface SystemEvent {
  type: string;
  agentId?: string;
  data: string; // JSON stringified
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Batch Writer
// ---------------------------------------------------------------------------

const FLUSH_INTERVAL_MS = 5_000;
const FLUSH_THRESHOLD = 50;

export class BatchWriter {
  private logBuffer: LogEntry[] = [];
  private eventBuffer: SystemEvent[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private flushing = false;

  constructor(private readonly db: ArcadeClient) {}

  /** Start the periodic flush timer. */
  start(): void {
    if (this.flushTimer) return;
    this.flushTimer = setInterval(() => this.flush(), FLUSH_INTERVAL_MS);
  }

  /** Stop the flush timer and do a final flush. */
  async stop(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    await this.flush();
  }

  /** Queue a log entry. Triggers flush if threshold reached. */
  pushLog(entry: LogEntry): void {
    this.logBuffer.push(entry);
    if (this.logBuffer.length + this.eventBuffer.length >= FLUSH_THRESHOLD) {
      this.flush();
    }
  }

  /** Queue a system event. Triggers flush if threshold reached. */
  pushEvent(entry: SystemEvent): void {
    this.eventBuffer.push(entry);
    if (this.logBuffer.length + this.eventBuffer.length >= FLUSH_THRESHOLD) {
      this.flush();
    }
  }

  /** Flush all buffered entries to ArcadeDB. Fire-and-forget. */
  private async flush(): Promise<void> {
    if (this.flushing) return;
    if (this.logBuffer.length === 0 && this.eventBuffer.length === 0) return;

    this.flushing = true;
    const logs = this.logBuffer.splice(0);
    const events = this.eventBuffer.splice(0);

    try {
      // Batch insert logs
      for (const entry of logs) {
        const sql = `INSERT INTO LogEntry SET agentId = :agentId, agentRole = :agentRole, level = :level, module = :module, message = :message, networkId = :networkId, source = :source, timestamp = :timestamp`;
        await this.db.command(sql, {
          agentId: entry.agentId,
          agentRole: entry.agentRole,
          level: entry.level,
          module: entry.module,
          message: entry.message,
          networkId: entry.networkId,
          source: entry.source,
          timestamp: entry.timestamp,
        });
      }

      // Batch insert events
      for (const entry of events) {
        const sql = `INSERT INTO SystemEvent SET type = :type, agentId = :agentId, data = :data, timestamp = :timestamp`;
        await this.db.command(sql, {
          type: entry.type,
          agentId: entry.agentId ?? '',
          data: entry.data,
          timestamp: entry.timestamp,
        });
      }
    } catch (err) {
      // Fire-and-forget: log the error, don't propagate
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[ability-log] Flush failed (${logs.length} logs, ${events.length} events): ${msg}`);
    } finally {
      this.flushing = false;
    }
  }
}
