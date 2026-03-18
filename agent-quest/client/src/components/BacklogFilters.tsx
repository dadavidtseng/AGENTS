/**
 * BacklogFilters — Advanced filter bar for BacklogPage.
 *
 * Features:
 *  - Full-text search (task name + description + quest name)
 *  - Multi-select status filter (task-level statuses)
 *  - Multi-select assignee filter
 *  - Multi-select role filter
 *  - Multi-select quest filter
 *  - Date range filter (created date)
 *  - Saved filter presets (localStorage)
 *  - All state synced to URL search params
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import type { TaskStatus } from '../types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FilterState {
  search: string;
  statuses: TaskStatus[];
  assignees: string[];
  roles: string[];
  quests: string[];
  dateFrom: string;
  dateTo: string;
}

export const EMPTY_FILTERS: FilterState = {
  search: '',
  statuses: [],
  assignees: [],
  roles: [],
  quests: [],
  dateFrom: '',
  dateTo: '',
};

interface Preset {
  name: string;
  filters: FilterState;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ALL_STATUSES: { value: TaskStatus; label: string }[] = [
  { value: 'pending',          label: 'Pending' },
  { value: 'in_progress',      label: 'Active' },
  { value: 'pending_approval', label: 'Review' },
  { value: 'completed',        label: 'Done' },
  { value: 'failed',           label: 'Failed' },
];

const PRESETS_KEY = 'backlog-filter-presets';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadPresets(): Preset[] {
  try {
    const raw = localStorage.getItem(PRESETS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function savePresets(presets: Preset[]) {
  localStorage.setItem(PRESETS_KEY, JSON.stringify(presets));
}

function filtersActive(f: FilterState): boolean {
  return (
    f.search !== '' ||
    f.statuses.length > 0 ||
    f.assignees.length > 0 ||
    f.roles.length > 0 ||
    f.quests.length > 0 ||
    f.dateFrom !== '' ||
    f.dateTo !== ''
  );
}

// ---------------------------------------------------------------------------
// Multi-select dropdown (internal)
// ---------------------------------------------------------------------------

function MultiSelect({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: { value: string; label: string }[];
  selected: string[];
  onChange: (values: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const toggle = (val: string) => {
    onChange(
      selected.includes(val)
        ? selected.filter((s) => s !== val)
        : [...selected, val],
    );
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm transition-colors cursor-pointer ${
          selected.length > 0
            ? 'border-blue/40 bg-blue/10 text-text-primary'
            : 'border-border text-text-secondary hover:border-border-hover'
        }`}
      >
        {label}
        {selected.length > 0 && (
          <span className="font-mono text-[0.65rem] bg-blue/20 text-blue px-1.5 rounded-full">
            {selected.length}
          </span>
        )}
        <svg className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 min-w-[180px] bg-bg-card border border-border rounded-xl shadow-lg py-1 max-h-60 overflow-y-auto">
          {options.map((opt) => (
            <label
              key={opt.value}
              className="flex items-center gap-2 px-3 py-1.5 hover:bg-bg-elevated/60 cursor-pointer text-sm"
            >
              <input
                type="checkbox"
                className="accent-blue cursor-pointer"
                checked={selected.includes(opt.value)}
                onChange={() => toggle(opt.value)}
              />
              <span className="text-text-secondary">{opt.label}</span>
            </label>
          ))}
          {options.length === 0 && (
            <div className="px-3 py-2 text-text-tertiary text-sm">None available</div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export interface BacklogFiltersProps {
  filters: FilterState;
  onChange: (filters: FilterState) => void;
  /** Unique assignee names extracted from task data */
  availableAssignees: string[];
  /** Unique role names extracted from task data */
  availableRoles: string[];
  /** Quest options with id/label for the quest filter */
  availableQuests: { value: string; label: string }[];
}

export function BacklogFilters({
  filters,
  onChange,
  availableAssignees,
  availableRoles,
  availableQuests,
}: BacklogFiltersProps) {
  const [presets, setPresets] = useState<Preset[]>(loadPresets);
  const [presetMenuOpen, setPresetMenuOpen] = useState(false);
  const presetRef = useRef<HTMLDivElement>(null);

  // Close preset menu on outside click
  useEffect(() => {
    if (!presetMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (presetRef.current && !presetRef.current.contains(e.target as Node)) setPresetMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [presetMenuOpen]);

  const update = useCallback(
    (patch: Partial<FilterState>) => onChange({ ...filters, ...patch }),
    [filters, onChange],
  );

  const handleSavePreset = () => {
    const name = prompt('Preset name:');
    if (!name?.trim()) return;
    const next = [...presets.filter((p) => p.name !== name.trim()), { name: name.trim(), filters }];
    setPresets(next);
    savePresets(next);
  };

  const handleLoadPreset = (preset: Preset) => {
    onChange(preset.filters);
    setPresetMenuOpen(false);
  };

  const handleDeletePreset = (name: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const next = presets.filter((p) => p.name !== name);
    setPresets(next);
    savePresets(next);
  };

  const assigneeOptions = availableAssignees.map((a) => ({
    value: a,
    label: a.replace(/^agent-/i, ''),
  }));

  const roleOptions = availableRoles.map((r) => ({
    value: r,
    label: r.charAt(0).toUpperCase() + r.slice(1),
  }));

  const active = filtersActive(filters);

  return (
    <div className="flex flex-wrap items-center gap-2 mb-4">
      {/* Search */}
      <div className="relative flex-1 min-w-[200px] max-w-[320px]">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-tertiary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          type="text"
          placeholder="Search tasks..."
          value={filters.search}
          onChange={(e) => update({ search: e.target.value })}
          className="w-full pl-9 pr-3 py-1.5 rounded-lg border border-border bg-bg-elevated/40 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-blue/40 transition-colors"
        />
      </div>

      {/* Status filter */}
      <MultiSelect
        label="Status"
        options={ALL_STATUSES}
        selected={filters.statuses}
        onChange={(statuses) => update({ statuses: statuses as TaskStatus[] })}
      />

      {/* Assignee filter */}
      <MultiSelect
        label="Assignee"
        options={assigneeOptions}
        selected={filters.assignees}
        onChange={(assignees) => update({ assignees })}
      />

      {/* Role filter */}
      <MultiSelect
        label="Role"
        options={roleOptions}
        selected={filters.roles}
        onChange={(roles) => update({ roles })}
      />

      {/* Quest filter */}
      <MultiSelect
        label="Quest"
        options={availableQuests}
        selected={filters.quests}
        onChange={(quests) => update({ quests })}
      />

      {/* Date range */}
      <div className="flex items-center gap-1.5 text-sm">
        <input
          type="date"
          value={filters.dateFrom}
          onChange={(e) => update({ dateFrom: e.target.value })}
          className="px-2 py-1.5 rounded-lg border border-border bg-bg-elevated/40 text-text-secondary text-[0.8rem] focus:outline-none focus:border-blue/40 transition-colors [color-scheme:dark]"
          title="From date"
        />
        <span className="text-text-tertiary">–</span>
        <input
          type="date"
          value={filters.dateTo}
          onChange={(e) => update({ dateTo: e.target.value })}
          className="px-2 py-1.5 rounded-lg border border-border bg-bg-elevated/40 text-text-secondary text-[0.8rem] focus:outline-none focus:border-blue/40 transition-colors [color-scheme:dark]"
          title="To date"
        />
      </div>

      {/* Presets */}
      <div ref={presetRef} className="relative">
        <button
          onClick={() => setPresetMenuOpen(!presetMenuOpen)}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-border text-sm text-text-secondary hover:border-border-hover transition-colors cursor-pointer"
          title="Filter presets"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
          </svg>
          Presets
        </button>

        {presetMenuOpen && (
          <div className="absolute top-full right-0 mt-1 z-50 min-w-[200px] bg-bg-card border border-border rounded-xl shadow-lg py-1">
            {presets.length === 0 ? (
              <div className="px-3 py-2 text-text-tertiary text-sm">No saved presets</div>
            ) : (
              presets.map((p) => (
                <div
                  key={p.name}
                  className="flex items-center justify-between px-3 py-1.5 hover:bg-bg-elevated/60 cursor-pointer text-sm"
                  onClick={() => handleLoadPreset(p)}
                >
                  <span className="text-text-secondary truncate">{p.name}</span>
                  <button
                    onClick={(e) => handleDeletePreset(p.name, e)}
                    className="text-text-tertiary hover:text-red ml-2 shrink-0 cursor-pointer"
                    title="Delete preset"
                  >
                    ×
                  </button>
                </div>
              ))
            )}
            <div className="border-t border-border/50 mt-1 pt-1">
              <button
                onClick={handleSavePreset}
                disabled={!active}
                className="w-full text-left px-3 py-1.5 text-sm text-blue hover:bg-bg-elevated/60 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
              >
                Save current filters…
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Clear */}
      {active && (
        <button
          onClick={() => onChange(EMPTY_FILTERS)}
          className="text-sm text-text-tertiary hover:text-text-secondary transition-colors cursor-pointer"
        >
          Clear
        </button>
      )}
    </div>
  );
}
