/**
 * LogsPage — Real-time log viewer with two modes:
 *  1. Container Logs — streams from Docker/Podman containers via SSE
 *  2. Agent Logs — streams from KĀDI agents via broker log forwarding
 *
 * Features:
 *  - Tab switcher: Containers | Agent Logs
 *  - Sidebar selector (containers or agents)
 *  - "All" mode merges streams
 *  - Level filter, full-text search, auto-scroll
 *  - Color-coded by source + level
 *  - Export filtered logs to .txt
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useObserverContext } from '../contexts/ObserverContext';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ContainerInfo {
  id: string;
  name: string;
  image: string;
  status: string;
  state: string;
  ports: string[];
}

interface LogLine {
  id: number;
  container: string;
  timestamp: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
}

type LevelFilter = 'all' | 'debug' | 'info' | 'warn' | 'error';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_LINES = 2000;
const TAIL_COUNT = 300;

/** Container name → accent color (cycles through a palette). */
const CONTAINER_COLORS = [
  'text-blue',
  'text-green',
  'text-[#a855f7]',
  'text-yellow',
  'text-[#f472b6]',
  'text-[#22d3ee]',
  'text-[#fb923c]',
  'text-red',
];

const LEVEL_STYLES: Record<string, string> = {
  debug: 'text-text-tertiary',
  info:  'text-blue',
  warn:  'text-yellow',
  error: 'text-red',
};

const LEVEL_TAG: Record<string, string> = {
  debug: 'DBG',
  info:  'INF',
  warn:  'WRN',
  error: 'ERR',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let globalId = 0;

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso.slice(11, 23);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3 } as Intl.DateTimeFormatOptions);
  } catch {
    return iso.slice(0, 23);
  }
}

function exportLogs(lines: LogLine[]) {
  const text = lines
    .map((l) => `[${l.timestamp}] [${l.container}] [${l.level.toUpperCase()}] ${l.message}`)
    .join('\n');
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `container-logs-${Date.now()}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Hook: fetch container list
// ---------------------------------------------------------------------------

function useContainers(pollInterval = 15_000) {
  const [containers, setContainers] = useState<ContainerInfo[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetch_() {
      try {
        const res = await fetch('/api/containers');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!cancelled) {
          setContainers(data.containers ?? []);
          if (data.unavailable) {
            setError(data.reason ?? 'Container runtime not available');
          } else {
            setError(null);
          }
        }
      } catch (err: any) {
        if (!cancelled) setError(err.message);
      }
    }

    fetch_();
    const interval = setInterval(fetch_, pollInterval);
    return () => { cancelled = true; clearInterval(interval); };
  }, [pollInterval]);

  return { containers, error };
}

// ---------------------------------------------------------------------------
// Hook: SSE log stream for a single container
// ---------------------------------------------------------------------------

function useContainerLogs(
  containerName: string | null,
  opts?: { tail?: number },
) {
  const [lines, setLines] = useState<LogLine[]>([]);
  const [connected, setConnected] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!containerName) return;

    setLines([]);
    setConnected(false);

    const params = new URLSearchParams({
      tail: String(opts?.tail ?? TAIL_COUNT),
      follow: 'true',
      timestamps: 'true',
    });

    const url = `/api/containers/${encodeURIComponent(containerName)}/logs?${params}`;
    const es = new EventSource(url);
    esRef.current = es;

    es.onopen = () => setConnected(true);

    es.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data);
        const entry: LogLine = {
          id: ++globalId,
          container: data.container ?? containerName,
          timestamp: data.timestamp ?? new Date().toISOString(),
          level: data.level ?? 'info',
          message: data.message ?? '',
        };
        setLines((prev) => {
          const next = [...prev, entry];
          return next.length > MAX_LINES ? next.slice(-MAX_LINES) : next;
        });
      } catch { /* ignore */ }
    };

    es.addEventListener('error', (ev: any) => {
      // EventSource error event — check if there's a message from server
      setConnected(false);
    });

    return () => {
      es.close();
      esRef.current = null;
      setConnected(false);
    };
  }, [containerName, opts?.tail]);

  return { lines, connected };
}

// ---------------------------------------------------------------------------
// Hook: merged logs from ALL containers
// ---------------------------------------------------------------------------

function useAllContainerLogs(containerNames: string[], opts?: { tail?: number }) {
  const [lines, setLines] = useState<LogLine[]>([]);
  const [connectedSet, setConnectedSet] = useState<Set<string>>(new Set());
  const sourcesRef = useRef<Map<string, EventSource>>(new Map());

  useEffect(() => {
    if (containerNames.length === 0) return;

    setLines([]);
    setConnectedSet(new Set());

    const sources = new Map<string, EventSource>();

    for (const name of containerNames) {
      const params = new URLSearchParams({
        tail: String(opts?.tail ?? TAIL_COUNT),
        follow: 'true',
        timestamps: 'true',
      });

      const url = `/api/containers/${encodeURIComponent(name)}/logs?${params}`;
      const es = new EventSource(url);
      sources.set(name, es);

      es.onopen = () => {
        setConnectedSet((prev) => new Set([...prev, name]));
      };

      es.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data);
          const entry: LogLine = {
            id: ++globalId,
            container: data.container ?? name,
            timestamp: data.timestamp ?? new Date().toISOString(),
            level: data.level ?? 'info',
            message: data.message ?? '',
          };
          setLines((prev) => {
            const next = [...prev, entry];
            return next.length > MAX_LINES ? next.slice(-MAX_LINES) : next;
          });
        } catch { /* ignore */ }
      };

      es.addEventListener('error', () => {
        setConnectedSet((prev) => {
          const next = new Set(prev);
          next.delete(name);
          return next;
        });
      });
    }

    sourcesRef.current = sources;

    return () => {
      for (const es of sources.values()) es.close();
      sources.clear();
      setConnectedSet(new Set());
    };
  }, [containerNames.join(','), opts?.tail]);

  const connected = connectedSet.size > 0;
  return { lines, connected, connectedCount: connectedSet.size };
}

// ---------------------------------------------------------------------------
// Hook: agent log SSE stream
// ---------------------------------------------------------------------------

interface AgentLogLine {
  id: number;
  agentId: string;
  timestamp: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
}

function useAgentLogs(agentId: string | null, tail = 200) {
  const [lines, setLines] = useState<AgentLogLine[]>([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!agentId) {
      setLines([]);
      setConnected(false);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();

    async function stream() {
      try {
        const res = await fetch(`/api/agents/${encodeURIComponent(agentId!)}/logs?follow=true&tail=${tail}`, {
          signal: controller.signal,
        });
        if (!res.ok || !res.body) return;
        setConnected(true);

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let currentEvent: string | null = null;

        while (true) {
          const { done, value } = await reader.read();
          if (done || cancelled) break;
          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split('\n');
          buffer = parts.pop() ?? '';

          for (const line of parts) {
            if (line.startsWith('event: ')) {
              currentEvent = line.slice(7).trim();
            } else if (line.startsWith('data: ') && currentEvent === 'log') {
              try {
                const entry = JSON.parse(line.slice(6));
                if (!cancelled) {
                  setLines((prev) => {
                    const next = [...prev, {
                      id: ++globalId,
                      agentId: entry.agentId ?? agentId!,
                      timestamp: entry.timestamp ?? new Date().toISOString(),
                      level: entry.level ?? 'info',
                      message: entry.message ?? '',
                    }];
                    return next.length > MAX_LINES ? next.slice(-MAX_LINES) : next;
                  });
                }
              } catch { /* skip malformed */ }
              currentEvent = null;
            }
          }
        }
      } catch {
        /* abort or network error */
      } finally {
        if (!cancelled) setConnected(false);
      }
    }

    stream();
    return () => { cancelled = true; controller.abort(); };
  }, [agentId, tail]);

  return { lines, connected };
}

// ---------------------------------------------------------------------------
// Component: Agent Logs View
// ---------------------------------------------------------------------------

function AgentLogsView() {
  const { agents: observerAgents } = useObserverContext();
  const agents = useMemo(
    () => observerAgents.filter((a) => a.type === 'agent').sort((a, b) => a.name.localeCompare(b.name)),
    [observerAgents],
  );

  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const { lines, connected } = useAgentLogs(selectedAgent);

  const [levelFilter, setLevelFilter] = useState<LevelFilter>('all');
  const [search, setSearch] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(true);

  const filteredLines = useMemo(() => {
    return lines.filter((l) => {
      if (levelFilter !== 'all' && l.level !== levelFilter) return false;
      if (search && !l.message.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [lines, levelFilter, search]);

  useEffect(() => {
    if (pinned && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [filteredLines.length, pinned]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setPinned(el.scrollHeight - el.scrollTop - el.clientHeight < 60);
  }, []);

  const colorMap = useMemo(() => {
    const map = new Map<string, string>();
    agents.forEach((a, i) => map.set(a.name, CONTAINER_COLORS[i % CONTAINER_COLORS.length]));
    return map;
  }, [agents]);

  return (
    <>
      {agents.length === 0 && (
        <div className="px-4 py-3 rounded-lg bg-yellow/10 border border-yellow/20 text-sm text-yellow">
          No agents connected. Agent logs appear when agents publish via the broker.
        </div>
      )}

      <div className="flex gap-4">
        {/* Sidebar — agent pills */}
        <div className="w-48 shrink-0 space-y-1 max-h-[calc(100vh-240px)] overflow-y-auto">
          {agents.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => setSelectedAgent(a.name)}
              className={`w-full text-left font-mono text-[0.7rem] px-3 py-2 rounded-lg border transition-colors cursor-pointer ${
                selectedAgent === a.name
                  ? 'bg-white/10 border-white/20 text-text-primary'
                  : 'border-border text-text-secondary hover:bg-white/5'
              }`}
            >
              <div className="flex items-center gap-2">
                <span className={`w-1.5 h-1.5 rounded-full ${a.status === 'active' ? 'bg-green' : 'bg-red'}`} />
                <span className={colorMap.get(a.name) ?? 'text-text-secondary'}>{a.name}</span>
              </div>
            </button>
          ))}
        </div>

        {/* Main log area */}
        <div className="flex-1 min-w-0 bg-[#0a0a0a] rounded-xl border border-border overflow-hidden">
          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-3 px-4 py-2.5 bg-bg-elevated border-b border-border">
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${connected ? 'bg-green animate-pulse' : 'bg-red'}`} />
              <span className="font-mono text-[0.65rem] text-text-secondary">
                {connected ? 'Live' : selectedAgent ? 'Connecting...' : 'Select an agent'}
              </span>
            </div>

            <div className="flex items-center gap-1">
              {(['all', 'info', 'warn', 'error'] as LevelFilter[]).map((lvl) => {
                const active = levelFilter === lvl;
                const colors: Record<string, string> = {
                  all: active ? 'bg-white/10 border-white/20 text-text-primary' : 'border-border text-text-secondary',
                  info: active ? 'bg-blue/10 border-blue/40 text-blue' : 'border-border text-text-tertiary',
                  warn: active ? 'bg-yellow/10 border-yellow/40 text-yellow' : 'border-border text-text-tertiary',
                  error: active ? 'bg-red/10 border-red/40 text-red' : 'border-border text-text-tertiary',
                };
                return (
                  <button
                    key={lvl}
                    type="button"
                    onClick={() => setLevelFilter(lvl)}
                    className={`font-mono text-[0.6rem] px-2 py-0.5 rounded-full border transition-colors cursor-pointer ${colors[lvl]}`}
                  >
                    {lvl === 'all' ? 'All' : lvl.charAt(0).toUpperCase() + lvl.slice(1)}
                  </button>
                );
              })}
            </div>

            <div className="w-px h-4 bg-border" />

            <div className="relative flex-1 min-w-[140px] max-w-[280px]">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search logs..."
                className="w-full font-mono text-[0.65rem] bg-transparent border border-border rounded px-2 py-1 pl-6 text-text-secondary placeholder:text-text-tertiary outline-none focus:border-blue/40 transition-colors"
              />
              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[0.6rem] text-text-tertiary pointer-events-none">Q</span>
            </div>

            <div className="flex-1" />

            <span className="font-mono text-[0.6rem] text-text-tertiary">
              {filteredLines.length}/{lines.length}
            </span>

            <button
              type="button"
              onClick={() => { setPinned(true); bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }}
              className={`font-mono text-[0.6rem] px-2 py-0.5 rounded border transition-colors cursor-pointer ${
                pinned ? 'border-border text-text-tertiary' : 'border-blue/20 text-blue bg-blue/10'
              }`}
            >
              {pinned ? 'Auto-scroll' : 'Scroll to bottom'}
            </button>
          </div>

          {/* Log output */}
          <div
            ref={scrollRef}
            onScroll={handleScroll}
            className="max-h-[calc(100vh-280px)] overflow-y-auto overflow-x-hidden p-4 font-mono text-[0.7rem] leading-relaxed"
          >
            {!selectedAgent && (
              <p className="text-text-tertiary">Select an agent from the sidebar to view logs.</p>
            )}

            {selectedAgent && filteredLines.length === 0 && lines.length === 0 && (
              <p className="text-text-tertiary animate-pulse">
                {connected ? 'Waiting for log output...' : 'Connecting...'}
              </p>
            )}

            {filteredLines.map((line) => (
              <div key={line.id} className="flex gap-2 py-[1px] hover:bg-white/[0.02]">
                <span className="text-text-tertiary shrink-0 select-none w-[85px]">
                  {formatTime(line.timestamp)}
                </span>
                <span className={`shrink-0 w-7 text-center select-none ${LEVEL_STYLES[line.level] ?? 'text-text-secondary'}`}>
                  {LEVEL_TAG[line.level] ?? '???'}
                </span>
                <span className="text-text-secondary break-all whitespace-pre-wrap">{line.message}</span>
              </div>
            ))}

            <div ref={bottomRef} />
          </div>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Component: Container Logs View (original)
// ---------------------------------------------------------------------------

function ContainerLogsView() {
  // Container list
  const { containers, error: containerError } = useContainers();
  const containerNames = useMemo(() => containers.map((c) => c.name), [containers]);

  // Selection: null = "All"
  const [selected, setSelected] = useState<string | null>(null);

  // Filters
  const [levelFilter, setLevelFilter] = useState<LevelFilter>('all');
  const [search, setSearch] = useState('');
  const [pinned, setPinned] = useState(true);

  // Color map for container names
  const colorMap = useMemo(() => {
    const map = new Map<string, string>();
    containerNames.forEach((name, i) => {
      map.set(name, CONTAINER_COLORS[i % CONTAINER_COLORS.length]);
    });
    return map;
  }, [containerNames]);

  // Log streams
  const singleStream = useContainerLogs(selected, { tail: TAIL_COUNT });
  const allStream = useAllContainerLogs(
    selected === null ? containerNames : [],
    { tail: TAIL_COUNT },
  );

  const rawLines = selected === null ? allStream.lines : singleStream.lines;
  const isConnected = selected === null ? allStream.connected : singleStream.connected;

  // Apply filters
  const filteredLines = useMemo(() => {
    return rawLines.filter((l) => {
      if (levelFilter !== 'all' && l.level !== levelFilter) return false;
      if (search && !l.message.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [rawLines, levelFilter, search]);

  // Auto-scroll
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (pinned && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [filteredLines.length, pinned]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    setPinned(atBottom);
  }, []);

  // Search highlight
  const highlight = useCallback((text: string) => {
    if (!search) return text;
    const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const parts = text.split(new RegExp(`(${escaped})`, 'gi'));
    if (parts.length === 1) return text;
    return parts.map((part, i) =>
      new RegExp(escaped, 'i').test(part)
        ? <mark key={i} className="bg-yellow/25 text-yellow rounded-sm px-0.5">{part}</mark>
        : part,
    );
  }, [search]);

  return (
    <>
      {/* Error banner */}
      {containerError && (
        <div className="px-4 py-3 rounded-lg bg-red/10 border border-red/20 text-sm text-red">
          {containerError}
        </div>
      )}

      <div className="flex gap-4">
        {/* Sidebar — container pills */}
        <div className="w-48 shrink-0 space-y-1">
          <button
            type="button"
            onClick={() => setSelected(null)}
            className={`w-full text-left font-mono text-[0.7rem] px-3 py-2 rounded-lg border transition-colors cursor-pointer ${
              selected === null
                ? 'bg-white/10 border-white/20 text-text-primary'
                : 'border-border text-text-secondary hover:bg-white/5'
            }`}
          >
            All Containers
            {selected === null && (
              <span className="ml-1 text-[0.6rem] text-text-tertiary">
                ({containerNames.length})
              </span>
            )}
          </button>

          {containers.map((c) => (
            <button
              key={c.name}
              type="button"
              onClick={() => setSelected(c.name)}
              className={`w-full text-left font-mono text-[0.7rem] px-3 py-2 rounded-lg border transition-colors cursor-pointer ${
                selected === c.name
                  ? 'bg-white/10 border-white/20 text-text-primary'
                  : 'border-border text-text-secondary hover:bg-white/5'
              }`}
            >
              <div className="flex items-center gap-2">
                <span className={`w-1.5 h-1.5 rounded-full ${c.state === 'running' ? 'bg-green' : 'bg-red'}`} />
                <span className={colorMap.get(c.name) ?? 'text-text-secondary'}>{c.name}</span>
              </div>
            </button>
          ))}

          {containers.length === 0 && !containerError && (
            <p className="text-[0.65rem] text-text-tertiary px-3 py-2 animate-pulse">
              Loading containers...
            </p>
          )}
        </div>

        {/* Main log area */}
        <div className="flex-1 min-w-0 bg-[#0a0a0a] rounded-xl border border-border overflow-hidden">
          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-3 px-4 py-2.5 bg-bg-elevated border-b border-border">
            {/* Connection status */}
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green animate-pulse' : 'bg-red'}`} />
              <span className="font-mono text-[0.65rem] text-text-secondary">
                {isConnected ? 'Live' : 'Disconnected'}
              </span>
            </div>

            {/* Level filter pills */}
            <div className="flex items-center gap-1">
              {(['all', 'debug', 'info', 'warn', 'error'] as LevelFilter[]).map((lvl) => {
                const active = levelFilter === lvl;
                const colors: Record<string, string> = {
                  all: active ? 'bg-white/10 border-white/20 text-text-primary' : 'border-border text-text-secondary',
                  debug: active ? 'bg-text-tertiary/10 border-text-tertiary/40 text-text-secondary' : 'border-border text-text-tertiary',
                  info: active ? 'bg-blue/10 border-blue/40 text-blue' : 'border-border text-text-tertiary',
                  warn: active ? 'bg-yellow/10 border-yellow/40 text-yellow' : 'border-border text-text-tertiary',
                  error: active ? 'bg-red/10 border-red/40 text-red' : 'border-border text-text-tertiary',
                };
                return (
                  <button
                    key={lvl}
                    type="button"
                    onClick={() => setLevelFilter(lvl)}
                    className={`font-mono text-[0.6rem] px-2 py-0.5 rounded-full border transition-colors cursor-pointer ${colors[lvl]}`}
                  >
                    {lvl === 'all' ? 'All' : lvl.charAt(0).toUpperCase() + lvl.slice(1)}
                  </button>
                );
              })}
            </div>

            {/* Separator */}
            <div className="w-px h-4 bg-border" />

            {/* Search */}
            <div className="relative flex-1 min-w-[140px] max-w-[280px]">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search logs..."
                className="w-full font-mono text-[0.65rem] bg-transparent border border-border rounded px-2 py-1 pl-6 text-text-secondary placeholder:text-text-tertiary outline-none focus:border-blue/40 transition-colors"
              />
              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[0.6rem] text-text-tertiary pointer-events-none">
                Q
              </span>
            </div>

            {/* Spacer */}
            <div className="flex-1" />

            {/* Entry count */}
            <span className="font-mono text-[0.6rem] text-text-tertiary">
              {filteredLines.length}/{rawLines.length}
            </span>

            {/* Export */}
            <button
              type="button"
              onClick={() => exportLogs(filteredLines)}
              disabled={filteredLines.length === 0}
              className="font-mono text-[0.6rem] px-2 py-0.5 rounded border border-border text-text-secondary hover:bg-white/5 transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
            >
              Export
            </button>

            {/* Scroll to bottom */}
            <button
              type="button"
              onClick={() => {
                setPinned(true);
                bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
              }}
              className={`font-mono text-[0.6rem] px-2 py-0.5 rounded border transition-colors cursor-pointer ${
                pinned
                  ? 'border-border text-text-tertiary'
                  : 'border-blue/20 text-blue bg-blue/10'
              }`}
            >
              {pinned ? 'Auto-scroll' : 'Scroll to bottom'}
            </button>
          </div>

          {/* Log output */}
          <div
            ref={scrollRef}
            onScroll={handleScroll}
            className="max-h-[calc(100vh-280px)] overflow-y-auto overflow-x-hidden p-4 font-mono text-[0.7rem] leading-relaxed"
          >
            {filteredLines.length === 0 && rawLines.length === 0 && (
              <p className="text-text-tertiary animate-pulse">
                {isConnected ? 'Waiting for log output...' : 'Connecting to container...'}
              </p>
            )}

            {filteredLines.length === 0 && rawLines.length > 0 && (
              <p className="text-text-tertiary">
                No entries match the current filter ({rawLines.length} total).
              </p>
            )}

            {filteredLines.map((line) => (
              <div key={line.id} className="flex gap-2 py-[1px] hover:bg-white/[0.02]">
                {/* Timestamp */}
                <span className="text-text-tertiary shrink-0 select-none w-[85px]">
                  {formatTime(line.timestamp)}
                </span>

                {/* Container tag (in "All" mode) */}
                {selected === null && (
                  <span className={`shrink-0 w-[100px] truncate select-none ${colorMap.get(line.container) ?? 'text-text-secondary'}`}>
                    {line.container}
                  </span>
                )}

                {/* Level */}
                <span className={`shrink-0 w-7 text-center select-none ${LEVEL_STYLES[line.level] ?? 'text-text-secondary'}`}>
                  {LEVEL_TAG[line.level] ?? '???'}
                </span>

                {/* Message */}
                <span className="text-text-secondary break-all whitespace-pre-wrap">
                  {highlight(line.message)}
                </span>
              </div>
            ))}

            <div ref={bottomRef} />
          </div>
        </div>
      </div>
    </>
  );
}
// ---------------------------------------------------------------------------

type LogTab = 'containers' | 'agents';

export function LogsPage() {
  const [tab, setTab] = useState<LogTab>('containers');

  return (
    <div className="space-y-6">
      {/* Header + tabs */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-text-primary">Logs</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Real-time log streaming from containers and agents
        </p>

        {/* Tab switcher */}
        <div className="mt-4 flex gap-1">
          {([
            { key: 'containers' as LogTab, label: 'Containers' },
            { key: 'agents' as LogTab, label: 'Agent Logs' },
          ]).map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`font-mono text-[0.75rem] px-4 py-1.5 rounded-lg border transition-colors cursor-pointer ${
                tab === key
                  ? 'bg-white/10 border-white/20 text-text-primary'
                  : 'border-border text-text-secondary hover:bg-white/5'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'containers' ? <ContainerLogsView /> : <AgentLogsView />}
    </div>
  );
}
