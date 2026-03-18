/**
 * @fileoverview CLI provider git tag operation
 * @module services/git/providers/cli/operations/tags/tag
 */

import type { RequestContext } from '@/utils/index.js';

import type {
  GitOperationContext,
  GitTagOptions,
  GitTagResult,
} from '../../../../types.js';
import {
  buildGitCommand,
  mapGitError,
  parseGitTag,
  shouldSignCommits,
} from '../../utils/index.js';

/**
 * Execute git tag operations.
 *
 * @param options - Tag options
 * @param context - Operation context
 * @param execGit - Function to execute git commands
 * @returns Tag result
 */
export async function executeTag(
  options: GitTagOptions,
  context: GitOperationContext,
  execGit: (
    args: string[],
    cwd: string,
    ctx: RequestContext,
  ) => Promise<{ stdout: string; stderr: string }>,
): Promise<GitTagResult> {
  try {
    const args: string[] = [];

    switch (options.mode) {
      case 'list': {
        args.push('-l');

        const cmd = buildGitCommand({ command: 'tag', args });
        const result = await execGit(
          cmd,
          context.workingDirectory,
          context.requestContext,
        );

        const tagNames = parseGitTag(result.stdout);
        const tags = tagNames.map((name) => ({
          name,
          commit: '', // Would need separate call to get commit
        }));

        const listResult = {
          mode: 'list' as const,
          tags,
        };

        return listResult;
      }

      case 'create': {
        if (!options.tagName) {
          throw new Error('Tag name is required for create operation');
        }

        args.push(options.tagName);

        // Determine if we should sign the tag - use explicit option or fall back to config default
        const shouldSign = options.sign ?? shouldSignCommits();

        // Signing implies annotated tag, and requires a message
        if (shouldSign) {
          const message = options.message || `Tag ${options.tagName}`;
          args.push('-s', '-m', message);
        } else if (options.message && options.annotated) {
          args.push('-a', '-m', options.message);
        }

        if (options.commit) {
          args.push(options.commit);
        }

        if (options.force) {
          args.push('--force');
        }

        const cmd = buildGitCommand({ command: 'tag', args });
        await execGit(cmd, context.workingDirectory, context.requestContext);

        const createResult = {
          mode: 'create' as const,
          created: options.tagName,
        };

        return createResult;
      }

      case 'delete': {
        if (!options.tagName) {
          throw new Error('Tag name is required for delete operation');
        }

        args.push('-d', options.tagName);

        const cmd = buildGitCommand({ command: 'tag', args });
        await execGit(cmd, context.workingDirectory, context.requestContext);

        const deleteResult = {
          mode: 'delete' as const,
          deleted: options.tagName,
        };

        return deleteResult;
      }

      default:
        throw new Error('Unknown tag operation mode');
    }
  } catch (error) {
    throw mapGitError(error, 'tag');
  }
}
