/**
 * ObserverContext — App-wide React context for observer SSE state.
 *
 * Provides:
 *  - Raw snapshot (agents, networks, connections)
 *  - Connection status
 *  - Derived state: active agents, tool inventory, network list, agent count
 *
 * Single subscription point — the provider connects once, all consumers
 * read from context without independent subscriptions.
 */

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useMemo,
  type ReactNode,
} from 'react';
import {
  observerService,
  type ObserverConnectionStatus,
  type ObserverSnapshot,
  type ObserverAgent,
  type ObserverNetwork,
  type ObserverConnection,
} from '../services/ObserverService';

// ---------------------------------------------------------------------------
// Derived types
// ---------------------------------------------------------------------------

export interface ToolEntry {
  name: string;
  /** Agent IDs that register this tool */
  agents: string[];
  /** Networks this tool is available on (union of owning agents' networks) */
  networks: string[];
}

export interface ObserverState {
  /** SSE connection status */
  status: ObserverConnectionStatus;
  /** Raw snapshot from broker */
  agents: ObserverAgent[];
  networks: ObserverNetwork[];
  connections: ObserverConnection[];
  timestamp: string | null;
  /** Derived: only active agents */
  activeAgents: ObserverAgent[];
  /** Derived: deduplicated tool inventory across all agents */
  tools: ToolEntry[];
  /** Derived: counts */
  agentCount: number;
  activeAgentCount: number;
  networkCount: number;
  toolCount: number;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const EMPTY_STATE: ObserverState = {
  status: 'disconnected',
  agents: [],
  networks: [],
  connections: [],
  timestamp: null,
  activeAgents: [],
  tools: [],
  agentCount: 0,
  activeAgentCount: 0,
  networkCount: 0,
  toolCount: 0,
};

const ObserverCtx = createContext<ObserverState>(EMPTY_STATE);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function ObserverProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<ObserverConnectionStatus>(observerService.status);
  const [snapshot, setSnapshot] = useState<ObserverSnapshot>(observerService.snapshot);

  useEffect(() => {
    observerService.connect();

    const unsubStatus = observerService.onStatusChange(setStatus);
    const unsubSnapshot = observerService.onSnapshot(setSnapshot);

    // Sync initial state
    setStatus(observerService.status);
    setSnapshot(observerService.snapshot);

    return () => {
      unsubStatus();
      unsubSnapshot();
      observerService.disconnect();
    };
  }, []);

  // Compute derived state
  const state = useMemo<ObserverState>(() => {
    const { agents, networks, connections, timestamp } = snapshot;

    const activeAgents = agents.filter((a) => a.status === 'active');

    // Build deduplicated tool inventory
    const toolMap = new Map<string, ToolEntry>();
    for (const agent of agents) {
      for (const tool of agent.tools) {
        // tool is ObserverTool {name, networks}
        const toolNetworks = tool.networks.length > 0 ? tool.networks : agent.networks;
        const existing = toolMap.get(tool.name);
        if (existing) {
          if (!existing.agents.includes(agent.id)) {
            existing.agents.push(agent.id);
          }
          for (const net of toolNetworks) {
            if (!existing.networks.includes(net)) {
              existing.networks.push(net);
            }
          }
        } else {
          toolMap.set(tool.name, {
            name: tool.name,
            agents: [agent.id],
            networks: [...toolNetworks],
          });
        }
      }
    }

    const tools = Array.from(toolMap.values()).sort((a, b) =>
      a.name.localeCompare(b.name),
    );

    return {
      status,
      agents,
      networks,
      connections,
      timestamp,
      activeAgents,
      tools,
      agentCount: agents.length,
      activeAgentCount: activeAgents.length,
      networkCount: networks.length,
      toolCount: tools.length,
    };
  }, [status, snapshot]);

  return (
    <ObserverCtx.Provider value={state}>
      {children}
    </ObserverCtx.Provider>
  );
}

// ---------------------------------------------------------------------------
// Consumer hooks
// ---------------------------------------------------------------------------

/** Full observer state. */
export function useObserverContext(): ObserverState {
  return useContext(ObserverCtx);
}

/** Just the agents list. */
export function useObserverAgents(): ObserverAgent[] {
  return useContext(ObserverCtx).agents;
}

/** Just the active agents. */
export function useActiveAgents(): ObserverAgent[] {
  return useContext(ObserverCtx).activeAgents;
}

/** Just the networks list. */
export function useObserverNetworks(): ObserverNetwork[] {
  return useContext(ObserverCtx).networks;
}

/** Deduplicated tool inventory. */
export function useObserverTools(): ToolEntry[] {
  return useContext(ObserverCtx).tools;
}

/** Observer connection status. */
export function useObserverStatus(): ObserverConnectionStatus {
  return useContext(ObserverCtx).status;
}
