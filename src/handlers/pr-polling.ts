/**
 * PR Polling Fallback — periodically checks PR status when webhook is unavailable
 *
 * Subscribes to quest.pr_created events to track active PRs.
 * Polls GitHub via mcp-server-github's github_get_pr tool at a configurable
 * interval. On state change, publishes the same KĀDI events as the webhook:
 *
 *   github.pr.approved, github.pr.merged, github.pr.closed,
 *   github.pr.changes_requested, quest.merged, quest.pr_rejected,
 *   pr.changes_requested
 *
 * Configurable via:
 *   PR_POLL_INTERVAL_MS  — polling interval in ms (default: 60000 = 1 min)
 *   PR_POLL_ENABLED      — set to "false" to disable (default: true)
 *
 * @module handlers/pr-polling
 */

import { logger, MODULE_AGENT, timer } from 'agents-library';
import type { KadiClient } from '@kadi.build/core';

// ============================================================================
// Types
// ============================================================================

interface TrackedPr {
  questId: string;
  owner: string;
  repo: string;
  prNumber: number;
  lastState: string;        // 'open' | 'closed'
  lastMerged: boolean;
  lastReviewState: string;  // '' | 'approved' | 'changes_requested'
}

interface PrCreatedPayload {
  questId: string;
  prNumber: number;
  prUrl: string;
}

// ============================================================================
// State
// ============================================================================

const trackedPrs = new Map<number, TrackedPr>();
let pollTimer: ReturnType<typeof setInterval> | null = null;

// ============================================================================
// Helpers
// ============================================================================

/**
 * Extract owner/repo from a PR URL like "https://github.com/owner/repo/pull/123"
 */
function parseOwnerRepo(prUrl: string): { owner: string; repo: string } | null {
  const match = prUrl.match(/github\.com\/([^/]+)\/([^/]+)/);
  if (!match) return null;
  return { owner: match[1], repo: match[2] };
}

function parseMcpResponse(result: { content: Array<{ type: string; text: string }> }): any {
  return JSON.parse(result.content[0].text);
}

// ============================================================================
// Poll Logic
// ============================================================================

async function pollPr(client: KadiClient, pr: TrackedPr): Promise<void> {
  try {
    const result = await client.invokeRemote<{
      content: Array<{ type: string; text: string }>;
    }>('github_get_pr', {
      owner: pr.owner,
      repo: pr.repo,
      pull_number: pr.prNumber,
    });

    const data = parseMcpResponse(result);
    const state: string = data.state ?? 'open';
    const merged: boolean = !!data.merged;

    // Check for merge/close state changes
    if (state === 'closed' && pr.lastState !== 'closed') {
      if (merged) {
        logger.info(MODULE_AGENT, `[pr-poll] PR #${pr.prNumber} merged`, timer.elapsed('main'));
        const eventData = {
          prNumber: pr.prNumber,
          prTitle: data.title,
          prUrl: data.html_url,
          repo: `${pr.owner}/${pr.repo}`,
          questId: pr.questId,
          mergedBy: data.merged_by?.login,
          timestamp: Date.now(),
        };
        await client.publish('github.pr.merged', eventData);
        await client.publish('quest.merged', eventData);
        trackedPrs.delete(pr.prNumber);
      } else {
        logger.info(MODULE_AGENT, `[pr-poll] PR #${pr.prNumber} closed`, timer.elapsed('main'));
        const eventData = {
          prNumber: pr.prNumber,
          prTitle: data.title,
          prUrl: data.html_url,
          repo: `${pr.owner}/${pr.repo}`,
          questId: pr.questId,
          timestamp: Date.now(),
        };
        await client.publish('github.pr.closed', eventData);
        await client.publish('quest.pr_rejected', eventData);
        trackedPrs.delete(pr.prNumber);
      }
      return;
    }

    // Check review state changes (from latest review)
    const reviews: Array<{ state: string; user?: { login: string } }> = data.reviews ?? [];
    const latestReview = reviews.length > 0 ? reviews[reviews.length - 1] : null;
    const reviewState = latestReview?.state?.toLowerCase() ?? '';

    if (reviewState && reviewState !== pr.lastReviewState) {
      const eventData = {
        prNumber: pr.prNumber,
        prTitle: data.title,
        prUrl: data.html_url,
        repo: `${pr.owner}/${pr.repo}`,
        questId: pr.questId,
        reviewer: latestReview?.user?.login,
        timestamp: Date.now(),
      };

      if (reviewState === 'approved') {
        logger.info(MODULE_AGENT, `[pr-poll] PR #${pr.prNumber} approved`, timer.elapsed('main'));
        await client.publish('github.pr.approved', eventData);
      } else if (reviewState === 'changes_requested') {
        logger.info(MODULE_AGENT, `[pr-poll] PR #${pr.prNumber} changes requested`, timer.elapsed('main'));
        await client.publish('github.pr.changes_requested', eventData);
        await client.publish('pr.changes_requested', eventData);
      }

      pr.lastReviewState = reviewState;
    }

    pr.lastState = state;
    pr.lastMerged = merged;
  } catch (err: any) {
    logger.warn(
      MODULE_AGENT,
      `[pr-poll] Failed to poll PR #${pr.prNumber}: ${err.message}`,
      timer.elapsed('main'),
    );
  }
}

async function pollAllPrs(client: KadiClient): Promise<void> {
  if (trackedPrs.size === 0) return;

  logger.info(
    MODULE_AGENT,
    `[pr-poll] Polling ${trackedPrs.size} active PR(s)...`,
    timer.elapsed('main'),
  );

  for (const pr of trackedPrs.values()) {
    await pollPr(client, pr);
  }
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Set up PR polling fallback.
 *
 * Subscribes to quest.pr_created to track new PRs, then starts a polling
 * interval to check their status via mcp-server-github.
 */
export async function setupPrPollingHandler(
  client: KadiClient,
  _role: string,
  _agentId: string,
): Promise<void> {
  const enabled = process.env.PR_POLL_ENABLED !== 'false';
  if (!enabled) {
    logger.info(MODULE_AGENT, '[pr-poll] PR polling disabled (PR_POLL_ENABLED=false)', timer.elapsed('main'));
    return;
  }

  const intervalMs = parseInt(process.env.PR_POLL_INTERVAL_MS ?? '60000', 10);

  // Track new PRs from quest.pr_created events
  await client.subscribe('quest.pr_created', (event: unknown) => {
    const data = ((event as any)?.data ?? event) as PrCreatedPayload;
    if (!data.prNumber || !data.prUrl) {
      logger.warn(MODULE_AGENT, '[pr-poll] Invalid quest.pr_created payload', timer.elapsed('main'));
      return;
    }

    const parsed = parseOwnerRepo(data.prUrl);
    if (!parsed) {
      logger.warn(MODULE_AGENT, `[pr-poll] Cannot parse PR URL: ${data.prUrl}`, timer.elapsed('main'));
      return;
    }

    trackedPrs.set(data.prNumber, {
      questId: data.questId,
      owner: parsed.owner,
      repo: parsed.repo,
      prNumber: data.prNumber,
      lastState: 'open',
      lastMerged: false,
      lastReviewState: '',
    });

    logger.info(
      MODULE_AGENT,
      `[pr-poll] Tracking PR #${data.prNumber} (${parsed.owner}/${parsed.repo})`,
      timer.elapsed('main'),
    );
  });

  // Start polling interval
  pollTimer = setInterval(() => {
    pollAllPrs(client).catch((err) => {
      logger.error(MODULE_AGENT, `[pr-poll] Poll cycle error: ${err.message}`, timer.elapsed('main'));
    });
  }, intervalMs);

  logger.info(
    MODULE_AGENT,
    `[pr-poll] PR polling enabled (interval: ${intervalMs}ms)`,
    timer.elapsed('main'),
  );
}

/**
 * Stop the polling interval. Call during graceful shutdown.
 */
export function stopPrPolling(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
    trackedPrs.clear();
    logger.info(MODULE_AGENT, '[pr-poll] Polling stopped', timer.elapsed('main'));
  }
}
