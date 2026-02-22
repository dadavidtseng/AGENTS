/**
 * Git Operations Handler — merge conflict detection and resolution
 *
 * Provides utilities for agent-lead to:
 * - Merge task worktree branches into a staging branch
 * - Detect and auto-resolve simple merge conflicts
 * - Escalate complex conflicts to HUMAN via agent-producer
 *
 * All git operations are performed via mcp-server-git invokeRemote calls.
 *
 * @module handlers/git-operations
 */

import { logger, MODULE_AGENT, timer } from 'agents-library';
import type { KadiClient } from '@kadi.build/core';

// ============================================================================
// Types
// ============================================================================

/** Result of a merge attempt */
export interface MergeResult {
  success: boolean;
  conflicts: boolean;
  conflictedFiles: string[];
  mergedFiles: string[];
  message: string;
}

/** Result of conflict resolution */
export interface ConflictResolutionResult {
  resolved: boolean;
  autoResolved: string[];
  escalated: string[];
  message: string;
}

/** Overall result of a merge-and-resolve operation */
export interface MergeOperationResult {
  merge: MergeResult;
  resolution?: ConflictResolutionResult;
  finalCommit?: string;
}

// ============================================================================
// Constants
// ============================================================================

/** File patterns that can be auto-resolved by accepting "theirs" (incoming) */
const AUTO_THEIRS_PATTERNS = [
  /\.lock$/,
  /package-lock\.json$/,
  /yarn\.lock$/,
  /pnpm-lock\.yaml$/,
];

/** File patterns that can be auto-resolved by accepting "ours" (current) */
const AUTO_OURS_PATTERNS = [
  /\.env$/,
  /\.env\.local$/,
];

// ============================================================================
// Git Tool Wrappers
// ============================================================================

/** Parse mcp-server-git response content */
function parseGitResponse(result: { content: Array<{ type: string; text: string }> }): any {
  return JSON.parse(result.content[0].text);
}

/**
 * Set the working directory for subsequent git operations.
 */
async function setWorkingDir(client: KadiClient, path: string): Promise<void> {
  await client.invokeRemote('git_set_working_dir', { path });
}

/**
 * Get repository status including conflicted files.
 */
async function getStatus(client: KadiClient, path: string): Promise<{
  currentBranch: string;
  isClean: boolean;
  conflictedFiles: string[];
  stagedChanges: string[];
  unstagedChanges: string[];
}> {
  const result = await client.invokeRemote<{
    content: Array<{ type: string; text: string }>;
  }>('git_status', { path });
  return parseGitResponse(result);
}

/**
 * Merge a branch into the current branch.
 */
async function mergeBranch(client: KadiClient, path: string, branch: string, message?: string): Promise<MergeResult> {
  try {
    const result = await client.invokeRemote<{
      content: Array<{ type: string; text: string }>;
    }>('git_merge', {
      path,
      branch,
      noFastForward: true,
      message: message ?? `Merge ${branch}`,
    });

    const data = parseGitResponse(result);
    return {
      success: data.success ?? true,
      conflicts: data.conflicts ?? false,
      conflictedFiles: data.conflictedFiles ?? [],
      mergedFiles: data.mergedFiles ?? [],
      message: data.message ?? 'Merge completed',
    };
  } catch (err: any) {
    // Merge failure with conflicts still returns useful data
    if (err.message?.includes('CONFLICT') || err.message?.includes('conflict')) {
      return {
        success: false,
        conflicts: true,
        conflictedFiles: [],
        mergedFiles: [],
        message: err.message,
      };
    }
    throw err;
  }
}

/**
 * Checkout a file using ours/theirs strategy to resolve conflict.
 */
async function checkoutFile(
  client: KadiClient,
  path: string,
  file: string,
  strategy: 'ours' | 'theirs',
): Promise<void> {
  await client.invokeRemote('git_checkout', {
    path,
    files: [file],
    [strategy]: true,
  });
}

/**
 * Stage resolved files.
 */
async function stageFiles(client: KadiClient, path: string, files: string[]): Promise<void> {
  await client.invokeRemote('git_add', { path, files });
}

/**
 * Create a commit.
 */
async function commit(client: KadiClient, path: string, message: string): Promise<string> {
  const result = await client.invokeRemote<{
    content: Array<{ type: string; text: string }>;
  }>('git_commit', { path, message });
  const data = parseGitResponse(result);
  return data.commitHash ?? '';
}

/**
 * Abort an in-progress merge.
 */
async function abortMerge(client: KadiClient, path: string): Promise<void> {
  await client.invokeRemote('git_merge', { path, abort: true });
}

// ============================================================================
// Conflict Resolution Logic
// ============================================================================

/**
 * Determine if a conflicted file can be auto-resolved.
 * Returns 'ours', 'theirs', or null (needs manual/escalation).
 */
function classifyConflict(filePath: string): 'ours' | 'theirs' | null {
  for (const pattern of AUTO_THEIRS_PATTERNS) {
    if (pattern.test(filePath)) return 'theirs';
  }
  for (const pattern of AUTO_OURS_PATTERNS) {
    if (pattern.test(filePath)) return 'ours';
  }
  return null;
}

/**
 * Attempt to auto-resolve conflicts for files matching known patterns.
 * Returns which files were resolved and which need escalation.
 */
async function resolveConflicts(
  client: KadiClient,
  repoPath: string,
  conflictedFiles: string[],
): Promise<ConflictResolutionResult> {
  const autoResolved: string[] = [];
  const escalated: string[] = [];

  for (const file of conflictedFiles) {
    const strategy = classifyConflict(file);

    if (strategy) {
      try {
        await checkoutFile(client, repoPath, file, strategy);
        await stageFiles(client, repoPath, [file]);
        autoResolved.push(file);
        logger.info(
          MODULE_AGENT,
          `  Auto-resolved ${file} (${strategy})`,
          timer.elapsed('main'),
        );
      } catch (err: any) {
        logger.warn(
          MODULE_AGENT,
          `  Failed to auto-resolve ${file}: ${err.message}`,
          timer.elapsed('main'),
        );
        escalated.push(file);
      }
    } else {
      escalated.push(file);
    }
  }

  const resolved = escalated.length === 0;
  const message = resolved
    ? `All ${autoResolved.length} conflict(s) auto-resolved`
    : `${autoResolved.length} auto-resolved, ${escalated.length} need manual resolution`;

  return { resolved, autoResolved, escalated, message };
}

// ============================================================================
// Escalation
// ============================================================================

/**
 * Escalate unresolvable conflicts to HUMAN via agent-producer.
 * Publishes a conflict.escalation event with details.
 */
async function escalateToHuman(
  client: KadiClient,
  questId: string,
  branch: string,
  targetBranch: string,
  escalatedFiles: string[],
  agentId: string,
): Promise<void> {
  await client.publish('conflict.escalation', {
    questId,
    branch,
    targetBranch,
    conflictedFiles: escalatedFiles,
    message: `Merge conflict in ${escalatedFiles.length} file(s) requires manual resolution`,
    timestamp: new Date().toISOString(),
    escalatedBy: agentId,
  }, { broker: 'default', network: 'global' });

  logger.warn(
    MODULE_AGENT,
    `Escalated ${escalatedFiles.length} conflict(s) to HUMAN: ${escalatedFiles.join(', ')}`,
    timer.elapsed('main'),
  );
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Merge a task branch into the staging branch with conflict resolution.
 *
 * Flow:
 * 1. Set working directory
 * 2. Attempt merge
 * 3. If conflicts, try auto-resolution
 * 4. If auto-resolution succeeds, commit the merge
 * 5. If auto-resolution fails, escalate to HUMAN and abort merge
 *
 * @param client       - Connected KadiClient
 * @param repoPath     - Path to the git repository
 * @param taskBranch   - Branch to merge (e.g. "task/quest-123/task-1")
 * @param questId      - Quest ID for escalation context
 * @param agentId      - This agent-lead's identity
 * @param targetBranch - Branch to merge into (defaults to current branch)
 */
export async function mergeTaskBranch(
  client: KadiClient,
  repoPath: string,
  taskBranch: string,
  questId: string,
  agentId: string,
  targetBranch?: string,
): Promise<MergeOperationResult> {
  logger.info(
    MODULE_AGENT,
    `Merging ${taskBranch} into ${targetBranch ?? 'current branch'} at ${repoPath}`,
    timer.elapsed('main'),
  );

  // Set working directory
  await setWorkingDir(client, repoPath);

  // Attempt merge
  const merge = await mergeBranch(
    client,
    repoPath,
    taskBranch,
    `Merge ${taskBranch} (quest: ${questId})`,
  );

  if (!merge.conflicts) {
    logger.info(MODULE_AGENT, `Merge clean — no conflicts`, timer.elapsed('main'));
    return { merge };
  }

  // Conflicts detected — get full list from status if merge didn't return them
  let conflictedFiles = merge.conflictedFiles;
  if (conflictedFiles.length === 0) {
    const status = await getStatus(client, repoPath);
    conflictedFiles = status.conflictedFiles;
  }

  logger.warn(
    MODULE_AGENT,
    `Merge conflicts in ${conflictedFiles.length} file(s): ${conflictedFiles.join(', ')}`,
    timer.elapsed('main'),
  );

  // Attempt auto-resolution
  const resolution = await resolveConflicts(client, repoPath, conflictedFiles);

  if (resolution.resolved) {
    // All conflicts resolved — commit
    const commitHash = await commit(
      client,
      repoPath,
      `Merge ${taskBranch} (auto-resolved conflicts)`,
    );
    logger.info(
      MODULE_AGENT,
      `Merge committed after auto-resolution: ${commitHash}`,
      timer.elapsed('main'),
    );
    return { merge, resolution, finalCommit: commitHash };
  }

  // Escalate remaining conflicts
  await escalateToHuman(
    client,
    questId,
    taskBranch,
    targetBranch ?? 'staging',
    resolution.escalated,
    agentId,
  );

  // Abort the merge to leave repo in clean state
  await abortMerge(client, repoPath);
  logger.info(MODULE_AGENT, `Merge aborted — waiting for HUMAN resolution`, timer.elapsed('main'));

  return { merge, resolution };
}

/**
 * Check if a repository has ongoing merge conflicts.
 */
export async function hasMergeConflicts(
  client: KadiClient,
  repoPath: string,
): Promise<{ hasConflicts: boolean; files: string[] }> {
  const status = await getStatus(client, repoPath);
  return {
    hasConflicts: status.conflictedFiles.length > 0,
    files: status.conflictedFiles,
  };
}
