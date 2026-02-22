/**
 * Task Reception Handler — quest.tasks_ready handoff from agent-producer → agent-lead
 *
 * Subscribes to quest.tasks_ready events published by agent-producer after task planning.
 * On receipt, queries mcp-server-quest for the full quest and filters tasks by this
 * agent-lead instance's role (artist / designer / programmer).
 *
 * @module handlers/task-reception
 */

import { logger, MODULE_AGENT, timer } from 'agents-library';
import type { KadiClient } from '@kadi.build/core';
import {
  QuestTasksReadyPayloadSchema,
  KadiEventSchema,
} from 'agents-library';
import type { KadiEvent, QuestTasksReadyPayload } from 'agents-library';
import { assignAndDispatchTasks } from './task-assignment.js';
import type { TaskAssignmentResult } from './task-assignment.js';

// ============================================================================
// Types
// ============================================================================

/** Minimal task shape returned by quest_quest_query_quest */
export interface QuestTask {
  taskId: string;
  name: string;
  description: string;
  implementationGuide?: string;
  verificationCriteria?: string;
  status: string;
  assignedTo?: string;
  role?: string;
  dependencies?: string[];
  relatedFiles?: Array<{ path: string; type: string }>;
}

/** Result of processing a quest.tasks_ready event */
export interface TaskReceptionResult {
  questId: string;
  totalTasks: number;
  matchingTasks: QuestTask[];
  skippedTasks: number;
  assignment?: TaskAssignmentResult;
}

// ============================================================================
// Constants
// ============================================================================

const TOPIC = 'quest.tasks_ready';

// ============================================================================
// Core Logic
// ============================================================================

/**
 * Query mcp-server-quest for full quest details and extract tasks.
 */
async function fetchQuestTasks(
  client: KadiClient,
  questId: string,
): Promise<QuestTask[]> {
  const result = await client.invokeRemote<{
    content: Array<{ type: string; text: string }>;
  }>('quest_quest_query_quest', {
    questId,
    detail: 'full',
  });

  const questData = JSON.parse(result.content[0].text);
  return questData.tasks ?? [];
}

/**
 * Filter tasks that match this agent-lead's role.
 *
 * A task matches if:
 * - task.role matches the agent's role exactly, OR
 * - task.role is unset (unassigned tasks are claimed by any lead)
 */
function filterTasksByRole(tasks: QuestTask[], role: string): QuestTask[] {
  return tasks.filter((task) => {
    if (!task.role) return true;
    return task.role === role;
  });
}

/**
 * Handle a single quest.tasks_ready event.
 */
async function handleTasksReady(
  client: KadiClient,
  role: string,
  agentId: string,
  event: unknown,
): Promise<TaskReceptionResult | null> {
  // Unwrap KĀDI envelope if present
  const eventData = (event as any)?.data || event;

  // Validate envelope
  const envelopeParse = KadiEventSchema.safeParse(eventData);
  let questId: string;

  if (envelopeParse.success) {
    // Full KadiEvent envelope
    const envelope = envelopeParse.data as KadiEvent<QuestTasksReadyPayload>;
    const payloadParse = QuestTasksReadyPayloadSchema.safeParse(envelope.payload);
    if (!payloadParse.success) {
      logger.warn(MODULE_AGENT, `Invalid quest.tasks_ready payload: ${payloadParse.error.message}`, timer.elapsed('main'));
      return null;
    }
    questId = payloadParse.data.questId;
  } else {
    // Flat payload (no envelope)
    const payloadParse = QuestTasksReadyPayloadSchema.safeParse(eventData);
    if (!payloadParse.success) {
      logger.warn(MODULE_AGENT, `Invalid quest.tasks_ready event: ${payloadParse.error.message}`, timer.elapsed('main'));
      return null;
    }
    questId = payloadParse.data.questId;
  }

  logger.info(MODULE_AGENT, `Received quest.tasks_ready for quest ${questId}`, timer.elapsed('main'));

  // Fetch tasks from mcp-server-quest
  const allTasks = await fetchQuestTasks(client, questId);
  logger.info(MODULE_AGENT, `  Quest has ${allTasks.length} total task(s)`, timer.elapsed('main'));

  // Filter by role
  const matching = filterTasksByRole(allTasks, role);
  const skipped = allTasks.length - matching.length;

  logger.info(
    MODULE_AGENT,
    `  ${matching.length} task(s) match role "${role}", ${skipped} skipped`,
    timer.elapsed('main'),
  );

  for (const task of matching) {
    logger.info(
      MODULE_AGENT,
      `    → [${task.taskId}] ${task.name} (status: ${task.status})`,
      timer.elapsed('main'),
    );
  }

  // Assign and dispatch matching tasks to worker agents
  let assignment: TaskAssignmentResult | undefined;
  if (matching.length > 0) {
    assignment = await assignAndDispatchTasks(client, questId, matching, agentId);
  }

  return { questId, totalTasks: allTasks.length, matchingTasks: matching, skippedTasks: skipped, assignment };
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Subscribe to quest.tasks_ready events on the broker.
 *
 * @param client - Connected KadiClient instance
 * @param role   - This agent-lead's role (artist | designer | programmer)
 */
export async function setupTaskReceptionHandler(
  client: KadiClient,
  role: string,
  agentId: string,
): Promise<void> {
  logger.info(MODULE_AGENT, `Subscribing to ${TOPIC} events (role: ${role})...`, timer.elapsed('main'));

  await client.subscribe(TOPIC, async (event: unknown) => {
    try {
      await handleTasksReady(client, role, agentId, event);
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
