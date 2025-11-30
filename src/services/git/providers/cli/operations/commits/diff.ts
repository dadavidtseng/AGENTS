/**
 * @fileoverview CLI provider git diff operation
 * @module services/git/providers/cli/operations/commits/diff
 */

import type { RequestContext } from '@/utils/index.js';

import type {
  GitDiffOptions,
  GitDiffResult,
  GitOperationContext,
} from '../../../../types.js';
import {
  buildGitCommand,
  mapGitError,
  parseGitDiffStat,
} from '../../utils/index.js';

/**
 * Execute git diff to show changes.
 *
 * @param options - Diff options
 * @param context - Operation context
 * @param execGit - Function to execute git commands
 * @returns Diff result
 */
export async function executeDiff(
  options: GitDiffOptions,
  context: GitOperationContext,
  execGit: (
    args: string[],
    cwd: string,
    ctx: RequestContext,
  ) => Promise<{ stdout: string; stderr: string }>,
): Promise<GitDiffResult> {
  try {
    const args: string[] = [];

    if (options.staged) {
      args.push('--cached');
    }

    if (options.commit1) {
      args.push(options.commit1);
    }

    if (options.commit2) {
      args.push(options.commit2);
    }

    if (options.path) {
      args.push('--', options.path);
    }

    if (options.unified) {
      args.push(`--unified=${options.unified}`);
    }

    // Get diff content
    const diffCmd = buildGitCommand({ command: 'diff', args: [...args] });
    const diffResult = await execGit(
      diffCmd,
      context.workingDirectory,
      context.requestContext,
    );

    // Get diff stats
    const statCmd = buildGitCommand({
      command: 'diff',
      args: [...args, '--stat'],
    });
    const statResult = await execGit(
      statCmd,
      context.workingDirectory,
      context.requestContext,
    );

    const stats = parseGitDiffStat(statResult.stdout);
    const hasBinary = diffResult.stdout.includes('Binary files');

    const result = {
      diff: diffResult.stdout,
      filesChanged: stats.files.length,
      insertions: stats.totalAdditions,
      deletions: stats.totalDeletions,
      binary: hasBinary,
    };

    return result;
  } catch (error) {
    throw mapGitError(error, 'diff');
  }
}
