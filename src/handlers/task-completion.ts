/**
 * Task Completion Event Handler for Agent Producer
 * =================================================
 *
 * Subscribes to task.completed events from worker agents on 'utility' network.
 * Verifies task completion, records results, and sends Discord notifications.
 *
 * Flow:
 * 1. Subscribe to task.completed events on 'utility' network
 * 2. Receive event from worker agent with completion details
 * 3. Call quest_verify_task to verify completion
 * 4. Call quest_submit_task_result to record completion
 * 5. Send Discord notification with completion summary
 *
 * Integration:
 * - Uses KadiClient.subscribe() for event subscription
 * - Uses quest_verify_task and quest_submit_task_result via KĀDI broker
 * - Sends notifications to Discord channel where task was assigned
 */

import type { KadiClient } from '@kadi.build/core';
import { logger, MODULE_AGENT, timer } from 'agents-library';
import { getAssignedTasks, publishTaskAssignedEvent } from '../tools/task-execution.js';

// ============================================================================
// Types
// ============================================================================

interface TaskCompletedEvent {
  taskId: string;
  questId: string;
  role: string;
  status: 'completed';
  filesCreated: string[];
  filesModified: string[];
  commitSha: string;
  timestamp: string;
  agent: string;
  worktreePath?: string;
}

interface TaskVerificationResult {
  success: boolean;
  taskId: string;
  taskStatus: string;
  passed: boolean;
  score: number;
  message: string;
}

// Module-level map: taskId → worktreePath (populated by handleTaskCompletedEvent)
// Used by createQuestPullRequest to discover worker branches
const taskWorktreeMap = new Map<string, string>();

// ============================================================================
// Task Verification
// ============================================================================

/**
 * Verify task completion
 *
 * Calls quest_verify_task to verify task completion
 *
 * @param client - KĀDI client instance
 * @param event - Task completed event
 * @returns Verification result
 */
/**
 * Verify task completion using LLM
 *
 * Uses LLM to analyze task completion against verificationCriteria
 * and calculate a verification score (0-100)
 *
 * @param providerManager - Provider manager for LLM access
 * @param event - Task completed event
 * @param verificationCriteria - Verification criteria from task details
 * @param taskDetails - Full task details including description and requirements
 * @returns Verification result with score and summary
 */
async function verifyTaskCompletion(
  providerManager: any,
  event: TaskCompletedEvent,
  verificationCriteria: string,
  taskDetails: any,
  gitEvidence?: string
): Promise<{ score: number; summary: string; feedback: string }> {
  logger.info(
    MODULE_AGENT,
    `Verifying task completion with LLM: ${event.taskId}`,
    timer.elapsed('main')
  );

  try {
    // Build LLM prompt for verification
    const verificationPrompt = `You are a task verification expert. Analyze the following task completion and provide a verification score.

Task Description:
${taskDetails.description || 'No description provided'}

Task Requirements/Implementation Guide:
${taskDetails.implementationGuide || 'No specific requirements provided'}

Completion Details:
- Task ID: ${event.taskId}
- Completed by: ${event.agent}
- Files created: ${event.filesCreated.length} (${event.filesCreated.join(', ')})
- Files modified: ${event.filesModified.length} (${event.filesModified.join(', ')})
- Commit SHA: ${event.commitSha}
${(event as any).contentSummary ? `- Content produced:\n${(event as any).contentSummary}` : '- Content produced: (no content summary available)'}
${gitEvidence ? `\nGit Evidence (actual changes from the repository):\n${gitEvidence}` : ''}

Verification Criteria:
${verificationCriteria}

IMPORTANT INSTRUCTIONS:
1. Only verify what was EXPLICITLY required in the task description and requirements above
2. Do NOT add extra requirements or expectations beyond what was specified
3. Do NOT penalize for missing documentation, checksums, or other details unless they were explicitly required
4. Focus on whether the core task objectives were met
5. Do NOT require "verification artifacts" — the git diff IS the verification artifact
6. The worker's self-reported summary is secondary to actual git evidence

SCORING GUIDELINES:
- If git evidence shows the required file(s) were created/modified with correct content → score >= 85
- If the core task was completed but with minor issues (e.g., slightly different formatting) → score 80-84
- Only score below 80 if the task fundamentally failed (wrong file, missing content, no commit)
- When in doubt, favor passing (score >= 80) over failing — a human reviewer will do final approval

Based ONLY on the task description and requirements above, provide:
1. A verification score (0-100) where:
   - 0-79: Task needs revision or retry
   - 80-100: Task is ready for human approval
2. A brief summary of what was accomplished
3. Feedback for improvement (if score < 80) or confirmation (if score >= 80)

Respond in JSON format:
{
  "score": <number 0-100>,
  "summary": "<brief summary of accomplishment>",
  "feedback": "<feedback or confirmation>"
}`;

    // Call LLM for verification
    const llmResult = await providerManager.chat(
      [
        {
          role: 'user',
          content: verificationPrompt,
        },
      ],
      {
        model: 'gpt-5-mini',
      }
    );

    if (!llmResult.success) {
      throw new Error(`LLM verification failed: ${llmResult.error.message}`);
    }

    // Parse LLM response
    const responseText = llmResult.data;
    
    // Extract JSON from response (handle markdown code blocks)
    let jsonText = responseText;
    const jsonMatch = responseText.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
    if (jsonMatch) {
      jsonText = jsonMatch[1];
    }

    const verificationResult = JSON.parse(jsonText);

    logger.info(
      MODULE_AGENT,
      `LLM verification score: ${verificationResult.score}/100`,
      timer.elapsed('main')
    );

    return {
      score: verificationResult.score,
      summary: verificationResult.summary,
      feedback: verificationResult.feedback,
    };
  } catch (error: any) {
    logger.error(
      MODULE_AGENT,
      `Failed to verify task with LLM: ${error.message}`,
      timer.elapsed('main'),
      error
    );
    throw error;
  }
}

/**
 * Submit task completion result
 *
 * Calls quest_submit_task_result to record task completion
 *
 * @param client - KĀDI client instance
 * @param event - Task completed event
 * @returns Submission result
 */
/**
 * Record task verification result
 *
 * Calls quest_verify_task to record the LLM verification score
 *
 * @param client - KĀDI client instance
 * @param event - Task completed event
 * @param score - Verification score (0-100)
 * @param summary - Verification summary
 * @returns Verification result
 */
async function recordTaskVerification(
  client: KadiClient,
  event: TaskCompletedEvent,
  score: number,
  summary: string
): Promise<TaskVerificationResult> {
  logger.info(
    MODULE_AGENT,
    `Recording task verification: ${event.taskId} (score: ${score})`,
    timer.elapsed('main')
  );

  try {
    // Call quest_verify_task tool via KĀDI broker
    const result = await client.invokeRemote<{
      content: Array<{ type: string; text: string }>;
    }>('quest_quest_verify_task', {
      taskId: event.taskId,
      summary,
      score,
      verifiedBy: 'agent-producer',
    });

    // Parse result
    const resultText = result.content[0].text;

    // Log the raw result for debugging
    logger.debug(
      MODULE_AGENT,
      `Raw verification result: ${resultText.substring(0, 200)}`,
      timer.elapsed('main')
    );

    // Check if result is an error message
    if (resultText.startsWith('Error:') || resultText.startsWith('error:')) {
      throw new Error(`Tool returned error: ${resultText}`);
    }

    const verificationData = JSON.parse(resultText) as TaskVerificationResult;

    logger.info(
      MODULE_AGENT,
      `Task verification recorded: ${verificationData.passed ? 'VERIFIED' : 'FAILED'}`,
      timer.elapsed('main')
    );

    return verificationData;
  } catch (error: any) {
    logger.error(
      MODULE_AGENT,
      `Failed to record task verification: ${error.message}`,
      timer.elapsed('main'),
      error
    );
    throw error;
  }
}

// ============================================================================
// Batch Approval Check
// ============================================================================

/**
 * Check if all tasks in a quest are in terminal state, and if so,
 * request task approval for all completed tasks.
 *
 * Terminal states: completed, failed, rejected
 * Only tasks with status 'completed' get approval requests.
 *
 * @param client - KĀDI client instance
 * @param questId - Quest ID to check
 * @param triggerEvent - The event that triggered this check
 */
/**
 * Create a quest-level pull request by merging all worker branches.
 *
 * Flow:
 * 1. Discover main repo path via git_git_worktree list
 * 2. Checkout main branch, create quest branch
 * 3. Merge each worker branch into quest branch
 * 4. Push quest branch and create PR via `gh` CLI
 *
 * @returns PR URL if successful, null otherwise
 */
async function createQuestPullRequest(
  client: KadiClient,
  questId: string,
  completedTasks: any[]
): Promise<string | null> {
  // Step 1: Find any worktree path to discover the main repo
  let anyWorktreePath: string | null = null;
  for (const task of completedTasks) {
    const taskId = task.taskId || task.id;
    const path = taskWorktreeMap.get(taskId);
    if (path) {
      anyWorktreePath = path;
      break;
    }
  }

  if (!anyWorktreePath) {
    logger.warn(
      MODULE_AGENT,
      `No worktree paths stored for quest ${questId} — skipping PR creation`,
      timer.elapsed('main')
    );
    return null;
  }

  // Step 2: List worktrees to find main repo and worker branches
  const worktreeResult = await client.invokeRemote<{
    content: Array<{ type: string; text: string }>;
  }>('git_git_worktree', {
    path: anyWorktreePath,
    mode: 'list',
  });

  const worktreeData = JSON.parse(worktreeResult.content[0].text);
  const worktrees: Array<{
    path: string;
    head: string;
    branch?: string;
    bare: boolean;
    detached: boolean;
  }> = worktreeData.worktrees || [];

  if (worktrees.length === 0) {
    logger.warn(
      MODULE_AGENT,
      'No worktrees found — skipping PR creation',
      timer.elapsed('main')
    );
    return null;
  }

  // First entry is always the main working tree
  const mainRepoPath = worktrees[0].path;
  const mainBranch = worktrees[0].branch || 'main';

  logger.info(
    MODULE_AGENT,
    `Main repo: ${mainRepoPath} (branch: ${mainBranch})`,
    timer.elapsed('main')
  );

  // Step 3: Collect worker branch names from worktree list
  const workerBranches: string[] = [];
  for (const task of completedTasks) {
    const taskId = task.taskId || task.id;
    const worktreePath = taskWorktreeMap.get(taskId);
    if (worktreePath) {
      // Normalize path separators for comparison
      const normalizedPath = worktreePath.replace(/\\/g, '/');
      const wt = worktrees.find(
        (w) => w.path.replace(/\\/g, '/') === normalizedPath
      );
      if (wt?.branch) {
        workerBranches.push(wt.branch);
      } else {
        logger.warn(
          MODULE_AGENT,
          `No branch found for worktree ${worktreePath} (task ${taskId})`,
          timer.elapsed('main')
        );
      }
    }
  }

  if (workerBranches.length === 0) {
    logger.warn(
      MODULE_AGENT,
      `No worker branches found for quest ${questId} — skipping PR creation`,
      timer.elapsed('main')
    );
    return null;
  }

  logger.info(
    MODULE_AGENT,
    `Worker branches to merge: ${workerBranches.join(', ')}`,
    timer.elapsed('main')
  );

  // Step 4: Checkout main branch in main repo
  const questBranch = `quest/${questId}`;

  await client.invokeRemote('git_git_checkout', {
    path: mainRepoPath,
    target: mainBranch,
  });

  // Step 5: Create quest branch from main
  await client.invokeRemote('git_git_checkout', {
    path: mainRepoPath,
    target: questBranch,
    createBranch: true,
  });

  logger.info(
    MODULE_AGENT,
    `Created quest branch: ${questBranch}`,
    timer.elapsed('main')
  );

  // Step 6: Merge each worker branch
  const mergedBranches: string[] = [];
  for (const branch of workerBranches) {
    try {
      const mergeResult = await client.invokeRemote<{
        content: Array<{ type: string; text: string }>;
        isError?: boolean;
      }>('git_git_merge', {
        path: mainRepoPath,
        branch,
        noFastForward: true,
        message: `Merge ${branch} into ${questBranch}`,
      });

      // Check for MCP-level error (tool returned isError)
      if (mergeResult.isError) {
        throw new Error(`Merge tool error: ${mergeResult.content?.[0]?.text || 'unknown'}`);
      }

      // Check for merge conflicts in the result payload
      let mergeData: any;
      try {
        mergeData = JSON.parse(mergeResult.content[0].text);
      } catch {
        // Non-JSON response — treat as success
      }

      if (mergeData?.conflicts) {
        logger.warn(
          MODULE_AGENT,
          `Merge of ${branch} has conflicts (${(mergeData.conflictedFiles || []).join(', ')}) — aborting merge`,
          timer.elapsed('main')
        );
        // Abort the conflicted merge
        try {
          await client.invokeRemote('git_git_merge', {
            path: mainRepoPath,
            branch: '',
            abort: true,
          });
        } catch {
          // Ignore abort errors
        }
        continue;
      }

      mergedBranches.push(branch);
      logger.info(
        MODULE_AGENT,
        `Merged branch: ${branch}`,
        timer.elapsed('main')
      );
    } catch (mergeError: any) {
      logger.error(
        MODULE_AGENT,
        `Failed to merge branch ${branch}: ${mergeError.message}`,
        timer.elapsed('main'),
        mergeError
      );
      // Abort the merge if it failed (conflicts)
      try {
        await client.invokeRemote('git_git_merge', {
          path: mainRepoPath,
          branch: '',
          abort: true,
        });
      } catch {
        // Ignore abort errors
      }
    }
  }

  if (mergedBranches.length === 0) {
    logger.error(
      MODULE_AGENT,
      'No branches could be merged — aborting PR creation',
      timer.elapsed('main')
    );
    // Checkout back to main
    await client.invokeRemote('git_git_checkout', {
      path: mainRepoPath,
      target: mainBranch,
    });
    return null;
  }

  // Compute base branch name early (used in diff check and PR creation)
  const baseBranch = mainBranch.replace(/^refs\/heads\//, '');

  // Step 6.5: Verify quest branch has actual file changes vs main
  // Prevents "No commits between" GitHub API error when worker changes are already in main
  try {
    const diffResult = await client.invokeRemote<{
      content: Array<{ type: string; text: string }>;
    }>('git_git_diff', {
      path: mainRepoPath,
      source: baseBranch,
      target: 'HEAD',
      nameOnly: true,
    });

    const rawDiffText = diffResult.content[0].text;
    logger.debug(
      MODULE_AGENT,
      `Diff result (raw): ${rawDiffText.substring(0, 500)}`,
      timer.elapsed('main')
    );

    const diffData = JSON.parse(rawDiffText);
    if (diffData.filesChanged === 0) {
      logger.warn(
        MODULE_AGENT,
        `No file differences between quest branch and ${baseBranch} — worker changes already in main, skipping PR creation`,
        timer.elapsed('main')
      );
      // Checkout back to main and clean up quest branch
      await client.invokeRemote('git_git_checkout', {
        path: mainRepoPath,
        target: mainBranch,
      });
      return null;
    }

    logger.info(
      MODULE_AGENT,
      `Quest branch has ${diffData.filesChanged} changed file(s) vs ${baseBranch}`,
      timer.elapsed('main')
    );
  } catch (diffError: any) {
    // Fail-open: if diff check fails, proceed with PR creation
    logger.warn(
      MODULE_AGENT,
      `Could not verify diff against ${baseBranch}: ${(diffError as Error).message} — proceeding with PR creation`,
      timer.elapsed('main')
    );
  }

  // Step 7: Push quest branch
  try {
    await client.invokeRemote('git_git_push', {
      path: mainRepoPath,
      branch: questBranch,
      setUpstream: true,
    });
    logger.info(
      MODULE_AGENT,
      `Pushed quest branch: ${questBranch}`,
      timer.elapsed('main')
    );
  } catch (pushError: any) {
    logger.error(
      MODULE_AGENT,
      `Failed to push quest branch: ${pushError.message}`,
      timer.elapsed('main'),
      pushError
    );
    return null;
  }

  // Step 8: Create PR via mcp-server-github (through KĀDI broker)
  try {
    const taskSummary = completedTasks
      .map((t: any) => `- ${t.taskName || t.name || t.taskId || t.id}`)
      .join('\n');
    const prBody = `Quest: ${questId}\n\nMerged branches:\n${mergedBranches.map((b) => `- ${b}`).join('\n')}\n\nCompleted tasks:\n${taskSummary}`;

    // Extract owner/repo from the git remote URL
    const remoteResult = await client.invokeRemote<{
      content: Array<{ type: string; text: string }>;
    }>('git_git_remote', {
      path: mainRepoPath,
    });
    const remoteData = JSON.parse(remoteResult.content[0].text);
    const remoteUrl: string = remoteData?.remotes?.[0]?.fetchUrl
      || remoteData?.remotes?.[0]?.pushUrl
      || '';

    // Parse owner/repo from remote URL (supports HTTPS and SSH formats)
    const ownerRepoMatch = remoteUrl.match(/(?:github\.com)[/:]([^/]+)\/([^/.]+)/);
    if (!ownerRepoMatch) {
      logger.warn(
        MODULE_AGENT,
        `Could not parse owner/repo from remote URL: ${remoteUrl} — skipping PR creation`,
        timer.elapsed('main')
      );
      return `Branch ${questBranch} pushed to origin (could not parse remote URL for PR creation)`;
    }

    const [, owner, repo] = ownerRepoMatch;

    // baseBranch already computed above (Step 6.5)
    const headBranch = questBranch;

    const prResult = await client.invokeRemote<{
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    }>('github_github_create_pr', {
      owner,
      repo,
      title: `Quest: ${questId}`,
      head: headBranch,
      base: baseBranch,
      body: prBody,
    });

    // Check for MCP tool-level error (isError flag)
    if (prResult.isError) {
      throw new Error(`GitHub API error: ${prResult.content?.[0]?.text || 'unknown error'}`);
    }

    // Safe parse — handle non-JSON responses gracefully
    let prData: any;
    try {
      prData = JSON.parse(prResult.content[0].text);
    } catch {
      throw new Error(`GitHub PR creation returned non-JSON response: ${prResult.content[0].text}`);
    }
    const prUrl = prData?.html_url || prData?.url || `PR #${prData?.number}`;

    logger.info(
      MODULE_AGENT,
      `PR created: ${prUrl}`,
      timer.elapsed('main')
    );
    return prUrl;
  } catch (prError: any) {
    logger.error(
      MODULE_AGENT,
      `Failed to create PR via mcp-server-github: ${prError.message}`,
      timer.elapsed('main'),
      prError
    );
    // Branch is pushed even if PR creation fails — user can create PR manually
    return `Branch ${questBranch} pushed to origin (PR creation failed — create manually)`;
  }
}

async function checkAllTasksCompleteAndRequestApproval(
  client: KadiClient,
  questId: string,
  triggerEvent: TaskCompletedEvent
): Promise<void> {
  try {
    // Fetch all tasks for this quest
    const questResponse = await client.invokeRemote<{
      content: Array<{ type: string; text: string }>;
    }>('quest_quest_query_task', {
      questId,
    });

    const questData = JSON.parse(questResponse.content[0].text);
    const tasks = questData.tasks || [];

    if (tasks.length === 0) {
      logger.warn(
        MODULE_AGENT,
        `No tasks found for quest ${questId}`,
        timer.elapsed('main')
      );
      return;
    }

    // Check if all tasks are in terminal state
    const terminalStatuses = ['completed', 'failed', 'rejected'];
    const allTerminal = tasks.every((t: any) => terminalStatuses.includes(t.status));
    const completedTasks = tasks.filter((t: any) => t.status === 'completed');
    const failedTasks = tasks.filter((t: any) => t.status === 'failed' || t.status === 'rejected');

    logger.info(
      MODULE_AGENT,
      `Quest ${questId} task status: ${completedTasks.length} completed, ${failedTasks.length} failed/rejected, ${tasks.length} total`,
      timer.elapsed('main')
    );

    if (!allTerminal) {
      const pendingTasks = tasks.filter((t: any) => !terminalStatuses.includes(t.status));
      logger.info(
        MODULE_AGENT,
        `Quest ${questId} still has ${pendingTasks.length} non-terminal task(s) — attempting dependency cascade`,
        timer.elapsed('main')
      );

      // Cascade: re-assign tasks whose dependencies are now resolved
      try {
        const assignResult = await client.invokeRemote<{
          content: Array<{ type: string; text: string }>;
        }>('quest_quest_assign_task', { questId });

        const assignData = JSON.parse(assignResult.content[0].text);

        if (assignData.assignedTaskIds && assignData.assignedTaskIds.length > 0) {
          logger.info(
            MODULE_AGENT,
            `Cascade: ${assignData.assignedTaskIds.length} newly unblocked task(s) assigned — dispatching`,
            timer.elapsed('main')
          );

          // Fetch and publish task.assigned events for newly assigned tasks
          const newTasks = await getAssignedTasks(client, questId);
          const cascadeTasks = newTasks.filter(t =>
            assignData.assignedTaskIds.includes(t.taskId)
          );

          const { taskChannelMap } = await import('../index.js');

          for (const task of cascadeTasks) {
            await publishTaskAssignedEvent(client, task, questId, 'cascade');

            // Inherit channel context from the completed task
            const parentCtx = taskChannelMap.get(triggerEvent.taskId);
            if (parentCtx) {
              taskChannelMap.set(task.taskId, { ...parentCtx });
            }

            logger.info(
              MODULE_AGENT,
              `Cascade: published task.assigned for ${task.taskId} (${task.name})`,
              timer.elapsed('main')
            );
          }
        } else {
          logger.info(
            MODULE_AGENT,
            `Cascade: no newly unblocked tasks to assign`,
            timer.elapsed('main')
          );
        }
      } catch (cascadeError: any) {
        logger.error(
          MODULE_AGENT,
          `Cascade assignment failed: ${cascadeError.message}`,
          timer.elapsed('main'),
          cascadeError
        );
      }
      return;
    }

    // All tasks are terminal — request approval for completed ones
    logger.info(
      MODULE_AGENT,
      `All tasks in quest ${questId} are terminal — requesting batch approval for ${completedTasks.length} completed task(s)`,
      timer.elapsed('main')
    );

    for (const task of completedTasks) {
      try {
        await client.invokeRemote('quest_quest_request_task_approval', {
          questId,
          taskId: task.taskId || task.id,
        });
        logger.info(
          MODULE_AGENT,
          `Requested approval for task ${task.taskId || task.id} (${task.taskName || task.name || 'unnamed'})`,
          timer.elapsed('main')
        );
      } catch (approvalError: any) {
        logger.error(
          MODULE_AGENT,
          `Failed to request approval for task ${task.taskId || task.id}: ${approvalError.message}`,
          timer.elapsed('main'),
          approvalError
        );
      }
    }

    // Create quest-level PR (merge all worker branches)
    let prUrl: string | null = null;
    try {
      prUrl = await createQuestPullRequest(client, questId, completedTasks);
      if (prUrl) {
        logger.info(
          MODULE_AGENT,
          `Quest PR created: ${prUrl}`,
          timer.elapsed('main')
        );
      }
    } catch (prError: any) {
      logger.error(
        MODULE_AGENT,
        `Quest PR creation failed: ${prError.message}`,
        timer.elapsed('main'),
        prError
      );
    }

    // Send Discord notification about batch approval + PR
    try {
      const { taskChannelMap } = await import('../index.js');
      const channelContext = taskChannelMap.get(triggerEvent.taskId);

      if (channelContext && channelContext.channelId && (channelContext.type === 'discord' || channelContext.type === 'desktop')) {
        const prLine = prUrl ? `\n🔗 PR: ${prUrl}` : '';
        const batchMessage = `🎉 All tasks in quest are complete!

📦 Quest: ${questId}
✅ Completed: ${completedTasks.length} task(s)${failedTasks.length > 0 ? `\n❌ Failed: ${failedTasks.length} task(s)` : ''}${prLine}

${completedTasks.map((t: any) => `  • ${t.taskName || t.name || t.taskId || t.id}`).join('\n')}

Please review all tasks in the dashboard and approve/revise/reject as needed.`;

        await client.invokeRemote('discord_server_send_message', {
          channel: channelContext.channelId,
          text: batchMessage,
        });

        logger.info(
          MODULE_AGENT,
          'Batch approval notification sent to Discord',
          timer.elapsed('main')
        );
      }
    } catch (notifyError: any) {
      logger.error(
        MODULE_AGENT,
        `Failed to send batch approval notification: ${notifyError.message}`,
        timer.elapsed('main'),
        notifyError
      );
    }
  } catch (error: any) {
    logger.error(
      MODULE_AGENT,
      `Failed to check quest completion status: ${error.message}`,
      timer.elapsed('main'),
      error
    );
  }
}

// ============================================================================
// Event Handler
// ============================================================================

/**
 * Handle task.completed event
 *
 * @param client - KĀDI client instance
 * @param event - Task completed event
 */
/**
 * Handle task.completed event
 *
 * Implements the complete verification workflow:
 * 1. Fetch task details and verification criteria
 * 2. Use LLM to calculate verification score (0-100)
 * 3. Record verification with quest_verify_task
 * 4. If score >= 80: Publish task.ready_for_approval and request human approval
 * 5. If score < 80: Publish task.failed and republish task.assigned to retry
 *
 * @param client - KĀDI client instance
 * @param providerManager - Provider manager for LLM access
 * @param event - Task completed event
 */
async function handleTaskCompletedEvent(
  client: KadiClient,
  providerManager: any,
  event: TaskCompletedEvent
): Promise<void> {
  logger.info(
    MODULE_AGENT,
    `Received task.completed event: ${event.taskId} from ${event.agent}`,
    timer.elapsed('main')
  );

  try {
    // Step 1: Fetch task details to get verification criteria
    logger.info(
      MODULE_AGENT,
      'Fetching task details for verification criteria...',
      timer.elapsed('main')
    );

    const taskDetailsResponse = await client.invokeRemote<{
      content: Array<{ type: string; text: string }>;
    }>('quest_quest_query_task', {
      taskId: event.taskId,
    });

    const taskDetailsText = taskDetailsResponse.content[0].text;
    const taskDetailsData = JSON.parse(taskDetailsText);
    const taskDetails = taskDetailsData.task;
    const questId = taskDetailsData.questContext?.questId || event.questId;
    const taskName = taskDetails.name || event.taskId;
    const verificationCriteria = taskDetails.verificationCriteria || 'No specific criteria provided';

    // Step 1a: If task is in 'needs_revision' (retry scenario), reset to 'in_progress' before verification
    // This prevents quest_verify_task from seeing a stale status due to read-modify-write races
    if (taskDetails.status === 'needs_revision') {
      try {
        const resetResult = await client.invokeRemote<{
          content: Array<{ type: string; text: string }>;
        }>('quest_quest_update_task', {
          questId: questId,
          taskId: event.taskId,
          status: 'in_progress',
          agentId: event.agent,
        });
        const resetText = resetResult.content?.[0]?.text || '';
        if (resetText.startsWith('Error:') || resetText.startsWith('error:')) {
          throw new Error(`Status reset failed: ${resetText}`);
        }
        logger.info(
          MODULE_AGENT,
          `Task ${event.taskId} status reset from 'needs_revision' to 'in_progress' before verification`,
          timer.elapsed('main')
        );
      } catch (statusError: any) {
        logger.warn(
          MODULE_AGENT,
          `Failed to pre-reset task status: ${statusError.message}`,
          timer.elapsed('main')
        );
        // Non-fatal: quest_verify_task now accepts needs_revision anyway (Fix 1)
      }
    }

    logger.info(
      MODULE_AGENT,
      `Task details fetched: ${taskName}`,
      timer.elapsed('main')
    );

    // Store worktree path for PR creation later
    if (event.worktreePath) {
      taskWorktreeMap.set(event.taskId, event.worktreePath);
      logger.info(
        MODULE_AGENT,
        `Stored worktree path for task ${event.taskId}: ${event.worktreePath}`,
        timer.elapsed('main')
      );
    }

    // Step 1b: Gather git evidence from the worker's worktree (if available)
    let gitEvidence = '';
    const worktreePath = event.worktreePath;
    if (worktreePath) {
      try {
        logger.info(
          MODULE_AGENT,
          `Gathering git evidence from worktree: ${worktreePath}`,
          timer.elapsed('main')
        );

        const gitLogResult = await client.invokeRemote<{
          content: Array<{ type: string; text: string }>;
        }>('git_git_log', {
          path: worktreePath,
          maxCount: 5,
        });
        const gitLogText = gitLogResult.content?.[0]?.text || '';

        const gitShowResult = await client.invokeRemote<{
          content: Array<{ type: string; text: string }>;
        }>('git_git_show', {
          path: worktreePath,
          object: 'HEAD',
        });
        const gitShowText = gitShowResult.content?.[0]?.text || '';
        // Truncate large diffs to avoid blowing up the LLM context
        const MAX_GIT_CHARS = 4000;
        const truncatedShow = gitShowText.length > MAX_GIT_CHARS
          ? gitShowText.substring(0, MAX_GIT_CHARS) + '\n... [truncated]'
          : gitShowText;

        gitEvidence = `Git Log (recent commits):\n${gitLogText}\n\nLatest Commit Diff:\n${truncatedShow}`;

        logger.info(
          MODULE_AGENT,
          `Git evidence gathered (${gitEvidence.length} chars)`,
          timer.elapsed('main')
        );
      } catch (gitError: any) {
        logger.warn(
          MODULE_AGENT,
          `Failed to gather git evidence: ${gitError.message}`,
          timer.elapsed('main')
        );
        // Non-fatal: continue without git evidence
      }
    }

    // Step 2: Use LLM to verify task and calculate score
    const verification = await verifyTaskCompletion(
      providerManager,
      event,
      verificationCriteria,
      taskDetails,
      gitEvidence || undefined
    );

    // Step 3: Record verification result (quest_verify_task now accepts in_progress)
    await recordTaskVerification(
      client,
      event,
      verification.score,
      verification.summary
    );

    // Step 4: Score-based decision making
    if (verification.score >= 80) {
      // High score: Send informational notification, then check if all tasks done
      logger.info(
        MODULE_AGENT,
        `Task scored ${verification.score}/100 - verified successfully`,
        timer.elapsed('main')
      );

      // Send informational Discord notification (not an approval request)
      try {
        const { taskChannelMap } = await import('../index.js');
        const channelContext = taskChannelMap.get(event.taskId);

        if (channelContext && channelContext.channelId && (channelContext.type === 'discord' || channelContext.type === 'desktop')) {
          const infoMessage = `✅ Task completed and verified

📋 Task: ${taskName}
🤖 Agent: ${event.agent}
📊 Verification Score: ${verification.score}/100
📁 Files created: ${event.filesCreated.length}
📝 Files modified: ${event.filesModified.length}
🔗 Commit: ${event.commitSha.substring(0, 7)}

Summary: ${verification.summary}`;

          await client.invokeRemote('discord_server_send_message', {
            channel: channelContext.channelId,
            text: infoMessage,
          });

          logger.info(
            MODULE_AGENT,
            'Informational completion notification sent to Discord',
            timer.elapsed('main')
          );
        }
      } catch (notifyError: any) {
        logger.error(
          MODULE_AGENT,
          `Failed to send completion notification: ${notifyError.message}`,
          timer.elapsed('main'),
          notifyError
        );
        // Don't throw - notification failure shouldn't block workflow
      }

      // Check if ALL tasks in this quest are now in terminal state
      await checkAllTasksCompleteAndRequestApproval(client, questId, event);
    } else {
      // Low score: Check retry limit before retrying
      const verificationHistory = taskDetails.artifacts?.verificationHistory || [];
      const MAX_RETRIES = 3;

      if (verificationHistory.length >= MAX_RETRIES) {
        logger.warn(
          MODULE_AGENT,
          `Task ${event.taskId} exceeded max retries (${MAX_RETRIES}, history: ${verificationHistory.length}) — marking as permanently failed`,
          timer.elapsed('main')
        );

        // Mark task as failed (terminal state)
        try {
          await client.invokeRemote('quest_quest_update_task', {
            questId,
            taskId: event.taskId,
            status: 'failed',
            agentId: event.agent,
          });
        } catch (failError: any) {
          logger.error(
            MODULE_AGENT,
            `Failed to mark task as failed: ${failError.message}`,
            timer.elapsed('main'),
            failError
          );
        }

        // Send Discord notification about permanent failure
        try {
          const { taskChannelMap } = await import('../index.js');
          const channelContext = taskChannelMap.get(event.taskId);

          if (channelContext && channelContext.channelId && (channelContext.type === 'discord' || channelContext.type === 'desktop')) {
            const failMessage = `❌ Task permanently failed after ${MAX_RETRIES} retries

📋 Task: ${taskName}
🤖 Agent: ${event.agent}
📊 Last Score: ${verification.score}/100

The task has been marked as failed. Please review and take manual action if needed.`;

            await client.invokeRemote('discord_server_send_message', {
              channel: channelContext.channelId,
              text: failMessage,
            });
          }
        } catch (notifyError: any) {
          logger.error(
            MODULE_AGENT,
            `Failed to send permanent failure notification: ${notifyError.message}`,
            timer.elapsed('main'),
            notifyError
          );
        }

        return;
      }

      logger.info(
        MODULE_AGENT,
        `Task scored ${verification.score}/100 - triggering retry (attempt ${verificationHistory.length + 1}/${MAX_RETRIES})`,
        timer.elapsed('main')
      );

      // Publish task.failed event
      await client.publish(
        'task.failed',
        {
          taskId: event.taskId,
          questId: event.questId,
          role: event.role,
          reason: 'verification_failed',
          score: verification.score,
          feedback: verification.feedback,
          error: `Verification failed with score ${verification.score}/100. ${verification.feedback}`,
          agent: event.agent,
          timestamp: new Date().toISOString(),
        },
        {
          broker: 'default',
          network: 'global',
        }
      );

      logger.info(
        MODULE_AGENT,
        'Published task.failed event',
        timer.elapsed('main')
      );

      // Status reset to 'in_progress' is now handled upfront in Step 1a (before verification)
      // so quest_verify_task always sees a clean state on retry completions

      // Republish task.assigned event with feedback for retry
      // IMPORTANT: Match the worker agent's expected schema (description + requirements)
      await client.publish(
        'task.assigned',
        {
          taskId: event.taskId,
          questId: event.questId,
          role: event.role,
          description: taskDetails.description || taskName || 'Task retry',
          requirements: taskDetails.implementationGuide || taskDetails.description || '',
          timestamp: new Date().toISOString(),
          assignedBy: 'system-retry',
          // Optional fields for retry context
          feedback: verification.feedback,
          retryAttempt: (taskDetails.artifacts?.verificationHistory?.length || 0) + 1,
        },
        {
          broker: 'default',
          network: 'global',
        }
      );

      logger.info(
        MODULE_AGENT,
        `Task ${event.taskId} republished for retry with feedback`,
        timer.elapsed('main')
      );

      // Send Discord notification about retry
      try {
        const { taskChannelMap } = await import('../index.js');
        const channelContext = taskChannelMap.get(event.taskId);

        if (channelContext && channelContext.channelId && (channelContext.type === 'discord' || channelContext.type === 'desktop')) {
          const retryMessage = `⚠️ Task needs revision

📋 Task: ${taskName}
🤖 Agent: ${event.agent}
📊 Verification Score: ${verification.score}/100

❌ Feedback: ${verification.feedback}

The task has been reassigned to ${event.agent} for retry.`;

          await client.invokeRemote('discord_server_send_message', {
            channel: channelContext.channelId,
            text: retryMessage,
          });

          logger.info(
            MODULE_AGENT,
            'Retry notification sent to Discord',
            timer.elapsed('main')
          );
        }
      } catch (error: any) {
        logger.error(
          MODULE_AGENT,
          `Failed to send retry notification: ${error.message}`,
          timer.elapsed('main'),
          error
        );
        // Don't throw - notification failure shouldn't block retry
      }
    }

    logger.info(
      MODULE_AGENT,
      `Task completion handled successfully: ${event.taskId}`,
      timer.elapsed('main')
    );
  } catch (error: any) {
    logger.error(
      MODULE_AGENT,
      `Failed to handle task.completed event: ${error.message}`,
      timer.elapsed('main'),
      error
    );
  }
}

// ============================================================================
// Event Subscription Setup
// ============================================================================

/**
 * Setup task completion event handler
 *
 * Subscribes to generic task.completed events on 'global' network.
 * Worker agents publish to 'task.completed' with agentId in the payload.
 *
 * @param client - KĀDI client instance
 * @param providerManager - Provider manager for LLM access
 */
export async function setupTaskCompletionHandler(
  client: KadiClient,
  providerManager: any
): Promise<void> {
  logger.info(
    MODULE_AGENT,
    'Setting up task completion event handler...',
    timer.elapsed('main')
  );

  try {
    // Subscribe to generic task.completed topic (agent identity is in the payload)
    await client.subscribe(
      'task.completed',
      async (event: any) => {
        logger.info(
          MODULE_AGENT,
          `🔔 Received task.completed event`,
          timer.elapsed('main')
        );

        // Extract event data from KĀDI envelope
        const eventData = (event as any)?.data || event;

        // Validate event has required fields
        if (!eventData.taskId || !eventData.questId || !eventData.agent) {
          logger.warn(
            MODULE_AGENT,
            `Received invalid task.completed event (missing required fields)`,
            timer.elapsed('main')
          );
          return;
        }

        // Handle event
        await handleTaskCompletedEvent(client, providerManager, eventData as TaskCompletedEvent);
      },
      {
        broker: 'default',
      }
    );

    logger.info(
      MODULE_AGENT,
      `Subscribed to task.completed for LLM verification`,
      timer.elapsed('main')
    );

    logger.info(
      MODULE_AGENT,
      'Task completion event handler registered successfully',
      timer.elapsed('main')
    );
  } catch (error: any) {
    logger.error(
      MODULE_AGENT,
      `Failed to setup task completion handler: ${error.message}`,
      timer.elapsed('main'),
      error
    );
    throw error;
  }
}
