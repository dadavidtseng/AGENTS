/**
 * WebSocket Service
 *
 * Dedicated WebSocket client with auto-reconnect (exponential backoff)
 * and typed event subscription system. Matches the server-side WsMessage format:
 * { event: string, data: unknown, timestamp?: string }
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Event names matching server-side WsEventName. */
export type WsEventName =
  | 'quest.created'
  | 'quest.updated'
  | 'task.assigned'
  | 'task.completed'
  | 'approval.requested';

/** Wire format matching server-side WsMessage. */
export interface WsMessage {
  event: string;
  data: unknown;
  timestamp?: string;
}

export type WsEventHandler = (data: unknown, message: WsMessage) => void;

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected';

export type StatusChangeHandler = (status: ConnectionStatus) => void;

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface WebSocketServiceOptions {
  /** WebSocket server URL. Defaults to ws://localhost:8888/ws */
  url?: string;
  /** Maximum reconnect attempts before giving up. Defaults to Infinity. */
  maxReconnectAttempts?: number;
  /** Initial reconnect delay in ms. Defaults to 1000. */
  initialReconnectDelay?: number;
  /** Maximum reconnect delay in ms (backoff cap). Defaults to 30000. */
  maxReconnectDelay?: number;
  /** Backoff multiplier. Defaults to 2. */
  backoffMultiplier?: number;
}

const DEFAULTS: Required<WebSocketServiceOptions> = {
  url: 'ws://localhost:8888/ws',
  maxReconnectAttempts: Infinity,
  initialReconnectDelay: 1_000,
  maxReconnectDelay: 30_000,
  backoffMultiplier: 2,
};

// ---------------------------------------------------------------------------
// WebSocketService
// ---------------------------------------------------------------------------

export class WebSocketService {
  private ws: WebSocket | null = null;
  private options: Required<WebSocketServiceOptions>;
  private listeners = new Map<string, Set<WsEventHandler>>();
  private statusListeners = new Set<StatusChangeHandler>();
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _status: ConnectionStatus = 'disconnected';
  private intentionalClose = false;

  constructor(options?: WebSocketServiceOptions) {
    this.options = { ...DEFAULTS, ...options };
  }

  // -------------------------------------------------------------------------
  // Connection lifecycle
  // -------------------------------------------------------------------------

  /** Open a WebSocket connection. Idempotent — does nothing if already connected. */
  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN || this.ws?.readyState === WebSocket.CONNECTING) {
      return;
    }

    this.intentionalClose = false;
    this.setStatus('connecting');

    try {
      this.ws = new WebSocket(this.options.url);
    } catch (err) {
      console.error('[ws-service] Failed to create WebSocket:', err);
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      console.log('[ws-service] Connected to', this.options.url);
      this.reconnectAttempts = 0;
      this.setStatus('connected');
    };

    this.ws.onmessage = (event: MessageEvent) => {
      this.handleMessage(event);
    };

    this.ws.onclose = (event: CloseEvent) => {
      console.log(`[ws-service] Disconnected (code=${event.code}, reason=${event.reason || 'none'})`);
      this.setStatus('disconnected');
      if (!this.intentionalClose) {
        this.scheduleReconnect();
      }
    };

    this.ws.onerror = (event: Event) => {
      console.error('[ws-service] WebSocket error:', event);
      // onclose will fire after onerror, which triggers reconnect
    };
  }

  /** Close the WebSocket connection. Does not auto-reconnect. */
  disconnect(): void {
    this.intentionalClose = true;
    this.cancelReconnect();
    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }
    this.setStatus('disconnected');
  }

  /** Current connection status. */
  get status(): ConnectionStatus {
    return this._status;
  }

  // -------------------------------------------------------------------------
  // Event subscription
  // -------------------------------------------------------------------------

  /**
   * Subscribe to a specific event.
   * @returns Unsubscribe function for convenience.
   */
  subscribe(event: WsEventName | string, handler: WsEventHandler): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler);

    // Return unsubscribe function
    return () => this.unsubscribe(event, handler);
  }

  /** Unsubscribe a specific handler from an event. */
  unsubscribe(event: string, handler: WsEventHandler): void {
    const handlers = this.listeners.get(event);
    if (handlers) {
      handlers.delete(handler);
      if (handlers.size === 0) {
        this.listeners.delete(event);
      }
    }
  }

  /** Unsubscribe all handlers for a specific event, or all events if no event specified. */
  unsubscribeAll(event?: string): void {
    if (event) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
  }

  /** Subscribe to connection status changes. */
  onStatusChange(handler: StatusChangeHandler): () => void {
    this.statusListeners.add(handler);
    return () => this.statusListeners.delete(handler);
  }

  // -------------------------------------------------------------------------
  // Send messages to server
  // -------------------------------------------------------------------------

  /** Send a JSON message to the server. */
  send(event: string, data?: unknown): void {
    if (this.ws?.readyState !== WebSocket.OPEN) {
      console.warn('[ws-service] Cannot send — not connected');
      return;
    }
    this.ws.send(JSON.stringify({ event, data }));
  }

  /** Send a ping to the server. */
  ping(): void {
    this.send('ping');
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  private handleMessage(event: MessageEvent): void {
    let message: WsMessage;
    try {
      message = JSON.parse(event.data as string);
    } catch {
      console.warn('[ws-service] Received non-JSON message, ignoring');
      return;
    }

    const handlers = this.listeners.get(message.event);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(message.data, message);
        } catch (err) {
          console.error(`[ws-service] Handler error for "${message.event}":`, err);
        }
      }
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.options.maxReconnectAttempts) {
      console.warn('[ws-service] Max reconnect attempts reached, giving up');
      return;
    }

    const delay = Math.min(
      this.options.initialReconnectDelay * Math.pow(this.options.backoffMultiplier, this.reconnectAttempts),
      this.options.maxReconnectDelay,
    );

    this.reconnectAttempts++;
    console.log(`[ws-service] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})…`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private cancelReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private setStatus(status: ConnectionStatus): void {
    if (this._status !== status) {
      this._status = status;
      for (const handler of this.statusListeners) {
        try {
          handler(status);
        } catch (err) {
          console.error('[ws-service] Status handler error:', err);
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton instance
// ---------------------------------------------------------------------------

/** Default WebSocketService instance for the application. */
export const wsService = new WebSocketService();
