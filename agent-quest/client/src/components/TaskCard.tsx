/**
 * TaskCard — Compact task card for kanban swimlanes.
 *
 * Shows: status dot, task name (truncated), assignee avatar.
 * Used inside TaskSwimLane within expanded QuestCards.
 */

import { useDraggable } from '@dnd-kit/core';
import type { TaskStatus, Task } from '../types';

// ---------------------------------------------------------------------------
// Status config
// ---------------------------------------------------------------------------

const TASK_STATUS_CONFIG: Record<TaskStatus, { color: string; label: string }> = {
  pending:          { color: 'bg-text-tertiary', label: 'Pending' },
  in_progress:      { color: 'bg-blue',          label: 'Active' },
  pending_approval: { color: 'bg-yellow',        label: 'Review' },
  completed:        { color: 'bg-green',          label: 'Done' },
  failed:           { color: 'bg-red',            label: 'Failed' },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Deterministic hue from string (for avatar colors). */
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

export interface TaskCardProps {
  task: Task;
  className?: string;
}

export function TaskCard({ task, className = '' }: TaskCardProps) {
  const cfg = TASK_STATUS_CONFIG[task.status];

  return (
    <div
      className={`flex items-center gap-2 px-2.5 py-2 rounded-lg bg-bg-elevated/60 border border-border/50 text-[0.75rem] group/task hover:bg-bg-card transition-colors ${className}`}
    >
      {/* Status dot */}
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${cfg.color}`} />

      {/* Task name */}
      <span className="text-text-primary font-medium truncate flex-1 min-w-0">
        {task.name}
      </span>

      {/* Assignee avatar */}
      {task.assignedAgent && (
        <span
          title={task.assignedAgent}
          className="w-4 h-4 rounded-full flex items-center justify-center text-[0.45rem] font-bold text-white shrink-0"
          style={{ backgroundColor: `hsl(${hashHue(task.assignedAgent)}, 55%, 45%)` }}
        >
          {agentInitial(task.assignedAgent)}
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Draggable wrapper for TaskSwimLane
// ---------------------------------------------------------------------------

export function DraggableTaskCard({ task, className = '' }: TaskCardProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `task-${task.id}`,
    data: { type: 'task', task },
  });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`touch-none transition-opacity ${isDragging ? 'opacity-20' : ''}`}
    >
      <TaskCard task={task} className={className} />
    </div>
  );
}
