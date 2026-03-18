/**
 * useNotifications — Centralized notification state driven by WebSocket events.
 *
 * Responsibilities:
 *  - Listen to WS events and create notifications
 *  - Manage read/unread state (persisted in localStorage)
 *  - Expose a toast queue for transient pop-ups
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { wsService, type WsMessage } from '../services/WebSocketService';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type NotificationType = 'approval' | 'task' | 'quest' | 'agent' | 'info';

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  timestamp: string;
  read: boolean;
  /** Optional link target */
  href?: string;
}

export interface Toast extends Notification {
  /** Auto-dismiss timer id */
  timerId?: ReturnType<typeof setTimeout>;
}

// ---------------------------------------------------------------------------
// localStorage helpers
// ---------------------------------------------------------------------------

const LS_KEY = 'quest-notifications';
const MAX_STORED = 100;

function loadNotifications(): Notification[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? (JSON.parse(raw) as Notification[]) : [];
  } catch {
    return [];
  }
}

function saveNotifications(items: Notification[]) {
  localStorage.setItem(LS_KEY, JSON.stringify(items.slice(0, MAX_STORED)));
}

// ---------------------------------------------------------------------------
// Event → Notification mapping
// ---------------------------------------------------------------------------

/** Build a deterministic dedup key from the event so duplicates are ignored. */
function dedupKey(msg: WsMessage): string {
  const d = msg.data as Record<string, unknown> | undefined;
  const entity = String(d?.questId ?? d?.taskId ?? '');
  return `${msg.event}:${entity}`;
}

/** Friendly label for an entity — quest name or short ID. */
function entityLabel(d: Record<string, unknown> | undefined, fallback: string): string {
  if (d?.questName) return String(d.questName);
  if (d?.questId) return `Quest ${String(d.questId).slice(0, 8)}…`;
  if (d?.taskName) return String(d.taskName);
  if (d?.taskId) return `Task ${String(d.taskId).slice(0, 8)}…`;
  return fallback;
}

function wsToNotification(msg: WsMessage): Notification | null {
  const ts = msg.timestamp ?? new Date().toISOString();
  const d = msg.data as Record<string, unknown> | undefined;
  // Deterministic ID — same event + entity = same ID (prevents duplicates)
  const id = dedupKey(msg);

  switch (msg.event) {
    case 'approval.requested':
      return {
        id,
        type: 'approval',
        title: 'Approval Requested',
        body: entityLabel(d, 'A quest needs your approval'),
        timestamp: ts,
        read: false,
        href: d?.questId ? `/quests/${d.questId}` : undefined,
      };

    case 'quest.created':
      return {
        id,
        type: 'quest',
        title: 'Quest Created',
        body: entityLabel(d, 'New quest'),
        timestamp: ts,
        read: false,
        href: d?.questId ? `/quests/${d.questId}` : undefined,
      };

    // task.completed, task.assigned, quest.updated are too noisy for
    // notifications — they fire for internal workflow steps and status
    // transitions. The Events page and Dashboard capture them instead.

    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

const TOAST_DURATION = 5_000;
/** Window in ms to suppress duplicate events with the same dedup key. */
const DEDUP_WINDOW = 2_000;

export function useNotifications() {
  const [notifications, setNotifications] = useState<Notification[]>(loadNotifications);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  /** Tracks recently seen dedup keys to suppress duplicates. */
  const recentKeys = useRef<Map<string, number>>(new Map());

  // Persist on change
  useEffect(() => {
    saveNotifications(notifications);
  }, [notifications]);

  // Clean up toast timers on unmount
  useEffect(() => {
    const timers = toastTimers.current;
    return () => {
      for (const t of timers.values()) clearTimeout(t);
    };
  }, []);

  const addNotification = useCallback((n: Notification) => {
    setNotifications((prev) => {
      // Skip if a notification with the same ID already exists
      if (prev.some((existing) => existing.id === n.id)) return prev;
      return [n, ...prev].slice(0, MAX_STORED);
    });

    // Show toast (also dedup)
    setToasts((prev) => {
      if (prev.some((t) => t.id === n.id)) return prev;
      const timerId = setTimeout(() => {
        setToasts((p) => p.filter((t) => t.id !== n.id));
        toastTimers.current.delete(n.id);
      }, TOAST_DURATION);
      toastTimers.current.set(n.id, timerId);
      return [...prev, { ...n, timerId }];
    });
  }, []);

  // Subscribe to WebSocket (with dedup)
  useEffect(() => {
    const unsub = wsService.onMessage((msg) => {
      const key = dedupKey(msg);
      const now = Date.now();

      // Suppress if we saw this exact key recently
      const lastSeen = recentKeys.current.get(key);
      if (lastSeen && now - lastSeen < DEDUP_WINDOW) return;
      recentKeys.current.set(key, now);

      // Prune old entries periodically
      if (recentKeys.current.size > 50) {
        for (const [k, t] of recentKeys.current) {
          if (now - t > DEDUP_WINDOW) recentKeys.current.delete(k);
        }
      }

      const n = wsToNotification(msg);
      if (n) addNotification(n);
    });
    return unsub;
  }, [addNotification]);

  const markRead = useCallback((id: string) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true } : n)),
    );
  }, []);

  const markAllRead = useCallback(() => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = toastTimers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      toastTimers.current.delete(id);
    }
  }, []);

  const clearAll = useCallback(() => {
    setNotifications([]);
  }, []);

  const unreadCount = notifications.filter((n) => !n.read).length;

  return {
    notifications,
    toasts,
    unreadCount,
    markRead,
    markAllRead,
    dismissToast,
    clearAll,
  };
}
