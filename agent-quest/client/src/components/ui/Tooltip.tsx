/**
 * Tooltip — Lightweight hover tooltip.
 *
 * Usage:
 *   <Tooltip text="Copy to clipboard">
 *     <button>📋</button>
 *   </Tooltip>
 */

import { useState, type ReactNode } from 'react';

export interface TooltipProps {
  text: string;
  /** Position relative to trigger */
  position?: 'top' | 'bottom';
  children: ReactNode;
}

export function Tooltip({ text, position = 'top', children }: TooltipProps) {
  const [visible, setVisible] = useState(false);

  const positionClass =
    position === 'top'
      ? 'bottom-full left-1/2 -translate-x-1/2 mb-2'
      : 'top-full left-1/2 -translate-x-1/2 mt-2';

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
    >
      {children}
      {visible && (
        <span
          className={`absolute ${positionClass} z-50 px-3 py-1.5 text-[0.7rem] font-mono text-text-primary bg-bg-card border border-border rounded-lg shadow-lg whitespace-nowrap pointer-events-none`}
        >
          {text}
        </span>
      )}
    </span>
  );
}
