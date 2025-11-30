/**
 * @fileoverview Shared formatting utilities for git tool outputs
 * @module mcp-server/tools/utils/git-formatters
 */

/**
 * Git change types that can be tracked
 */
export interface GitChanges {
  added?: string[];
  modified?: string[];
  deleted?: string[];
  renamed?: string[];
  copied?: string[];
}

/**
 * Flattens git changes object into a record containing only non-empty arrays.
 *
 * This helper is used by git tools (add, commit, etc.) to convert provider
 * status results into a compact format that excludes empty change categories.
 *
 * @param changes - Git changes object from provider status result
 * @returns Record containing only change categories that have files
 *
 * @example
 * ```typescript
 * const changes = {
 *   added: ['file1.ts'],
 *   modified: ['file2.ts', 'file3.ts'],
 *   deleted: [],
 *   renamed: undefined
 * };
 *
 * const flattened = flattenChanges(changes);
 * // Result: { added: ['file1.ts'], modified: ['file2.ts', 'file3.ts'] }
 * ```
 */
export function flattenChanges(changes: GitChanges): Record<string, string[]> {
  const result: Record<string, string[]> = {};

  if (changes.added && changes.added.length > 0) {
    result.added = changes.added;
  }
  if (changes.modified && changes.modified.length > 0) {
    result.modified = changes.modified;
  }
  if (changes.deleted && changes.deleted.length > 0) {
    result.deleted = changes.deleted;
  }
  if (changes.renamed && changes.renamed.length > 0) {
    result.renamed = changes.renamed;
  }
  if (changes.copied && changes.copied.length > 0) {
    result.copied = changes.copied;
  }

  return result;
}
