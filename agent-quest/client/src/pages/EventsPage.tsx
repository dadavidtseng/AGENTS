/**
 * EventsPage — Real-time system-wide event monitoring.
 *
 * Combines WebSocket events and observer agent state changes into a unified
 * event stream. Filterable by event type, agent, network.
 * Auto-scroll with pause, expandable JSON payloads.
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useWebSocket } from '../hooks/useWebSocket';
import { useObserverContext } from '../contexts/ObserverContext';
import { wsService } from '../services/WebSocketService';
import { EventTimeline, type TimelineEvent } from '../components/EventTimeline';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_EVENTS = 500;

const EVENT_TYPES = [
  'quest.created',
  'quest.updated',
  'quest.statusChanged',
  'task.assigned',
  'task.completed',
  'approval.requested',
  'agent.connected',
  'agent.disconnected',
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function EventsPage() {
  const { status: wsStatus } = useWebSocket();
  const { agents, status: observerStatus } = useObserverContext();

  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const prevAgentIds = useRef<Set<string>>(new Set());

  // Filters
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [agentFilter, setAgentFilter] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Load event history from WebSocketService on mount
  useEffect(() => {
    const history = wsService.getEventHistory();
    const timelineEvents: TimelineEvent[] = history.map((stored) => ({
      id: stored.id,
      type: stored.message.event,
      timestamp: stored.message.timestamp ?? stored.receivedAt,
      data: stored.message.data,
      agent: typeof stored.message.data === 'object' && stored.message.data !== null
        ? (stored.message.data as Record<string, unknown>).agentId as string | undefined
        : undefined,
    }));
    setEvents(timelineEvents);
  }, []);

  // Subscribe to new WebSocket events
  useEffect(() => {
    const unsub = wsService.onMessage((msg) => {
      if (msg.event === 'pong') return;

      const evt: TimelineEvent = {
        id: Date.now(), // Use timestamp as ID since wsService manages the counter
        type: msg.event,
        timestamp: msg.timestamp ?? new Date().toISOString(),
        data: msg.data,
        agent: typeof msg.data === 'object' && msg.data !== null
          ? (msg.data as Record<string, unknown>).agentId as string | undefined
          : undefined,
      };

      setEvents((prev) => [...prev, evt]);
    });

    return unsub;
  }, []);

  // Track observer agent changes → generate synthetic events
  useEffect(() => {
    const currentIds = new Set(agents.map((a) => a.id));
    const prevIds = prevAgentIds.current;

    // New agents
    for (const agent of agents) {
      if (!prevIds.has(agent.id)) {
        const eventData = { 
          agentId: agent.id, 
          name: agent.name, 
          networks: agent.networks, 
          tools: agent.tools.length 
        };
        
        // Add to WebSocketService history
        wsService.addSyntheticEvent('agent.connected', eventData);
        
        // Update local state
        const evt: TimelineEvent = {
          id: Date.now(),
          type: 'agent.connected',
          timestamp: new Date().toISOString(),
          data: eventData,
          agent: agent.id,
        };
        setEvents((prev) => [...prev, evt]);
      }
    }

    // Removed agents
    for (const id of prevIds) {
      if (!currentIds.has(id)) {
        const eventData = { agentId: id };
        
        // Add to WebSocketService history
        wsService.addSyntheticEvent('agent.disconnected', eventData);
        
        // Update local state
        const evt: TimelineEvent = {
          id: Date.now(),
          type: 'agent.disconnected',
          timestamp: new Date().toISOString(),
          data: eventData,
          agent: id,
        };
        setEvents((prev) => [...prev, evt]);
      }
    }

    prevAgentIds.current = currentIds;
  }, [agents]);

  // Derive unique agents from events
  const availableAgents = useMemo(() => {
    const set = new Set<string>();
    for (const e of events) {
      if (e.agent) set.add(e.agent);
    }
    return [...set].sort();
  }, [events]);

  // Apply filters
  const filtered = useMemo(() => {
    let result = events;

    if (typeFilter) {
      result = result.filter((e) => e.type === typeFilter);
    }

    if (agentFilter) {
      result = result.filter((e) => e.agent === agentFilter);
    }

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter((e) =>
        e.type.toLowerCase().includes(q) ||
        JSON.stringify(e.data).toLowerCase().includes(q),
      );
    }

    return result;
  }, [events, typeFilter, agentFilter, searchQuery]);

  const handleClear = useCallback(() => {
    wsService.clearEventHistory();
    setEvents([]);
  }, []);

  const isConnected = wsStatus === 'connected' || observerStatus === 'connected';

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-text-primary">Events</h1>
          <p className="text-sm text-text-tertiary mt-0.5">
            Real-time system-wide event stream
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className={`inline-flex items-center gap-1.5 text-sm ${
            isConnected ? 'text-green' : 'text-text-tertiary'
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${
              isConnected ? 'bg-green animate-pulse-dot' : 'bg-text-tertiary'
            }`} />
            {isConnected ? 'Live' : 'Disconnected'}
          </span>
          <span className="font-mono text-sm text-text-tertiary">
            {events.length} event{events.length !== 1 ? 's' : ''}
          </span>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {/* Search */}
        <div className="relative flex-1 min-w-[180px] max-w-[280px]">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-tertiary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            placeholder="Search events..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 rounded-lg border border-border bg-bg-elevated/40 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-blue/40 transition-colors"
          />
        </div>

        {/* Type filter */}
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="px-3 py-1.5 rounded-lg border border-border bg-bg-elevated/40 text-sm text-text-secondary focus:outline-none focus:border-blue/40 transition-colors cursor-pointer"
        >
          <option value="">All types</option>
          {EVENT_TYPES.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>

        {/* Agent filter */}
        <select
          value={agentFilter}
          onChange={(e) => setAgentFilter(e.target.value)}
          className="px-3 py-1.5 rounded-lg border border-border bg-bg-elevated/40 text-sm text-text-secondary focus:outline-none focus:border-blue/40 transition-colors cursor-pointer"
        >
          <option value="">All agents</option>
          {availableAgents.map((a) => (
            <option key={a} value={a}>{a.replace(/^agent-/i, '')}</option>
          ))}
        </select>

        {/* Clear */}
        {events.length > 0 && (
          <button
            onClick={handleClear}
            className="text-sm text-text-tertiary hover:text-text-secondary transition-colors cursor-pointer"
          >
            Clear
          </button>
        )}

        {/* Filtered count */}
        {(typeFilter || agentFilter || searchQuery) && (
          <span className="text-[0.7rem] font-mono text-text-tertiary">
            {filtered.length} of {events.length}
          </span>
        )}
      </div>

      {/* Timeline */}
      <div className="rounded-xl border border-border bg-bg-card overflow-hidden">
        <EventTimeline events={filtered} />
      </div>
    </div>
  );
}
