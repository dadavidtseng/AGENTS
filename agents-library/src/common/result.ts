/**
 * Result Type Pattern for Predictable Error Handling
 *
 * Provides a type-safe way to handle success and error cases without throwing exceptions.
 * Inspired by Rust's Result<T, E> type.
 *
 * @example
 * ```typescript
 * const result = await someOperation();
 * if (result.success) {
 *   console.log(result.data);
 * } else {
 *   console.error(result.error);
 * }
 * ```
 */

/**
 * Result type representing either success with data or failure with error
 */
export type Result<T, E> =
  | { success: true; data: T }
  | { success: false; error: E };

/**
 * Helper function to create a successful Result
 *
 * @param data - The success data
 * @returns Success Result
 *
 * @example
 * ```typescript
 * return ok({ message: 'Success!' });
 * ```
 */
export function ok<T, E = never>(data: T): Result<T, E> {
  return { success: true, data };
}

/**
 * Helper function to create a failed Result
 *
 * @param error - The error data
 * @returns Error Result
 *
 * @example
 * ```typescript
 * return err(new Error('Something went wrong'));
 * ```
 */
export function err<T = never, E = unknown>(error: E): Result<T, E> {
  return { success: false, error };
}