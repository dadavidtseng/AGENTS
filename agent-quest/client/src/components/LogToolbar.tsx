/**
 * LogToolbar — Filter, search, and export controls for LogViewer.
 *
 * Controlled component — parent manages state and passes it down.
 *
 * Features:
 *  - Log level filter pills
 *  - Source filter (observer/websocket/system)
 *  - Full-text search input
 *  - Export logs as downloadable .txt file
 */

import { useCallback } from 'react';
import type { LogLevel, LogEntry } from './LogViewer';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LogFilter {
  level: LogLevel | 'all';
  source: LogEntry['source'] | 'all';
  search: string;
}

export const DEFAULT_FILTER: LogFilter = {
  level: 'all',
  source: 'all',
  search: '',
};

export interface LogToolbarProps {
  filter: LogFilter;
  onChange: (filter: LogFilter) => void;
  entries: LogEntry[];
  className?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LEVEL_OPTIONS: { label: string; value: LogFilter['level'] }[] = [
  { label: 'All', value: 'all' },
  { label: 'Debug', value: 'debug' },
  { label: 'Info', value: 'info' },
  { label: 'Warn', value: 'warn' },
  { label: 'Error', value: 'error' },
];

const SOURCE_OPTIONS: { label: string; value: LogFilter['source'] }[] = [
  { label: 'All', value: 'all' },
  { label: 'Observer', value: 'observer' },
  { label: 'WebSocket', value: 'websocket' },
  { label: 'System', value: 'system' },
];

const LEVEL_PILL_COLORS: Record<string, string> = {
  all:   'border-border text-text-secondary',
  debug: 'border-text-tertiary/30 text-text-tertiary',
  info:  'border-blue/30 text-blue',
  warn:  'border-yellow/30 text-yellow',
  error: 'border-red/30 text-red',
};

const LEVEL_PILL_ACTIVE: Record<string, string> = {
  all:   'bg-white/10 border-white/20 text-text-primary',
  debug: 'bg-text-tertiary/10 border-text-tertiary/40 text-text-secondary',
  info:  'bg-blue/10 border-blue/40 text-blue',
  warn:  'bg-yellow/10 border-yellow/40 text-yellow',
  error: 'bg-red/10 border-red/40 text-red',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Apply filter to entries (used by parent to derive visible list). */
export function applyFilter(entries: LogEntry[], filter: LogFilter): LogEntry[] {
  return entries.filter((e) => {
    if (filter.level !== 'all' && e.level !== filter.level) return false;
    if (filter.source !== 'all' && e.source !== filter.source) return false;
    if (filter.search && !e.message.toLowerCase().includes(filter.search.toLowerCase())) return false;
    return true;
  });
}

/** Export entries as a downloadable .txt file. */
function exportLogs(entries: LogEntry[]) {
  const lines = entries.map(
    (e) => `[${e.timestamp}] [${e.level.toUpperCase()}] [${e.source}] ${e.message}`,
  );
  const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `logs-${Date.now()}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function LogToolbar({ filter, onChange, entries, className = '' }: LogToolbarProps) {
  const set = useCallback(
    (patch: Partial<LogFilter>) => onChange({ ...filter, ...patch }),
    [filter, onChange],
  );

  const filtered = applyFilter(entries, filter);

  return (
    <div className={`flex flex-wrap items-center gap-3 px-4 py-2.5 bg-bg-elevated border-b border-border ${className}`}>
      {/* Level pills */}
      <div className="flex items-center gap-1">
        {LEVEL_OPTIONS.map((opt) => {
          const active = filter.level === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => set({ level: opt.value })}
              className={`font-mono text-[0.65rem] px-2.5 py-1 rounded-full border transition-colors cursor-pointer ${
                active ? LEVEL_PILL_ACTIVE[opt.value] : LEVEL_PILL_COLORS[opt.value]
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>

      {/* Separator */}
      <div className="w-px h-4 bg-border" />

      {/* Source filter */}
      <select
        value={filter.source}
        onChange={(e) => set({ source: e.target.value as LogFilter['source'] })}
        className="font-mono text-[0.65rem] bg-transparent border border-border rounded px-2 py-1 text-text-secondary outline-none cursor-pointer"
      >
        {SOURCE_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>

      {/* Search input */}
      <div className="relative flex-1 min-w-[140px] max-w-[280px]">
        <input
          type="text"
          value={filter.search}
          onChange={(e) => set({ search: e.target.value })}
          placeholder="Search logs..."
          className="w-full font-mono text-[0.65rem] bg-transparent border border-border rounded px-2 py-1 pl-6 text-text-secondary placeholder:text-text-tertiary outline-none focus:border-blue/40 transition-colors"
        />
        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[0.6rem] text-text-tertiary pointer-events-none">
          ⌕
        </span>
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Count */}
      <span className="font-mono text-[0.6rem] text-text-tertiary">
        {filtered.length}/{entries.length}
      </span>

      {/* Export */}
      <button
        type="button"
        onClick={() => exportLogs(filtered)}
        disabled={filtered.length === 0}
        className="font-mono text-[0.65rem] px-2.5 py-1 rounded border border-border text-text-secondary hover:bg-white/5 transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
      >
        ↓ Export
      </button>
    </div>
  );
}
