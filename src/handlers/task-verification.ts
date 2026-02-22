/**
 * Task Verification Handler — verifies task results from worker agents
 *
 * Subscribes to task.completed and task.failed events.
 * Performs structural verification (no LLM — agent-lead is lightweight),
 * records results via quest_quest_verify_task, and handles retry/cascade logic.
 *
 * Validation chain: worker → agent-lead (structural) → agent-producer (LLM deep verify)
 *
 * @module handlers/task-verification
 */

import { logger, MODULE_AGENT, timer } from 'agents-library';
import type { KadiClient } from '@kadi.build/core';
import type {
  TaskCompletedEvent,
  TaskFailedEvent,
} from 'agents-library';
import {
  TaskCompletedEventSchema,
  TaskFailedEventSchema,
  KadiEventSchema,
} from 'agents-library';

// ============================================================================
// Types
// ============================================================================

/** Structural verification result before forwarding to producer */
export interface StructuralVerificationResult {
  taskId: string;
  questId: string;
  passed: boolean;
  score: number;
  reason: string;
}

/** Result of handling a single task.completed event */
export interface TaskVerificationHandlerResult {
  taskId: string;
  questId: string;
  verification: StructuralVerificationResult;
  forwarded: boolean;
}

// ============================================================================
// Constants
// ============================================================================

const TOPIC_COMPLETED = 'task.completed';
const TOPIC_FAILED = 'task.failed';
const MAX_RETRIES = 3;

// ============================================================================
// Structural Verification
// ============================================================================

/**
 * Perform structural verification on a task.completed event.
 *
 * Checks:
 * - Required fields present (taskId, questId, commitSha, agent)
 * - At least one file created or modified
 * - commitSha is a valid hex string
 *
 * This is a lightweight gate before forwarding to agent-producer for LLM review.
 */
function verifyStructural(event: TaskCompletedEvent): StructuralVerificationResult {
  const questId = event.questId ?? '';
  let score = 100;
  const issues: string[] = [];

  // Check required fields
  if (!event.taskId) {
    issues.push('missing taskId');
    score -= 40;
  }
  if (!questId) {
    issues.push('missing questId');
    score -= 20;
  }
  if (!event.agent) {
    issues.push('missing agent identifier');
    score -= 10;
  }

  // Check commit evidence
  if (!event.commitSha || !/^[0-9a-f]{7,40}$/i.test(event.commitSha)) {
    issues.push(`invalid or missing commitSha: "${event.commitSha ?? ''}"`);
    score -= 30;
  }

  // Check file evidence
  const filesCreated = event.filesCreated?.length ?? 0;
  const filesModified = event.filesModified?.length ?? 0;
  if (filesCreated + filesModified === 0) {
    issues.push('no files created or modified');
    score -= 20;
  }

  const passed = score >= 60;
  const reason = issues.length > 0
    ? `Structural issues: ${issues.join('; ')}`
    : 'Structural verification passed';

  return { taskId: event.taskId, questId, passed, score: Math.max(0, score), reason };
}

// ============================================================================
// Quest Tool Interactions
// ============================================================================

/**
 * Record structural verification result via quest_quest_verify_task.
 */
async function recordVerification(
  client: KadiClient,
  result: StructuralVerificationResult,
  verifiedBy: string,
): Promise<void> {
  await client.invokeRemote('quest_quest_verify_task', {
    taskId: result.taskId,
    summary: result.reason,
    score: result.score,
    verifiedBy,
  });

  logger.info(
    MODULE_AGENT,
    `Recorded verification for [${result.taskId}]: score=${result.score}, passed=${result.passed}`,
    timer.elapsed('main'),
  );
}

/**
 * Update task status in quest.
 */
async function updateTaskStatus(
  client: KadiClient,
  questId: string,
  taskId: string,
  status: string,
  agentId: string,
): Promise<void> {
  await client.invokeRemote('quest_quest_update_task', {
    questId,
    taskId,
    status,
    agentId,
  });
}

// ============================================================================
// Cascade Check
// ============================================================================

/**
 * Check if all tasks in a quest are terminal. If so, publish
 * task.quest_complete for agent-producer to handle PR/approval.
 */
async function checkQuestCompletion(
  client: KadiClient,
  questId: string,
  agentId: string,
): Promise<void> {
  const resp = await client.invokeRemote<{
    content: Array<{ type: string; text: string }>;
  }>('quest_quest_query_quest', { questId, detail: 'full' });

  const questData = JSON.parse(resp.content[0].text);
  const tasks: any[] = questData.tasks ?? [];

  if (tasks.length === 0) return;

  const terminalStatuses = ['completed', 'failed', 'rejected'];
  const allTerminal = tasks.every((t: any) => terminalStatuses.includes(t.status));
  const completedCount = tasks.filter((t: any) => t.status === 'completed').length;
  const failedCount = tasks.filter((t: any) => t.status === 'failed' || t.status === 'rejected').length;

  logger.info(
    MODULE_AGENT,
    `Quest ${questId}: ${completedCount} completed, ${failedCount} failed, ${tasks.length} total`,
    timer.elapsed('main'),
  );

  if (!allTerminal) {
    // Cascade: try to assign newly unblocked tasks
    try {
      const assignResult = await client.invokeRemote<{
        content: Array<{ type: string; text: string }>;
      }>('quest_quest_assign_task', { questId });

      const assignData = JSON.parse(assignResult.content[0].text);
      const newIds: string[] = assignData.assignedTaskIds ?? [];

      if (newIds.length > 0) {
        logger.info(
          MODULE_AGENT,
          `Cascade: ${newIds.length} newly unblocked task(s) — re-dispatching`,
          timer.elapsed('main'),
        );

        // Import assignAndDispatchTasks to re-dispatch
        const { assignAndDispatchTasks } = await import('./task-assignment.js');
        const allTasks = questData.tasks ?? [];
        const cascadeTasks = allTasks.filter((t: any) => newIds.includes(t.taskId));
        if (cascadeTasks.length > 0) {
          await assignAndDispatchTasks(client, questId, cascadeTasks, agentId);
        }
      }
    } catch (err: any) {
      logger.warn(MODULE_AGENT, `Cascade assignment failed: ${err.message}`, timer.elapsed('main'));
    }
    return;
  }

  // All terminal — notify producer
  logger.info(
    MODULE_AGENT,
    `All tasks in quest ${questId} are terminal — forwarding to producer`,
    timer.elapsed('main'),
  );

  await client.publish('quest.verification_complete', {
    questId,
    completedCount,
    failedCount,
    totalTasks: tasks.length,
    verifiedBy: agentId,
    timestamp: new Date().toISOString(),
  }, { broker: 'default', network: 'global' });
}

// ============================================================================
// Event Handlers
// ============================================================================

/**
 * Handle a task.completed event from a worker agent.
 *
 * 1. Parse and validate the event
 * 2. Run structural verification
 * 3. Record result in quest
 * 4. If passed, forward to producer via task.review_requested
 * 5. If failed, request revision from worker
 * 6. Check quest completion cascade
 */
async function handleTaskCompleted(
  client: KadiClient,
  agentId: string,
  event: unknown,
): Promise<TaskVerificationHandlerResult | null> {
  // Unwrap KĀDI envelope if present
  const eventData = (event as any)?.data || event;

  let completedEvent: TaskCompletedEvent;

  const envelopeParse = KadiEventSchema.safeParse(eventData);
  if (envelopeParse.success) {
    const payloadParse = TaskCompletedEventSchema.safeParse(envelopeParse.data.payload);
    if (!payloadParse.success) {
      logger.warn(MODULE_AGENT, `Invalid task.completed payload: ${payloadParse.error.message}`, timer.elapsed('main'));
      return null;
    }
    completedEvent = payloadParse.data as TaskCompletedEvent;
  } else {
    const payloadParse = TaskCompletedEventSchema.safeParse(eventData);
    if (!payloadParse.success) {
      logger.warn(MODULE_AGENT, `Invalid task.completed event: ${payloadParse.error.message}`, timer.elapsed('main'));
      return null;
    }
    completedEvent = payloadParse.data as TaskCompletedEvent;
  }

  const questId = completedEvent.questId ?? '';
  logger.info(
    MODULE_AGENT,
    `Received task.completed for [${completedEvent.taskId}] from ${completedEvent.agent}`,
    timer.elapsed('main'),
  );

  // Structural verification
  const verification = verifyStructural(completedEvent);
  logger.info(
    MODULE_AGENT,
    `Structural verification: score=${verification.score}, passed=${verification.passed}`,
    timer.elapsed('main'),
  );

  // Record in quest
  await recordVerification(client, verification, agentId);

  let forwarded = false;

  if (verification.passed) {
    // Forward to producer for LLM-based deep review
    await client.publish('task.review_requested', {
      taskId: completedEvent.taskId,
      questId,
      branch: completedEvent.worktreePath ?? '',
      commitHash: completedEvent.commitSha,
      structuralScore: verification.score,
      timestamp: new Date().toISOString(),
      verifiedBy: agentId,
    }, { broker: 'default', network: 'global' });

    forwarded = true;
    logger.info(
      MODULE_AGENT,
      `Forwarded [${completedEvent.taskId}] to producer for deep review`,
      timer.elapsed('main'),
    );
  } else {
    // Request revision from worker
    await client.publish('task.revision_needed', {
      taskId: completedEvent.taskId,
      questId,
      score: verification.score,
      feedback: verification.reason,
      revisionCount: 1,
      timestamp: new Date().toISOString(),
    }, { broker: 'default', network: 'global' });

    logger.warn(
      MODULE_AGENT,
      `Requested revision for [${completedEvent.taskId}]: ${verification.reason}`,
      timer.elapsed('main'),
    );
  }

  // Check cascade
  if (questId) {
    await checkQuestCompletion(client, questId, agentId);
  }

  return { taskId: completedEvent.taskId, questId, verification, forwarded };
}

/**
 * Handle a task.failed event from a worker agent.
 *
 * 1. Parse and validate the event
 * 2. Check retry count — if under MAX_RETRIES, republish task.assigned
 * 3. If exhausted, mark task as failed in quest
 * 4. Check quest completion cascade
 */
async function handleTaskFailed(
  client: KadiClient,
  agentId: string,
  event: unknown,
): Promise<void> {
  const eventData = (event as any)?.data || event;

  let failedEvent: TaskFailedEvent;

  const envelopeParse = KadiEventSchema.safeParse(eventData);
  if (envelopeParse.success) {
    const payloadParse = TaskFailedEventSchema.safeParse(envelopeParse.data.payload);
    if (!payloadParse.success) {
      logger.warn(MODULE_AGENT, `Invalid task.failed payload: ${payloadParse.error.message}`, timer.elapsed('main'));
      return;
    }
    failedEvent = payloadParse.data as TaskFailedEvent;
  } else {
    const payloadParse = TaskFailedEventSchema.safeParse(eventData);
    if (!payloadParse.success) {
      logger.warn(MODULE_AGENT, `Invalid task.failed event: ${payloadParse.error.message}`, timer.elapsed('main'));
      return;
    }
    failedEvent = payloadParse.data as TaskFailedEvent;
  }

  const questId = failedEvent.questId;
  logger.info(
    MODULE_AGENT,
    `Received task.failed for [${failedEvent.taskId}]: ${failedEvent.error}`,
    timer.elapsed('main'),
  );

  // Check retry count from envelope metadata (not part of core schema)
  const retryCount = (eventData as any).retryCount ?? 0;

  if (retryCount < MAX_RETRIES) {
    logger.info(
      MODULE_AGENT,
      `Retrying [${failedEvent.taskId}] (attempt ${retryCount + 1}/${MAX_RETRIES})`,
      timer.elapsed('main'),
    );

    // Republish task.assigned with incremented retry count
    await client.publish('task.assigned', {
      taskId: failedEvent.taskId,
      questId,
      role: failedEvent.role,
      description: `Retry after failure: ${failedEvent.error}`,
      requirements: '',
      timestamp: new Date().toISOString(),
      assignedBy: agentId,
      retryCount: retryCount + 1,
      previousError: failedEvent.error,
    }, { broker: 'default', network: 'global' });
  } else {
    // Exhausted retries — mark as failed
    logger.warn(
      MODULE_AGENT,
      `Task [${failedEvent.taskId}] exhausted ${MAX_RETRIES} retries — marking as failed`,
      timer.elapsed('main'),
    );

    await updateTaskStatus(client, questId, failedEvent.taskId, 'failed', agentId);
  }

  // Check cascade
  await checkQuestCompletion(client, questId, agentId);
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Subscribe to task.completed and task.failed events on the broker.
 *
 * @param client  - Connected KadiClient instance
 * @param role    - This agent-lead's role (artist | designer | programmer)
 * @param agentId - This agent-lead's identity (e.g. "agent-lead-programmer")
 */
export async function setupTaskVerificationHandler(
  client: KadiClient,
  role: string,
  agentId: string,
): Promise<void> {
  logger.info(
    MODULE_AGENT,
    `Subscribing to ${TOPIC_COMPLETED} and ${TOPIC_FAILED} events (role: ${role})...`,
    timer.elapsed('main'),
  );

  await client.subscribe(TOPIC_COMPLETED, async (event: unknown) => {
    try {
      await handleTaskCompleted(client, agentId, event);
    } catch (err: any) {
      logger.error(
        MODULE_AGENT,
        `Error handling ${TOPIC_COMPLETED}: ${err.message}`,
        timer.elapsed('main'),
        err,
      );
    }
  });

  await client.subscribe(TOPIC_FAILED, async (event: unknown) => {
    try {
      await handleTaskFailed(client, agentId, event);
    } catch (err: any) {
      logger.error(
        MODULE_AGENT,
        `Error handling ${TOPIC_FAILED}: ${err.message}`,
        timer.elapsed('main'),
        err,
      );
    }
  });

  logger.info(
    MODULE_AGENT,
    `Subscribed to ${TOPIC_COMPLETED} and ${TOPIC_FAILED}`,
    timer.elapsed('main'),
  );
}
