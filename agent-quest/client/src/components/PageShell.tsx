/**
 * PageShell — Layout wrapper providing consistent page structure.
 *
 * Features:
 *  - max-w-[1100px] content width with responsive padding
 *  - Breadcrumbs (auto-hidden on root pages)
 *  - CSS reveal animation on mount (Portfolio-style)
 *  - pt-16 offset for fixed nav
 */

import { useEffect, useRef, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { Breadcrumbs } from './ui/Breadcrumbs';

interface PageShellProps {
  children: ReactNode;
  /** Additional classes on the content wrapper */
  className?: string;
  /** Override max-width (default: max-w-[1100px]) */
  maxWidth?: string;
}

export function PageShell({
  children,
  className = '',
  maxWidth = 'max-w-[1100px]',
}: PageShellProps) {
  const ref = useRef<HTMLDivElement>(null);
  const location = useLocation();

  // Trigger reveal animation on route change
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // Reset animation
    el.classList.remove('visible');
    // Force reflow to restart transition
    void el.offsetHeight;
    // Trigger reveal
    requestAnimationFrame(() => {
      el.classList.add('visible');
    });
  }, [location.pathname]);

  return (
    <main className="pt-16 min-h-screen">
      <div
        ref={ref}
        className={`reveal ${maxWidth} mx-auto px-8 max-md:px-6 py-16 ${className}`}
      >
        <Breadcrumbs />
        {children}
      </div>
    </main>
  );
}
