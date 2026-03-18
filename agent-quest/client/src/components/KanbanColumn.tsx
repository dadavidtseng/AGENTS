/**
 * KanbanColumn — Droppable column in the KanbanBoard.
 *
 * Uses @dnd-kit useDroppable for drag-and-drop target.
 * Renders a header with count badge and a scrollable list of draggable QuestCards.
 */

import type { ReactNode } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { DraggableQuestCard } from './QuestCard';
import type { Quest } from '../types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface KanbanColumnDef {
  id: string;
  label: string;
  /** Tailwind color class for the header accent dot */
  accent: string;
}

export interface KanbanColumnProps {
  column: KanbanColumnDef;
  quests: Quest[];
  /** Optional slot rendered below the header */
  headerSlot?: ReactNode;
  className?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function KanbanColumn({ column, quests, headerSlot, className = '' }: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id });

  return (
    <div
      ref={setNodeRef}
      className={`flex flex-col flex-1 rounded-xl transition-colors ${
        isOver ? 'bg-blue/5 ring-1 ring-blue/20' : ''
      } ${className}`}
    >
      {/* Column header */}
      <div className="flex items-center gap-2 px-3 py-3 mb-2">
        <span className={`w-2 h-2 rounded-full ${column.accent}`} />
        <span className="text-sm font-medium tracking-tight text-text-primary">
          {column.label}
        </span>
        <span className="font-mono text-[0.65rem] text-text-tertiary bg-bg-elevated border border-border rounded-full px-2 py-0.5">
          {quests.length}
        </span>
      </div>

      {headerSlot}

      {/* Card list */}
      <div className="flex flex-col gap-2 flex-1 overflow-y-auto px-1 pb-2 min-h-[120px]">
        {quests.length === 0 ? (
          <div className={`flex items-center justify-center flex-1 border border-dashed rounded-xl p-6 transition-colors ${
            isOver ? 'border-blue/30 bg-blue/5' : 'border-border'
          }`}>
            <span className="text-[0.75rem] text-text-tertiary">
              {isOver ? 'Drop here' : 'No quests'}
            </span>
          </div>
        ) : (
          quests.map((quest) => (
            <DraggableQuestCard key={quest.questId} quest={quest} />
          ))
        )}
      </div>
    </div>
  );
}
