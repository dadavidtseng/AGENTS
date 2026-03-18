/**
 * Badge — Portfolio-style border badge with optional pulse dot.
 *
 * Usage:
 *   <Badge dot="green" pulse>Available</Badge>
 *   <Badge>Draft</Badge>
 */

import type { ReactNode } from 'react';

export interface BadgeProps {
  /** Dot color — any Tailwind bg class (e.g. "bg-green", "bg-blue") */
  dot?: string;
  /** Animate the dot with pulse-dot keyframe */
  pulse?: boolean;
  children: ReactNode;
  className?: string;
}

export function Badge({ dot, pulse = false, children, className = '' }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-2 text-[0.75rem] text-text-secondary border border-border px-3 py-1.5 rounded-full shrink-0 ${className}`}
    >
      {dot && (
        <span
          className={`w-1.5 h-1.5 rounded-full ${dot} ${pulse ? 'animate-pulse-dot' : ''}`}
        />
      )}
      {children}
    </span>
  );
}
