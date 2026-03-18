/**
 * Card — Portfolio-style glassmorphism card primitive.
 *
 * Variants:
 *  - "elevated"  : bg-bg-elevated, hover → bg-bg-card  (default, grid cells)
 *  - "card"      : bg-bg-card with border                (standalone sections)
 *  - "frosted"   : backdrop-blur glassmorphism            (overlays, modals)
 */

import type { ReactNode, HTMLAttributes } from 'react';

type CardVariant = 'elevated' | 'card' | 'frosted';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant;
  /** Show gradient hover line on top edge */
  hoverGradient?: boolean;
  /** Padding size */
  padding?: 'sm' | 'md' | 'lg';
  children: ReactNode;
}

const VARIANT_CLASSES: Record<CardVariant, string> = {
  elevated:
    'bg-bg-elevated transition-colors duration-300 hover:bg-bg-card',
  card:
    'bg-bg-card border border-border rounded-xl',
  frosted:
    'bg-bg/80 backdrop-blur-xl backdrop-saturate-[180%] border border-[rgba(255,255,255,0.06)] rounded-xl',
};

const PADDING: Record<string, string> = {
  sm: 'p-5',
  md: 'p-8',
  lg: 'p-10',
};

export function Card({
  variant = 'elevated',
  hoverGradient = false,
  padding = 'md',
  className = '',
  children,
  ...rest
}: CardProps) {
  return (
    <div
      className={`${VARIANT_CLASSES[variant]} ${PADDING[padding]} ${
        hoverGradient ? 'card-hover-gradient' : ''
      } ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}
