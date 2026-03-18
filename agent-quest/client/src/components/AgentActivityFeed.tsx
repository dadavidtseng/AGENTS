/**
 * AgentActivityFeed — Scrollable timeline of recent per-agent events.
 *
 * Renders inside AgentDetailCard as a collapsible section.
 * Events are captured from observer snapshot diffs and WebSocket broadcasts.
 *
 * Color-coded event types:
 *  - connected    → green
 *  - disconnected → red
 *  - registered   → blue
 *  - task         → yellow
 *  - error        → red
 */

import { useState, useEffect, useRef, useCallback, useSyncExternalStore } from 'react';
import { StatusDot } from './ui/StatusDot';
import type { ObserverAgent } from '../services/ObserverService';
import { observerService } from '../services/ObserverService';
import { wsService } from '../services/WebSocketService';

// ---------------------------------------------------------------------------
// Event types
// ---------------------------------------------------------------------------

export type AgentEventType =
  | 'connected'
  | 'disconnected'
  | 'registered'
  | 'task_assigned'
  | 'task_completed'
  | 'tool_invoked'
  | 'error';

export interface AgentEvent {
  id: string;
  agentId: string;
  type: AgentEventType;
  message: string;
  timestamp: number;
}

const EVENT_CONFIG: Record<
  AgentEventType,
  { color: 'green' | 'red' | 'blue' | 'yellow' | 'orange'; label: string }
> = {
  connected:      { color: 'green',  label: 'Connected' },
  disconnected:   { color: 'red',    label: 'Disconnected' },
  registered:     { color: 'blue',   label: 'Registered' },
  task_assigned:  { color: 'yellow', label: 'Task Assigned' },
  task_completed: { color: 'green',  label: 'Task Completed' },
  tool_invoked:   { color: 'blue',   label: 'Tool Invoked' },
  error:          { color: 'red',    label: 'Error' },
};

// ---------------------------------------------------------------------------
// Module-level event store
// ---------------------------------------------------------------------------

const MAX_EVENTS_PER_AGENT = 50;
let eventCounter = 0;

/** agentId → events (newest first) */
const eventStore = new Map<string, AgentEvent[]>();
const listeners = new Set<() => void>();

function notify() {
  for (const fn of listeners) fn();
}

function pushEvent(agentId: string, type: AgentEventType, message: string) {
  const prev = eventStore.get(agentId) ?? [];
  // Create new array (immutable) so useSyncExternalStore detects the change
  const next = [
    {
      id: `evt-${++eventCounter}`,
      agentId,
      type,
      message,
      timestamp: Date.now(),
    },
    ...prev,
  ].slice(0, MAX_EVENTS_PER_AGENT);
  eventStore.set(agentId, next);
  notify();
}

/** Stable empty array — avoids new reference on every getSnapshot call. */
const EMPTY_EVENTS: AgentEvent[] = [];

function getEventsForAgent(agentId: string): AgentEvent[] {
  return eventStore.get(agentId) ?? EMPTY_EVENTS;
}

// ---------------------------------------------------------------------------
// Observer snapshot diff — detect connect/disconnect/register
// ---------------------------------------------------------------------------

let prevAgentMap = new Map<string, ObserverAgent>();
let observerInitialized = false;

function diffSnapshot() {
  const { agents } = observerService.snapshot;
  const currentMap = new Map(agents.map((a) => [a.id, a]));

  if (observerInitialized) {
    // Detect new agents (connected)
    for (const [id, agent] of currentMap) {
      const prev = prevAgentMap.get(id);
      if (!prev) {
        pushEvent(id, 'connected', `${agent.name} connected`);
        if (agent.tools.length > 0) {
          pushEvent(id, 'registered', `Registered ${agent.tools.length} tools`);
        }
      } else if (prev.status === 'disconnected' && agent.status === 'active') {
        pushEvent(id, 'connected', `${agent.name} reconnected`);
      } else if (prev.status === 'active' && agent.status === 'disconnected') {
        pushEvent(id, 'disconnected', `${agent.name} disconnected`);
      } else if (prev.tools.length !== agent.tools.length) {
        pushEvent(id, 'registered', `Tools updated: ${agent.tools.length} registered`);
      }
    }

    // Detect removed agents (disconnected)
    for (const [id, prev] of prevAgentMap) {
      if (!currentMap.has(id)) {
        pushEvent(id, 'disconnected', `${prev.name} removed`);
      }
    }
  }

  prevAgentMap = currentMap;
  observerInitialized = true;
}

// Subscribe to observer snapshots
observerService.onSnapshot(() => diffSnapshot());

// Subscribe to WebSocket events for task correlation
function initWsSubscriptions() {
  wsService.subscribe('task.assigned', (data) => {
    const d = data as { agentId?: string; taskName?: string };
    if (d.agentId) {
      pushEvent(d.agentId, 'task_assigned', `Task: ${d.taskName ?? 'unknown'}`);
    }
  });
  wsService.subscribe('task.completed', (data) => {
    const d = data as { agentId?: string; taskName?: string };
    if (d.agentId) {
      pushEvent(d.agentId, 'task_completed', `Completed: ${d.taskName ?? 'unknown'}`);
    }
  });
}

// Initialize WS subscriptions once
let wsInitialized = false;
function ensureWsSubscriptions() {
  if (!wsInitialized) {
    wsInitialized = true;
    initWsSubscriptions();
  }
}

// ---------------------------------------------------------------------------
// React hook
// ---------------------------------------------------------------------------

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useAgentEvents(agentId: string): AgentEvent[] {
  ensureWsSubscriptions();

  const getSnapshot = useCallback(() => getEventsForAgent(agentId), [agentId]);

  return useSyncExternalStore(subscribe, getSnapshot);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface AgentActivityFeedProps {
  agentId: string;
  maxVisible?: number;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function AgentActivityFeed({ agentId, maxVisible = 10 }: AgentActivityFeedProps) {
  const events = useAgentEvents(agentId);
  const [expanded, setExpanded] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to top on new events
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, [events.length]);

  const visible = expanded ? events : events.slice(0, maxVisible);

  if (events.length === 0) {
    return (
      <p className="text-[0.7rem] text-text-tertiary italic">
        No activity recorded yet
      </p>
    );
  }

  return (
    <div>
      <div
        ref={scrollRef}
        className="max-h-48 overflow-y-auto space-y-1.5 scrollbar-thin"
      >
        {visible.map((evt) => {
          const cfg = EVENT_CONFIG[evt.type];
          return (
            <div
              key={evt.id}
              className="flex items-start gap-2 py-1 text-[0.7rem]"
            >
              <StatusDot color={cfg.color} size="sm" className="mt-1 shrink-0" />
              <span className="text-text-secondary flex-1 min-w-0 truncate">
                {evt.message}
              </span>
              <span className="font-mono text-text-tertiary shrink-0">
                {formatTime(evt.timestamp)}
              </span>
            </div>
          );
        })}
      </div>

      {events.length > maxVisible && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-2 text-[0.65rem] text-text-tertiary hover:text-text-secondary transition-colors cursor-pointer"
        >
          {expanded ? 'Show less' : `Show all ${events.length} events`}
        </button>
      )}
    </div>
  );
}

