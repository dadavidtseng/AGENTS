/**
 * useKanbanSync — Real-time kanban board synchronization via WebSocket.
 *
 * Encapsulates:
 *  - Initial data fetch from API
 *  - WebSocket event subscriptions (quest + task + approval events)
 *  - Conflict resolution: server-side events always override optimistic state
 *  - Refetch on task-level events to update progress counts
 *
 * Events handled:
 *  - quest.created   → full reload
 *  - quest.updated   → in-place status update (server wins)
 *  - task.completed  → refetch quest details for updated task counts
 *  - task.assigned   → refetch quest details for updated assignees
 *  - approval.requested → refetch quest details
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { apiClient } from '../api/client';
import { useWebSocket, useWsEvent } from './useWebSocket';
import type { Quest, QuestStatus } from '../types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface KanbanSyncResult {
  quests: Quest[];
  setQuests: React.Dispatch<React.SetStateAction<Quest[]>>;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useKanbanSync(): KanbanSyncResult {
  const [quests, setQuests] = useState<Quest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Debounce refetches triggered by rapid task events
  const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ---- Data fetching ----

  const reload = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await apiClient.getQuests();
      // Deduplicate by questId — backend may return duplicates from file-watcher races
      const seen = new Set<string>();
      const unique = data.filter((q) => {
        if (seen.has(q.questId)) return false;
        seen.add(q.questId);
        return true;
      });
      setQuests(unique);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load quests');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  // ---- WebSocket connection ----

  useWebSocket();

  // ---- Quest-level events ----

  // New quest created → full reload
  useWsEvent('quest.created', useCallback(() => {
    reload();
  }, [reload]));

  // Quest status changed → in-place update (server wins over optimistic state)
  useWsEvent('quest.updated', useCallback((data: unknown) => {
    const update = data as { questId: string; status?: QuestStatus; action?: string };
    if (update.status) {
      setQuests((prev) =>
        prev.map((q) =>
          q.questId === update.questId
            ? { ...q, status: update.status!, updatedAt: new Date().toISOString() }
            : q,
        ),
      );
    } else {
      // Status not in payload (e.g. file-watcher metadata change) → refetch
      reload();
    }
  }, [reload]));

  // ---- Task-level events (affect quest progress counts) ----

  /** Debounced refetch — coalesces rapid task events into a single API call. */
  const debouncedRefetch = useCallback(() => {
    if (refetchTimer.current) clearTimeout(refetchTimer.current);
    refetchTimer.current = setTimeout(() => {
      reload();
      refetchTimer.current = null;
    }, 500);
  }, [reload]);

  // Task completed/failed → refetch to update progress bars
  useWsEvent('task.completed', useCallback(() => {
    debouncedRefetch();
  }, [debouncedRefetch]));

  // Task assigned → refetch to update assignee avatars
  useWsEvent('task.assigned', useCallback(() => {
    debouncedRefetch();
  }, [debouncedRefetch]));

  // Approval requested → quest may have moved to pending_approval
  useWsEvent('approval.requested', useCallback(() => {
    debouncedRefetch();
  }, [debouncedRefetch]));

  // Cleanup debounce timer
  useEffect(() => {
    return () => {
      if (refetchTimer.current) clearTimeout(refetchTimer.current);
    };
  }, []);

  return { quests, setQuests, loading, error, reload };
}
