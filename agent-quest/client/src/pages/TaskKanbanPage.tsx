/**
 * TaskKanbanPage — Task-level kanban board showing tasks from all quests.
 *
 * Columns: Pending → In Progress → Review → Completed → Failed
 * Each task card shows parent quest context (badge + colored border).
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { createPortal } from 'react-dom';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  DragStartEvent,
  DragEndEvent,
} from '@dnd-kit/core';
import { useWsEvent } from '../hooks/useWebSocket';
import { apiClient } from '../api/client';
import { KanbanColumn } from '../components/KanbanColumn';
import type { Task, TaskStatus, Quest } from '../types';

// ---------------------------------------------------------------------------
// Column definitions
// ---------------------------------------------------------------------------

interface TaskColumnDef {
  id: TaskStatus;
  label: string;
  accent: string;
}

const TASK_COLUMNS: TaskColumnDef[] = [
  { id: 'pending',          label: 'Pending',     accent: 'bg-text-tertiary' },
  { id: 'in_progress',      label: 'In Progress', accent: 'bg-blue' },
  { id: 'pending_approval', label: 'Review',      accent: 'bg-yellow' },
  { id: 'completed',        label: 'Completed',   accent: 'bg-green' },
  { id: 'failed',           label: 'Failed',      accent: 'bg-red' },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Generate deterministic hue from quest ID for colored borders */
function questHue(questId: string): number {
  let h = 0;
  for (let i = 0; i < questId.length; i++) h = (h * 31 + questId.charCodeAt(i)) | 0;
  return Math.abs(h) % 360;
}

/** Extract agent initial */
function agentInitial(name: string): string {
  const short = name.replace(/^agent-/i, '');
  return (short.charAt(0) || name.charAt(0)).toUpperCase();
}

/** Generate deterministic hue for agent avatar */
function agentHue(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return Math.abs(h) % 360;
}

// ---------------------------------------------------------------------------
// TaskCard Component
// ---------------------------------------------------------------------------

interface TaskCardProps {
  task: Task;
  quest: Quest;
  isDragging?: boolean;
}

function TaskCard({ task, quest, isDragging = false }: TaskCardProps) {
  const navigate = useNavigate();
  const hue = questHue(quest.questId);

  return (
    <div
      className={`bg-bg-elevated rounded-lg border-l-4 p-3 cursor-pointer transition-all hover:bg-bg-card ${
        isDragging ? 'opacity-50' : ''
      }`}
      style={{ borderLeftColor: `hsl(${hue}, 55%, 45%)` }}
      onClick={() => navigate(`/quests/${quest.questId}`)}
    >
      {/* Quest badge */}
      <div className="flex items-center gap-2 mb-2">
        <span
          className="text-[0.6rem] font-mono px-2 py-0.5 rounded-full text-white"
          style={{ backgroundColor: `hsl(${hue}, 55%, 45%)` }}
        >
          {quest.questName.slice(0, 20)}
          {quest.questName.length > 20 ? '...' : ''}
        </span>
      </div>

      {/* Task name */}
      <h4 className="text-sm font-medium text-text-primary mb-2 line-clamp-2">
        {task.name}
      </h4>

      {/* Task description */}
      {task.description && (
        <p className="text-[0.7rem] text-text-tertiary mb-2 line-clamp-2">
          {task.description}
        </p>
      )}

      {/* Footer: assignee */}
      <div className="flex items-center justify-between">
        {task.assignedAgent ? (
          <div className="flex items-center gap-1.5">
            <span
              className="w-5 h-5 rounded-full flex items-center justify-center text-[0.5rem] font-bold text-white"
              style={{ backgroundColor: `hsl(${agentHue(task.assignedAgent)}, 55%, 45%)` }}
            >
              {agentInitial(task.assignedAgent)}
            </span>
            <span className="text-[0.65rem] text-text-tertiary">
              {task.assignedAgent.replace(/^agent-/i, '')}
            </span>
          </div>
        ) : (
          <span className="text-[0.65rem] text-text-tertiary italic">Unassigned</span>
        )}

        {/* Task ID */}
        <span className="text-[0.6rem] font-mono text-text-tertiary">
          {task.id.slice(0, 6)}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DraggableTaskCard
// ---------------------------------------------------------------------------

interface DraggableTaskCardProps {
  task: Task;
  quest: Quest;
}

function DraggableTaskCard({ task, quest }: DraggableTaskCardProps) {
  const [isDragging, setIsDragging] = useState(false);

  return (
    <div
      draggable
      onDragStart={() => setIsDragging(true)}
      onDragEnd={() => setIsDragging(false)}
      className="touch-none"
    >
      <TaskCard task={task} quest={quest} isDragging={isDragging} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// TaskKanbanPage Component
// ---------------------------------------------------------------------------

export function TaskKanbanPage() {
  const [quests, setQuests] = useState<Quest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);

  // Remove constraints for full-width kanban board
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

  // Fetch all quests with tasks
  const fetchQuests = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      // First, get the list of quests
      const questList = await apiClient.getQuests();

      // Then fetch details for each quest (which includes tasks)
      const detailsPromises = questList.map(q => apiClient.getQuestDetails(q.questId));
      const questDetails = await Promise.all(detailsPromises);

      setQuests(questDetails);
      console.log(`[TaskKanbanPage] Loaded ${questDetails.length} quests with tasks`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tasks');
      console.error('[TaskKanbanPage] Error loading quests:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchQuests();
  }, [fetchQuests]);

  // Real-time updates
  useWsEvent('quest.updated', fetchQuests);
  useWsEvent('task.assigned', fetchQuests);
  useWsEvent('task.completed', fetchQuests);

  // Flatten all tasks from all quests
  const allTasks = useMemo(() => {
    const tasks: Array<{ task: Task; quest: Quest }> = [];
    for (const quest of quests) {
      if (quest.tasks) {
        for (const task of quest.tasks) {
          tasks.push({ task, quest });
        }
      }
    }
    return tasks;
  }, [quests]);

  // Group tasks by status
  const columnTasks = useMemo(() => {
    const map: Record<TaskStatus, Array<{ task: Task; quest: Quest }>> = {
      pending: [],
      in_progress: [],
      pending_approval: [],
      completed: [],
      failed: [],
    };

    for (const item of allTasks) {
      const status = item.task.status;
      if (map[status]) {
        map[status].push(item);
      }
    }

    return map;
  }, [allTasks]);

  // DnD setup
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  const handleDragStart = (event: DragStartEvent) => {
    setActiveTaskId(event.active.id as string);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveTaskId(null);
    // TODO: Implement task status update via API
    // For now, tasks are read-only (status changes require agent orchestration)
  };

  const activeItem = useMemo(() => {
    if (!activeTaskId) return null;
    return allTasks.find((item) => item.task.id === activeTaskId);
  }, [activeTaskId, allTasks]);

  // Render
  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue mx-auto mb-4" />
          <p className="text-text-secondary">Loading tasks...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center py-32">
        <div className="bg-bg-card rounded-xl border border-border p-8 max-w-md text-center">
          <div className="text-red text-4xl mb-4">⚠️</div>
          <h2 className="text-xl font-semibold tracking-tight text-text-primary mb-2">
            Failed to Load Tasks
          </h2>
          <p className="text-sm font-light text-text-secondary mb-4">{error}</p>
          <button
            onClick={fetchQuests}
            className="text-[0.85rem] font-medium text-bg bg-text-primary px-7 py-3 rounded-lg hover:opacity-85 hover:-translate-y-px transition-all cursor-pointer"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Header */}
      <div className="mb-8">
        <p className="font-mono text-[0.65rem] tracking-[0.15em] uppercase text-blue mb-3">
          Workflow
        </p>
        <h1 className="text-[2.5rem] font-semibold tracking-tight text-text-primary mb-2">
          Task Board
        </h1>
        <p className="text-[0.9rem] font-light leading-relaxed text-text-secondary">
          All tasks across quests — {allTasks.length} task{allTasks.length !== 1 ? 's' : ''}
        </p>
      </div>

      {/* Kanban board */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        autoScroll={false}
      >
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
          {TASK_COLUMNS.map((col) => (
            <div key={col.id} className="flex flex-col">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${col.accent}`} />
                  <h3 className="text-sm font-medium text-text-primary">{col.label}</h3>
                </div>
                <span className="text-[0.7rem] font-mono text-text-tertiary">
                  {columnTasks[col.id].length}
                </span>
              </div>

              <div className="space-y-2 min-h-[200px] bg-bg-elevated/30 rounded-lg p-2 border border-border/30 flex-1">
                {columnTasks[col.id].map((item) => (
                  <DraggableTaskCard
                    key={item.task.id}
                    task={item.task}
                    quest={item.quest}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Drag overlay */}
        {createPortal(
          <DragOverlay dropAnimation={null}>
            {activeItem ? (
              <div className="pointer-events-none">
                <TaskCard task={activeItem.task} quest={activeItem.quest} />
              </div>
            ) : null}
          </DragOverlay>,
          document.body,
        )}
      </DndContext>
    </>
  );
}
