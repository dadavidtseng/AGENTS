/**
 * BacklogPage — Task-level backlog view using TanStack React Table.
 *
 * Shows individual tasks (not quests) in a sortable, filterable table.
 * Each task row shows its parent quest name for context.
 * Features: sorting, pagination, column resizing, row selection,
 * advanced filtering (status, assignee, role, quest, date range, search),
 * URL-persisted filter state, saved filter presets.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { apiClient } from '../api/client';
import { useWsEvent } from '../hooks/useWebSocket';
import { BacklogTable } from '../components/BacklogTable';
import { BacklogFilters, EMPTY_FILTERS, type FilterState } from '../components/BacklogFilters';
import type { Quest, Task, TaskStatus, BacklogTask } from '../types';

// ---------------------------------------------------------------------------
// URL ↔ FilterState sync
// ---------------------------------------------------------------------------

function filtersFromParams(params: URLSearchParams): FilterState {
  return {
    search:    params.get('q') ?? '',
    statuses:  (params.get('status')?.split(',').filter(Boolean) ?? []) as TaskStatus[],
    assignees: params.get('assignee')?.split(',').filter(Boolean) ?? [],
    roles:     params.get('role')?.split(',').filter(Boolean) ?? [],
    quests:    params.get('quest')?.split(',').filter(Boolean) ?? [],
    dateFrom:  params.get('from') ?? '',
    dateTo:    params.get('to') ?? '',
  };
}

function filtersToParams(f: FilterState): URLSearchParams {
  const p = new URLSearchParams();
  if (f.search)               p.set('q', f.search);
  if (f.statuses.length > 0)  p.set('status', f.statuses.join(','));
  if (f.assignees.length > 0) p.set('assignee', f.assignees.join(','));
  if (f.roles.length > 0)     p.set('role', f.roles.join(','));
  if (f.quests.length > 0)    p.set('quest', f.quests.join(','));
  if (f.dateFrom)             p.set('from', f.dateFrom);
  if (f.dateTo)               p.set('to', f.dateTo);
  return p;
}

// ---------------------------------------------------------------------------
// Client-side filtering
// ---------------------------------------------------------------------------

function applyFilters(tasks: BacklogTask[], f: FilterState): BacklogTask[] {
  let result = tasks;

  // Full-text search (task name + description + quest name)
  if (f.search) {
    const q = f.search.toLowerCase();
    result = result.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.description?.toLowerCase().includes(q) ||
        t.questName.toLowerCase().includes(q),
    );
  }

  // Status filter
  if (f.statuses.length > 0) {
    const set = new Set(f.statuses);
    result = result.filter((t) => set.has(t.status));
  }

  // Assignee filter
  if (f.assignees.length > 0) {
    const set = new Set(f.assignees);
    result = result.filter((t) => t.assignedAgent && set.has(t.assignedAgent));
  }

  // Role filter
  if (f.roles.length > 0) {
    const set = new Set(f.roles);
    result = result.filter((t) => t.role && set.has(t.role));
  }

  // Quest filter
  if (f.quests.length > 0) {
    const set = new Set(f.quests);
    result = result.filter((t) => set.has(t.questId));
  }

  // Date range (created/started date)
  if (f.dateFrom) {
    const from = new Date(f.dateFrom).getTime();
    result = result.filter((t) => {
      const d = t.createdAt || t.startedAt;
      return d ? new Date(d).getTime() >= from : true;
    });
  }
  if (f.dateTo) {
    const to = new Date(f.dateTo).getTime() + 86_400_000;
    result = result.filter((t) => {
      const d = t.createdAt || t.startedAt;
      return d ? new Date(d).getTime() < to : true;
    });
  }

  return result;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function BacklogPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [tasks, setTasks] = useState<BacklogTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Expand to full width (same pattern as Kanban pages)
  useEffect(() => {
    const pageShell = document.querySelector('.reveal');
    if (pageShell) {
      pageShell.classList.remove('max-w-[1100px]', 'px-8', 'max-md:px-6');
      pageShell.classList.add('max-w-full', 'px-4');
    }
    return () => {
      const pageShell = document.querySelector('.reveal');
      if (pageShell) {
        pageShell.classList.remove('max-w-full', 'px-4');
        pageShell.classList.add('max-w-[1100px]', 'px-8', 'max-md:px-6');
      }
    };
  }, []);

  const filters = useMemo(() => filtersFromParams(searchParams), [searchParams]);

  const setFilters = useCallback(
    (f: FilterState) => {
      const params = filtersToParams(f);
      setSearchParams(params, { replace: true });
    },
    [setSearchParams],
  );

  const fetchData = useCallback(async () => {
    try {
      // Always fetch quests for name lookup
      const quests = await apiClient.getQuests();
      const questMap = new Map<string, string>();
      for (const q of quests) {
        questMap.set(q.questId, q.questName);
      }

      // Try bulk task endpoint first; fall back to per-quest detail fetch
      let rawTasks: Task[];
      try {
        rawTasks = await apiClient.getAllTasks();
      } catch {
        // Fallback: fetch each quest's details to extract tasks
        const details = await Promise.all(
          quests.map((q) => apiClient.getQuestDetails(q.questId)),
        );
        rawTasks = details.flatMap((d) => d.tasks ?? []);
      }

      // Merge quest name into each task
      const backlogTasks: BacklogTask[] = rawTasks.map((t) => ({
        ...t,
        questName: questMap.get(t.questId) ?? t.questId.slice(0, 8),
      }));

      setTasks(backlogTasks);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tasks');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Refresh on real-time events
  useWsEvent('quest.created', fetchData);
  useWsEvent('quest.updated', fetchData);
  useWsEvent('quest.statusChanged', fetchData);
  useWsEvent('task.updated', fetchData);
  useWsEvent('task.statusChanged', fetchData);

  // Derive filtered data + available filter options
  const filtered = useMemo(() => applyFilters(tasks, filters), [tasks, filters]);

  const availableAssignees = useMemo(() => {
    const set = new Set<string>();
    for (const t of tasks) {
      if (t.assignedAgent) set.add(t.assignedAgent);
    }
    return [...set].sort();
  }, [tasks]);

  const availableRoles = useMemo(() => {
    const set = new Set<string>();
    for (const t of tasks) {
      if (t.role) set.add(t.role);
    }
    return [...set].sort();
  }, [tasks]);

  const availableQuests = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of tasks) {
      if (!map.has(t.questId)) {
        map.set(t.questId, t.questName);
      }
    }
    return Array.from(map.entries())
      .map(([id, name]) => ({ value: id, label: name }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [tasks]);

  const hasActiveFilters = filters.search !== '' || filters.statuses.length > 0 ||
    filters.assignees.length > 0 || filters.roles.length > 0 ||
    filters.quests.length > 0 || filters.dateFrom !== '' || filters.dateTo !== '';

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-text-primary">Backlog</h1>
          <p className="text-sm text-text-tertiary mt-0.5">
            All tasks across quests in a sortable, filterable table view
          </p>
        </div>
        <span className="font-mono text-sm text-text-tertiary">
          {hasActiveFilters
            ? `${filtered.length} of ${tasks.length}`
            : `${tasks.length}`
          } task{tasks.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Filters */}
      <BacklogFilters
        filters={filters}
        onChange={setFilters}
        availableAssignees={availableAssignees}
        availableRoles={availableRoles}
        availableQuests={availableQuests}
      />

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-text-tertiary" />
        </div>
      ) : error ? (
        <div className="text-center py-20">
          <p className="text-red text-sm">{error}</p>
          <button
            onClick={fetchData}
            className="mt-3 text-sm text-text-secondary hover:text-text-primary underline"
          >
            Retry
          </button>
        </div>
      ) : (
        <BacklogTable data={filtered} />
      )}
    </div>
  );
}
