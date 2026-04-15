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
import type { ProviderManager, Message } from 'agents-library';
import type { MemoryService } from 'agents-library';
import type { KadiClient } from '@kadi.build/core';
import { KadiEventSchema } from 'agents-library';
import { mergeTaskBranch } from './git-operations.js';

/** Native ability handle returned by KadiClient.loadNative() */
type NativeAbility = Awaited<ReturnType<KadiClient['loadNative']>>;

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
  const raw = parseMcpResponse(result);
  logger.info(MODULE_AGENT, `Quest data keys: ${Object.keys(raw).join(', ')}`, timer.elapsed('main'));
  // Map common field name variations
  return {
    questId: raw.questId ?? raw.id ?? questId,
    title: raw.title ?? raw.name ?? raw.description ?? questId,
    description: raw.description ?? raw.title ?? '',
    repoUrl: raw.repoUrl ?? raw.repo ?? '',
    baseBranch: raw.baseBranch ?? raw.targetBranch ?? 'main',
    tasks: raw.tasks ?? [],
  };
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

/**
 * Derive repo URL from mcp-server-git's git_git_remote tool.
 * Falls back to null if remote cannot be determined.
 */
async function deriveRepoUrl(client: KadiClient, worktreePath: string): Promise<string | null> {
  try {
    const result = await client.invokeRemote<{
      content: Array<{ type: string; text: string }>;
    }>('git_git_remote', { path: worktreePath });
    const parsed = parseMcpResponse(result);
    // git_remote returns { remotes: [{ name, fetchUrl, pushUrl }] }
    const remotes = parsed.remotes ?? parsed;
    if (Array.isArray(remotes)) {
      const origin = remotes.find((r: any) => r.name === 'origin') ?? remotes[0];
      if (origin?.fetchUrl) return origin.fetchUrl;
      if (origin?.url) return origin.url;
    }
    // If it's a plain string
    if (typeof parsed === 'string' && parsed.includes('github.com')) return parsed;
    return null;
  } catch (err: any) {
    logger.warn(MODULE_AGENT, `Failed to derive repo URL from git remote: ${err.message}`, timer.elapsed('main'));
    return null;
  }
}

// ============================================================================
// Branch Discovery (worktree-based, like agent-producer)
// ============================================================================

/**
 * Discover task branches by listing git worktrees.
 * Matches worktree branches to completed tasks by role convention
 * (e.g. "agent-playground-programmer" for role "programmer").
 */
async function discoverTaskBranches(
  client: KadiClient,
  repoPath: string,
  quest: QuestData,
): Promise<string[]> {
  if (!repoPath) return [];

  try {
    const result = await client.invokeRemote<{
      content: Array<{ type: string; text: string }>;
    }>('git_git_worktree', { path: repoPath, mode: 'list' });

    let parsed: any;
    try {
      parsed = parseMcpResponse(result);
    } catch {
      parsed = result as any;
    }

    const worktrees: Array<{ path: string; branch: string; head?: string }> =
      parsed.worktrees ?? parsed ?? [];

    if (!Array.isArray(worktrees) || worktrees.length === 0) {
      logger.warn(MODULE_AGENT, 'No worktrees found', timer.elapsed('main'));
      return [];
    }

    // Collect completed task commit SHAs for matching
    const completedShas = new Set(
      quest.tasks
        .filter((t) => t.status === 'completed' && t.commitSha)
        .map((t) => t.commitSha!),
    );

    const branches: string[] = [];
    for (const wt of worktrees) {
      if (!wt.branch) continue;
      // Strip refs/heads/ prefix
      const branchName = wt.branch.replace(/^refs\/heads\//, '');
      // Skip main/master and the bare worktree
      if (branchName === 'main' || branchName === 'master') continue;
      // Skip shadow branches — only merge worker branches
      if (branchName.startsWith('shadow-')) continue;
      // Match by commit SHA if available
      if (wt.head && completedShas.has(wt.head)) {
        branches.push(branchName);
        continue;
      }
      // Match by role convention: branch contains role name from a completed task
      const completedRoles = quest.tasks
        .filter((t) => t.status === 'completed')
        .map((t) => (t as any).role ?? (t as any).assignedTo ?? '')
        .filter(Boolean);
      for (const role of completedRoles) {
        if (branchName.includes(role)) {
          branches.push(branchName);
          break;
        }
      }
    }

    return [...new Set(branches)];
  } catch (err: any) {
    logger.warn(MODULE_AGENT, `Failed to list worktrees: ${err.message}`, timer.elapsed('main'));
    return [];
  }
}

/**
 * Create a staging branch from baseBranch for the quest PR.
 */
async function createStagingBranch(
  client: KadiClient,
  repoPath: string,
  stagingBranch: string,
  baseBranch: string,
): Promise<void> {
  // First checkout baseBranch to ensure we branch from it
  await client.invokeRemote('git_git_checkout', {
    path: repoPath,
    target: baseBranch,
  });

  // Create and switch to staging branch
  try {
    await client.invokeRemote('git_git_checkout', {
      path: repoPath,
      target: stagingBranch,
      createBranch: true,
    });
    logger.info(MODULE_AGENT, `Created staging branch ${stagingBranch} from ${baseBranch}`, timer.elapsed('main'));
  } catch (err: any) {
    // Branch may already exist — try switching to it
    logger.warn(MODULE_AGENT, `Failed to create ${stagingBranch}: ${err.message} — trying checkout`, timer.elapsed('main'));
    await client.invokeRemote('git_git_checkout', {
      path: repoPath,
      target: stagingBranch,
    });
  }
}



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

/**
 * Generate an LLM-enhanced PR body that summarizes the quest changes.
 * Falls back to the template-based buildPrBody if LLM is unavailable.
 */
async function generatePrBody(
  quest: QuestData,
  payload: QuestVerificationCompletePayload,
  providerManager?: ProviderManager | null,
): Promise<string> {
  // Fallback: template-based body
  const templateBody = buildPrBody(quest, payload);

  if (!providerManager) return templateBody;

  try {
    const taskSummary = quest.tasks
      .map((t) => `- [${t.status === 'completed' ? 'x' : ' '}] ${t.name} (${t.status})`)
      .join('\n');

    const messages: Message[] = [
      {
        role: 'system',
        content:
          'You are a technical writer generating a GitHub PR description. ' +
          'Write a concise, well-structured PR body in Markdown. ' +
          'Include: a brief summary of what changed, a task checklist, and any notable decisions. ' +
          'Keep it under 500 words. Do not invent details not present in the input.',
      },
      {
        role: 'user',
        content: [
          `Quest: ${quest.title}`,
          `Description: ${quest.description || 'N/A'}`,
          '',
          'Tasks:',
          taskSummary,
          '',
          `Stats: ${payload.completedCount} completed, ${payload.failedCount} failed, ${payload.totalTasks} total`,
          '',
          quest.description ? `Requirements:\n${quest.description.slice(0, 2000)}` : '',
        ].join('\n'),
      },
    ];

    const result = await providerManager.chat(messages, { maxTokens: 1024 });

    if (result.success && result.data) {
      logger.info(MODULE_AGENT, 'LLM-generated PR body', timer.elapsed('main'));
      // Append the standard footer
      return `${result.data}\n\n---\n*Created by ${payload.verifiedBy} via KĀDI agent-lead*`;
    }

    logger.warn(MODULE_AGENT, 'LLM PR body generation failed — using template', timer.elapsed('main'));
    return templateBody;
  } catch (err: any) {
    logger.warn(MODULE_AGENT, `LLM PR body error: ${err.message} — using template`, timer.elapsed('main'));
    return templateBody;
  }
}

/**
 * Push a branch to remote via mcp-server-git.
 * Retries on transient failures (credential store lock, network glitch).
 */
const PUSH_MAX_RETRIES = 3;
const PUSH_RETRY_DELAY_MS = 3000;

async function pushBranch(
  client: KadiClient,
  repoPath: string,
  branch: string,
): Promise<void> {
  for (let attempt = 1; attempt <= PUSH_MAX_RETRIES; attempt++) {
    try {
      const result = await client.invokeRemote<{
        content: Array<{ type: string; text: string }>;
      }>('git_git_push', {
        path: repoPath,
        remote: 'origin',
        branch,
      });

      const rawText = result.content[0].text;

      // MCP server wraps git errors as { content: [{ text: "Error: ..." }] }
      if (rawText.startsWith('Error:')) {
        const isTransient = rawText.includes('Resource busy')
          || rawText.includes('credential store')
          || rawText.includes('could not lock');

        if (isTransient && attempt < PUSH_MAX_RETRIES) {
          logger.warn(
            MODULE_AGENT,
            `Push attempt ${attempt}/${PUSH_MAX_RETRIES} failed (transient): ${rawText.slice(0, 200)}`,
            timer.elapsed('main'),
          );
          await new Promise((r) => setTimeout(r, PUSH_RETRY_DELAY_MS));
          continue;
        }

        throw new Error(rawText);
      }

      logger.info(MODULE_AGENT, `Push result: ${JSON.stringify(result).slice(0, 300)}`, timer.elapsed('main'));
      return; // success
    } catch (err: any) {
      if (attempt < PUSH_MAX_RETRIES && (
        err.message?.includes('Resource busy')
        || err.message?.includes('credential store')
        || err.message?.includes('could not lock')
      )) {
        logger.warn(
          MODULE_AGENT,
          `Push attempt ${attempt}/${PUSH_MAX_RETRIES} threw (transient): ${err.message}`,
          timer.elapsed('main'),
        );
        await new Promise((r) => setTimeout(r, PUSH_RETRY_DELAY_MS));
        continue;
      }

      logger.error(MODULE_AGENT, `Push failed: ${err.message}`, timer.elapsed('main'));
      throw err;
    }
  }
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
  providerManager?: ProviderManager | null,
  memoryService?: MemoryService,
  nativeFileLocal?: NativeAbility | null,
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

  // Only the lead that published quest.verification_complete should create the PR.
  // Other leads receive the event (shared producer network) but must skip.
  if (payload.verifiedBy && payload.verifiedBy !== agentId) {
    logger.info(
      MODULE_AGENT,
      `Skipping PR workflow for quest ${payload.questId} — verifiedBy=${payload.verifiedBy}, I am ${agentId}`,
      timer.elapsed('main'),
    );
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

  // Determine repo info — try quest.repoUrl first, then REPO_PATH env, then give up
  let repoUrl = quest.repoUrl ?? '';
  let repoInfo = repoUrl ? parseRepoUrl(repoUrl) : null;

  if (!repoInfo) {
    // Derive from git remote using REPO_PATH (filesystem path to the git repo)
    const repoPath = process.env.REPO_PATH ?? '';
    if (repoPath) {
      const derivedUrl = await deriveRepoUrl(client, repoPath);
      if (derivedUrl) {
        repoUrl = derivedUrl;
        repoInfo = parseRepoUrl(derivedUrl);
        logger.info(MODULE_AGENT, `Derived repo URL from git remote (REPO_PATH=${repoPath}): ${derivedUrl}`, timer.elapsed('main'));
      }
    } else {
      logger.warn(MODULE_AGENT, 'REPO_PATH env var not set — cannot derive repo URL from git remote', timer.elapsed('main'));
    }
  }

  if (!repoInfo) {
    logger.warn(MODULE_AGENT, `Cannot determine repo info for quest ${payload.questId} (repoUrl: ${repoUrl})`, timer.elapsed('main'));
    return {
      questId: payload.questId,
      success: false,
      message: `Invalid or missing repoUrl: ${repoUrl}`,
    };
  }

  const repoPath = process.env.REPO_PATH ?? '';
  const baseBranch = quest.baseBranch ?? 'main';
  const stagingBranch = `quest/${payload.questId}`;

  // Discover task branches via git worktree list (like agent-producer)
  const taskBranches = await discoverTaskBranches(client, repoPath, quest);
  logger.info(
    MODULE_AGENT,
    `Discovered ${taskBranches.length} task branch(es) via worktree list: ${taskBranches.join(', ') || '(none)'}`,
    timer.elapsed('main'),
  );

  if (taskBranches.length === 0) {
    logger.warn(MODULE_AGENT, `No task branches found — cannot create PR`, timer.elapsed('main'));
    return {
      questId: payload.questId,
      success: false,
      message: 'No task branches discovered from worktree list',
    };
  }

  // Create staging branch from baseBranch
  await createStagingBranch(client, repoPath, stagingBranch, baseBranch);

  // Recall past merge conflict patterns (best-effort, non-blocking)
  if (memoryService) {
    try {
      const recallResult = await memoryService.recallRelevant(
        'merge',
        `PR merge for quest ${payload.questId}`,
        undefined,
        3,
        ['*'],
      );
      if (recallResult.success && recallResult.data.length > 0) {
        logger.info(MODULE_AGENT, `Recalled ${recallResult.data.length} past merge patterns`, timer.elapsed('main'));
      }
    } catch (err: any) {
      logger.warn(MODULE_AGENT, `Memory recall failed (non-fatal): ${err.message}`, timer.elapsed('main'));
    }
  }

  // Merge each task branch into staging
  for (const branch of taskBranches) {
    const mergeResult = await mergeTaskBranch(
      client,
      repoPath,
      branch,
      payload.questId,
      agentId,
      stagingBranch,
      providerManager,
      nativeFileLocal,
    );

    if (!mergeResult.merge.success) {
      // Check if conflicts were resolved (merge.success is false but resolution succeeded)
      const conflictsResolved = mergeResult.resolution?.resolved && mergeResult.finalCommit;
      if (!conflictsResolved) {
        logger.error(
          MODULE_AGENT,
          `Merge failed for ${branch}: ${mergeResult.merge.message}`,
          timer.elapsed('main'),
        );
        return {
          questId: payload.questId,
          success: false,
          message: `Merge failed for ${branch}: ${mergeResult.merge.message}`,
        };
      }
      logger.info(
        MODULE_AGENT,
        `Merge conflicts for ${branch} resolved (commit: ${mergeResult.finalCommit})`,
        timer.elapsed('main'),
      );
    }

    if (mergeResult.resolution && !mergeResult.resolution.resolved) {
      logger.warn(
        MODULE_AGENT,
        `Merge conflict escalated for ${branch} — aborting PR workflow`,
        timer.elapsed('main'),
      );
      return {
        questId: payload.questId,
        success: false,
        message: `Merge conflict in ${branch} — escalated to HUMAN`,
      };
    }
  }

  // Push staging branch
  logger.info(MODULE_AGENT, `Pushing ${stagingBranch} to origin`, timer.elapsed('main'));
  await pushBranch(client, repoPath, stagingBranch);

  // Switch main worktree back to baseBranch so it's not stuck on the quest branch
  try {
    await client.invokeRemote('git_git_checkout', { path: repoPath, target: baseBranch });
  } catch (err: any) {
    logger.warn(MODULE_AGENT, `Failed to switch back to ${baseBranch}: ${err.message}`, timer.elapsed('main'));
  }

  // Create PR
  const prTitle = `[Quest] ${quest.title}`;
  const prBody = await generatePrBody(quest, payload, providerManager);

  logger.info(
    MODULE_AGENT,
    `Creating PR: ${prTitle} (${stagingBranch} → ${baseBranch})`,
    timer.elapsed('main'),
  );

  const prResult = await client.invokeRemote<{
    content: Array<{ type: string; text: string }>;
  }>('github_github_create_pr', {
    owner: repoInfo.owner,
    repo: repoInfo.repo,
    title: prTitle,
    head: stagingBranch,
    base: baseBranch,
    body: prBody,
  });

  // Parse PR response — handle both MCP-wrapped and direct object shapes
  let prData: any;
  try {
    prData = parseMcpResponse(prResult);
  } catch {
    // invokeRemote may return the object directly (not MCP-wrapped)
    prData = prResult as any;
  }
  logger.info(MODULE_AGENT, `PR response parsed: ${JSON.stringify(prData).slice(0, 300)}`, timer.elapsed('main'));
  const prNumber = prData.number;
  const prUrl = prData.html_url ?? prData.url;

  logger.info(MODULE_AGENT, `PR #${prNumber} created: ${prUrl}`, timer.elapsed('main'));

  // Publish quest.pr_created to producer network (for agent-producer → HUMAN notification)
  const prCreatedData = {
    questId: payload.questId,
    prNumber,
    prUrl,
    title: prTitle,
    stagingBranch,
    baseBranch,
    createdBy: agentId,
    timestamp: new Date().toISOString(),
  };
  await client.publish('quest.pr_created', prCreatedData, { broker: 'default', network: 'producer' });

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
  providerManager?: ProviderManager | null,
  memoryService?: MemoryService,
  nativeFileLocal?: NativeAbility | null,
): Promise<void> {
  logger.info(
    MODULE_AGENT,
    `Subscribing to ${TOPIC} events for PR workflow (role: ${role})...`,
    timer.elapsed('main'),
  );

  await client.subscribe(TOPIC, async (event: unknown) => {
    try {
      await handleVerificationComplete(client, agentId, event, providerManager, memoryService, nativeFileLocal);
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
