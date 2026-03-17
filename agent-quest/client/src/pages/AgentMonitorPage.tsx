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
  available: { color: 'bg-green-200 text-green-800', icon: '🟢', label: 'Available' },
  busy: { color: 'bg-yellow-200 text-yellow-800', icon: '🟡', label: 'Busy' },
  offline: { color: 'bg-red-200 text-red-800', icon: '🔴', label: 'Offline' },
};

/**
 * Role badge colors
 */
const ROLE_COLORS: Record<AgentRole, string> = {
  artist: 'bg-purple-100 text-purple-700 border-purple-300',
  designer: 'bg-blue-100 text-blue-700 border-blue-300',
  programmer: 'bg-green-100 text-green-700 border-green-300',
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
    <div className="bg-white rounded-lg shadow hover:shadow-lg transition-shadow p-6 border border-gray-200">
      {/* Header: Name and Status */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex-1">
          <h3 className="text-lg font-semibold text-gray-900 mb-1">
            {agent.name}
          </h3>
          <span
            className={`inline-block px-2 py-1 rounded-md text-xs font-medium border ${
              ROLE_COLORS[agent.role]
            }`}
          >
            {ROLE_LABELS[agent.role]}
          </span>
        </div>
        <div className="flex flex-col items-end">
          <span className="text-2xl mb-1">{statusConfig.icon}</span>
          <span
            className={`px-2 py-1 rounded-full text-xs font-medium ${statusConfig.color}`}
          >
            {statusConfig.label}
          </span>
        </div>
      </div>

      {/* Task Count */}
      <div className="mb-4 pb-4 border-b border-gray-200">
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-600">Current Tasks:</span>
          <span className="font-semibold text-gray-900">
            {agent.currentTasks.length}
          </span>
        </div>
      </div>

      {/* Capabilities */}
      <div className="mb-4">
        <p className="text-xs text-gray-500 mb-2">Capabilities:</p>
        <div className="flex flex-wrap gap-1">
          {agent.capabilities && agent.capabilities.length > 0 ? (
            agent.capabilities.map((capability, index) => (
              <span
                key={index}
                className="px-2 py-1 bg-gray-100 text-gray-700 rounded text-xs"
              >
                {capability}
              </span>
            ))
          ) : (
            <span className="text-xs text-gray-400 italic">No capabilities listed</span>
          )}
        </div>
      </div>

      {/* Last Seen */}
      <div className="text-xs text-gray-500">
        <span>Last seen: {lastSeen}</span>
      </div>

      {/* Agent ID */}
      <div className="mt-2 text-xs text-gray-400">
        ID: {agent.agentId.slice(0, 8)}...
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
   * Initialize: load agents and setup WebSocket
   */
  useEffect(() => {
    loadAgents();
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
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading agents...</p>
        </div>
      </div>
    );
  }

  /**
   * Render error state
   */
  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="bg-white rounded-lg shadow p-8 max-w-md">
          <div className="text-red-600 text-4xl mb-4">⚠️</div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">
            Failed to Load Agents
          </h2>
          <p className="text-gray-600 mb-4">{error}</p>
          <button
            onClick={loadAgents}
            className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 transition-colors"
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
      <div className="min-h-screen bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 py-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-8">Agent Monitor</h1>
          <div className="bg-white rounded-lg shadow p-12 text-center">
            <div className="text-6xl mb-4">🤖</div>
            <h2 className="text-2xl font-semibold text-gray-900 mb-2">
              No Agents Registered
            </h2>
            <p className="text-gray-600 mb-6">
              Agents will appear here once they register with the system
            </p>
          </div>
        </div>
      </div>
    );
  }

  /**
   * Render agent monitor
   */
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Agent Monitor</h1>
          <p className="text-gray-600">
            {filteredAgents.length} {filteredAgents.length === 1 ? 'agent' : 'agents'}
            {' '}
            {statusFilter !== 'all' && `(${STATUS_CONFIG[statusFilter].label})`}
            {roleFilter !== 'all' && ` - ${ROLE_LABELS[roleFilter]}`}
          </p>
        </div>

        {/* Status Filter Tabs */}
        <div className="bg-white rounded-lg shadow mb-4 p-2 flex gap-2 overflow-x-auto">
          {STATUS_FILTERS.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setStatusFilter(tab.value)}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors whitespace-nowrap ${
                statusFilter === tab.value
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-700 hover:bg-gray-100'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Role Filter Tabs */}
        <div className="bg-white rounded-lg shadow mb-6 p-2 flex gap-2 overflow-x-auto">
          {ROLE_FILTERS.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setRoleFilter(tab.value)}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors whitespace-nowrap ${
                roleFilter === tab.value
                  ? 'bg-green-600 text-white'
                  : 'text-gray-700 hover:bg-gray-100'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Agent Grid */}
        {filteredAgents.length === 0 ? (
          <div className="bg-white rounded-lg shadow p-12 text-center">
            <div className="text-4xl mb-4">🔍</div>
            <h2 className="text-xl font-semibold text-gray-900 mb-2">
              No {statusFilter !== 'all' && STATUS_CONFIG[statusFilter].label}{' '}
              {roleFilter !== 'all' && ROLE_LABELS[roleFilter]} Agents
            </h2>
            <p className="text-gray-600">
              Try selecting a different filter
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredAgents.map((agent) => (
              <AgentCard key={agent.agentId} agent={agent} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
