/**
 * NotificationBell — Bell icon with unread count badge.
 *
 * Placed in the Navigation bar. Toggles the NotificationCenter drawer.
 */

export interface NotificationBellProps {
  unreadCount: number;
  onClick: () => void;
}

export function NotificationBell({ unreadCount, onClick }: NotificationBellProps) {
  return (
    <button
      onClick={onClick}
      className="relative w-8 h-8 flex items-center justify-center rounded-md hover:bg-bg-card transition-colors"
      aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 18 18"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        className="text-text-secondary"
      >
        <path d="M13.5 6.75a4.5 4.5 0 1 0-9 0c0 4.5-2.25 5.625-2.25 5.625h13.5S13.5 11.25 13.5 6.75Z" />
        <path d="M10.3 14.625a1.5 1.5 0 0 1-2.6 0" />
      </svg>

      {unreadCount > 0 && (
        <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 flex items-center justify-center rounded-full bg-blue text-[0.6rem] font-semibold text-white px-1">
          {unreadCount > 99 ? '99+' : unreadCount}
        </span>
      )}
    </button>
  );
}
