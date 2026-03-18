/**
 * LogViewer — Terminal-style real-time log viewer.
 *
 * Connects to the SSE log endpoint (GET /api/agents/:agentId/logs)
 * and renders entries in a scrollable, auto-scrolling container.
 *
 * Features:
 *  - Level color coding (debug=muted, info=blue, warn=yellow, error=red)
 *  - Auto-scroll with "pin to bottom" toggle
 *  - JetBrains Mono font via design system
 *  - History marker separating initial tail from live entries
 */

import { useState, useEffect, useRef, useCallback, type ReactNode } from 'react';

// ---------------------------------------------------------------------------
// Types (mirrors server LogEntry)
// ---------------------------------------------------------------------------

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  id: number;
  agentId: string;
  level: LogLevel;
  message: string;
  timestamp: string;
  source: 'observer' | 'websocket' | 'system';
}

// ---------------------------------------------------------------------------
// Level styling
// ---------------------------------------------------------------------------

const LEVEL_COLORS: Record<LogLevel, string> = {
  debug: 'text-text-tertiary',
  info:  'text-blue',
  warn:  'text-yellow',
  error: 'text-red',
};

const LEVEL_TAG: Record<LogLevel, string> = {
  debug: 'DBG',
  info:  'INF',
  warn:  'WRN',
  error: 'ERR',
};

// ---------------------------------------------------------------------------
// Hook: SSE log stream
// ---------------------------------------------------------------------------

function useLogStream(agentId: string | null, options?: { tail?: number; level?: LogLevel }) {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [connected, setConnected] = useState(false);
  const [historyDone, setHistoryDone] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!agentId) return;

    setEntries([]);
    setHistoryDone(false);

    const params = new URLSearchParams();
    if (options?.tail) params.set('tail', String(options.tail));
    if (options?.level) params.set('level', options.level);
    params.set('follow', 'true');

    const url = `/api/agents/${encodeURIComponent(agentId)}/logs?${params}`;
    const es = new EventSource(url);
    esRef.current = es;

    es.onopen = () => setConnected(true);

    es.onmessage = (ev) => {
      try {
        const entry = JSON.parse(ev.data) as LogEntry;
        setEntries((prev) => [...prev, entry]);
      } catch {
        // ignore
      }
    };

    es.addEventListener('history-end', () => {
      setHistoryDone(true);
    });

    es.onerror = () => {
      setConnected(false);
    };

    return () => {
      es.close();
      esRef.current = null;
      setConnected(false);
    };
  }, [agentId, options?.tail, options?.level]);

  return { entries, connected, historyDone };
}

// ---------------------------------------------------------------------------
// Timestamp formatter
// ---------------------------------------------------------------------------

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// ---------------------------------------------------------------------------
// Search highlight
// ---------------------------------------------------------------------------

function highlightMatch(text: string, query: string): ReactNode {
  if (!query) return text;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escaped})`, 'gi');
  const parts = text.split(regex);
  if (parts.length === 1) return text;
  return parts.map((part, i) =>
    regex.test(part) ? (
      <mark key={i} className="bg-yellow/25 text-yellow rounded-sm px-0.5">
        {part}
      </mark>
    ) : (
      part
    ),
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface LogViewerProps {
  agentId: string | null;
  /** Number of historical entries to fetch. Default 100. */
  tail?: number;
  /** Minimum log level filter. */
  level?: LogLevel;
  /** Search query — matching terms are highlighted in log lines. */
  searchQuery?: string;
  /** Max height CSS class. Default "max-h-[400px]". */
  maxHeight?: string;
  className?: string;
}

export function LogViewer({
  agentId,
  tail = 100,
  level,
  searchQuery = '',
  maxHeight = 'max-h-[400px]',
  className = '',
}: LogViewerProps) {
  const { entries, connected, historyDone } = useLogStream(agentId, { tail, level });
  const [pinned, setPinned] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll when pinned
  useEffect(() => {
    if (pinned && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [entries.length, pinned]);

  // Detect manual scroll-up to unpin
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    setPinned(atBottom);
  }, []);

  if (!agentId) {
    return (
      <div className={`bg-bg rounded-xl border border-border p-8 text-center ${className}`}>
        <p className="text-sm text-text-tertiary">Select an agent to view logs</p>
      </div>
    );
  }

  return (
    <div className={`bg-[#0a0a0a] rounded-xl border border-border overflow-hidden ${className}`}>
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-bg-elevated">
        <div className="flex items-center gap-2">
          <span
            className={`w-2 h-2 rounded-full ${connected ? 'bg-green animate-pulse-dot' : 'bg-red'}`}
          />
          <span className="font-mono text-[0.65rem] text-text-secondary">
            {connected ? 'Live' : 'Disconnected'}
          </span>
          <span className="font-mono text-[0.6rem] text-text-tertiary">
            {entries.length} entries
          </span>
        </div>
        <button
          type="button"
          onClick={() => {
            setPinned(true);
            bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
          }}
          className={`font-mono text-[0.6rem] px-2 py-1 rounded transition-colors cursor-pointer ${
            pinned
              ? 'text-text-tertiary'
              : 'text-blue bg-blue/10 border border-blue/20'
          }`}
        >
          {pinned ? '⬇ Auto-scroll' : '⬇ Scroll to bottom'}
        </button>
      </div>

      {/* Log output */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className={`${maxHeight} overflow-y-auto overflow-x-hidden p-4 font-mono text-[0.75rem] leading-relaxed`}
      >
        {entries.length === 0 && !historyDone && (
          <p className="text-text-tertiary animate-pulse">Loading logs...</p>
        )}
        {entries.length === 0 && historyDone && (
          <p className="text-text-tertiary">No log entries yet. Waiting for events...</p>
        )}

        {entries.map((entry, i) => (
          <div key={entry.id} className="flex gap-3 py-0.5 hover:bg-white/[0.02]">
            {/* Timestamp */}
            <span className="text-text-tertiary shrink-0 select-none">
              {formatTimestamp(entry.timestamp)}
            </span>
            {/* Level tag */}
            <span className={`${LEVEL_COLORS[entry.level]} shrink-0 w-7 text-center select-none`}>
              {LEVEL_TAG[entry.level]}
            </span>
            {/* Message */}
            <span className="text-text-secondary break-all">
              {highlightMatch(entry.message, searchQuery)}
            </span>
            {/* History marker */}
            {historyDone && i === entries.length - 1 && !connected && null}
          </div>
        ))}

        {/* History separator */}
        {historyDone && entries.length > 0 && (
          <div className="flex items-center gap-2 py-2 select-none">
            <div className="flex-1 border-t border-border" />
            <span className="text-[0.6rem] text-text-tertiary">live</span>
            <div className="flex-1 border-t border-border" />
          </div>
        )}

        <div ref={bottomRef} />
      </div>
    </div>
  );
}

