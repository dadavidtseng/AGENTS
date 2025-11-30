/**
 * @fileoverview Git CLI error mapping utilities
 * @module services/git/providers/cli/utils/error-mapper
 */

import { JsonRpcErrorCode, McpError } from '@/types-global/errors.js';

/**
 * Git error patterns and their corresponding error codes.
 */
const ERROR_PATTERNS: Array<{
  pattern: RegExp;
  code: JsonRpcErrorCode;
  messageTransform?: (match: RegExpMatchArray) => string;
}> = [
  // Repository errors
  {
    pattern: /not a git repository/i,
    code: JsonRpcErrorCode.InvalidRequest,
  },
  {
    pattern: /repository .* not found/i,
    code: JsonRpcErrorCode.InvalidRequest,
  },

  // Permission errors
  {
    pattern: /permission denied/i,
    code: JsonRpcErrorCode.InternalError,
  },
  {
    pattern: /eacces/i,
    code: JsonRpcErrorCode.InternalError,
  },

  // File errors
  {
    pattern: /pathspec '(.+)' did not match any files/i,
    code: JsonRpcErrorCode.InvalidRequest,
    messageTransform: (match) => `File not found: ${match[1]}`,
  },
  {
    pattern: /no such file or directory/i,
    code: JsonRpcErrorCode.InvalidRequest,
  },

  // Conflict errors
  {
    pattern: /conflict/i,
    code: JsonRpcErrorCode.InvalidRequest,
  },
  {
    pattern: /you have unstaged changes/i,
    code: JsonRpcErrorCode.InvalidRequest,
  },
  {
    pattern: /your local changes would be overwritten/i,
    code: JsonRpcErrorCode.InvalidRequest,
  },
  {
    pattern: /failed to merge/i,
    code: JsonRpcErrorCode.InvalidRequest,
  },

  // Branch errors
  {
    pattern: /branch '(.+)' already exists/i,
    code: JsonRpcErrorCode.InvalidRequest,
    messageTransform: (match) => `Branch already exists: ${match[1]}`,
  },
  {
    pattern: /branch '(.+)' not found/i,
    code: JsonRpcErrorCode.InvalidRequest,
    messageTransform: (match) => `Branch not found: ${match[1]}`,
  },

  // Remote errors
  {
    pattern: /could not read from remote/i,
    code: JsonRpcErrorCode.InternalError,
  },
  {
    pattern: /failed to connect/i,
    code: JsonRpcErrorCode.InternalError,
  },
  {
    pattern: /authentication failed/i,
    code: JsonRpcErrorCode.InvalidRequest,
  },
  {
    pattern: /remote .* does not exist/i,
    code: JsonRpcErrorCode.InvalidRequest,
  },

  // Network errors
  {
    pattern: /network/i,
    code: JsonRpcErrorCode.InternalError,
  },
  {
    pattern: /connection/i,
    code: JsonRpcErrorCode.InternalError,
  },
  {
    pattern: /timeout/i,
    code: JsonRpcErrorCode.InternalError,
  },

  // Commit errors
  {
    pattern: /nothing to commit/i,
    code: JsonRpcErrorCode.InvalidRequest,
  },
  {
    pattern: /no changes added to commit/i,
    code: JsonRpcErrorCode.InvalidRequest,
  },

  // Reference errors
  {
    pattern: /reference is not a tree/i,
    code: JsonRpcErrorCode.InvalidRequest,
  },
  {
    pattern: /ambiguous argument/i,
    code: JsonRpcErrorCode.InvalidRequest,
  },
  {
    pattern: /unknown revision/i,
    code: JsonRpcErrorCode.InvalidRequest,
  },
];

/**
 * Map a git CLI error to an appropriate McpError.
 *
 * @param error - The original error from git command execution
 * @param operation - The git operation that failed
 * @returns Mapped McpError with appropriate code and message
 */
export function mapGitError(error: unknown, operation: string): McpError {
  if (error instanceof McpError) {
    return error;
  }

  const errorMessage = error instanceof Error ? error.message : String(error);
  const lowerMessage = errorMessage.toLowerCase();

  // Try to match against known error patterns
  for (const { pattern, code, messageTransform } of ERROR_PATTERNS) {
    const match = errorMessage.match(pattern);
    if (match) {
      const message = messageTransform
        ? messageTransform(match)
        : `Git ${operation} failed: ${errorMessage}`;

      return new McpError(code, message, {
        cause: error instanceof Error ? error : undefined,
      });
    }
  }

  // Check for git not installed
  if (
    lowerMessage.includes('git') &&
    (lowerMessage.includes('not found') ||
      lowerMessage.includes('enoent') ||
      lowerMessage.includes('command not found'))
  ) {
    return new McpError(
      JsonRpcErrorCode.InternalError,
      'Git command not found. Please ensure Git is installed and in your PATH.',
      { cause: error instanceof Error ? error : undefined },
    );
  }

  // Default error
  return new McpError(
    JsonRpcErrorCode.InternalError,
    `Git ${operation} failed: ${errorMessage}`,
    { cause: error instanceof Error ? error : undefined },
  );
}

/**
 * Check if an error indicates a missing git installation.
 *
 * @param error - Error to check
 * @returns True if git is not installed
 */
export function isGitNotFoundError(error: unknown): boolean {
  const message = (
    error instanceof Error ? error.message : String(error)
  ).toLowerCase();
  return (
    message.includes('git') &&
    (message.includes('not found') ||
      message.includes('enoent') ||
      message.includes('command not found'))
  );
}

/**
 * Extract meaningful error context from git stderr output.
 *
 * @param stderr - Git command stderr output
 * @returns Cleaned error message
 */
export function extractGitErrorMessage(stderr: string): string {
  // Remove common git prefixes
  let message = stderr
    .replace(/^fatal:\s*/gim, '')
    .replace(/^error:\s*/gim, '')
    .replace(/^warning:\s*/gim, '')
    .trim();

  // Take only the first meaningful line
  const lines = message.split('\n').filter((l) => l.trim());
  if (lines.length > 0) {
    message = lines[0]!;
  }

  return message;
}
