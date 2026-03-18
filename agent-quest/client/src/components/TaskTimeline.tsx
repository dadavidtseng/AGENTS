/**
 * TaskTimeline — Chronological audit trail for a task's lifecycle.
 *
 * Shows state transitions, verification attempts (with scores),
 * assignment changes, and key timestamps. Collapsible detail sections
 * for verbose entries. Newest-first ordering.
 */

import { useState } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface VerificationEntry {
  score: number;
  summary: string;
  verifiedBy: string;
  timestamp: string;
  passed: boolean;
}

interface TaskArtifacts {
  verificationHistory?: VerificationEntry[];
  verified?: boolean;
  verificationScore?: number;
}

export interface TimelineTask {
  id: string;
  name: string;
  status: string;
  assignedAgent?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  artifacts?: TaskArtifacts;
}

// ---------------------------------------------------------------------------
// Timeline event model
// ---------------------------------------------------------------------------

interface TimelineEvent {
  id: string;
  timestamp: string;
  type: 'created' | 'assigned' | 'started' | 'verification' | 'completed' | 'failed';
  title: string;
  detail?: string;
  agent?: string;
  score?: number;
  passed?: boolean;
}

function buildEvents(task: TimelineTask): TimelineEvent[] {
  const events: TimelineEvent[] = [];

  // Created
  events.push({
    id: 'created',
    timestamp: task.createdAt,
    type: 'created',
    title: 'Task created',
  });

  // Assigned
  if (task.assignedAgent) {
    // Use createdAt + 1ms as proxy (assignment happens at creation in current model)
    events.push({
      id: 'assigned',
      timestamp: task.createdAt,
      type: 'assigned',
      title: `Assigned to ${task.assignedAgent.replace(/^agent-/i, '')}`,
      agent: task.assignedAgent,
    });
  }

  // Started
  if (task.startedAt) {
    events.push({
      id: 'started',
      timestamp: task.startedAt,
      type: 'started',
      title: 'Task started',
      agent: task.assignedAgent,
    });
  }

  // Verification attempts
  if (task.artifacts?.verificationHistory) {
    task.artifacts.verificationHistory.forEach((v, i) => {
      events.push({
        id: `verification-${i}`,
        timestamp: v.timestamp,
        type: 'verification',
        title: v.passed ? 'Verification passed' : 'Verification failed',
        detail: v.summary,
        agent: v.verifiedBy,
        score: v.score,
        passed: v.passed,
      });
    });
  }

  // Completed / Failed
  if (task.completedAt) {
    events.push({
      id: 'completed',
      timestamp: task.completedAt,
      type: task.status === 'failed' ? 'failed' : 'completed',
      title: task.status === 'failed' ? 'Task failed' : 'Task completed',
    });
  }

  // Sort newest-first
  events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  return events;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const EVENT_STYLES: Record<string, { dot: string; line: string }> = {
  created:      { dot: 'bg-text-tertiary', line: 'border-border/50' },
  assigned:     { dot: 'bg-blue',          line: 'border-blue/20' },
  started:      { dot: 'bg-blue',          line: 'border-blue/20' },
  verification: { dot: 'bg-yellow',        line: 'border-yellow/20' },
  completed:    { dot: 'bg-green',          line: 'border-green/20' },
  failed:       { dot: 'bg-red',            line: 'border-red/20' },
};

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  } catch { return '—'; }
}

function agentInitial(name: string): string {
  const short = name.replace(/^agent-/i, '');
  return (short.charAt(0) || name.charAt(0)).toUpperCase();
}

function hashHue(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h) % 360;
}

// ---------------------------------------------------------------------------
// Score badge
// ---------------------------------------------------------------------------

function ScoreBadge({ score, passed }: { score: number; passed: boolean }) {
  const color = passed ? 'text-green border-green/30' : 'text-red border-red/30';
  return (
    <span className={`inline-flex items-center gap-1 font-mono text-[0.7rem] border px-2 py-0.5 rounded-full ${color}`}>
      {passed ? '✓' : '✗'} {score}/100
    </span>
  );
}

// ---------------------------------------------------------------------------
// Collapsible event card
// ---------------------------------------------------------------------------

function TimelineEntry({ event }: { event: TimelineEvent }) {
  const [expanded, setExpanded] = useState(false);
  const style = EVENT_STYLES[event.type] ?? EVENT_STYLES.created;
  const hasDetail = !!event.detail;

  return (
    <div className="relative flex gap-4 pb-6 last:pb-0">
      {/* Vertical line + dot */}
      <div className="flex flex-col items-center">
        <div className={`w-2.5 h-2.5 rounded-full shrink-0 mt-1 ${style.dot}`} />
        <div className={`flex-1 w-px border-l ${style.line}`} />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 -mt-0.5">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-text-primary">{event.title}</span>

          {event.score !== undefined && (
            <ScoreBadge score={event.score} passed={event.passed ?? false} />
          )}

          {event.agent && (
            <span
              title={event.agent}
              className="w-4 h-4 rounded-full flex items-center justify-center text-[0.4rem] font-bold text-white shrink-0"
              style={{ backgroundColor: `hsl(${hashHue(event.agent)}, 55%, 45%)` }}
            >
              {agentInitial(event.agent)}
            </span>
          )}
        </div>

        <span className="text-[0.7rem] text-text-tertiary font-mono">
          {formatTimestamp(event.timestamp)}
        </span>

        {/* Collapsible detail */}
        {hasDetail && (
          <>
            <button
              onClick={() => setExpanded(!expanded)}
              className="mt-1 text-[0.75rem] text-text-tertiary hover:text-text-secondary transition-colors flex items-center gap-1 cursor-pointer"
            >
              <svg
                className={`w-3 h-3 transition-transform ${expanded ? 'rotate-90' : ''}`}
                fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
              {expanded ? 'Hide details' : 'Show details'}
            </button>

            {expanded && (
              <div className="mt-2 p-3 rounded-lg bg-bg-elevated/60 border border-border/30 text-[0.8rem] text-text-secondary leading-relaxed whitespace-pre-wrap">
                {event.detail}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export interface TaskTimelineProps {
  task: TimelineTask;
  className?: string;
}

export function TaskTimeline({ task, className = '' }: TaskTimelineProps) {
  const events = buildEvents(task);

  if (events.length === 0) {
    return (
      <div className={`text-center py-8 text-text-tertiary text-sm ${className}`}>
        No history available for this task
      </div>
    );
  }

  return (
    <div className={className}>
      {events.map((event) => (
        <TimelineEntry key={event.id} event={event} />
      ))}
    </div>
  );
}
