/**
 * ToastContainer — Renders transient toast notifications in the bottom-right corner.
 */

import type { Toast, NotificationType } from '../hooks/useNotifications';

const TYPE_ICON: Record<NotificationType, string> = {
  approval: '⚡',
  task: '✓',
  quest: '◆',
  agent: '●',
  info: 'ℹ',
};

export interface ToastContainerProps {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}

export function ToastContainer({ toasts, onDismiss }: ToastContainerProps) {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-6 right-6 z-[80] flex flex-col gap-2 max-w-sm">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="flex items-start gap-3 px-4 py-3 bg-bg-card border border-border rounded-xl shadow-lg animate-[slideUp_0.3s_ease-out]"
          role="alert"
        >
          <span className="text-sm mt-0.5">{TYPE_ICON[t.type] ?? 'ℹ'}</span>
          <div className="flex-1 min-w-0">
            <span className="text-sm font-medium text-text-primary block truncate">
              {t.title}
            </span>
            <span className="text-xs text-text-secondary block truncate">
              {t.body}
            </span>
          </div>
          <button
            onClick={() => onDismiss(t.id)}
            className="text-text-tertiary hover:text-text-secondary text-xs mt-0.5"
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
