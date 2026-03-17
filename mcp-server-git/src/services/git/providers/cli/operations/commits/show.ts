/**
 * @fileoverview CLI provider git show operation
 * @module services/git/providers/cli/operations/commits/show
 */

import type { RequestContext } from '@/utils/index.js';

import type {
  GitOperationContext,
  GitShowOptions,
  GitShowResult,
} from '../../../../types.js';
import { buildGitCommand, mapGitError } from '../../utils/index.js';

/**
 * Execute git show to display commit details.
 *
 * @param options - Show options
 * @param context - Operation context
 * @param execGit - Function to execute git commands
 * @returns Show result
 */
export async function executeShow(
  options: GitShowOptions,
  context: GitOperationContext,
  execGit: (
    args: string[],
    cwd: string,
    ctx: RequestContext,
  ) => Promise<{ stdout: string; stderr: string }>,
): Promise<GitShowResult> {
  try {
    const args = [options.object];

    if (options.stat) {
      args.push('--stat');
    }

    if (options.format === 'raw') {
      args.push('--format=raw');
    }

    const cmd = buildGitCommand({ command: 'show', args });
    const result = await execGit(
      cmd,
      context.workingDirectory,
      context.requestContext,
    );

    // Determine object type from output
    let objectType: 'commit' | 'tree' | 'blob' | 'tag' = 'commit';
    if (result.stdout.includes('tree ')) {
      objectType = 'tree';
    } else if (result.stdout.includes('tag ')) {
      objectType = 'tag';
    } else if (!result.stdout.includes('commit ')) {
      objectType = 'blob';
    }

    const showResult = {
      object: options.object,
      type: objectType,
      content: result.stdout,
      metadata: {},
    };

    return showResult;
  } catch (error) {
    throw mapGitError(error, 'show');
  }
}
