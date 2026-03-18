/**
 * AgentBoardPage — Rich agent monitoring grid powered by ObserverContext.
 *
 * Features:
 *  - Grid of AgentDetailCards with gap-px border technique
 *  - Filter by status, role (type), network
 *  - Sort by name, status, tool count
 *  - Real-time updates via SSE observer
 */

import { useState, useMemo } from 'react';
import {
  useObserverAgents,
  useObserverStatus,
} from '../contexts/ObserverContext';
import type { ObserverAgent } from '../services/ObserverService';
import { AgentDetailCard } from '../components/AgentDetailCard';

// ---------------------------------------------------------------------------
// Filter / sort types
// ---------------------------------------------------------------------------

type StatusFilter = 'all' | 'active' | 'disconnected';
type SortKey = 'name' | 'status' | 'tools';

const STATUS_FILTERS: { label: string; value: StatusFilter }[] = [
  { label: 'All', value: 'all' },
  { label: 'Online', value: 'active' },
  { label: 'Offline', value: 'disconnected' },
];

const SORT_OPTIONS: { label: string; value: SortKey }[] = [
  { label: 'Name', value: 'name' },
  { label: 'Status', value: 'status' },
  { label: 'Tools', value: 'tools' },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract unique values from agents for a given key. */
function uniqueValues(agents: ObserverAgent[], key: 'type' | 'networks'): string[] {
  const set = new Set<string>();
  for (const a of agents) {
    if (key === 'networks') {
      for (const n of a.networks) set.add(n);
    } else {
      set.add(a[key]);
    }
  }
  return Array.from(set).sort();
}

const STATUS_PRIORITY: Record<string, number> = { active: 0, disconnected: 1 };

function sortAgents(agents: ObserverAgent[], key: SortKey): ObserverAgent[] {
  return [...agents].sort((a, b) => {
    switch (key) {
      case 'name':
        return a.name.localeCompare(b.name);
      case 'status':
        return (STATUS_PRIORITY[a.status] ?? 2) - (STATUS_PRIORITY[b.status] ?? 2);
      case 'tools':
        return b.tools.length - a.tools.length;
      default:
        return 0;
    }
  });
}

// ---------------------------------------------------------------------------
// Filter pill component
// ---------------------------------------------------------------------------

function FilterRow({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { label: string; value: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="font-mono text-[0.6rem] tracking-[0.1em] uppercase text-text-tertiary shrink-0">
        {label}
      </span>
      <div className="flex gap-1.5 overflow-x-auto">
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={`px-3 py-1.5 rounded-lg text-[0.8rem] transition-all whitespace-nowrap cursor-pointer ${
              value === opt.value
                ? 'text-text-primary bg-bg-card border border-border-hover'
                : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export function AgentBoardPage() {
  const agents = useObserverAgents();
  const observerStatus = useObserverStatus();

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [roleFilter, setRoleFilter] = useState('all');
  const [networkFilter, setNetworkFilter] = useState('all');
  const [sortKey, setSortKey] = useState<SortKey>('name');

  // Dynamic filter options derived from live data
  const roles = useMemo(() => uniqueValues(agents, 'type'), [agents]);
  const networks = useMemo(() => uniqueValues(agents, 'networks'), [agents]);

  const roleOptions = useMemo(
    () => [{ label: 'All Roles', value: 'all' }, ...roles.map((r) => ({ label: r, value: r }))],
    [roles],
  );
  const networkOptions = useMemo(
    () => [{ label: 'All Networks', value: 'all' }, ...networks.map((n) => ({ label: n, value: n }))],
    [networks],
  );

  // Filter + sort
  const displayed = useMemo(() => {
    let list = agents;
    if (statusFilter !== 'all') list = list.filter((a) => a.status === statusFilter);
    if (roleFilter !== 'all') list = list.filter((a) => a.type === roleFilter);
    if (networkFilter !== 'all') list = list.filter((a) => a.networks.includes(networkFilter));
    return sortAgents(list, sortKey);
  }, [agents, statusFilter, roleFilter, networkFilter, sortKey]);

  // ---------------------------------------------------------------------------
  // Connecting state
  // ---------------------------------------------------------------------------
  if (observerStatus === 'connecting') {
    return (
      <div className="flex items-center justify-center py-32">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue mx-auto mb-4" />
          <p className="text-text-secondary">Connecting to observer...</p>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Empty state
  // ---------------------------------------------------------------------------
  if (agents.length === 0) {
    return (
      <>
        <h1 className="text-[2.5rem] font-semibold tracking-tight text-text-primary mb-10">
          Agents
        </h1>
        <div className="bg-bg-card rounded-xl border border-border p-16 text-center">
          <div className="text-5xl mb-4 opacity-40">⬡</div>
          <h2 className="text-xl font-medium tracking-tight text-text-primary mb-2">
            No Agents Connected
          </h2>
          <p className="text-sm font-light text-text-secondary">
            Agents will appear here once they connect to the broker
          </p>
        </div>
      </>
    );
  }

  // ---------------------------------------------------------------------------
  // Main render
  // ---------------------------------------------------------------------------
  return (
    <>
      {/* Header */}
      <div className="mb-8">
        <p className="font-mono text-[0.65rem] tracking-[0.15em] uppercase text-blue mb-3">
          Monitoring
        </p>
        <h1 className="text-[2.5rem] font-semibold tracking-tight text-text-primary mb-2">
          Agents
        </h1>
        <p className="text-[0.9rem] font-light leading-relaxed text-text-secondary">
          {displayed.length} of {agents.length} agent{agents.length !== 1 ? 's' : ''}
        </p>
      </div>

      {/* Filters */}
      <div className="space-y-2 mb-6">
        <FilterRow
          label="Status"
          options={STATUS_FILTERS}
          value={statusFilter}
          onChange={(v) => setStatusFilter(v as StatusFilter)}
        />
        {roles.length > 1 && (
          <FilterRow label="Role" options={roleOptions} value={roleFilter} onChange={setRoleFilter} />
        )}
        {networks.length > 1 && (
          <FilterRow
            label="Network"
            options={networkOptions}
            value={networkFilter}
            onChange={setNetworkFilter}
          />
        )}
      </div>

      {/* Sort */}
      <div className="flex items-center gap-3 mb-8">
        <span className="font-mono text-[0.6rem] tracking-[0.1em] uppercase text-text-tertiary">
          Sort
        </span>
        {SORT_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => setSortKey(opt.value)}
            className={`px-3 py-1.5 rounded-lg text-[0.8rem] transition-all cursor-pointer ${
              sortKey === opt.value
                ? 'text-text-primary bg-bg-card border border-border-hover'
                : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Grid */}
      {displayed.length === 0 ? (
        <div className="bg-bg-card rounded-xl border border-border p-16 text-center">
          <h2 className="text-xl font-medium tracking-tight text-text-primary mb-2">
            No Matching Agents
          </h2>
          <p className="text-sm font-light text-text-secondary">
            Try adjusting the filters
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-px bg-border border border-border rounded-xl overflow-hidden">
          {displayed.map((agent) => (
            <AgentDetailCard key={agent.id} agent={agent} />
          ))}
        </div>
      )}
    </>
  );
}
