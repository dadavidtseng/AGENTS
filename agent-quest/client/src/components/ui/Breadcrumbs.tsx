/**
 * Breadcrumbs — Auto-generated breadcrumb trail from react-router location.
 *
 * Usage:
 *   <Breadcrumbs />
 *
 * Renders: Home / Quests / quest-id
 */

import { Link, useLocation } from 'react-router-dom';

const LABEL_MAP: Record<string, string> = {
  quests: 'Quests',
  agents: 'Agents',
  tasks: 'Tasks',
};

export function Breadcrumbs() {
  const location = useLocation();
  const segments = location.pathname.split('/').filter(Boolean);

  // Don't render on root or single-segment pages
  if (segments.length <= 1) return null;

  const crumbs = segments.map((seg, i) => {
    const path = '/' + segments.slice(0, i + 1).join('/');
    const label = LABEL_MAP[seg] || decodeURIComponent(seg);
    const isLast = i === segments.length - 1;

    return { path, label, isLast };
  });

  return (
    <nav
      aria-label="Breadcrumb"
      className="flex items-center gap-1.5 text-[0.75rem] font-mono text-text-tertiary mb-6"
    >
      <Link
        to="/"
        className="text-text-tertiary hover:text-text-secondary transition-colors"
      >
        Home
      </Link>

      {crumbs.map(({ path, label, isLast }) => (
        <span key={path} className="flex items-center gap-1.5">
          <span className="text-border">/</span>
          {isLast ? (
            <span className="text-text-secondary">{label}</span>
          ) : (
            <Link
              to={path}
              className="text-text-tertiary hover:text-text-secondary transition-colors"
            >
              {label}
            </Link>
          )}
        </span>
      ))}
    </nav>
  );
}
