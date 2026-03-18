/**
 * useKanbanDnd — Drag-and-drop logic for KanbanBoard.
 *
 * Handles:
 *  - Transition validation (only valid workflow moves allowed)
 *  - Optimistic UI update with rollback on failure
 *  - Backend API calls for approval actions
 *
 * Columns match the quest lifecycle:
 *   Draft → Pending Approval → Approved → In Progress → Completed → Closed
 *
 * Valid transitions:
 *  - draft → pending_approval        (submit for approval)
 *  - pending_approval → approved     (approve quest)
 *  - pending_approval → draft        (request revision — returns to draft)
 *  - pending_approval → closed       (reject quest)
 *  - approved → in_progress          (start execution — optimistic)
 *  - in_progress → completed         (mark done — optimistic)
 *  - completed, closed → locked      (no moves out)
 */

import { useState, useCallback } from 'react';
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core';
import { apiClient } from '../api/client';
import type { Quest, QuestStatus } from '../types';

// ---------------------------------------------------------------------------
// Transition rules
// ---------------------------------------------------------------------------

/** Column id → target QuestStatus when dropped */
const COLUMN_TO_STATUS: Record<string, QuestStatus> = {
  draft:            'draft',
  pending_approval: 'pending_approval',
  approved:         'approved',
  in_progress:      'in_progress',
  completed:        'completed',
  closed:           'rejected',
};

/** Allowed transitions: source column → set of valid target columns */
const VALID_TRANSITIONS: Record<string, Set<string>> = {
  draft:            new Set(['pending_approval']),
  pending_approval: new Set(['approved', 'draft', 'closed']),
  approved:         new Set(['in_progress']),
  in_progress:      new Set(['completed']),
  completed:        new Set(), // locked
  closed:           new Set(), // locked
};

/** Map QuestStatus → column id (mirrors KanbanBoard) */
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
// Types
// ---------------------------------------------------------------------------

export interface KanbanDndResult {
  /** Currently dragged quest id (for overlay styling) */
  activeId: string | null;
  /** Handle drag start */
  onDragStart: (event: DragStartEvent) => void;
  /** Handle drag end — validates, applies optimistic update, calls API */
  onDragEnd: (event: DragEndEvent) => void;
  /** Check if a transition from source→target column is valid */
  isValidDrop: (sourceCol: string, targetCol: string) => boolean;
  /** Last error message (auto-clears after 3s) */
  error: string | null;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useKanbanDnd(
  quests: Quest[],
  setQuests: React.Dispatch<React.SetStateAction<Quest[]>>,
): KanbanDndResult {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [error, setErrorState] = useState<string | null>(null);

  const isValidDrop = useCallback((sourceCol: string, targetCol: string): boolean => {
    if (sourceCol === targetCol) return false;
    return VALID_TRANSITIONS[sourceCol]?.has(targetCol) ?? false;
  }, []);

  const setError = useCallback((msg: string | null) => {
    setErrorState(msg);
    if (msg) setTimeout(() => setErrorState(null), 3000);
  }, []);

  const onDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(String(event.active.id));
  }, []);

  const onDragEnd = useCallback((event: DragEndEvent) => {
    setActiveId(null);

    const { active, over } = event;
    if (!over) return;

    const questId = String(active.id);
    const targetCol = String(over.id);

    // Find the quest and its source column
    const quest = quests.find((q) => q.questId === questId);
    if (!quest) return;

    const sourceCol = STATUS_TO_COLUMN[quest.status];
    if (sourceCol === targetCol) return;

    if (!isValidDrop(sourceCol, targetCol)) {
      if (sourceCol === 'completed' || sourceCol === 'closed') {
        setError(`${sourceCol === 'completed' ? 'Completed' : 'Closed'} quests cannot be moved`);
      } else {
        setError(`Cannot move from ${sourceCol} to ${targetCol}`);
      }
      return;
    }

    const newStatus = COLUMN_TO_STATUS[targetCol];
    if (!newStatus) return;

    // Snapshot for rollback
    const prevQuests = [...quests];

    // Optimistic update
    setQuests((prev) =>
      prev.map((q) =>
        q.questId === questId
          ? { ...q, status: newStatus, updatedAt: new Date().toISOString() }
          : q,
      ),
    );

    // Call backend for approval actions
    (async () => {
      try {
        if (sourceCol === 'pending_approval' && targetCol === 'approved') {
          // Approve quest
          await apiClient.approveQuest(questId);
        } else if (sourceCol === 'pending_approval' && targetCol === 'draft') {
          // Request revision — back to draft
          await apiClient.reviseQuest(questId, 'Moved back to draft via board');
        } else if (sourceCol === 'pending_approval' && targetCol === 'closed') {
          // Reject quest
          await apiClient.rejectQuest(questId, 'Rejected via board');
        }
        // Other transitions (draft→pending_approval, approved→in_progress, in_progress→completed)
        // are optimistic — real status changes come from the agent workflow
      } catch (err) {
        // Rollback
        setQuests(prevQuests);
        setError(err instanceof Error ? err.message : 'Failed to update quest status');
      }
    })();
  }, [quests, setQuests, isValidDrop, setError]);

  return { activeId, onDragStart, onDragEnd, isValidDrop, error };
}
