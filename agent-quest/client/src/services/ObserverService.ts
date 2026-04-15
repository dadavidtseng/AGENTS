/**
 * ObserverService — SSE client for kadi-broker observer endpoint.
 *
 * Connects to the broker's /api/admin/observer SSE stream (proxied through
 * Express at /api/observer) and maintains typed state for agents, networks,
 * tools, and connections.
 *
 * Features:
 *  - Manual SSE parsing via Fetch ReadableStream (supports auth headers)
 *  - Typed snapshot state with incremental updates
 *  - Exponential backoff reconnection
 *  - Event subscription system for React hooks
 *
 * Reference: kadi-observer-website/network.html (SSE pattern)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ObserverConnectionStatus = 'disconnected' | 'connecting' | 'connected';

/** Per-tool entry with optional network scoping. */
export interface ObserverTool {
  name: string;
  networks: string[];
}

export interface ObserverAgent {
  id: string;
  name: string;
  type: string;
  /** Normalized — always ObserverTool[] (broker may send mixed string | object). */
  tools: ObserverTool[];
  /** Combined networks from all brokers. */
  networks: string[];
  status: 'active' | 'disconnected';
  /** Broker name (for multi-broker support). */
  brokerName?: string;
  /** All brokers this agent is connected to (for multi-broker support). */
  brokerNames?: string[];
  /** Per-broker network mapping: brokerName -> networks on that broker. */
  brokerNetworkMap?: Record<string, string[]>;
}

export interface ObserverNetwork {
  id: string;
  name: string;
  type: string;
  status: string;
}

export interface ObserverConnection {
  from: string;
  to: string;
  status: 'connected' | 'disconnected';
}

export interface ObserverSnapshot {
  agents: ObserverAgent[];
  networks: ObserverNetwork[];
  connections: ObserverConnection[];
  timestamp: string | null;
}

/** SSE event names from the broker. */
export type ObserverEventName =
  | 'broker.snapshot'
  | 'broker.agentConnected'
  | 'broker.agentRegistered'
  | 'broker.agentDisconnected';

export type ObserverEventHandler = (snapshot: ObserverSnapshot) => void;
export type StatusChangeHandler = (status: ObserverConnectionStatus) => void;

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface ObserverServiceOptions {
  /** SSE endpoint URL. Defaults to /api/observer */
  url?: string;
  /** Observer password for X-Observer-Password header */
  password?: string;
  /** Max reconnect attempts. Defaults to Infinity. */
  maxReconnectAttempts?: number;
  /** Initial reconnect delay in ms. Defaults to 2000. */
  initialReconnectDelay?: number;
  /** Max reconnect delay in ms. Defaults to 30000. */
  maxReconnectDelay?: number;
  /** Backoff multiplier. Defaults to 2. */
  backoffMultiplier?: number;
}

const DEFAULTS: Required<ObserverServiceOptions> = {
  url: '/api/observer',
  password: '',
  maxReconnectAttempts: Infinity,
  initialReconnectDelay: 2_000,
  maxReconnectDelay: 30_000,
  backoffMultiplier: 2,
};

// ---------------------------------------------------------------------------
// Normalizers — broker sends tools as mixed string | {name, networks}
// ---------------------------------------------------------------------------

function normalizeTool(raw: unknown): ObserverTool {
  if (typeof raw === 'string') return { name: raw, networks: [] };
  if (raw && typeof raw === 'object' && 'name' in raw) {
    const obj = raw as { name: string; networks?: string[] };
    return { name: obj.name, networks: obj.networks ?? [] };
  }
  return { name: String(raw), networks: [] };
}

function normalizeAgent(raw: Record<string, unknown>): ObserverAgent {
  const tools = Array.isArray(raw.tools) ? raw.tools.map(normalizeTool) : [];
  return {
    id: String(raw.id ?? ''),
    name: String(raw.name ?? ''),
    type: String(raw.type ?? ''),
    tools,
    networks: Array.isArray(raw.networks) ? raw.networks.map(String) : [],
    status: raw.status === 'active' ? 'active' : 'disconnected',
    brokerName: raw.brokerName ? String(raw.brokerName) : undefined,
  };
}

// ---------------------------------------------------------------------------
// Empty snapshot
// ---------------------------------------------------------------------------

const EMPTY_SNAPSHOT: ObserverSnapshot = {
  agents: [],
  networks: [],
  connections: [],
  timestamp: null,
};

// ---------------------------------------------------------------------------
// ObserverService
// ---------------------------------------------------------------------------

export class ObserverService {
  private options: Required<ObserverServiceOptions>;
  private abortController: AbortController | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionalClose = false;

  private _status: ObserverConnectionStatus = 'disconnected';
  private _snapshot: ObserverSnapshot = { ...EMPTY_SNAPSHOT };
  /** Per-broker agent store for multi-broker merging: brokerName -> agentName -> agent */
  private _brokerAgents?: Map<string, Map<string, ObserverAgent>>;

  private snapshotListeners = new Set<ObserverEventHandler>();
  private statusListeners = new Set<StatusChangeHandler>();

  constructor(options?: ObserverServiceOptions) {
    this.options = { ...DEFAULTS, ...options };
  }

  // -------------------------------------------------------------------------
  // Connection lifecycle
  // -------------------------------------------------------------------------

  /** Open SSE connection. Idempotent. */
  connect(): void {
    if (this._status === 'connecting' || this._status === 'connected') return;

    this.intentionalClose = false;
    this.setStatus('connecting');
    this.startStream();
  }

  /** Close SSE connection. Does not auto-reconnect. */
  disconnect(): void {
    this.intentionalClose = true;
    this.cancelReconnect();

    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    if (this.reader) {
      this.reader.cancel().catch(() => {});
      this.reader = null;
    }

    this._snapshot = { ...EMPTY_SNAPSHOT };
    this._brokerAgents = undefined;
    this.setStatus('disconnected');
  }

  get status(): ObserverConnectionStatus {
    return this._status;
  }

  get snapshot(): ObserverSnapshot {
    return this._snapshot;
  }

  // -------------------------------------------------------------------------
  // Subscriptions
  // -------------------------------------------------------------------------

  /** Subscribe to snapshot changes. Returns unsubscribe function. */
  onSnapshot(handler: ObserverEventHandler): () => void {
    this.snapshotListeners.add(handler);
    return () => this.snapshotListeners.delete(handler);
  }

  /** Subscribe to connection status changes. Returns unsubscribe function. */
  onStatusChange(handler: StatusChangeHandler): () => void {
    this.statusListeners.add(handler);
    return () => this.statusListeners.delete(handler);
  }

  // -------------------------------------------------------------------------
  // SSE stream
  // -------------------------------------------------------------------------

  private async startStream(): Promise<void> {
    try {
      this.abortController = new AbortController();

      const headers: Record<string, string> = {};
      if (this.options.password) {
        headers['X-Observer-Password'] = this.options.password;
      }

      const response = await fetch(this.options.url, {
        headers,
        signal: this.abortController.signal,
      });

      if (!response.ok) {
        if (response.status === 401) {
          console.error('[observer] Authentication failed — check observer password');
        }
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      console.log(`[observer] SSE response: ${response.status}, content-type: ${response.headers.get('content-type')}`);

      if (!response.body) {
        throw new Error('Response body is null — SSE not supported');
      }

      this.reconnectAttempts = 0;
      this.setStatus('connected');

      this.reader = response.body.getReader();
      await this.processStream(this.reader);
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return;
      console.error('[observer] Stream error:', err);
      this.handleDisconnect();
    }
  }

  private async processStream(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
    const decoder = new TextDecoder();
    let buffer = '';
    let currentEvent: string | null = null;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          console.log('[observer] SSE stream ended');
          this.handleDisconnect();
          return;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith('data: ') && currentEvent) {
            try {
              const data = JSON.parse(line.slice(6));
              console.log(`[observer] Received event: ${currentEvent}, agents: ${data.agents?.length ?? '?'}, networks: ${data.networks?.length ?? '?'}`);
              this.handleEvent(currentEvent, data);
            } catch {
              console.warn('[observer] Failed to parse event data');
            }
            currentEvent = null;
          }
          // Ignore keepalive comments (lines starting with :)
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return;
      console.error('[observer] Read error:', err);
      this.handleDisconnect();
    }
  }

  // -------------------------------------------------------------------------
  // Event handling
  // -------------------------------------------------------------------------

  private handleEvent(event: string, data: unknown): void {
    switch (event) {
      case 'broker.snapshot':
        this.handleSnapshot(data);
        break;
      case 'broker.agentConnected':
        this.handleAgentConnected(data);
        break;
      case 'broker.agentRegistered':
        this.handleAgentRegistered(data);
        break;
      case 'broker.agentDisconnected':
        this.handleAgentDisconnected(data);
        break;
      default:
        console.log('[observer] Unknown event:', event);
    }
  }

  private handleSnapshot(data: unknown): void {
    const d = data as {
      agents?: Array<Record<string, unknown>>;
      networks?: ObserverNetwork[];
      connections?: ObserverConnection[];
      timestamp?: string;
      brokerName?: string;
    };

    const incomingAgents = (d.agents ?? []).map(normalizeAgent);
    const brokerName = d.brokerName;

    if (brokerName) {
      // Multi-broker mode: merge by agent NAME (not ID).
      // The same logical agent gets a different session-ID per broker,
      // so we use `name` as the dedup key.

      // --- per-broker raw store: keep every session separately first ---
      // _brokerAgents tracks { brokerName -> agentName -> ObserverAgent }
      if (!this._brokerAgents) {
        this._brokerAgents = new Map();
      }

      // Replace all agents from this broker with the incoming set
      const brokerMap = new Map<string, ObserverAgent>();
      for (const agent of incomingAgents) {
        agent.brokerName = brokerName;
        brokerMap.set(agent.name, agent);
      }
      this._brokerAgents.set(brokerName, brokerMap);

      // --- rebuild merged agent list from all broker stores ---
      const mergedMap = new Map<string, ObserverAgent>();

      for (const [bName, agents] of this._brokerAgents.entries()) {
        for (const [agentName, agent] of agents.entries()) {
          const existing = mergedMap.get(agentName);
          if (existing) {
            // Merge: combine networks, tools, brokerNames
            const networkSet = new Set([...existing.networks, ...agent.networks]);
            existing.networks = Array.from(networkSet);

            // Merge tools by name
            const toolMap = new Map(existing.tools.map(t => [t.name, t]));
            for (const tool of agent.tools) {
              if (!toolMap.has(tool.name)) {
                toolMap.set(tool.name, tool);
              }
            }
            existing.tools = Array.from(toolMap.values());

            // Track all brokers
            const brokerSet = new Set(existing.brokerNames || []);
            brokerSet.add(bName);
            existing.brokerNames = Array.from(brokerSet);

            // Track per-broker networks
            existing.brokerNetworkMap = existing.brokerNetworkMap || {};
            existing.brokerNetworkMap[bName] = [...agent.networks];

            // Keep active status if any session is active
            if (agent.status === 'active') {
              existing.status = 'active';
            }
          } else {
            // First occurrence of this agent
            mergedMap.set(agentName, {
              ...agent,
              brokerName: bName,
              brokerNames: [bName],
              brokerNetworkMap: { [bName]: [...agent.networks] },
            });
          }
        }
      }

      this._snapshot.agents = Array.from(mergedMap.values());

      // Merge networks (deduplicate by name)
      const networkMap = new Map(this._snapshot.networks.map(n => [n.name, n]));
      for (const network of d.networks ?? []) {
        networkMap.set(network.name, network);
      }
      this._snapshot.networks = Array.from(networkMap.values());

      // Merge connections (deduplicate by from+to)
      const connMap = new Map(this._snapshot.connections.map(c => [`${c.from}-${c.to}`, c]));
      for (const conn of d.connections ?? []) {
        connMap.set(`${conn.from}-${conn.to}`, conn);
      }
      this._snapshot.connections = Array.from(connMap.values());
      this._snapshot.connections = Array.from(connMap.values());
    } else {
      // Single-broker mode: replace entire snapshot
      this._snapshot = {
        agents: incomingAgents,
        networks: d.networks ?? [],
        connections: d.connections ?? [],
        timestamp: d.timestamp ?? new Date().toISOString(),
      };
    }

    this._snapshot.timestamp = d.timestamp ?? new Date().toISOString();
    this.notifySnapshot();
  }

  private handleAgentConnected(data: unknown): void {
    const d = data as { id: string; timestamp?: string };
    const existing = this._snapshot.agents.find((a) => a.id === d.id);

    if (existing) {
      existing.status = 'active';
    } else {
      this._snapshot.agents.push({
        id: d.id,
        name: d.id,
        type: 'agent',
        tools: [],
        networks: [],
        status: 'active',
      });
    }

    this._snapshot.timestamp = d.timestamp ?? new Date().toISOString();
    this.notifySnapshot();
  }

  private handleAgentRegistered(data: unknown): void {
    const d = data as {
      id: string;
      displayName?: string;
      tools?: unknown[];
      networks?: string[];
      timestamp?: string;
    };

    const tools = (d.tools ?? []).map(normalizeTool);

    const idx = this._snapshot.agents.findIndex((a) => a.id === d.id);
    const agent: ObserverAgent = {
      id: d.id,
      name: d.displayName ?? d.id,
      type: 'agent',
      tools,
      networks: d.networks ?? [],
      status: 'active',
    };

    if (idx >= 0) {
      this._snapshot.agents[idx] = agent;
    } else {
      this._snapshot.agents.push(agent);
    }

    this._snapshot.timestamp = d.timestamp ?? new Date().toISOString();
    this.notifySnapshot();
  }

  private handleAgentDisconnected(data: unknown): void {
    const d = data as { id?: string; sessionId?: string; timestamp?: string };
    const agentId = d.id ?? d.sessionId;

    if (agentId) {
      const agent = this._snapshot.agents.find((a) => a.id === agentId);
      if (agent) {
        agent.status = 'disconnected';
      }
    }

    this._snapshot.timestamp = d.timestamp ?? new Date().toISOString();
    this.notifySnapshot();
  }

  // -------------------------------------------------------------------------
  // Reconnection
  // -------------------------------------------------------------------------

  private handleDisconnect(): void {
    this.reader = null;
    this.abortController = null;
    this.setStatus('disconnected');

    if (!this.intentionalClose) {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.options.maxReconnectAttempts) {
      console.warn('[observer] Max reconnect attempts reached');
      return;
    }

    const delay = Math.min(
      this.options.initialReconnectDelay * Math.pow(this.options.backoffMultiplier, this.reconnectAttempts),
      this.options.maxReconnectDelay,
    );

    this.reconnectAttempts++;
    console.log(`[observer] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.setStatus('connecting');
      this.startStream();
    }, delay);
  }

  private cancelReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  private setStatus(status: ObserverConnectionStatus): void {
    if (this._status === status) return;
    this._status = status;
    for (const handler of this.statusListeners) {
      try { handler(status); } catch { /* ignore */ }
    }
  }

  private notifySnapshot(): void {
    // Shallow copy so React detects the new reference and re-renders
    const copy = { ...this._snapshot };
    for (const handler of this.snapshotListeners) {
      try { handler(copy); } catch { /* ignore */ }
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

export const observerService = new ObserverService();
