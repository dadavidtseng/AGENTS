/**
 * Logger utilities
 *
 * Provides default logger implementation and logger factory functions
 *
 * @module utils/logger
 */

import type { DeploymentLogger } from '../types/index.js';

/**
 * Default console-based logger implementation
 *
 * Uses console methods for output with timestamps and level prefixes
 */
export class ConsoleLogger implements DeploymentLogger {
  private readonly verbose: boolean;

  constructor(verbose: boolean = false) {
    this.verbose = verbose;
  }

  /**
   * Log informational message
   */
  log(message: string, ...args: unknown[]): void {
    console.log(`[${this.getTimestamp()}] ${message}`, ...args);
  }

  /**
   * Log error message
   */
  error(message: string, ...args: unknown[]): void {
    console.error(`[${this.getTimestamp()}] ERROR: ${message}`, ...args);
  }

  /**
   * Log warning message
   */
  warn(message: string, ...args: unknown[]): void {
    console.warn(`[${this.getTimestamp()}] WARN: ${message}`, ...args);
  }

  /**
   * Log debug message (only if verbose mode enabled)
   */
  debug(message: string, ...args: unknown[]): void {
    if (this.verbose) {
      console.debug(`[${this.getTimestamp()}] DEBUG: ${message}`, ...args);
    }
  }

  /**
   * Get current timestamp for log messages
   */
  private getTimestamp(): string {
    return new Date().toISOString();
  }
}

/**
 * Silent logger that discards all output
 *
 * Useful for testing or when logging is not desired
 */
export class SilentLogger implements DeploymentLogger {
  log(_message: string, ..._args: unknown[]): void {
    // Silent - no output
  }

  error(_message: string, ..._args: unknown[]): void {
    // Silent - no output
  }

  warn(_message: string, ..._args: unknown[]): void {
    // Silent - no output
  }

  debug(_message: string, ..._args: unknown[]): void {
    // Silent - no output
  }
}

/**
 * Create a logger instance
 *
 * @param options - Logger configuration options
 * @returns Logger instance
 *
 * @example
 * const logger = createLogger({ verbose: true });
 * logger.log('Deployment started');
 */
export function createLogger(options: {
  verbose?: boolean;
  silent?: boolean;
  custom?: DeploymentLogger;
}): DeploymentLogger {
  if (options.custom) {
    return options.custom;
  }

  if (options.silent) {
    return new SilentLogger();
  }

  return new ConsoleLogger(options.verbose ?? false);
}

/**
 * Default logger instance (console-based, non-verbose)
 */
export const defaultLogger: DeploymentLogger = new ConsoleLogger(false);
