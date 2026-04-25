/**
 * Log Streaming Route — SSE endpoint for per-agent log events.
 *
 * GET /api/agents/:agentId/logs?tail=100&follow=true&level=info
 *
 * Sources:
 *  - Broker observer SSE (agent lifecycle events)
 *  - Server-side event buffer (captures events from observer + WebSocket)
 *
 * The server maintains a ring buffer per agent. On connect, the endpoint
 * sends the last `tail` entries, then streams new events if `follow=true`.
 *
 * Environment:
 *  - Uses the same KADI_BROKER_URL and OBSERVER_PASSWORD as the observer proxy
 */

import { Router, type Request, type Response } from 'express';
import { cfg, secrets, getBrokerUrls, abilityLog } from '../kadi-agent.js';

export const logRoutes = Router();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  id: number;
  agentId: string;
  level: LogLevel;
  message: string;
  timestamp: string;
  source: 'observer' | 'websocket' | 'system' | 'broker';
}

// ---------------------------------------------------------------------------
// Ring buffer — server-side event store
// ---------------------------------------------------------------------------

const MAX_ENTRIES_PER_AGENT = 500;
let entryCounter = 0;

/** agentId → LogEntry[] (oldest first) */
const buffer = new Map<string, LogEntry[]>();

/** Listeners waiting for new entries (agentId → callbacks) */
const followers = new Map<string, Set<(entry: LogEntry) => void>>();

export function pushEntry(agentId: string, level: LogLevel, message: string, source: LogEntry['source'] = 'observer') {
  const entry: LogEntry = {
    id: ++entryCounter,
    agentId,
    level,
    message,
    timestamp: new Date().toISOString(),
    source,
  };

  const entries = buffer.get(agentId) ?? [];
  entries.push(entry);
  if (entries.length > MAX_ENTRIES_PER_AGENT) entries.splice(0, entries.length - MAX_ENTRIES_PER_AGENT);
  buffer.set(agentId, entries);

  // Notify followers
  const cbs = followers.get(agentId);
  if (cbs) {
    for (const cb of cbs) cb(entry);
  }
}

function getEntries(agentId: string, tail: number, level?: LogLevel): LogEntry[] {
  const entries = buffer.get(agentId) ?? [];
  const filtered = level ? entries.filter((e) => LOG_LEVEL_PRIORITY[e.level] >= LOG_LEVEL_PRIORITY[level]) : entries;
  return filtered.slice(-tail);
}

function addFollower(agentId: string, cb: (entry: LogEntry) => void): () => void {
  let cbs = followers.get(agentId);
  if (!cbs) {
    cbs = new Set();
    followers.set(agentId, cbs);
  }
  cbs.add(cb);
  return () => {
    cbs!.delete(cb);
    if (cbs!.size === 0) followers.delete(agentId);
  };
}

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

// ---------------------------------------------------------------------------
// Observer SSE subscription — feeds the buffer
// ---------------------------------------------------------------------------

let observerSubscribed = false;

function getBrokerHttpBase(): string {
  const brokers = getBrokerUrls();
  const wsUrl = brokers[0]?.url ?? 'ws://localhost:8080/kadi';
  return wsUrl
    .replace(/^wss:/, 'https:')
    .replace(/^ws:/, 'http:')
    .replace(/\/(mcp|kadi)\/?$/, '');
}

/**
 * Subscribe to the broker observer SSE and feed events into the ring buffer.
 * Reconnects automatically on disconnect.
 */
export function startLogCapture(): void {
  if (observerSubscribed) return;
  observerSubscribed = true;
  connectObserver();
}

async function connectObserver(): Promise<void> {
  const brokerBase = getBrokerHttpBase();
  const observerUrl = `${brokerBase}/api/admin/observer`;
  const password = secrets['OBSERVER_PASSWORD'] ?? '';

  try {
    const headers: Record<string, string> = {};
    if (password) headers['X-Observer-Password'] = password;

    const res = await fetch(observerUrl, { headers });
    if (!res.ok || !res.body) {
      console.warn(`[log-capture] Observer returned ${res.status}, retrying in 10s`);
      setTimeout(connectObserver, 10_000);
      return;
    }

    console.log('[log-capture] Connected to broker observer SSE');

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let partial = '';

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      partial += decoder.decode(value, { stream: true });
      const lines = partial.split('\n');
      partial = lines.pop() ?? '';

      let currentEvent = '';
      let currentData = '';

      for (const line of lines) {
        if (line.startsWith('event:')) {
          currentEvent = line.slice(6).trim();
        } else if (line.startsWith('data:')) {
          currentData += line.slice(5).trim();
        } else if (line.trim() === '' && currentEvent && currentData) {
          processObserverEvent(currentEvent, currentData);
          currentEvent = '';
          currentData = '';
        }
      }
    }

    console.warn('[log-capture] Observer stream ended, reconnecting in 5s');
    setTimeout(connectObserver, 5_000);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[log-capture] Observer connection failed: ${msg}, retrying in 10s`);
    setTimeout(connectObserver, 10_000);
  }
}

/** Previous agent statuses for diff detection */
const prevStatus = new Map<string, string>();

function processObserverEvent(event: string, dataStr: string): void {
  try {
    const data = JSON.parse(dataStr);

    switch (event) {
      case 'broker.snapshot': {
        const agents = data.agents ?? [];
        for (const agent of agents) {
          const id = agent.id ?? '';
          const status = agent.status ?? 'unknown';
          const prev = prevStatus.get(id);

          if (!prev) {
            // First time seeing this agent
            pushEntry(id, 'info', `Agent ${agent.name ?? id} seen (${status})`, 'observer');
          } else if (prev !== status) {
            const level: LogLevel = status === 'active' ? 'info' : 'warn';
            pushEntry(id, level, `Status changed: ${prev} → ${status}`, 'observer');
          }
          prevStatus.set(id, status);
        }
        break;
      }
      case 'broker.agentConnected':
        if (data.id) pushEntry(data.id, 'info', 'Agent connected', 'observer');
        break;
      case 'broker.agentRegistered': {
        const toolCount = Array.isArray(data.tools) ? data.tools.length : 0;
        if (data.id) pushEntry(data.id, 'info', `Registered ${toolCount} tools`, 'observer');
        break;
      }
      case 'broker.agentDisconnected': {
        const id = data.id ?? data.sessionId;
        if (id) pushEntry(id, 'warn', 'Agent disconnected', 'observer');
        break;
      }
    }
  } catch {
    // Ignore parse errors
  }
}

// ---------------------------------------------------------------------------
// SSE endpoint
// ---------------------------------------------------------------------------

/**
 * GET /api/agents/:agentId/logs
 *
 * Query params:
 *  - format: "json" for paginated DB query, omit for SSE stream (default)
 *  - tail: number of historical entries (default 100)
 *  - follow: "true" to keep connection open for live streaming (default "true")
 *  - level: minimum log level filter (debug|info|warn|error)
 *  - after: ISO timestamp — return entries after this time (json format only)
 *  - limit: max results for json format (default 100, max 500)
 */
logRoutes.get('/:agentId/logs', async (req: Request, res: Response) => {
  const agentId = String(req.params.agentId);
  const format = String(req.query.format ?? 'sse');

  // JSON format — query ArcadeDB via ability-log
  if (format === 'json') {
    if (!abilityLog) {
      res.status(503).json({ error: 'ability-log not available — log persistence disabled' });
      return;
    }

    const params: Record<string, unknown> = { agentId };
    if (req.query.level) params.level = String(req.query.level);
    if (req.query.after) params.after = String(req.query.after);
    if (req.query.limit) params.limit = Math.min(parseInt(String(req.query.limit), 10) || 100, 500);

    try {
      const result = await abilityLog.invoke('log_query', params);
      const data = typeof result === 'string' ? JSON.parse(result) : result;
      res.json({
        entries: data.entries ?? [],
        count: data.count ?? 0,
        hasMore: (data.count ?? 0) >= (params.limit ?? 100),
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message ?? 'Failed to query logs' });
    }
    return;
  }

  // SSE format (default) — ArcadeDB primary, ring buffer for observer events
  const tail = Math.min(parseInt(String(req.query.tail ?? '200')), MAX_ENTRIES_PER_AGENT);
  const follow = String(req.query.follow ?? 'true') !== 'false';
  const levelParam = req.query.level ? String(req.query.level) : undefined;
  const level = levelParam as LogLevel | undefined;

  // Validate level
  if (level && !LOG_LEVEL_PRIORITY[level]) {
    res.status(400).json({ error: `Invalid level: ${level}. Use debug|info|warn|error` });
    return;
  }

  // SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  let closed = false;
  let lastTimestamp = '';

  // --- Phase 1: Send historical entries ---
  // Try ArcadeDB first, fall back to ring buffer
  if (abilityLog) {
    try {
      const params: Record<string, unknown> = { agentId, limit: tail };
      if (level) params.level = level;
      const result = await Promise.race([
        abilityLog.invoke('log_query', params),
        new Promise((_, reject) => setTimeout(() => reject(new Error('ArcadeDB query timeout (5s)')), 5000)),
      ]);
      const data = typeof result === 'string' ? JSON.parse(result) : result;
      const entries: any[] = (data as any).entries ?? [];

      // log_query returns newest-first (ORDER BY timestamp DESC) — reverse for chronological SSE
      entries.reverse();

      for (const entry of entries) {
        const logEntry: LogEntry = {
          id: ++entryCounter,
          agentId: entry.agentId ?? agentId,
          level: entry.level ?? 'info',
          message: entry.module ? `[${entry.module}] ${entry.message}` : (entry.message ?? ''),
          timestamp: entry.timestamp ?? '',
          source: entry.source ?? 'agent',
        };
        res.write(`event: log\ndata: ${JSON.stringify(logEntry)}\n\n`);
        if (entry.timestamp && entry.timestamp > lastTimestamp) {
          lastTimestamp = entry.timestamp;
        }
      }

      res.write(`event: history-end\ndata: ${JSON.stringify({ count: entries.length, source: 'arcadedb' })}\n\n`);
    } catch (err: any) {
      console.warn(`[logs] ArcadeDB history query failed: ${err.message}, falling back to ring buffer`);
      sendRingBufferHistory();
    }
  } else {
    sendRingBufferHistory();
  }

  function sendRingBufferHistory() {
    const history = getEntries(agentId, tail, level);
    for (const entry of history) {
      res.write(`event: log\ndata: ${JSON.stringify(entry)}\n\n`);
      if (entry.timestamp > lastTimestamp) lastTimestamp = entry.timestamp;
    }
    res.write(`event: history-end\ndata: ${JSON.stringify({ count: history.length, source: 'ringbuffer' })}\n\n`);
  }

  if (!follow) {
    res.end();
    return;
  }

  // --- Phase 2: Follow mode ---
  // Poll ArcadeDB every 2s for new agent log entries
  // + ring buffer follower for observer events (connect/disconnect)

  const minPriority = level ? LOG_LEVEL_PRIORITY[level] : 0;

  // Ring buffer follower — catches observer events that don't go through ArcadeDB
  const removeFollower = addFollower(agentId, (entry) => {
    if (closed) return;
    if (LOG_LEVEL_PRIORITY[entry.level] >= minPriority) {
      res.write(`event: log\ndata: ${JSON.stringify(entry)}\n\n`);
    }
  });

  // ArcadeDB poller — catches agent log entries written via ability-log
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  if (abilityLog) {
    if (!lastTimestamp) {
      lastTimestamp = new Date().toISOString();
    }

    pollTimer = setInterval(async () => {
      if (closed) return;
      try {
        const params: Record<string, unknown> = {
          agentId,
          after: lastTimestamp,
          limit: 100,
        };
        if (level) params.level = level;

        const result = await Promise.race([
          abilityLog!.invoke('log_query', params),
          new Promise((_, reject) => setTimeout(() => reject(new Error('poll timeout')), 5000)),
        ]);
        const data = typeof result === 'string' ? JSON.parse(result) : result;
        const entries: any[] = (data as any).entries ?? [];

        // log_query returns newest-first — reverse for chronological streaming
        entries.reverse();

        for (const entry of entries) {
          if (closed) break;
          const logEntry: LogEntry = {
            id: ++entryCounter,
            agentId: entry.agentId ?? agentId,
            level: entry.level ?? 'info',
            message: entry.module ? `[${entry.module}] ${entry.message}` : (entry.message ?? ''),
            timestamp: entry.timestamp ?? '',
            source: entry.source ?? 'agent',
          };
          if (LOG_LEVEL_PRIORITY[logEntry.level] >= minPriority) {
            res.write(`event: log\ndata: ${JSON.stringify(logEntry)}\n\n`);
          }
          if (entry.timestamp && entry.timestamp > lastTimestamp) {
            lastTimestamp = entry.timestamp;
          }
        }
      } catch {
        // Silently skip poll failures — next poll will retry
      }
    }, 2000);
  }
  // Keepalive ping every 30s
  const keepalive = setInterval(() => {
    if (!closed) res.write(': keepalive\n\n');
  }, 30_000);

  req.on('close', () => {
    closed = true;
    removeFollower();
    if (pollTimer) clearInterval(pollTimer);
    clearInterval(keepalive);
  });
});

