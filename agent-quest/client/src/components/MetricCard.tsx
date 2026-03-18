/**
 * MetricCard — At-a-glance KPI card with optional trend indicator.
 *
 * Uses the glassmorphism Card primitive from 3.49.
 */

import type { ReactNode } from 'react';
import { Card } from './ui/Card';

export interface MetricCardProps {
  label: string;
  value: string | number;
  icon: ReactNode;
  /** Optional delta string, e.g. "+12%" */
  trend?: string;
  /** Positive = green, negative = red, neutral = secondary */
  trendDirection?: 'up' | 'down' | 'neutral';
}

export function MetricCard({
  label,
  value,
  icon,
  trend,
  trendDirection = 'neutral',
}: MetricCardProps) {
  const trendColor =
    trendDirection === 'up'
      ? 'text-green'
      : trendDirection === 'down'
        ? 'text-red'
        : 'text-text-secondary';

  return (
    <Card variant="card" padding="md" className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-text-secondary text-sm tracking-wide">
          {label}
        </span>
        <span className="text-text-tertiary">{icon}</span>
      </div>

      <span className="text-3xl font-semibold tracking-tight text-text-primary">
        {value}
      </span>

      {trend && (
        <span className={`text-xs ${trendColor}`}>{trend}</span>
      )}
    </Card>
  );
}
