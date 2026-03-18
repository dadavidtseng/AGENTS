/**
 * EventTimeline — Real-time event stream display.
 *
 * Shows KĀDI events (quest/task/agent lifecycle) in a scrollable list.
 * Features: expandable JSON payload, auto-scroll with pause, event type icons.
 */

import { useState, useRef, useEffect, useCallback } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TimelineEvent {
  id: number;
  type: string;
  timestamp: string;
  data: unknown;
  agent?: string;
  network?: string;
}

// ---------------------------------------------------------------------------
// Event type config
// ---------------------------------------------------------------------------

const EVENT_STYLES: Record<string, { icon: string; color: string; label: string }> = {
  'quest.created':       { icon: '✦', color: 'text-green',  label: 'Quest Created' },
  'quest.updated':       { icon: '↻', color: 'text-blue',   label: 'Quest Updated' },
  'quest.statusChanged': { icon: '◈', color: 'text-yellow', label: 'Quest Status' },
  'task.assigned':       { icon: '→', color: 'text-blue',   label: 'Task Assigned' },
  'task.completed':      { icon: '✓', color: 'text-green',  label: 'Task Completed' },
  'approval.requested':  { icon: '?', color: 'text-yellow', label: 'Approval' },
  'agent.connected':     { icon: '●', color: 'text-green',  label: 'Agent Connected' },
  'agent.disconnected':  { icon: '○', color: 'text-red',    label: 'Agent Disconnected' },
  'system.welcome':      { icon: '⚡', color: 'text-text-tertiary', label: 'System' },
};

function getEventStyle(type: string) {
  return EVENT_STYLES[type] ?? { icon: '•', color: 'text-text-tertiary', label: type };
}

// ---------------------------------------------------------------------------
// JSON syntax highlighter
// ---------------------------------------------------------------------------

function highlightJson(json: string): string {
  return json
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"([^"\\]*(\\.[^"\\]*)*)"\s*:/g, '<span class="text-blue">"$1"</span>:')
    .replace(/"([^"\\]*(\\.[^"\\]*)*)"/g, '<span class="text-green">"$1"</span>')
    .replace(/\b(true|false)\b/g, '<span class="text-yellow">$1</span>')
    .replace(/\b(null)\b/g, '<span class="text-red">$1</span>')
    .replace(/\b(\d+\.?\d*)\b/g, '<span class="text-[#c084fc]">$1</span>');
}

// ---------------------------------------------------------------------------
// Single event row
// ---------------------------------------------------------------------------

function EventRow({ event }: { event: TimelineEvent }) {
  const [expanded, setExpanded] = useState(false);
  const style = getEventStyle(event.type);

  const time = new Date(event.timestamp).toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });

  return (
    <div className="border-b border-border/30 hover:bg-bg-elevated/30 transition-colors">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left px-4 py-2.5 flex items-center gap-3 cursor-pointer"
      >
        {/* Icon */}
        <span className={`text-sm shrink-0 ${style.color}`}>{style.icon}</span>

        {/* Type badge */}
        <span className={`text-[0.7rem] font-mono shrink-0 ${style.color}`}>
          {style.label}
        </span>

        {/* Summary */}
        <span className="text-[0.8rem] text-text-secondary truncate flex-1 min-w-0">
          {event.agent && (
            <span className="text-text-tertiary">[{event.agent.replace(/^agent-/i, '')}] </span>
          )}
          {typeof event.data === 'object' && event.data !== null
            ? String(
                (event.data as Record<string, unknown>).questName ??
                (event.data as Record<string, unknown>).name ??
                (event.data as Record<string, unknown>).taskId ??
                event.type
              )
            : String(event.data ?? '')}
        </span>

        {/* Timestamp */}
        <span className="text-[0.6rem] font-mono text-text-tertiary shrink-0">{time}</span>

        {/* Expand indicator */}
        <svg
          className={`w-3 h-3 text-text-tertiary transition-transform shrink-0 ${expanded ? 'rotate-90' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </button>

      {/* Expanded payload */}
      {expanded && (
        <div className="px-4 pb-3">
          <pre
            className="p-3 rounded-lg bg-bg-elevated/60 border border-border/30 text-[0.7rem] leading-relaxed overflow-x-auto max-h-[300px] overflow-y-auto"
            style={{ fontFamily: "'JetBrains Mono', monospace" }}
            dangerouslySetInnerHTML={{
              __html: highlightJson(JSON.stringify(event.data, null, 2)),
            }}
          />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export interface EventTimelineProps {
  events: TimelineEvent[];
  className?: string;
}

export function EventTimeline({ events, className = '' }: EventTimelineProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const prevLenRef = useRef(events.length);

  // Auto-scroll to bottom when new events arrive
  useEffect(() => {
    if (autoScroll && events.length > prevLenRef.current && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
    prevLenRef.current = events.length;
  }, [events.length, autoScroll]);

  // Detect manual scroll → pause auto-scroll
  const handleScroll = useCallback(() => {
    if (!listRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = listRef.current;
    const atBottom = scrollHeight - scrollTop - clientHeight < 40;
    setAutoScroll(atBottom);
  }, []);

  if (events.length === 0) {
    return (
      <div className={`flex items-center justify-center py-16 text-text-tertiary text-sm ${className}`}>
        Waiting for events…
      </div>
    );
  }

  return (
    <div className={`relative ${className}`}>
      {/* Event list */}
      <div
        ref={listRef}
        onScroll={handleScroll}
        className="overflow-y-auto max-h-[calc(100vh-16rem)]"
      >
        {events.map((event) => (
          <EventRow key={event.id} event={event} />
        ))}
      </div>

      {/* Pause indicator */}
      {!autoScroll && (
        <button
          onClick={() => {
            setAutoScroll(true);
            if (listRef.current) {
              listRef.current.scrollTop = listRef.current.scrollHeight;
            }
          }}
          className="absolute bottom-3 right-3 px-3 py-1.5 rounded-lg bg-bg-card border border-border shadow-lg text-[0.75rem] text-text-secondary hover:text-text-primary transition-colors cursor-pointer flex items-center gap-1.5"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-yellow animate-pulse" />
          Paused — click to resume
        </button>
      )}
    </div>
  );
}
