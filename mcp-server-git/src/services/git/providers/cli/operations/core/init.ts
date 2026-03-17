/**
 * @fileoverview CLI provider git init operation
 * @module services/git/providers/cli/operations/core/init
 */

import type { RequestContext } from '@/utils/index.js';

import type {
  GitInitOptions,
  GitInitResult,
  GitOperationContext,
} from '../../../../types.js';
import { buildGitCommand, mapGitError } from '../../utils/index.js';

/**
 * Execute git init to initialize a new repository.
 */
export async function executeInit(
  options: GitInitOptions,
  context: GitOperationContext,
  execGit: (
    args: string[],
    cwd: string,
    ctx: RequestContext,
  ) => Promise<{ stdout: string; stderr: string }>,
): Promise<GitInitResult> {
  try {
    const args: string[] = [];

    if (options.bare) {
      args.push('--bare');
    }

    // Default to 'main' if no initial branch is specified
    const initialBranch = options.initialBranch || 'main';
    args.push(`--initial-branch=${initialBranch}`);

    args.push(options.path);

    const cmd = buildGitCommand({ command: 'init', args });
    await execGit(cmd, context.workingDirectory, context.requestContext);

    const result = {
      success: true,
      path: options.path,
      initialBranch,
      bare: options.bare || false,
    };

    return result;
  } catch (error) {
    throw mapGitError(error, 'init');
  }
}
