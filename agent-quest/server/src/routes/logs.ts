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
  source: 'observer' | 'websocket' | 'system';
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

function pushEntry(agentId: string, level: LogLevel, message: string, source: LogEntry['source'] = 'observer') {
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
  const wsUrl = process.env.KADI_BROKER_URL ?? 'ws://localhost:8080/mcp';
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
  const password = process.env.OBSERVER_PASSWORD ?? '';

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
 *  - tail: number of historical entries (default 100)
 *  - follow: "true" to keep connection open for live streaming (default "true")
 *  - level: minimum log level filter (debug|info|warn|error)
 */
logRoutes.get('/:agentId/logs', (req: Request, res: Response) => {
  const agentId = String(req.params.agentId);
  const tail = Math.min(parseInt(String(req.query.tail ?? '100')), MAX_ENTRIES_PER_AGENT);
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

  // Send historical entries
  const history = getEntries(agentId, tail, level);
  for (const entry of history) {
    res.write(`data: ${JSON.stringify(entry)}\n\n`);
  }

  // Send a marker so the client knows history is done
  res.write(`event: history-end\ndata: ${JSON.stringify({ count: history.length })}\n\n`);

  if (!follow) {
    res.end();
    return;
  }

  // Follow mode — stream new entries
  const minPriority = level ? LOG_LEVEL_PRIORITY[level] : 0;

  const removeFollower = addFollower(agentId, (entry) => {
    if (LOG_LEVEL_PRIORITY[entry.level] >= minPriority) {
      res.write(`data: ${JSON.stringify(entry)}\n\n`);
    }
  });

  // Keepalive ping every 30s
  const keepalive = setInterval(() => {
    res.write(': keepalive\n\n');
  }, 30_000);

  req.on('close', () => {
    removeFollower();
    clearInterval(keepalive);
  });
});

