/**
 * SQL utilities for constructing safe ArcadeDB queries.
 *
 * ArcadeDB uses standard SQL string literal escaping: single quotes are
 * doubled ('').  Backslash is NOT an escape character in ArcadeDB SQL,
 * but we strip it defensively to prevent any future interpretation.
 *
 * All user-supplied values that appear inside SQL string literals MUST pass
 * through {@link escapeSQL} before interpolation.
 *
 * @see .dev/validated-sql.md for the canonical SQL patterns.
 */

/**
 * Result shape returned by the `arcade-query` tool (SELECT statements).
 */
export interface ArcadeQueryResult {
  success: boolean;
  result?: Array<Record<string, unknown>>;
  error?: string;
}

/**
 * Result shape returned by the `arcade-command` tool (DDL / DML statements).
 */
export interface ArcadeCommandResult {
  success: boolean;
  result?: Array<Record<string, unknown>>;
  error?: string;
}

/**
 * Escape a string value for interpolation inside a SQL single-quoted literal.
 *
 * ArcadeDB follows the SQL standard: the only character that needs escaping
 * inside a single-quoted string is the single quote itself, which is doubled.
 * Backslashes are passed through literally (not interpreted as escape chars).
 *
 * NUL bytes are stripped defensively since they can truncate strings in some
 * database engines.
 *
 * **Note:** For INSERT or UPDATE of user-generated content (which may contain
 * quotes, newlines, or arbitrary characters), prefer parameterized queries
 * via `arcade-command` or `arcade-batch` with `{ command, params }`.  This
 * function is appropriate for short, controlled identifiers used in WHERE
 * clauses (collection names, chunkIds, etc.).
 *
 * @param value - Raw string to escape.
 * @returns Escaped string safe for SQL single-quoted interpolation.
 */
export function escapeSQL(value: string): string {
  return value
    .replace(/\0/g, '')        // strip NUL bytes
    .replace(/'/g, "''");      // ' → '' (SQL standard)
}

/**
 * Validate and coerce a value to a safe positive integer for use in SQL
 * clauses that expect a number (LIMIT, OFFSET, array dimensions).
 *
 * Throws if the value is not a finite non-negative integer.  This prevents
 * injection through numeric parameters that are interpolated outside quotes.
 *
 * @param value - Value to validate.
 * @param label - Human-readable label for error messages (e.g. "limit").
 * @returns The validated integer.
 */
export function sanitizeInt(value: number, label: string): number {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
    throw new Error(`Invalid ${label}: expected a non-negative integer, got ${value}`);
  }
  return value;
}
