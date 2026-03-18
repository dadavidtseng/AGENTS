/**
 * NotificationCenter — Slide-out drawer showing notification history.
 *
 * Features:
 *  - Grouped by read/unread
 *  - Click to navigate, auto-mark-read
 *  - "Mark all read" and "Clear" actions
 */

import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Notification, NotificationType } from '../hooks/useNotifications';

// ---------------------------------------------------------------------------
// Icon + color per type
// ---------------------------------------------------------------------------

const TYPE_CONFIG: Record<NotificationType, { icon: string; color: string }> = {
  approval: { icon: '⚡', color: 'text-yellow' },
  task:     { icon: '✓', color: 'text-green' },
  quest:    { icon: '◆', color: 'text-blue' },
  agent:    { icon: '●', color: 'text-red' },
  info:     { icon: 'ℹ', color: 'text-text-secondary' },
};

function relativeTime(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface NotificationCenterProps {
  open: boolean;
  onClose: () => void;
  notifications: Notification[];
  onMarkRead: (id: string) => void;
  onMarkAllRead: () => void;
  onClearAll: () => void;
}

export function NotificationCenter({
  open,
  onClose,
  notifications,
  onMarkRead,
  onMarkAllRead,
  onClearAll,
}: NotificationCenterProps) {
  const navigate = useNavigate();
  const panelRef = useRef<HTMLDivElement>(null);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    // Delay to avoid closing immediately from the bell click
    const id = setTimeout(() => document.addEventListener('mousedown', handler), 50);
    return () => {
      clearTimeout(id);
      document.removeEventListener('mousedown', handler);
    };
  }, [open, onClose]);

  const handleClick = (n: Notification) => {
    onMarkRead(n.id);
    if (n.href) {
      navigate(n.href);
      onClose();
    }
  };

  const unread = notifications.filter((n) => !n.read);
  const read = notifications.filter((n) => n.read);

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-sm transition-opacity" />
      )}

      {/* Drawer */}
      <div
        ref={panelRef}
        className={`fixed top-0 right-0 z-[70] h-full w-full max-w-md bg-bg-card border-l border-border shadow-2xl transition-transform duration-300 ease-out ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
        role="dialog"
        aria-label="Notification center"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 h-16 border-b border-border">
          <h2 className="text-base font-medium text-text-primary tracking-tight">
            Notifications
          </h2>
          <div className="flex items-center gap-3">
            {unread.length > 0 && (
              <button
                onClick={onMarkAllRead}
                className="text-xs text-blue hover:underline"
              >
                Mark all read
              </button>
            )}
            {notifications.length > 0 && (
              <button
                onClick={onClearAll}
                className="text-xs text-text-tertiary hover:text-text-secondary"
              >
                Clear
              </button>
            )}
            <button
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-bg-elevated text-text-secondary"
              aria-label="Close notifications"
            >
              ✕
            </button>
          </div>
        </div>

        {/* List */}
        <div className="overflow-y-auto h-[calc(100%-4rem)]">
          {notifications.length === 0 && (
            <div className="flex items-center justify-center h-40 text-text-tertiary text-sm">
              No notifications yet
            </div>
          )}

          {unread.length > 0 && (
            <div>
              <div className="px-6 py-2 text-[0.7rem] uppercase tracking-widest text-text-tertiary">
                New
              </div>
              {unread.map((n) => (
                <NotificationRow key={n.id} notification={n} onClick={() => handleClick(n)} />
              ))}
            </div>
          )}

          {read.length > 0 && (
            <div>
              <div className="px-6 py-2 text-[0.7rem] uppercase tracking-widest text-text-tertiary">
                Earlier
              </div>
              {read.map((n) => (
                <NotificationRow key={n.id} notification={n} onClick={() => handleClick(n)} />
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Row
// ---------------------------------------------------------------------------

function NotificationRow({
  notification: n,
  onClick,
}: {
  notification: Notification;
  onClick: () => void;
}) {
  const cfg = TYPE_CONFIG[n.type] ?? TYPE_CONFIG.info;

  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-6 py-3 flex items-start gap-3 transition-colors hover:bg-bg-elevated ${
        n.read ? 'opacity-60' : ''
      }`}
    >
      <span className={`mt-0.5 text-sm ${cfg.color}`}>{cfg.icon}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-text-primary truncate">
            {n.title}
          </span>
          {!n.read && (
            <span className="w-1.5 h-1.5 rounded-full bg-blue shrink-0" />
          )}
        </div>
        <p className="text-xs text-text-secondary truncate mt-0.5">{n.body}</p>
        <span className="text-[0.65rem] text-text-tertiary mt-1 block">
          {relativeTime(n.timestamp)}
        </span>
      </div>
    </button>
  );
}
