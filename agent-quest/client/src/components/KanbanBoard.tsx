/**
 * KanbanBoard — Visual quest workflow board with drag-and-drop.
 *
 * Columns follow the actual quest lifecycle:
 *   Draft → Pending Approval → Approved → In Progress → Completed → Closed
 *
 * Uses @dnd-kit DndContext for drag between columns.
 * Real-time sync via useKanbanSync hook (WebSocket + file-watcher events).
 */

import { useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
} from '@dnd-kit/core';
import { useKanbanSync } from '../hooks/useKanbanSync';
import { useKanbanDnd } from '../hooks/useKanbanDnd';
import { KanbanColumn } from './KanbanColumn';
import { QuestCard } from './QuestCard';
import type { KanbanColumnDef } from './KanbanColumn';
import type { Quest, QuestStatus } from '../types';

// ---------------------------------------------------------------------------
// Column definitions
// ---------------------------------------------------------------------------

const COLUMNS: KanbanColumnDef[] = [
  { id: 'draft',            label: 'Draft',            accent: 'bg-text-tertiary' },
  { id: 'pending_approval', label: 'Pending Approval', accent: 'bg-yellow' },
  { id: 'approved',         label: 'Approved',         accent: 'bg-[#a855f7]' },
  { id: 'in_progress',      label: 'In Progress',      accent: 'bg-blue' },
  { id: 'completed',        label: 'Completed',        accent: 'bg-green' },
  { id: 'closed',           label: 'Closed',           accent: 'bg-red' },
];

/** Map QuestStatus → column id */
const STATUS_TO_COLUMN: Record<QuestStatus, string> = {
  draft:            'draft',
  pending_approval: 'pending_approval',
  approved:         'approved',
  in_progress:      'in_progress',
  completed:        'completed',
  rejected:         'closed',
  cancelled:        'closed',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface KanbanBoardProps {
  className?: string;
}

export function KanbanBoard({ className = '' }: KanbanBoardProps) {
  // ---- Real-time data sync ----
  const { quests, setQuests, loading, error, reload } = useKanbanSync();

  // ---- DnD ----
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );
  const dnd = useKanbanDnd(quests, setQuests);

  // ---- Distribute quests into columns ----
  const columnQuests = useMemo(() => {
    const map: Record<string, Quest[]> = {};
    for (const col of COLUMNS) map[col.id] = [];
    for (const q of quests) {
      const colId = STATUS_TO_COLUMN[q.status] ?? 'draft';
      map[colId]?.push(q);
    }
    return map;
  }, [quests]);

  const activeQuest = dnd.activeId ? quests.find((q) => q.questId === dnd.activeId) : null;

  // ---- Render ----

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue mx-auto mb-4" />
          <p className="text-text-secondary text-sm">Loading board...</p>
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
            Failed to Load Board
          </h2>
          <p className="text-sm font-light text-text-secondary mb-4">{error}</p>
          <button
            onClick={reload}
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
      {/* Error toast */}
      {dnd.error && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-red/90 text-white text-sm px-4 py-2 rounded-lg shadow-lg backdrop-blur-sm animate-fade-in">
          {dnd.error}
        </div>
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={dnd.onDragStart}
        onDragEnd={dnd.onDragEnd}
        autoScroll={false}
      >
        <div className={`grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-3 ${className}`}>
          {COLUMNS.map((col) => (
            <KanbanColumn
              key={col.id}
              column={col}
              quests={columnQuests[col.id] ?? []}
            />
          ))}
        </div>

        {/* Drag overlay — portal to document.body to escape CSS transform containing block */}
        {createPortal(
          <DragOverlay dropAnimation={null}>
            {activeQuest ? (
              <div className="pointer-events-none">
                <QuestCard quest={activeQuest} />
              </div>
            ) : null}
          </DragOverlay>,
          document.body,
        )}
      </DndContext>
    </>
  );
}
