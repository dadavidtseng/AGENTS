/**
 * Quest Cleanup Handler — deletes staging branches after PR merge
 *
 * Subscribes to quest.merged events published by agent-quest when a GitHub
 * webhook confirms the PR was merged. On receipt, deletes the quest/<questId>
 * staging branch both locally and on the remote.
 *
 * Both agent-leads receive the event; cleanup operations are idempotent
 * (deleting an already-deleted branch is a no-op).
 *
 * @module handlers/quest-cleanup
 */

import { logger, MODULE_AGENT, timer } from 'agents-library';
import type { KadiClient } from '@kadi.build/core';
import { KadiEventSchema } from 'agents-library';

// ============================================================================
// Types
// ============================================================================

interface QuestMergedPayload {
  questId?: string;
  prNumber?: number;
  prTitle?: string;
  prUrl?: string;
  repo?: string;
  mergedBy?: string;
  timestamp?: number;
}

// ============================================================================
// Constants
// ============================================================================

const TOPIC = 'quest.merged';

// ============================================================================
// Cleanup Logic
// ============================================================================

/**
 * Delete a local branch via mcp-server-git.
 * Swallows errors (branch may already be deleted or not exist).
 */
async function deleteLocalBranch(
  client: KadiClient,
  repoPath: string,
  branch: string,
): Promise<boolean> {
  try {
    await client.invokeRemote('git_git_branch', {
      path: repoPath,
      operation: 'delete',
      name: branch,
      force: true,
    });
    return true;
  } catch (err: any) {
    logger.warn(
      MODULE_AGENT,
      `Failed to delete local branch ${branch}: ${err.message}`,
      timer.elapsed('main'),
    );
    return false;
  }
}

/**
 * Delete a remote branch via git push --delete.
 * Swallows errors (branch may already be deleted or not exist).
 */
async function deleteRemoteBranch(
  client: KadiClient,
  repoPath: string,
  branch: string,
  remote: string = 'origin',
): Promise<boolean> {
  try {
    await client.invokeRemote('git_git_push', {
      path: repoPath,
      remote,
      branch,
      delete: true,
    });
    return true;
  } catch (err: any) {
    logger.warn(
      MODULE_AGENT,
      `Failed to delete remote branch ${remote}/${branch}: ${err.message}`,
      timer.elapsed('main'),
    );
    return false;
  }
}

// ============================================================================
// Event Handler
// ============================================================================

/**
 * Handle a quest.merged event — clean up the staging branch.
 */
async function handleQuestMerged(
  client: KadiClient,
  _agentId: string,
  event: unknown,
): Promise<void> {
  const eventData = (event as any)?.data || event;

  // Extract payload — may be wrapped in KadiEvent envelope
  let payload: QuestMergedPayload;
  const envelopeParse = KadiEventSchema.safeParse(eventData);
  if (envelopeParse.success) {
    payload = envelopeParse.data.payload as QuestMergedPayload;
  } else {
    payload = eventData as QuestMergedPayload;
  }

  if (!payload.questId) {
    logger.warn(MODULE_AGENT, 'Missing questId in quest.merged event — cannot clean up', timer.elapsed('main'));
    return;
  }

  const questId = payload.questId;
  const stagingBranch = `quest/${questId}`;
  const repoPath = process.env.REPO_PATH ?? '';

  if (!repoPath) {
    logger.warn(MODULE_AGENT, 'REPO_PATH not set — skipping branch cleanup', timer.elapsed('main'));
    return;
  }

  logger.info(
    MODULE_AGENT,
    `Quest ${questId} merged (PR #${payload.prNumber ?? '?'}) — cleaning up branch ${stagingBranch}`,
    timer.elapsed('main'),
  );

  // Ensure we're not on the branch we're about to delete
  try {
    await client.invokeRemote('git_git_checkout', { path: repoPath, target: 'main' });
  } catch {
    // Already on main or main doesn't exist — continue anyway
  }

  // Delete remote branch first (most important — what the user sees)
  const remoteDeleted = await deleteRemoteBranch(client, repoPath, stagingBranch);
  if (remoteDeleted) {
    logger.info(MODULE_AGENT, `Deleted remote branch origin/${stagingBranch}`, timer.elapsed('main'));
  }

  // Delete local branch
  const localDeleted = await deleteLocalBranch(client, repoPath, stagingBranch);
  if (localDeleted) {
    logger.info(MODULE_AGENT, `Deleted local branch ${stagingBranch}`, timer.elapsed('main'));
  }

  if (remoteDeleted || localDeleted) {
    logger.info(
      MODULE_AGENT,
      `Cleanup complete for quest ${questId}`,
      timer.elapsed('main'),
    );
  } else {
    logger.info(
      MODULE_AGENT,
      `No branches to clean up for quest ${questId} (already deleted by another lead)`,
      timer.elapsed('main'),
    );
  }
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Subscribe to quest.merged events for post-merge branch cleanup.
 *
 * @param client  - Connected KadiClient instance
 * @param role    - This agent-lead's role
 * @param agentId - This agent-lead's identity
 */
export async function setupQuestCleanupHandler(
  client: KadiClient,
  role: string,
  agentId: string,
): Promise<void> {
  logger.info(
    MODULE_AGENT,
    `Subscribing to ${TOPIC} events for branch cleanup (role: ${role})...`,
    timer.elapsed('main'),
  );

  await client.subscribe(TOPIC, async (event: unknown) => {
    try {
      await handleQuestMerged(client, agentId, event);
    } catch (err: any) {
      logger.error(
        MODULE_AGENT,
        `Error handling ${TOPIC}: ${err.message}`,
        timer.elapsed('main'),
        err,
      );
    }
  });

  logger.info(MODULE_AGENT, `Subscribed to ${TOPIC}`, timer.elapsed('main'));
}
