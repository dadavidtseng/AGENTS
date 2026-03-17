/**
 * Timer Utility for Performance Tracking
 * =====================================
 *
 * Provides named timer tracking with human-readable elapsed time formatting.
 * Tracks multiple concurrent timers and formats output as: +Nms, +Ns, +Nm
 *
 * This timer is shared across all KĀDI agents (template-agent-typescript,
 * agent-producer, agent-artist, etc.) for consistent performance tracking
 * and elapsed time display in logs.
 *
 * Usage:
 * ```typescript
 * import { timer } from 'agents-library';
 *
 * // Start a timer
 * timer.start('main');
 *
 * // Later, get elapsed time formatted string
 * logger.info(MODULE_AGENT, 'Application started', timer.elapsed('main'));
 * // Output: [template-agent] [14:32:45.123] Info: Application started +150ms
 *
 * // Even later, elapsed time shows progression
 * logger.info(MODULE_AGENT, 'Connected to broker', timer.elapsed('main'));
 * // Output: [template-agent] [14:32:48.234] Info: Connected to broker +3.1s
 *
 * // Start nested timer for operation-specific tracking
 * timer.start('file-write');
 * // ... perform file operation ...
 * logger.info(MODULE_AGENT, 'File written', timer.elapsed('file-write'));
 *
 * // Reset timer to zero
 * timer.reset('main');
 *
 * // Stop and remove timer from tracking
 * timer.stop('main');
 * ```
 *
 * @module timer
 */

/**
 * Timer class for tracking named elapsed times with human-readable formatting.
 *
 * Maintains a Map of named timers, each storing a start timestamp.
 * Provides methods to start, check elapsed time, reset, and stop timers.
 *
 * @example
 * ```typescript
 * const timer = new Timer();
 * timer.start('operation');
 * // ... do work ...
 * const elapsed = timer.elapsed('operation'); // Returns '+150ms', '+2.4s', etc.
 * ```
 */
class Timer {
  /**
   * Map of timer names to start timestamps (milliseconds since epoch)
   *
   * Each named timer stores the timestamp when it was started.
   * Elapsed time is calculated as: now - startTime
   *
   * @private
   */
  private timers: Map<string, number> = new Map();

  /**
   * Start a named timer
   *
   * If a timer with the same name already exists, it is reset to the current time.
   * This allows restarting a timer without stopping it first.
   *
   * Uses performance.now() for high-resolution timing when available,
   * falls back to Date.now() for millisecond precision.
   *
   * @param name - Unique name for this timer (e.g., 'main', 'file-write', 'api-call')
   *
   * @example
   * ```typescript
   * timer.start('database-query');
   * // Timer is now tracking
   * ```
   */
  start(name: string): void {
    const now = this.getCurrentTime();
    this.timers.set(name, now);
  }

  /**
   * Get elapsed time for a named timer as a human-readable formatted string
   *
   * Formats the elapsed time automatically:
   * - Less than 1 second: '+Nms' (milliseconds)
   * - 1 second to 59.9 seconds: '+Ns' (seconds with 1 decimal)
   * - 1 minute or more: '+Nm' (minutes with 1 decimal)
   *
   * If the timer doesn't exist, returns '+0ms' as a safe fallback.
   *
   * @param name - Name of the timer to check
   * @returns Formatted elapsed time string (e.g., '+150ms', '+2.4s', '+1.2m')
   *
   * @example
   * ```typescript
   * timer.start('process');
   * setTimeout(() => {
   *   console.log(timer.elapsed('process')); // After 1.5s: '+1.5s'
   * }, 1500);
   * ```
   */
  elapsed(name: string): string {
    const startTime = this.timers.get(name);

    // Timer doesn't exist - return safe fallback
    if (startTime === undefined) {
      return '+0ms';
    }

    const now = this.getCurrentTime();
    const elapsedMs = now - startTime;

    // Format based on magnitude
    if (elapsedMs < 1000) {
      // Less than 1 second: show milliseconds
      return `+${Math.round(elapsedMs)}ms`;
    } else if (elapsedMs < 60000) {
      // Less than 1 minute: show seconds with 1 decimal place
      const seconds = elapsedMs / 1000;
      return `+${seconds.toFixed(1)}s`;
    } else {
      // 1 minute or more: show minutes with 1 decimal place
      const minutes = elapsedMs / 60000;
      return `+${minutes.toFixed(1)}m`;
    }
  }

  /**
   * Reset a named timer to the current time
   *
   * This is equivalent to stopping and immediately restarting the timer.
   * The elapsed time will be zero after reset.
   *
   * If the timer doesn't exist, it is created with the current time.
   *
   * @param name - Name of the timer to reset
   *
   * @example
   * ```typescript
   * timer.start('attempt');
   * // ... some work ...
   * timer.reset('attempt'); // Restart the timer
   * // ... more work ...
   * console.log(timer.elapsed('attempt')); // Only counts time after reset
   * ```
   */
  reset(name: string): void {
    const now = this.getCurrentTime();
    this.timers.set(name, now);
  }

  /**
   * Stop a named timer and remove it from tracking
   *
   * After stopping, calling elapsed() for this timer will return '+0ms'.
   * To resume tracking, call start() again.
   *
   * @param name - Name of the timer to stop
   *
   * @example
   * ```typescript
   * timer.start('temp-operation');
   * // ... work ...
   * timer.stop('temp-operation'); // Stops tracking
   * console.log(timer.elapsed('temp-operation')); // Returns '+0ms'
   * ```
   */
  stop(name: string): void {
    this.timers.delete(name);
  }

  /**
   * Get current time in milliseconds
   *
   * Uses performance.now() for high-resolution timing when available
   * (typical in Node.js 8.5.0+), falls back to Date.now() for millisecond precision.
   *
   * @private
   * @returns Current time in milliseconds since timer epoch started
   */
  private getCurrentTime(): number {
    // Try to use performance.now() for higher resolution timing
    if (typeof performance !== 'undefined' && performance.now) {
      return performance.now();
    }
    // Fallback to Date.now() for millisecond precision
    return Date.now();
  }
}

/**
 * Singleton timer instance
 *
 * Export as singleton to ensure:
 * 1. Single source of truth for all timers across the application
 * 2. Consistent time reference points for all agents
 * 3. Ability to track global and operation-specific timers
 *
 * This follows the same pattern as logger.ts for consistency.
 *
 * @example
 * ```typescript
 * import { timer } from 'agents-library';
 *
 * timer.start('app');
 * // ... application runs ...
 * logger.info(MODULE_AGENT, 'Status', timer.elapsed('app'));
 * ```
 */
export const timer = new Timer();

/**
 * Timer class export for TypeScript type annotations
 *
 * Use this type when you need to pass the timer or its type as a parameter.
 *
 * @example
 * ```typescript
 * function logWithTiming(timerInstance: Timer, name: string) {
 *   console.log(timerInstance.elapsed(name));
 * }
 * ```
 */
export type { Timer };
