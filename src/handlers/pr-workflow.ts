/**
 * PR Workflow Handler — creates GitHub PRs after quest verification completes
 *
 * Subscribes to quest.verification_complete events from task-verification.
 * On receipt:
 * 1. Fetches quest details for PR body
 * 2. Merges task branches into staging via git-operations
 * 3. Pushes staging branch to remote
 * 4. Creates PR via mcp-server-github
 * 5. Publishes quest.pr_created for agent-producer to notify HUMAN
 *
 * @module handlers/pr-workflow
 */

import { logger, MODULE_AGENT, timer } from 'agents-library';
import type { KadiClient } from '@kadi.build/core';
import { KadiEventSchema } from 'agents-library';
import { mergeTaskBranch } from './git-operations.js';

// ============================================================================
// Types
// ============================================================================

/** Payload of quest.verification_complete event */
interface QuestVerificationCompletePayload {
  questId: string;
  completedCount: number;
  failedCount: number;
  totalTasks: number;
  verifiedBy: string;
  timestamp: string;
}

/** Quest data from mcp-server-quest */
interface QuestData {
  questId: string;
  title: string;
  description?: string;
  repoUrl?: string;
  baseBranch?: string;
  tasks: Array<{
    taskId: string;
    name: string;
    status: string;
    branch?: string;
    commitSha?: string;
  }>;
}

/** Result of the PR creation workflow */
export interface PrWorkflowResult {
  questId: string;
  prNumber?: number;
  prUrl?: string;
  success: boolean;
  message: string;
}

// ============================================================================
// Constants
// ============================================================================

const TOPIC = 'quest.verification_complete';

// ============================================================================
// Quest Data Helpers
// ============================================================================

/** Parse mcp response content */
function parseMcpResponse(result: { content: Array<{ type: string; text: string }> }): any {
  return JSON.parse(result.content[0].text);
}

/**
 * Fetch full quest data from mcp-server-quest.
 */
async function fetchQuestData(client: KadiClient, questId: string): Promise<QuestData> {
  const result = await client.invokeRemote<{
    content: Array<{ type: string; text: string }>;
  }>('quest_quest_query_quest', { questId, detail: 'full' });
  return parseMcpResponse(result);
}

/**
 * Extract repo owner and name from a GitHub URL.
 * e.g. "https://github.com/owner/repo" → { owner: "owner", repo: "repo" }
 */
function parseRepoUrl(repoUrl: string): { owner: string; repo: string } | null {
  const match = repoUrl.match(/github\.com\/([^/]+)\/([^/.]+)/);
  if (!match) return null;
  return { owner: match[1], repo: match[2] };
}

// ============================================================================
// PR Body Builder
// ============================================================================

/**
 * Build a PR description from quest data.
 */
function buildPrBody(quest: QuestData, payload: QuestVerificationCompletePayload): string {
  const lines: string[] = [];

  lines.push(`## Quest: ${quest.title}`);
  lines.push('');
  if (quest.description) {
    lines.push(quest.description);
    lines.push('');
  }

  lines.push('### Task Summary');
  lines.push('');
  lines.push(`| Task | Status |`);
  lines.push(`|------|--------|`);

  for (const task of quest.tasks) {
    const icon = task.status === 'completed' ? '✅' : '❌';
    lines.push(`| ${task.name} | ${icon} ${task.status} |`);
  }

  lines.push('');
  lines.push(`**${payload.completedCount}** completed, **${payload.failedCount}** failed out of **${payload.totalTasks}** total tasks.`);
  lines.push('');
  lines.push('---');
  lines.push(`*Created by ${payload.verifiedBy} via KĀDI agent-lead*`);

  return lines.join('\n');
}

// ============================================================================
// Git Push
// ============================================================================

/**
 * Push a branch to remote via mcp-server-git.
 */
async function pushBranch(
  client: KadiClient,
  repoPath: string,
  branch: string,
): Promise<void> {
  await client.invokeRemote('git_push', {
    path: repoPath,
    remote: 'origin',
    branch,
  });
}

// ============================================================================
// Core Handler
// ============================================================================

/**
 * Handle a quest.verification_complete event.
 *
 * 1. Fetch quest data
 * 2. Determine repo path, owner, repo from quest
 * 3. Merge completed task branches into staging
 * 4. Push staging branch
 * 5. Create PR via mcp-server-github
 * 6. Publish quest.pr_created
 */
async function handleVerificationComplete(
  client: KadiClient,
  agentId: string,
  event: unknown,
): Promise<PrWorkflowResult | null> {
  const eventData = (event as any)?.data || event;

  // Extract payload — may be wrapped in KadiEvent envelope
  let payload: QuestVerificationCompletePayload;
  const envelopeParse = KadiEventSchema.safeParse(eventData);
  if (envelopeParse.success) {
    payload = envelopeParse.data.payload as QuestVerificationCompletePayload;
  } else {
    payload = eventData as QuestVerificationCompletePayload;
  }

  if (!payload.questId) {
    logger.warn(MODULE_AGENT, 'Missing questId in verification_complete event', timer.elapsed('main'));
    return null;
  }

  // Skip if there are failures — only create PR when all tasks succeeded
  if (payload.failedCount > 0) {
    logger.info(
      MODULE_AGENT,
      `Quest ${payload.questId} has ${payload.failedCount} failed task(s) — skipping PR creation`,
      timer.elapsed('main'),
    );
    return {
      questId: payload.questId,
      success: false,
      message: `${payload.failedCount} task(s) failed — PR not created`,
    };
  }

  logger.info(
    MODULE_AGENT,
    `Starting PR workflow for quest ${payload.questId}`,
    timer.elapsed('main'),
  );

  // Fetch quest data
  const quest = await fetchQuestData(client, payload.questId);

  // Determine repo info
  const repoInfo = quest.repoUrl ? parseRepoUrl(quest.repoUrl) : null;
  if (!repoInfo) {
    logger.warn(MODULE_AGENT, `Cannot parse repo URL: ${quest.repoUrl}`, timer.elapsed('main'));
    return {
      questId: payload.questId,
      success: false,
      message: `Invalid or missing repoUrl: ${quest.repoUrl}`,
    };
  }

  const baseBranch = quest.baseBranch ?? 'main';
  const stagingBranch = `quest/${payload.questId}`;

  // Merge completed task branches into staging
  const completedTasks = quest.tasks.filter((t) => t.status === 'completed' && t.branch);
  logger.info(
    MODULE_AGENT,
    `Merging ${completedTasks.length} task branch(es) into ${stagingBranch}`,
    timer.elapsed('main'),
  );

  for (const task of completedTasks) {
    if (!task.branch) continue;
    const mergeResult = await mergeTaskBranch(
      client,
      quest.repoUrl ?? '',
      task.branch,
      payload.questId,
      agentId,
      stagingBranch,
    );

    if (mergeResult.resolution && !mergeResult.resolution.resolved) {
      logger.warn(
        MODULE_AGENT,
        `Merge conflict escalated for ${task.branch} — aborting PR workflow`,
        timer.elapsed('main'),
      );
      return {
        questId: payload.questId,
        success: false,
        message: `Merge conflict in ${task.branch} — escalated to HUMAN`,
      };
    }
  }

  // Push staging branch
  logger.info(MODULE_AGENT, `Pushing ${stagingBranch} to origin`, timer.elapsed('main'));
  await pushBranch(client, quest.repoUrl ?? '', stagingBranch);

  // Create PR
  const prTitle = `[Quest] ${quest.title}`;
  const prBody = buildPrBody(quest, payload);

  logger.info(
    MODULE_AGENT,
    `Creating PR: ${prTitle} (${stagingBranch} → ${baseBranch})`,
    timer.elapsed('main'),
  );

  const prResult = await client.invokeRemote<{
    content: Array<{ type: string; text: string }>;
  }>('github_create_pr', {
    owner: repoInfo.owner,
    repo: repoInfo.repo,
    title: prTitle,
    head: stagingBranch,
    base: baseBranch,
    body: prBody,
  });

  const prData = parseMcpResponse(prResult);
  const prNumber = prData.number;
  const prUrl = prData.html_url ?? prData.url;

  logger.info(MODULE_AGENT, `PR #${prNumber} created: ${prUrl}`, timer.elapsed('main'));

  // Publish quest.pr_created
  await client.publish('quest.pr_created', {
    questId: payload.questId,
    prNumber,
    prUrl,
    title: prTitle,
    stagingBranch,
    baseBranch,
    createdBy: agentId,
    timestamp: new Date().toISOString(),
  }, { broker: 'default', network: 'global' });

  return {
    questId: payload.questId,
    prNumber,
    prUrl,
    success: true,
    message: `PR #${prNumber} created successfully`,
  };
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Subscribe to quest.verification_complete events and create PRs.
 *
 * @param client  - Connected KadiClient instance
 * @param role    - This agent-lead's role
 * @param agentId - This agent-lead's identity
 */
export async function setupPrWorkflowHandler(
  client: KadiClient,
  role: string,
  agentId: string,
): Promise<void> {
  logger.info(
    MODULE_AGENT,
    `Subscribing to ${TOPIC} events for PR workflow (role: ${role})...`,
    timer.elapsed('main'),
  );

  await client.subscribe(TOPIC, async (event: unknown) => {
    try {
      await handleVerificationComplete(client, agentId, event);
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
