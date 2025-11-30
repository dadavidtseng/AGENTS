/**
 * @fileoverview CLI provider git log operation
 * @module services/git/providers/cli/operations/commits/log
 */

import type { RequestContext } from '@/utils/index.js';

import type {
  GitLogOptions,
  GitLogResult,
  GitOperationContext,
} from '../../../../types.js';
import {
  buildGitCommand,
  GIT_FIELD_DELIMITER,
  GIT_RECORD_DELIMITER,
  mapGitError,
} from '../../utils/index.js';

/**
 * Execute git log to view commit history.
 *
 * @param options - Log options
 * @param context - Operation context
 * @param execGit - Function to execute git commands
 * @returns Log result
 */
export async function executeLog(
  options: GitLogOptions,
  context: GitOperationContext,
  execGit: (
    args: string[],
    cwd: string,
    ctx: RequestContext,
  ) => Promise<{ stdout: string; stderr: string }>,
): Promise<GitLogResult> {
  try {
    // Format: hash, shortHash, author, authorEmail, timestamp, subject, body, parents
    const args = [
      `--format=%H${GIT_FIELD_DELIMITER}%h${GIT_FIELD_DELIMITER}%an${GIT_FIELD_DELIMITER}%ae${GIT_FIELD_DELIMITER}%at${GIT_FIELD_DELIMITER}%s${GIT_FIELD_DELIMITER}%b${GIT_FIELD_DELIMITER}%P${GIT_RECORD_DELIMITER}`,
    ];

    if (options.maxCount) {
      args.push(`-n${options.maxCount}`);
    }

    if (options.since) {
      args.push(`--since=${options.since}`);
    }

    if (options.until) {
      args.push(`--until=${options.until}`);
    }

    if (options.author) {
      args.push(`--author=${options.author}`);
    }

    if (options.grep) {
      args.push(`--grep=${options.grep}`);
    }

    // Add branch argument if specified (must come before -- separator)
    if (options.branch) {
      args.push(options.branch);
    }

    // Add file path filter if specified (must come after -- separator)
    if (options.path) {
      args.push('--', options.path);
    }

    const cmd = buildGitCommand({ command: 'log', args });
    const gitOutput = await execGit(
      cmd,
      context.workingDirectory,
      context.requestContext,
    );

    const commits = gitOutput.stdout
      .split(GIT_RECORD_DELIMITER)
      .filter((r) => r.trim())
      .map((record) => {
        const fields = record.trim().split(GIT_FIELD_DELIMITER);
        const commit: {
          hash: string;
          shortHash: string;
          author: string;
          authorEmail: string;
          timestamp: number;
          subject: string;
          body?: string;
          parents: string[];
          refs?: string[];
        } = {
          hash: fields[0] || '',
          shortHash: fields[1] || '',
          author: fields[2] || '',
          authorEmail: fields[3] || '',
          timestamp: parseInt(fields[4] || '0', 10),
          subject: fields[5] || '',
          parents: (fields[7] || '').split(' ').filter((p) => p),
        };

        if (fields[6]) {
          commit.body = fields[6];
        }

        return commit;
      });

    const result = {
      commits,
      totalCount: commits.length,
    };

    return result;
  } catch (error) {
    throw mapGitError(error, 'log');
  }
}
