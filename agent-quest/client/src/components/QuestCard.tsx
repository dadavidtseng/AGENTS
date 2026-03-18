/**
 * QuestCard — Compact quest card for KanbanBoard columns.
 *
 * Shows: title, task count, progress bar, assignee avatars, status badge.
 * Expandable: click chevron to reveal TaskSwimLane with nested task DnD.
 * Uses glassmorphism Card primitive from design system.
 */

import { useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDraggable } from '@dnd-kit/core';
import { Card } from './ui/Card';
import { Badge } from './ui/Badge';
import { TaskSwimLane } from './TaskSwimLane';
import { apiClient } from '../api/client';
import type { Quest, QuestStatus, Task } from '../types';

// ---------------------------------------------------------------------------
// Status config
// ---------------------------------------------------------------------------

const STATUS_CONFIG: Record<QuestStatus, { dot: string; label: string }> = {
  draft:            { dot: 'bg-text-tertiary', label: 'Draft' },
  pending_approval: { dot: 'bg-yellow',        label: 'Pending' },
  approved:         { dot: 'bg-green',          label: 'Approved' },
  rejected:         { dot: 'bg-red',            label: 'Rejected' },
  in_progress:      { dot: 'bg-blue',           label: 'Active' },
  completed:        { dot: 'bg-green',          label: 'Done' },
  cancelled:        { dot: 'bg-text-tertiary',  label: 'Cancelled' },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getProgressColor(pct: number): string {
  if (pct >= 100) return 'bg-green';
  if (pct >= 60)  return 'bg-blue';
  if (pct >= 30)  return 'bg-yellow';
  return 'bg-text-tertiary';
}

/** Generate a deterministic hue from a string (for avatar colors). */
function hashHue(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h) % 360;
}

/** Extract a meaningful initial from an agent name (strip "agent-" prefix). */
function agentInitial(name: string): string {
  const short = name.replace(/^agent-/i, '');
  return (short.charAt(0) || name.charAt(0)).toUpperCase();
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface QuestCardProps {
  quest: Quest;
  /** Enable expand/collapse for task swimlane (disabled in DragOverlay) */
  expandable?: boolean;
  className?: string;
}

export function QuestCard({ quest, expandable = false, className = '' }: QuestCardProps) {
  const navigate = useNavigate();
  const cfg = STATUS_CONFIG[quest.status];

  const [expanded, setExpanded] = useState(false);
  const [tasks, setTasks] = useState<Task[] | null>(quest.tasks ?? null);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [taskLoadError, setTaskLoadError] = useState(false);

  const { total, completed, pct, assignees } = useMemo(() => {
    const tks = tasks ?? quest.tasks ?? [];
    const t = tks.length || (quest.taskCount ?? 0);
    const c = tks.filter((tk) => tk.status === 'completed').length;
    const p = t > 0 ? Math.round((c / t) * 100) : 0;
    const agents = [...new Set(tks.map((tk) => tk.assignedAgent).filter(Boolean))] as string[];
    return { total: t, completed: c, pct: p, assignees: agents };
  }, [quest, tasks]);

  const handleToggleExpand = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent navigation + drag
    e.preventDefault();

    if (expanded) {
      setExpanded(false);
      return;
    }

    setExpanded(true);

    // Fetch tasks if not already loaded
    if (!tasks || tasks.length === 0) {
      try {
        setLoadingTasks(true);
        setTaskLoadError(false);
        const detail = await apiClient.getQuestDetails(quest.questId);
        setTasks(detail.tasks ?? []);
      } catch {
        setTaskLoadError(true);
      } finally {
        setLoadingTasks(false);
      }
    }
  }, [expanded, tasks, quest.questId]);

  const handleTaskStatusChange = useCallback((taskId: string, newStatus: string) => {
    // Optimistic update
    setTasks((prev) =>
      (prev ?? []).map((t) =>
        t.id === taskId ? { ...t, status: newStatus as Task['status'] } : t,
      ),
    );
    // No backend call for now — task status changes require agent orchestration
  }, []);

  const hasTasks = total > 0;

  return (
    <Card
      variant="elevated"
      padding="sm"
      hoverGradient
      className={`cursor-pointer group ${className}`}
      onClick={() => navigate(`/quests/${quest.questId}`)}
    >
      {/* Header: badge + id */}
      <div className="flex items-center justify-between mb-2">
        <Badge dot={cfg.dot} pulse={quest.status === 'in_progress' || quest.status === 'pending_approval'}>
          {cfg.label}
        </Badge>
        <span className="font-mono text-[0.6rem] text-text-tertiary">
          {quest.questId.slice(0, 8)}
        </span>
      </div>

      {/* Title */}
      <h4 className="text-sm font-medium tracking-tight text-text-primary mb-1 line-clamp-2 group-hover:text-blue transition-colors">
        {quest.questName}
      </h4>

      {/* Description */}
      {quest.description && !expanded && (
        <p className="text-[0.75rem] font-light text-text-tertiary mb-3 line-clamp-1">
          {quest.description}
        </p>
      )}

      {/* Progress bar */}
      {total > 0 && (
        <div className="mb-3">
          <div className="flex items-center justify-between text-[0.6rem] font-mono text-text-tertiary mb-1">
            <span>{completed}/{total} tasks</span>
            <span>{pct}%</span>
          </div>
          <div className="w-full bg-border rounded-full h-1">
            <div
              className={`h-1 rounded-full transition-all ${getProgressColor(pct)}`}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      )}

      {/* Footer: assignee avatars + expand toggle */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          {assignees.slice(0, 4).map((agent) => (
            <span
              key={agent}
              title={agent}
              className="w-5 h-5 rounded-full flex items-center justify-center text-[0.5rem] font-bold text-white shrink-0"
              style={{ backgroundColor: `hsl(${hashHue(agent)}, 55%, 45%)` }}
            >
              {agentInitial(agent)}
            </span>
          ))}
          {assignees.length > 4 && (
            <span className="text-[0.6rem] font-mono text-text-tertiary ml-1">
              +{assignees.length - 4}
            </span>
          )}
        </div>

        {/* Expand toggle */}
        {expandable && hasTasks && (
          <button
            onClick={handleToggleExpand}
            className="text-text-tertiary hover:text-text-secondary transition-colors p-1 -mr-1 cursor-pointer"
            title={expanded ? 'Collapse tasks' : 'Expand tasks'}
          >
            <svg
              className={`w-3.5 h-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        )}
      </div>

      {/* Task swimlane (expanded) */}
      {expandable && expanded && (
        <div onClick={(e) => e.stopPropagation()}>
          {loadingTasks ? (
            <div className="mt-2 border-t border-border/30 pt-2">
              <div className="flex items-center justify-center py-3">
                <div className="animate-spin rounded-full h-4 w-4 border-b border-text-tertiary" />
              </div>
            </div>
          ) : taskLoadError ? (
            <div className="mt-2 border-t border-border/30 pt-2">
              <p className="text-[0.7rem] text-red text-center py-2">Failed to load tasks</p>
            </div>
          ) : (
            <TaskSwimLane
              tasks={tasks ?? []}
              onTaskStatusChange={handleTaskStatusChange}
            />
          )}
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Draggable wrapper for KanbanBoard
// ---------------------------------------------------------------------------

export function DraggableQuestCard({ quest, className = '' }: QuestCardProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: quest.questId,
  });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`touch-none transition-opacity ${isDragging ? 'opacity-20' : ''}`}
    >
      <QuestCard quest={quest} expandable className={className} />
    </div>
  );
}
