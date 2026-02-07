/**
 * Error utility functions
 *
 * Provides safe error message extraction for catch blocks
 *
 * @module errors/error-utils
 */

/**
 * Extract a safe error message from an unknown caught error.
 *
 * Handles:
 * - Error objects (extracts .message)
 * - String errors (returns as-is)
 * - Objects with circular references (safe stringification)
 * - Primitive values (converts to string)
 *
 * @param error - The caught error (unknown type from catch blocks)
 * @returns A string message safe for logging and interpolation
 *
 * @example
 * ```typescript
 * try {
 *   await riskyOperation();
 * } catch (error) {
 *   const errMsg = getErrorMessage(error);
 *   logger.error(`Operation failed: ${errMsg}`);
 * }
 * ```
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  try {
    return String(error);
  } catch {
    return 'Unknown error';
  }
}
