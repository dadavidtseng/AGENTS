/**
 * @fileoverview CLI provider git stash operation
 * @module services/git/providers/cli/operations/stash/stash
 */

import type { RequestContext } from '@/utils/index.js';

import type {
  GitOperationContext,
  GitStashOptions,
  GitStashResult,
} from '../../../../types.js';
import { buildGitCommand, mapGitError } from '../../utils/index.js';

/**
 * Execute git stash operations.
 *
 * @param options - Stash options
 * @param context - Operation context
 * @param execGit - Function to execute git commands
 * @returns Stash result
 */
export async function executeStash(
  options: GitStashOptions,
  context: GitOperationContext,
  execGit: (
    args: string[],
    cwd: string,
    ctx: RequestContext,
  ) => Promise<{ stdout: string; stderr: string }>,
): Promise<GitStashResult> {
  try {
    const args: string[] = [options.mode];

    switch (options.mode) {
      case 'list': {
        const cmd = buildGitCommand({ command: 'stash', args });
        const result = await execGit(
          cmd,
          context.workingDirectory,
          context.requestContext,
        );

        // Parse stash list output
        const stashes = result.stdout
          .split('\n')
          .filter((line) => line.trim())
          .map((line, index) => {
            // Format: stash@{0}: WIP on branch: description
            const match = line.match(/^(stash@\{(\d+)\}): (.+)$/);
            if (match) {
              return {
                ref: match[1]!,
                index,
                branch: '',
                description: match[3]!,
                timestamp: 0,
              };
            }
            return {
              ref: `stash@{${index}}`,
              index,
              branch: '',
              description: line,
              timestamp: 0,
            };
          });

        const listResult = {
          mode: 'list' as const,
          stashes,
        };

        return listResult;
      }

      case 'push': {
        if (options.message) {
          args.push('-m', options.message);
        }

        if (options.includeUntracked) {
          args.push('--include-untracked');
        }

        if (options.keepIndex) {
          args.push('--keep-index');
        }

        const cmd = buildGitCommand({ command: 'stash', args });
        await execGit(cmd, context.workingDirectory, context.requestContext);

        const pushResult = {
          mode: 'push' as const,
          created: 'stash@{0}',
        };

        return pushResult;
      }

      case 'pop':
      case 'apply': {
        if (options.stashRef) {
          args.push(options.stashRef);
        }

        const cmd = buildGitCommand({ command: 'stash', args });
        const result = await execGit(
          cmd,
          context.workingDirectory,
          context.requestContext,
        );

        const hasConflicts =
          result.stdout.includes('CONFLICT') ||
          result.stderr.includes('CONFLICT');

        const applyResult = {
          mode: options.mode,
          applied: options.stashRef || 'stash@{0}',
          conflicts: hasConflicts,
        };

        return applyResult;
      }

      case 'drop': {
        if (!options.stashRef) {
          throw new Error('Stash reference is required for drop operation');
        }

        args.push(options.stashRef);

        const cmd = buildGitCommand({ command: 'stash', args });
        await execGit(cmd, context.workingDirectory, context.requestContext);

        const dropResult = {
          mode: 'drop' as const,
          dropped: options.stashRef,
        };

        return dropResult;
      }

      case 'clear': {
        const cmd = buildGitCommand({ command: 'stash', args });
        await execGit(cmd, context.workingDirectory, context.requestContext);

        const clearResult = {
          mode: 'clear' as const,
        };

        return clearResult;
      }

      default:
        throw new Error('Unknown stash operation mode');
    }
  } catch (error) {
    throw mapGitError(error, 'stash');
  }
}
