import { WebSocketServer, WebSocket, type RawData } from 'ws';
import type { Server as HttpServer, IncomingMessage } from 'http';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Supported real-time event names pushed to dashboard clients. */
export type WsEventName =
  | 'quest.created'
  | 'quest.updated'
  | 'task.assigned'
  | 'task.completed'
  | 'approval.requested';

/** Wire format for all WebSocket messages (matches client ApiClient expectation). */
export interface WsMessage {
  event: WsEventName | 'system.welcome' | 'pong' | 'error';
  data: unknown;
  timestamp?: string;
}

/** Metadata tracked per connected client. */
interface ClientInfo {
  id: string;
  connectedAt: Date;
  isAlive: boolean;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const clients = new Map<WebSocket, ClientInfo>();
let clientIdCounter = 0;

const HEARTBEAT_INTERVAL_MS = 30_000;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Attach a WebSocket server to the given HTTP server on the `/ws` path.
 * Handles connection lifecycle, heartbeat, and provides `broadcastEvent` for
 * pushing real-time events to all connected dashboard clients.
 */
export function setupWebSocket(server: HttpServer): WebSocketServer {
  const wss = new WebSocketServer({ server, path: '/ws' });

  // --- Heartbeat: detect stale connections ---
  const heartbeat = setInterval(() => {
    for (const [ws, info] of clients) {
      if (!info.isAlive) {
        console.log(`[ws] Client ${info.id} failed heartbeat, terminating`);
        ws.terminate();
        clients.delete(ws);
        continue;
      }
      info.isAlive = false;
      ws.ping();
    }
  }, HEARTBEAT_INTERVAL_MS);

  wss.on('close', () => {
    clearInterval(heartbeat);
  });

  // --- Connection handler ---
  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const id = `client-${++clientIdCounter}`;
    const info: ClientInfo = { id, connectedAt: new Date(), isAlive: true };
    clients.set(ws, info);

    const origin = req.headers.origin ?? req.socket.remoteAddress ?? 'unknown';
    console.log(`[ws] ${id} connected from ${origin} (total: ${clients.size})`);

    // Send welcome acknowledgement
    sendTo(ws, {
      event: 'system.welcome',
      data: { type: 'connected', clientId: id },
    });

    // Pong response keeps heartbeat alive
    ws.on('pong', () => {
      const c = clients.get(ws);
      if (c) c.isAlive = true;
    });

    // Handle incoming messages from client
    ws.on('message', (raw: RawData) => {
      handleClientMessage(ws, raw);
    });

    ws.on('close', (code: number, reason: Buffer) => {
      clients.delete(ws);
      console.log(
        `[ws] ${id} disconnected (code=${code}, reason=${reason.toString() || 'none'}, remaining: ${clients.size})`,
      );
    });

    ws.on('error', (err: Error) => {
      console.error(`[ws] ${id} error:`, err.message);
      clients.delete(ws);
      ws.terminate();
    });
  });

  console.log('[ws] WebSocket server attached on /ws');
  return wss;
}

// ---------------------------------------------------------------------------
// Broadcast helpers
// ---------------------------------------------------------------------------

/**
 * Broadcast a typed event to all connected clients.
 * This is the primary API for route handlers to push real-time updates.
 *
 * @example
 * ```ts
 * import { broadcastEvent } from './websocket.js';
 * broadcastEvent('quest.created', { id: 'q-1', name: 'New Quest' });
 * ```
 */
export function broadcastEvent(event: WsEventName, data: unknown): void {
  const message: WsMessage = { event, data, timestamp: new Date().toISOString() };
  broadcast(message);
}

/**
 * Broadcast an event to all connected WebSocket clients.
 * Kept as a lower-level API; prefer `broadcastEvent` for typed usage.
 */
export function broadcast(event: string, data?: unknown): void;
export function broadcast(message: WsMessage): void;
export function broadcast(eventOrMessage: string | WsMessage, data?: unknown): void {
  const message: WsMessage =
    typeof eventOrMessage === 'string'
      ? { event: eventOrMessage as WsMessage['event'], data, timestamp: new Date().toISOString() }
      : eventOrMessage;

  const payload = JSON.stringify(message);
  let sent = 0;

  for (const [ws] of clients) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(payload);
      sent++;
    }
  }

  if (sent > 0) {
    console.log(`[ws] Broadcast "${message.event}" to ${sent} client(s)`);
  }
}

/**
 * Send a message to a single client.
 */
function sendTo(ws: WebSocket, message: Omit<WsMessage, 'timestamp'> & { timestamp?: string }): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ ...message, timestamp: message.timestamp ?? new Date().toISOString() }));
  }
}

// ---------------------------------------------------------------------------
// Client message handler
// ---------------------------------------------------------------------------

/**
 * Process incoming messages from dashboard clients.
 * Currently supports:
 * - `ping` → responds with `pong`
 * - Unknown messages are logged and ignored.
 */
function handleClientMessage(ws: WebSocket, raw: RawData): void {
  const info = clients.get(ws);
  const clientId = info?.id ?? 'unknown';

  let parsed: { event?: string; data?: unknown };
  try {
    parsed = JSON.parse(raw.toString());
  } catch {
    console.warn(`[ws] ${clientId} sent invalid JSON, ignoring`);
    sendTo(ws, { event: 'error', data: { message: 'Invalid JSON' } });
    return;
  }

  switch (parsed.event) {
    case 'ping':
      sendTo(ws, { event: 'pong', data: { timestamp: new Date().toISOString() } });
      break;
    default:
      console.log(`[ws] ${clientId} sent unhandled event: ${parsed.event}`);
      break;
  }
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

/** Get the number of currently connected WebSocket clients. */
export function getConnectedClientCount(): number {
  return clients.size;
}
