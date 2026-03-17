/**
 * @fileoverview CLI provider git status operation
 * @module services/git/providers/cli/operations/core/status
 */

import type { RequestContext } from '@/utils/index.js';

import type {
  GitOperationContext,
  GitStatusOptions,
  GitStatusResult,
} from '../../../../types.js';
import {
  buildGitCommand,
  mapGitError,
  parseGitStatus,
} from '../../utils/index.js';

/**
 * Execute git status to show working tree status.
 */
export async function executeStatus(
  options: GitStatusOptions,
  context: GitOperationContext,
  execGit: (
    args: string[],
    cwd: string,
    ctx: RequestContext,
  ) => Promise<{ stdout: string; stderr: string }>,
): Promise<GitStatusResult> {
  try {
    const args = ['--porcelain=v2', '-b'];

    if (options.includeUntracked === false) {
      args.push('--untracked-files=no');
    }

    if (options.ignoreSubmodules) {
      args.push('--ignore-submodules');
    }

    const cmd = buildGitCommand({ command: 'status', args });
    const result = await execGit(
      cmd,
      context.workingDirectory,
      context.requestContext,
    );

    // The new parser handles all the logic.
    const statusResult = parseGitStatus(result.stdout);

    return statusResult;
  } catch (error) {
    throw mapGitError(error, 'status');
  }
}
