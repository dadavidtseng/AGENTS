/**
 * TaskSwimLane — Expandable task status lanes inside a quest card.
 *
 * Groups tasks by status into mini droppable lanes.
 * Uses a separate DndContext to avoid conflicts with the parent quest DnD.
 *
 * Lanes: Pending → Active → Done (failed tasks shown inline with a red badge).
 */

import { useState, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  closestCenter,
} from '@dnd-kit/core';
import type { DragStartEvent, DragEndEvent } from '@dnd-kit/core';
import { DraggableTaskCard, TaskCard } from './TaskCard';
import type { Task, TaskStatus } from '../types';

// ---------------------------------------------------------------------------
// Lane definitions
// ---------------------------------------------------------------------------

interface LaneDef {
  id: string;
  label: string;
  statuses: TaskStatus[];
  accent: string;
}

const LANES: LaneDef[] = [
  { id: 'pending',  label: 'Pending',  statuses: ['pending'],                       accent: 'bg-text-tertiary' },
  { id: 'active',   label: 'Active',   statuses: ['in_progress', 'pending_approval'], accent: 'bg-blue' },
  { id: 'done',     label: 'Done',     statuses: ['completed', 'failed'],           accent: 'bg-green' },
];

/** Map lane id → target TaskStatus when a task is dropped */
const LANE_TO_STATUS: Record<string, TaskStatus> = {
  pending: 'pending',
  active:  'in_progress',
  done:    'completed',
};

/** Map TaskStatus → lane id */
function statusToLane(status: TaskStatus): string {
  for (const lane of LANES) {
    if (lane.statuses.includes(status)) return lane.id;
  }
  return 'pending';
}

// ---------------------------------------------------------------------------
// Mini droppable lane
// ---------------------------------------------------------------------------

function SwimLaneColumn({ lane, tasks }: { lane: LaneDef; tasks: Task[] }) {
  const { setNodeRef, isOver } = useDroppable({ id: lane.id });

  return (
    <div
      ref={setNodeRef}
      className={`flex-1 min-w-0 rounded-lg p-1.5 transition-colors ${
        isOver ? 'bg-blue/10 ring-1 ring-blue/20' : ''
      }`}
    >
      {/* Lane header */}
      <div className="flex items-center gap-1.5 px-1 mb-1.5">
        <span className={`w-1 h-1 rounded-full ${lane.accent}`} />
        <span className="text-[0.6rem] font-medium text-text-tertiary uppercase tracking-wider">
          {lane.label}
        </span>
        <span className="text-[0.55rem] font-mono text-text-tertiary">
          {tasks.length}
        </span>
      </div>

      {/* Task cards */}
      <div className="flex flex-col gap-1 min-h-[28px]">
        {tasks.length === 0 ? (
          <div className={`text-[0.55rem] text-text-tertiary text-center py-1.5 border border-dashed rounded-md transition-colors ${
            isOver ? 'border-blue/30' : 'border-border/30'
          }`}>
            {isOver ? 'Drop' : '—'}
          </div>
        ) : (
          tasks.map((task) => (
            <DraggableTaskCard key={task.id} task={task} />
          ))
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export interface TaskSwimLaneProps {
  tasks: Task[];
  /** Called when a task is moved to a new status via drag */
  onTaskStatusChange?: (taskId: string, newStatus: TaskStatus) => void;
  className?: string;
}

export function TaskSwimLane({ tasks, onTaskStatusChange, className = '' }: TaskSwimLaneProps) {
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);

  // Separate sensor for task-level DnD (shorter activation distance)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  // Group tasks by lane
  const laneTasks = useMemo(() => {
    const map: Record<string, Task[]> = {};
    for (const lane of LANES) map[lane.id] = [];
    for (const task of tasks) {
      const laneId = statusToLane(task.status);
      map[laneId]?.push(task);
    }
    return map;
  }, [tasks]);

  const activeTask = activeTaskId
    ? tasks.find((t) => t.id === activeTaskId.replace('task-', ''))
    : null;

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveTaskId(String(event.active.id));
  }, []);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    setActiveTaskId(null);
    const { active, over } = event;
    if (!over) return;

    const taskId = String(active.id).replace('task-', '');
    const targetLane = String(over.id);
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;

    const sourceLane = statusToLane(task.status);
    if (sourceLane === targetLane) return;

    const newStatus = LANE_TO_STATUS[targetLane];
    if (newStatus) {
      onTaskStatusChange?.(taskId, newStatus);
    }
  }, [tasks, onTaskStatusChange]);

  if (tasks.length === 0) return null;

  return (
    <div className={`mt-2 ${className}`}>
      {/* Separator */}
      <div className="border-t border-border/30 mb-2" />

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        autoScroll={false}
      >
        <div className="flex gap-1">
          {LANES.map((lane) => (
            <SwimLaneColumn
              key={lane.id}
              lane={lane}
              tasks={laneTasks[lane.id] ?? []}
            />
          ))}
        </div>

        {/* Task drag overlay — portal to body */}
        {createPortal(
          <DragOverlay dropAnimation={null}>
            {activeTask ? (
              <div className="pointer-events-none opacity-90">
                <TaskCard task={activeTask} />
              </div>
            ) : null}
          </DragOverlay>,
          document.body,
        )}
      </DndContext>
    </div>
  );
}
