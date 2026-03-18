/**
 * StatusDot — Animated status indicator dot.
 *
 * Usage:
 *   <StatusDot color="green" pulse />
 *   <StatusDot color="red" />
 */

type StatusColor = 'green' | 'blue' | 'yellow' | 'red' | 'orange' | 'muted';

export interface StatusDotProps {
  color: StatusColor;
  pulse?: boolean;
  /** Size in Tailwind units */
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const COLOR_MAP: Record<StatusColor, string> = {
  green: 'bg-green',
  blue: 'bg-blue',
  yellow: 'bg-yellow',
  red: 'bg-red',
  orange: 'bg-orange',
  muted: 'bg-text-tertiary',
};

const SIZE_MAP: Record<string, string> = {
  sm: 'w-1.5 h-1.5',
  md: 'w-2 h-2',
  lg: 'w-2.5 h-2.5',
};

export function StatusDot({
  color,
  pulse = false,
  size = 'sm',
  className = '',
}: StatusDotProps) {
  return (
    <span
      className={`rounded-full ${COLOR_MAP[color]} ${SIZE_MAP[size]} ${
        pulse ? 'animate-pulse-dot' : ''
      } ${className}`}
    />
  );
}
