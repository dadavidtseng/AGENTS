/**
 * @fileoverview CLI provider git clone operation
 * @module services/git/providers/cli/operations/core/clone
 */

import type { RequestContext } from '@/utils/index.js';

import type {
  GitCloneOptions,
  GitCloneResult,
  GitOperationContext,
} from '../../../../types.js';
import { buildGitCommand, mapGitError } from '../../utils/index.js';

/**
 * Execute git clone to clone a repository.
 */
export async function executeClone(
  options: GitCloneOptions,
  context: GitOperationContext,
  execGit: (
    args: string[],
    cwd: string,
    ctx: RequestContext,
  ) => Promise<{ stdout: string; stderr: string }>,
): Promise<GitCloneResult> {
  try {
    const args: string[] = [options.remoteUrl, options.localPath];

    if (options.branch) {
      args.push('--branch', options.branch);
    }

    if (options.depth) {
      args.push('--depth', options.depth.toString());
    }

    if (options.bare) {
      args.push('--bare');
    }

    if (options.mirror) {
      args.push('--mirror');
    }

    if (options.recurseSubmodules) {
      args.push('--recurse-submodules');
    }

    const cmd = buildGitCommand({ command: 'clone', args });
    await execGit(cmd, context.workingDirectory, context.requestContext);

    const result = {
      success: true,
      localPath: options.localPath,
      remoteUrl: options.remoteUrl,
      branch: options.branch || 'main',
    };

    return result;
  } catch (error) {
    throw mapGitError(error, 'clone');
  }
}
