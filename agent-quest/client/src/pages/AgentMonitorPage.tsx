/**
 * Agent Monitor Page - Real-time agent status monitoring
 * Features: status filtering, role filtering, real-time WebSocket updates
 */

import { useState, useEffect, useCallback } from 'react';
import { apiClient } from '../api/client';
import { useWebSocket, useWsEvent } from '../hooks/useWebSocket';
import type { Agent, AgentStatus, AgentRole } from '../types';

/**
 * Status indicator colors and icons
 */
const STATUS_CONFIG: Record<AgentStatus, { color: string; icon: string; label: string }> = {
  available: { color: 'bg-green/15 text-green', icon: '🟢', label: 'Available' },
  busy: { color: 'bg-yellow/15 text-yellow', icon: '🟡', label: 'Busy' },
  offline: { color: 'bg-red/15 text-red', icon: '🔴', label: 'Offline' },
};

/**
 * Role badge — Portfolio-style mono tag
 */
const ROLE_COLORS: Record<AgentRole, string> = {
  artist: 'font-mono text-[0.6rem] text-[#a855f7] bg-bg border border-[#a855f7]/20 px-2.5 py-0.5 rounded',
  designer: 'font-mono text-[0.6rem] text-blue bg-bg border border-blue/20 px-2.5 py-0.5 rounded',
  programmer: 'font-mono text-[0.6rem] text-green bg-bg border border-green/20 px-2.5 py-0.5 rounded',
};

/**
 * Role display labels
 */
const ROLE_LABELS: Record<AgentRole, string> = {
  artist: 'Artist',
  designer: 'Designer',
  programmer: 'Programmer',
};

/**
 * Status filter tabs
 */
const STATUS_FILTERS: Array<{ label: string; value: AgentStatus | 'all' }> = [
  { label: 'All', value: 'all' },
  { label: 'Available', value: 'available' },
  { label: 'Busy', value: 'busy' },
  { label: 'Offline', value: 'offline' },
];

/**
 * Role filter tabs
 */
const ROLE_FILTERS: Array<{ label: string; value: AgentRole | 'all' }> = [
  { label: 'All Roles', value: 'all' },
  { label: 'Artist', value: 'artist' },
  { label: 'Designer', value: 'designer' },
  { label: 'Programmer', value: 'programmer' },
];

/**
 * Format relative time (e.g., "2 minutes ago")
 */
function formatRelativeTime(timestamp: string): string {
  const now = Date.now();
  const then = new Date(timestamp).getTime();
  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) return 'just now';
  if (diffMin < 60) return `${diffMin} minute${diffMin > 1 ? 's' : ''} ago`;
  if (diffHour < 24) return `${diffHour} hour${diffHour > 1 ? 's' : ''} ago`;
  return `${diffDay} day${diffDay > 1 ? 's' : ''} ago`;
}

/**
 * Agent Card Component
 */
interface AgentCardProps {
  agent: Agent;
}

function AgentCard({ agent }: AgentCardProps) {
  const statusConfig = STATUS_CONFIG[agent.status];
  const [lastSeen, setLastSeen] = useState<string>('');

  // Update relative time every minute
  useEffect(() => {
    const updateLastSeen = () => {
      setLastSeen(formatRelativeTime(agent.lastSeen));
    };

    updateLastSeen();
    const interval = setInterval(updateLastSeen, 60000); // Update every minute

    return () => clearInterval(interval);
  }, [agent.lastSeen]);

  return (
    <div className="group bg-bg-elevated p-8 transition-colors duration-300 hover:bg-bg-card card-hover-gradient">
      {/* Header: Name and Status */}
      <div className="flex items-start justify-between mb-5">
        <div className="flex-1">
          <h3 className="text-lg font-medium tracking-tight text-text-primary mb-2">
            {agent.name}
          </h3>
          <span className={ROLE_COLORS[agent.role]}>
            {ROLE_LABELS[agent.role]}
          </span>
        </div>
        <div className="flex flex-col items-end">
          <span className="inline-flex items-center gap-2 text-[0.75rem] text-text-secondary border border-border px-3 py-1.5 rounded-full">
            <span className={`w-1.5 h-1.5 rounded-full ${statusConfig.color.split(' ')[0].replace('bg-', 'bg-').replace('/15', '')} ${agent.status === 'busy' ? 'animate-pulse-dot' : ''}`} />
            {statusConfig.label}
          </span>
        </div>
      </div>

      {/* Task Count */}
      <div className="mb-5 pb-5 border-b border-border">
        <div className="flex items-center justify-between text-sm">
          <span className="text-text-secondary font-light">Current Tasks</span>
          <span className="font-mono text-text-primary">
            {agent.currentTasks.length}
          </span>
        </div>
      </div>

      {/* Capabilities */}
      <div className="mb-5">
        <p className="font-mono text-[0.6rem] tracking-[0.1em] uppercase text-text-tertiary mb-2">Capabilities</p>
        <div className="flex flex-wrap gap-1.5">
          {agent.capabilities && agent.capabilities.length > 0 ? (
            agent.capabilities.map((capability, index) => (
              <span
                key={index}
                className="font-mono text-[0.6rem] text-text-tertiary bg-bg border border-border px-2.5 py-0.5 rounded"
              >
                {capability}
              </span>
            ))
          ) : (
            <span className="text-[0.7rem] text-text-tertiary italic">No capabilities listed</span>
          )}
        </div>
      </div>

      {/* Last Seen */}
      <div className="font-mono text-[0.6rem] tracking-wide text-text-tertiary">
        Last seen: {lastSeen}
      </div>

      {/* Agent ID */}
      <div className="mt-1.5 font-mono text-[0.6rem] tracking-wide text-text-tertiary">
        {agent.agentId.slice(0, 8)}
      </div>
    </div>
  );
}

/**
 * Agent Monitor Page Component
 */
export function AgentMonitorPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [filteredAgents, setFilteredAgents] = useState<Agent[]>([]);
  const [statusFilter, setStatusFilter] = useState<AgentStatus | 'all'>('all');
  const [roleFilter, setRoleFilter] = useState<AgentRole | 'all'>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /**
   * Load agents from API
   */
  const loadAgents = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await apiClient.getAgents();
      setAgents(data);
      console.log(`[AgentMonitor] Loaded ${data.length} agents`);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to load agents';
      setError(errorMessage);
      console.error('[AgentMonitor] Load error:', err);
    } finally {
      setLoading(false);
    }
  };

  /**
   * Filter agents by status and role
   */
  useEffect(() => {
    let filtered = agents;

    // Apply status filter
    if (statusFilter !== 'all') {
      filtered = filtered.filter((a) => a.status === statusFilter);
    }

    // Apply role filter
    if (roleFilter !== 'all') {
      filtered = filtered.filter((a) => a.role === roleFilter);
    }

    setFilteredAgents(filtered);
  }, [agents, statusFilter, roleFilter]);

  /**
   * Initialize: load agents, setup WebSocket, and poll every 30s
   * (agents send heartbeats every 30s, so polling keeps status fresh)
   */
  useEffect(() => {
    loadAgents();

    const pollInterval = setInterval(() => {
      apiClient.getAgents().then(setAgents).catch((err) => {
        console.warn('[AgentMonitor] Poll error:', err);
      });
    }, 30_000);

    return () => clearInterval(pollInterval);
  }, []);

  // WebSocket connection
  useWebSocket();

  // Real-time: agent registered / updated
  useWsEvent('task.assigned', useCallback((data: unknown) => {
    const agent = data as Agent;
    console.log('[AgentMonitor] Agent event:', agent);
    if (agent.agentId) {
      setAgents((prevAgents) => {
        const exists = prevAgents.some((a) => a.agentId === agent.agentId);
        if (exists) {
          return prevAgents.map((a) =>
            a.agentId === agent.agentId ? { ...a, ...agent } : a
          );
        } else {
          return [...prevAgents, agent];
        }
      });
    }
  }, []));

  /**
   * Render loading state
   */
  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue mx-auto mb-4"></div>
          <p className="text-text-secondary">Loading agents...</p>
        </div>
      </div>
    );
  }

  /**
   * Render error state
   */
  if (error) {
    return (
      <div className="flex items-center justify-center py-32">
        <div className="bg-bg-card rounded-lg shadow p-8 max-w-md border border-border">
          <div className="text-red text-4xl mb-4">⚠️</div>
          <h2 className="text-xl font-semibold tracking-tight text-text-primary mb-2">
            Failed to Load Agents
          </h2>
          <p className="text-sm font-light text-text-secondary mb-4">{error}</p>
          <button
            onClick={loadAgents}
            className="text-[0.85rem] font-medium text-bg bg-text-primary px-7 py-3 rounded-lg hover:opacity-85 hover:-translate-y-px transition-all"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  /**
   * Render empty state
   */
  if (agents.length === 0) {
    return (
      <>
          <h1 className="text-[2.5rem] font-semibold tracking-tight text-text-primary mb-10">Agents</h1>
          <div className="bg-bg-card rounded-xl border border-border p-16 text-center">
            <div className="text-6xl mb-4">🤖</div>
            <h2 className="text-xl font-medium tracking-tight text-text-primary mb-2">
              No Agents Registered
            </h2>
            <p className="text-sm font-light text-text-secondary mb-6">
              Agents will appear here once they register with the system
            </p>
          </div>
      </>
    );
  }

  /**
   * Render agent monitor
   */
  return (
    <>
      {/* Header */}
        <div className="mb-10">
          <p className="font-mono text-[0.65rem] tracking-[0.15em] uppercase text-blue mb-3">
            Monitoring
          </p>
          <h1 className="text-[2.5rem] font-semibold tracking-tight text-text-primary mb-2">
            Agents
          </h1>
          <p className="text-[0.9rem] font-light leading-relaxed text-text-secondary">
            {filteredAgents.length} {filteredAgents.length === 1 ? 'agent' : 'agents'}
            {' '}
            {statusFilter !== 'all' && `(${STATUS_CONFIG[statusFilter].label})`}
            {roleFilter !== 'all' && ` - ${ROLE_LABELS[roleFilter]}`}
          </p>
        </div>

        {/* Status Filter Tabs */}
        <div className="flex gap-2 mb-4 overflow-x-auto">
          {STATUS_FILTERS.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setStatusFilter(tab.value)}
              className={`px-4 py-2 rounded-lg text-sm transition-all whitespace-nowrap ${
                statusFilter === tab.value
                  ? 'text-text-primary bg-bg-card border border-border-hover'
                  : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Role Filter Tabs */}
        <div className="flex gap-2 mb-8 overflow-x-auto">
          {ROLE_FILTERS.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setRoleFilter(tab.value)}
              className={`px-4 py-2 rounded-lg text-sm transition-all whitespace-nowrap ${
                roleFilter === tab.value
                  ? 'text-text-primary bg-bg-card border border-border-hover'
                  : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Agent Grid */}
        {filteredAgents.length === 0 ? (
          <div className="bg-bg-card rounded-xl border border-border p-16 text-center">
            <h2 className="text-xl font-medium tracking-tight text-text-primary mb-2">
              No {statusFilter !== 'all' && STATUS_CONFIG[statusFilter].label}{' '}
              {roleFilter !== 'all' && ROLE_LABELS[roleFilter]} Agents
            </h2>
            <p className="text-sm font-light text-text-secondary">
              Try selecting a different filter
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-px bg-border border border-border rounded-xl overflow-hidden">
            {filteredAgents.map((agent) => (
              <AgentCard key={agent.agentId} agent={agent} />
            ))}
          </div>
        )}
    </>
  );
}
