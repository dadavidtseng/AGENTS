/**
 * Task Verification Handler — receives QA-validated results and performs final verification
 *
 * Subscribes to task.validated (from agent-qa) and task.failed (from worker) events.
 * Records results via quest_quest_verify_task, handles retry/cascade logic.
 *
 * Validation chain per QUEST_WORKFLOW_V2:
 *   worker → task.review_requested → agent-qa → task.validated → agent-lead (final verify)
 *
 * @module handlers/task-verification
 */

import { logger, MODULE_AGENT, timer } from 'agents-library';
import type { ProviderManager, Message } from 'agents-library';
import type { KadiClient } from '@kadi.build/core';
import type {
  TaskValidatedPayload,
  TaskFailedEvent,
  TaskRevisionNeededPayload,
} from 'agents-library';
import {
  TaskValidatedPayloadSchema,
  TaskFailedEventSchema,
  TaskRevisionNeededPayloadSchema,
  KadiEventSchema,
} from 'agents-library';

// ============================================================================
// Types
// ============================================================================

/** Result of handling a single task.validated event */
export interface TaskVerificationHandlerResult {
  taskId: string;
  questId: string;
  score: number;
  passed: boolean;
}

// ============================================================================
// Constants
// ============================================================================

const TOPIC_VALIDATED = 'task.validated';
const TOPIC_FAILED = 'task.failed';
const TOPIC_REVISION_NEEDED = 'task.revision_needed';
const TOPIC_CASCADE_NEEDED = 'quest.cascade_needed';
const MAX_RETRIES = 3;
const MAX_REVISIONS = 3;

// ============================================================================
// Quest Tool Interactions
// ============================================================================

/**
 * Record verification result via quest_quest_verify_task.
 * Passes explicit `passed` flag so the quest server respects agent-qa's decision.
 */
async function recordVerification(
  client: KadiClient,
  taskId: string,
  _questId: string,
  score: number,
  passed: boolean,
  summary: string,
  verifiedBy: string,
): Promise<void> {
  logger.info(
    MODULE_AGENT,
    `Calling quest_quest_verify_task for [${taskId}]: score=${score}, passed=${passed}, verifiedBy=${verifiedBy}`,
    timer.elapsed('main'),
  );

  await client.invokeRemote('quest_quest_verify_task', {
    taskId,
    score,
    passed,
    summary,
    verifiedBy,
  });

  logger.info(
    MODULE_AGENT,
    `Recorded verification for [${taskId}]: score=${score}, passed=${passed}`,
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
 * quest.verification_complete for agent-producer to handle PR/approval.
 */
async function checkQuestCompletion(
  client: KadiClient,
  questId: string,
  agentId: string,
  canCreatePR: boolean = true,
): Promise<void> {
  const resp = await client.invokeRemote<{
    content: Array<{ type: string; text: string }>;
  }>('quest_quest_query_quest', { questId, detail: 'full' });

  const rawQuestText = resp.content[0].text;
  if (rawQuestText.startsWith('Error:')) {
    logger.warn(MODULE_AGENT, `checkQuestCompletion: server error: ${rawQuestText}`, timer.elapsed('main'));
    return;
  }
  const questData = JSON.parse(rawQuestText);
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

  const role = agentId.replace(/^agent-lead-/, '');

  if (!allTerminal) {
    // Cascade: try to assign newly unblocked tasks.
    // Each lead only cascades tasks for its own role. Cross-role unblocking is
    // handled naturally because all leads receive task.validated events and each
    // will cascade its own role's newly-unblocked tasks independently.
    try {
      const assignResult = await client.invokeRemote<{
        content: Array<{ type: string; text: string }>;
      }>('quest_quest_assign_task', { questId, role });

      const rawText = assignResult.content[0].text;
      if (rawText.startsWith('Error:')) {
        logger.warn(MODULE_AGENT, `Cascade assign returned error: ${rawText}`, timer.elapsed('main'));
        return;
      }
      const assignData = JSON.parse(rawText);
      const newIds: string[] = assignData.assignedTaskIds ?? [];

      if (newIds.length > 0) {
        // Re-fetch quest data to get current task statuses (stale data may be outdated)
        const freshResp = await client.invokeRemote<{
          content: Array<{ type: string; text: string }>;
        }>('quest_quest_query_quest', { questId, detail: 'full' });
        const freshRawText = freshResp.content[0].text;
        if (freshRawText.startsWith('Error:')) {
          logger.warn(MODULE_AGENT, `Cascade re-fetch returned error: ${freshRawText}`, timer.elapsed('main'));
          return;
        }
        const freshQuestData = JSON.parse(freshRawText);
        const freshTasks: any[] = freshQuestData.tasks ?? [];

        // Filter out tasks that are already terminal — don't re-dispatch failed/rejected tasks
        // Note: server returns `id` but agent-lead uses `taskId` — check both
        const cascadeTasks = freshTasks
          .filter(
            (t: any) => newIds.includes(t.id ?? t.taskId) && !terminalStatuses.includes(t.status),
          )
          .map((t: any) => ({
            taskId: (t.id ?? t.taskId) as string,
            name: t.name as string,
            description: t.description as string,
            implementationGuide: t.implementationGuide as string | undefined,
            verificationCriteria: t.verificationCriteria as string | undefined,
            status: t.status as string,
            assignedTo: (t.assignedAgent ?? t.assignedTo) as string | undefined,
            role: t.role as string | undefined,
            dependencies: t.dependencies as string[] | undefined,
          }));

        if (cascadeTasks.length > 0) {
          logger.info(
            MODULE_AGENT,
            `Cascade: ${cascadeTasks.length} newly unblocked task(s) — re-dispatching`,
            timer.elapsed('main'),
          );

          const { assignAndDispatchTasks } = await import('./task-assignment.js');
          await assignAndDispatchTasks(client, questId, cascadeTasks, agentId, role);
        } else {
          logger.info(
            MODULE_AGENT,
            `Cascade: ${newIds.length} task(s) returned but all are terminal — skipping`,
            timer.elapsed('main'),
          );
        }
      }
    } catch (err: any) {
      logger.warn(MODULE_AGENT, `Cascade assignment failed: ${err.message}`, timer.elapsed('main'));
    }
    return;
  }

  // All terminal — only the verifying lead triggers the PR workflow
  if (!canCreatePR) {
    logger.info(
      MODULE_AGENT,
      `All tasks in quest ${questId} are terminal — but this lead is cascade-only, skipping PR`,
      timer.elapsed('main'),
    );
    return;
  }

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
  }, { broker: 'default', network: 'producer' });
}

// ============================================================================
// Event Handlers
// ============================================================================

/**
 * Handle a task.validated event from agent-qa.
 *
 * Per QUEST_WORKFLOW_V2 step 17:
 * 1. Parse TaskValidatedPayload (score, severity, feedback)
 * 2. Record verification in quest (with explicit passed flag)
 * 3. Check quest completion cascade
 */
async function handleTaskValidated(
  client: KadiClient,
  agentId: string,
  event: unknown,
): Promise<TaskVerificationHandlerResult | null> {
  // Unwrap KĀDI envelope if present
  const eventData = (event as any)?.data || event;

  let validatedPayload: TaskValidatedPayload;

  const envelopeParse = KadiEventSchema.safeParse(eventData);
  if (envelopeParse.success) {
    const payloadParse = TaskValidatedPayloadSchema.safeParse(envelopeParse.data.payload);
    if (!payloadParse.success) {
      logger.warn(MODULE_AGENT, `Invalid task.validated payload: ${payloadParse.error.message}`, timer.elapsed('main'));
      return null;
    }
    validatedPayload = payloadParse.data as TaskValidatedPayload;
  } else {
    const payloadParse = TaskValidatedPayloadSchema.safeParse(eventData);
    if (!payloadParse.success) {
      logger.warn(MODULE_AGENT, `Invalid task.validated event: ${payloadParse.error.message}`, timer.elapsed('main'));
      return null;
    }
    validatedPayload = payloadParse.data as TaskValidatedPayload;
  }

  const { taskId, questId, score, severity, feedback } = validatedPayload;
  const passed = severity !== 'FAIL';

  logger.info(
    MODULE_AGENT,
    `Received task.validated for [${taskId}]: score=${score}, severity=${severity}`,
    timer.elapsed('main'),
  );

  // Role guard: only the lead whose role matches the task should record verification.
  // Other leads still check cascade to unblock their own dependent tasks.
  const leadRole = agentId.replace(/^agent-lead-/, '');
  let taskRole: string | undefined;
  try {
    const resp = await client.invokeRemote<{
      content: Array<{ type: string; text: string }>;
    }>('quest_quest_query_quest', { questId, detail: 'full' });
    const roleRawText = resp.content[0].text;
    if (roleRawText.startsWith('Error:')) {
      logger.warn(MODULE_AGENT, `Role guard query returned error: ${roleRawText}`, timer.elapsed('main'));
    } else {
      const questData = JSON.parse(roleRawText);
      const taskInfo = (questData.tasks ?? []).find(
        (t: any) => (t.id ?? t.taskId) === taskId,
      );
      taskRole = taskInfo?.role;
    }
  } catch (err: any) {
    logger.warn(
      MODULE_AGENT,
      `Failed to query task role for [${taskId}]: ${err.message}`,
      timer.elapsed('main'),
    );
  }

  if (!taskRole || taskRole !== leadRole) {
    logger.info(
      MODULE_AGENT,
      `Skipping verification for [${taskId}] (task role: ${taskRole ?? 'unknown'}, my role: ${leadRole}) — waiting for cascade`,
      timer.elapsed('main'),
    );
    return null;  // No cascade here — verifying lead will publish quest.cascade_needed
  }

  // Record in quest with explicit passed flag (fixes threshold mismatch)
  await recordVerification(client, taskId, questId, score, passed, feedback, agentId);

  if (!passed) {
    // Shouldn't normally happen (agent-qa sends task.revision_needed for FAIL),
    // but handle defensively
    logger.warn(
      MODULE_AGENT,
      `Task [${taskId}] validated with FAIL severity — requesting revision`,
      timer.elapsed('main'),
    );

    const role = agentId.replace(/^agent-lead-/, '');
    await client.publish('task.revision_needed', {
      taskId,
      questId,
      score,
      feedback,
      revisionCount: 1,
      timestamp: new Date().toISOString(),
    }, { broker: 'default', network: role });
  } else {
    logger.info(
      MODULE_AGENT,
      `Task [${taskId}] verified by QA (score=${score}) — accepted`,
      timer.elapsed('main'),
    );
  }

  // Check cascade
  if (questId) {
    await checkQuestCompletion(client, questId, agentId);

    // Notify all leads to re-check cascade — by this point recordVerification
    // has persisted, so other leads will see consistent quest state.
    try {
      await client.publish(TOPIC_CASCADE_NEEDED, {
        questId,
        verifiedTaskId: taskId,
        timestamp: new Date().toISOString(),
      }, { broker: 'default', network: 'quest' });
    } catch (err: any) {
      logger.warn(MODULE_AGENT, `Failed to publish ${TOPIC_CASCADE_NEEDED}: ${err.message}`, timer.elapsed('main'));
    }
  }

  return { taskId, questId, score, passed };
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

  // Read retry attempt from the parsed event (now part of TaskFailedEvent schema)
  const retryAttempt = failedEvent.retryAttempt ?? 0;

  if (retryAttempt < MAX_RETRIES) {
    logger.info(
      MODULE_AGENT,
      `Retrying [${failedEvent.taskId}] (attempt ${retryAttempt + 1}/${MAX_RETRIES})`,
      timer.elapsed('main'),
    );

    // Republish task.assigned with incremented retry attempt
    await client.publish('task.assigned', {
      taskId: failedEvent.taskId,
      questId,
      role: failedEvent.role,
      description: `Retry after failure: ${failedEvent.error}`,
      requirements: '',
      timestamp: new Date().toISOString(),
      assignedBy: agentId,
      feedback: `Retry ${retryAttempt + 1}/${MAX_RETRIES}: ${failedEvent.error}`,
      retryAttempt: retryAttempt + 1,
    }, { broker: 'default', network: failedEvent.role || agentId.replace(/^agent-lead-/, '') });
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

/**
 * Use LLM to analyze QA feedback and generate targeted fix instructions.
 * Falls back to raw QA feedback if LLM is unavailable.
 */
async function generateFixInstructions(
  providerManager: ProviderManager | null | undefined,
  taskId: string,
  score: number,
  qaFeedback: string,
): Promise<string> {
  if (!providerManager) return qaFeedback;

  try {
    const messages: Message[] = [
      {
        role: 'system',
        content:
          'You are a senior developer reviewing QA feedback for a task. ' +
          'Analyze the feedback and produce clear, actionable fix instructions. ' +
          'Be specific: identify the root cause, list exact changes needed, and prioritize by impact. ' +
          'Keep it concise — under 300 words. Output plain text, no markdown headers.',
      },
      {
        role: 'user',
        content: [
          `Task ID: ${taskId}`,
          `QA Score: ${score}/100`,
          '',
          'QA Feedback:',
          qaFeedback,
          '',
          'Generate targeted fix instructions for the worker.',
        ].join('\n'),
      },
    ];

    const result = await providerManager.chat(messages, { maxTokens: 512 });

    if (result.success && result.data) {
      logger.info(MODULE_AGENT, `LLM-generated fix instructions for [${taskId}]`, timer.elapsed('main'));
      return result.data;
    }

    return qaFeedback;
  } catch (err: any) {
    logger.warn(MODULE_AGENT, `LLM fix analysis failed: ${err.message} — using raw feedback`, timer.elapsed('main'));
    return qaFeedback;
  }
}

/**
 * Handle task.revision_needed — QA rejected the code, re-assign to worker with feedback.
 *
 * Flow: agent-qa → task.revision_needed → agent-lead → task.assigned (with QA feedback) → worker
 */
async function handleRevisionNeeded(
  client: KadiClient,
  agentId: string,
  event: unknown,
  providerManager?: ProviderManager | null,
): Promise<void> {
  const eventData = (event as any)?.data || event;

  let payload: TaskRevisionNeededPayload;

  const envelopeParse = KadiEventSchema.safeParse(eventData);
  if (envelopeParse.success) {
    const payloadParse = TaskRevisionNeededPayloadSchema.safeParse(envelopeParse.data.payload);
    if (!payloadParse.success) {
      logger.warn(MODULE_AGENT, `Invalid task.revision_needed payload: ${payloadParse.error.message}`, timer.elapsed('main'));
      return;
    }
    payload = payloadParse.data as TaskRevisionNeededPayload;
  } else {
    const payloadParse = TaskRevisionNeededPayloadSchema.safeParse(eventData);
    if (!payloadParse.success) {
      logger.warn(MODULE_AGENT, `Invalid task.revision_needed event: ${payloadParse.error.message}`, timer.elapsed('main'));
      return;
    }
    payload = payloadParse.data as TaskRevisionNeededPayload;
  }

  const { taskId, questId, score, feedback, revisionCount } = payload;
  logger.info(
    MODULE_AGENT,
    `Received task.revision_needed for [${taskId}]: score=${score}, revision=${revisionCount}/${MAX_REVISIONS}`,
    timer.elapsed('main'),
  );

  if (revisionCount < MAX_REVISIONS) {
    logger.info(
      MODULE_AGENT,
      `Re-assigning [${taskId}] to worker with QA feedback (revision ${revisionCount + 1}/${MAX_REVISIONS})`,
      timer.elapsed('main'),
    );

    // Derive role from agentId (e.g. "agent-lead-programmer" → "programmer")
    const role = agentId.replace(/^agent-lead-/, '');

    // Generate targeted fix instructions via LLM (falls back to raw QA feedback)
    const fixInstructions = await generateFixInstructions(
      providerManager, taskId, score, feedback,
    );

    await client.publish('task.assigned', {
      taskId,
      questId,
      role,
      description: `Revision requested by QA (score: ${score})`,
      requirements: '',
      timestamp: new Date().toISOString(),
      assignedBy: agentId,
      feedback: `QA revision ${revisionCount + 1}/${MAX_REVISIONS}: ${fixInstructions}`,
      retryAttempt: revisionCount + 1,
    }, { broker: 'default', network: role });
  } else {
    logger.warn(
      MODULE_AGENT,
      `Task [${taskId}] exhausted ${MAX_REVISIONS} QA revisions (score=${score}) — marking as failed`,
      timer.elapsed('main'),
    );

    await updateTaskStatus(client, questId, taskId, 'failed', agentId);
  }

  await checkQuestCompletion(client, questId, agentId);
}

// ============================================================================
// Cascade Needed Handler
// ============================================================================

/**
 * Handle quest.cascade_needed — published by the verifying lead after
 * recording verification. Each lead runs its own role-scoped cascade
 * against now-consistent quest state.
 */
async function handleCascadeNeeded(
  client: KadiClient,
  agentId: string,
  role: string,
  event: unknown,
): Promise<void> {
  const eventData = (event as any)?.data || event;
  const envelope = KadiEventSchema.safeParse(eventData);
  const payload = envelope.success ? envelope.data.payload : eventData;
  const questId = (payload as any)?.questId;
  if (!questId) return;

  logger.info(MODULE_AGENT, `Received ${TOPIC_CASCADE_NEEDED} for quest ${questId}`, timer.elapsed('main'));

  // Run role-scoped cascade (verification is already persisted, state is consistent)
  try {
    const assignResult = await client.invokeRemote<{
      content: Array<{ type: string; text: string }>;
    }>('quest_quest_assign_task', { questId, role });

    const rawText = assignResult.content[0].text;
    if (rawText.startsWith('Error:')) return;

    const assignData = JSON.parse(rawText);
    const newIds: string[] = assignData.assignedTaskIds ?? [];

    if (newIds.length === 0) return;

    // Fetch fresh task data and dispatch
    const freshResp = await client.invokeRemote<{
      content: Array<{ type: string; text: string }>;
    }>('quest_quest_query_quest', { questId, detail: 'full' });
    const freshText = freshResp.content[0].text;
    if (freshText.startsWith('Error:')) return;

    const questData = JSON.parse(freshText);
    const tasks = (questData.tasks ?? [])
      .filter((t: any) => newIds.includes(t.id ?? t.taskId) && !['completed', 'failed', 'rejected'].includes(t.status))
      .map((t: any) => ({
        taskId: (t.id ?? t.taskId) as string,
        name: t.name as string,
        description: t.description as string,
        implementationGuide: t.implementationGuide as string | undefined,
        verificationCriteria: t.verificationCriteria as string | undefined,
        status: t.status as string,
        assignedTo: (t.assignedAgent ?? t.assignedTo) as string | undefined,
        role: t.role as string | undefined,
        dependencies: t.dependencies as string[] | undefined,
      }));

    if (tasks.length > 0) {
      logger.info(MODULE_AGENT, `Cascade (via ${TOPIC_CASCADE_NEEDED}): ${tasks.length} task(s) to dispatch`, timer.elapsed('main'));
      const { assignAndDispatchTasks } = await import('./task-assignment.js');
      await assignAndDispatchTasks(client, questId, tasks, agentId, role);
    }
  } catch (err: any) {
    logger.warn(MODULE_AGENT, `Cascade (${TOPIC_CASCADE_NEEDED}) failed: ${err.message}`, timer.elapsed('main'));
  }
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Subscribe to task.validated and task.failed events on the broker.
 *
 * @param client  - Connected KadiClient instance
 * @param role    - This agent-lead's role (artist | designer | programmer)
 * @param agentId - This agent-lead's identity (e.g. "agent-lead-programmer")
 */
export async function setupTaskVerificationHandler(
  client: KadiClient,
  role: string,
  agentId: string,
  providerManager?: ProviderManager | null,
): Promise<void> {
  logger.info(
    MODULE_AGENT,
    `Subscribing to ${TOPIC_VALIDATED}, ${TOPIC_FAILED}, ${TOPIC_REVISION_NEEDED}, and ${TOPIC_CASCADE_NEEDED} events (role: ${role})...`,
    timer.elapsed('main'),
  );

  await client.subscribe(TOPIC_VALIDATED, async (event: unknown) => {
    try {
      await handleTaskValidated(client, agentId, event);
    } catch (err: any) {
      logger.error(
        MODULE_AGENT,
        `Error handling ${TOPIC_VALIDATED}: ${err.message}`,
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

  await client.subscribe(TOPIC_REVISION_NEEDED, async (event: unknown) => {
    try {
      await handleRevisionNeeded(client, agentId, event, providerManager);
    } catch (err: any) {
      logger.error(
        MODULE_AGENT,
        `Error handling ${TOPIC_REVISION_NEEDED}: ${err.message}`,
        timer.elapsed('main'),
        err,
      );
    }
  });

  await client.subscribe(TOPIC_CASCADE_NEEDED, async (event: unknown) => {
    try {
      await handleCascadeNeeded(client, agentId, role, event);
    } catch (err: any) {
      logger.error(MODULE_AGENT, `Error handling ${TOPIC_CASCADE_NEEDED}: ${err.message}`, timer.elapsed('main'), err);
    }
  });

  logger.info(
    MODULE_AGENT,
    `Subscribed to ${TOPIC_VALIDATED}, ${TOPIC_FAILED}, ${TOPIC_REVISION_NEEDED}, and ${TOPIC_CASCADE_NEEDED}`,
    timer.elapsed('main'),
  );
}
