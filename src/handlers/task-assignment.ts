/**
 * Task Assignment Handler — assigns tasks to worker agents and publishes task.assigned events
 *
 * Called by task-reception after filtering tasks by role. Orchestrates:
 * 1. quest_quest_assign_task to formally assign tasks in mcp-server-quest
 * 2. quest_quest_update_task to set status to in_progress
 * 3. Publishes task.assigned events for worker agents to execute
 *
 * Extracted from agent-producer's task-execution.ts (task 4.11).
 *
 * @module handlers/task-assignment
 */

import { logger, MODULE_AGENT, timer } from 'agents-library';
import type { KadiClient } from '@kadi.build/core';
import type { TaskAssignedEvent } from 'agents-library';
import type { QuestTask } from './task-reception.js';

// ============================================================================
// Types
// ============================================================================

/** Result of assigning a batch of tasks */
export interface TaskAssignmentResult {
  questId: string;
  assignedCount: number;
  publishedCount: number;
  failedCount: number;
  taskIds: string[];
}

// ============================================================================
// Core Logic
// ============================================================================

/**
 * Call quest_quest_assign_task to formally assign all eligible tasks in a quest.
 * Returns the list of newly assigned task IDs.
 */
async function assignTasksInQuest(
  client: KadiClient,
  questId: string,
): Promise<string[]> {
  const result = await client.invokeRemote<{
    content: Array<{ type: string; text: string }>;
  }>('quest_quest_assign_task', { questId });

  const data = JSON.parse(result.content[0].text);
  return data.assignedTaskIds ?? [];
}

/**
 * Update a single task's status to in_progress via mcp-server-quest.
 */
async function updateTaskStatus(
  client: KadiClient,
  questId: string,
  taskId: string,
  agentId: string,
): Promise<void> {
  await client.invokeRemote('quest_quest_update_task', {
    questId,
    taskId,
    status: 'in_progress',
    agentId,
  });
}

/**
 * Build and publish a task.assigned event for a single task.
 */
async function publishTaskAssigned(
  client: KadiClient,
  task: QuestTask,
  questId: string,
  assignedBy: string,
): Promise<void> {
  const payload: TaskAssignedEvent = {
    taskId: task.taskId,
    questId,
    role: task.role ?? task.assignedTo?.replace('agent-', '') ?? 'unknown',
    description: task.description,
    requirements: task.implementationGuide ?? task.description,
    timestamp: new Date().toISOString(),
    assignedBy,
  };

  await client.publish('task.assigned', payload, {
    broker: 'default',
    network: 'global',
  });
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Assign and dispatch a set of tasks to worker agents.
 *
 * Steps:
 * 1. Call quest_quest_assign_task to formally assign tasks in mcp-server-quest
 * 2. For each matching task that was assigned, update status to in_progress
 * 3. Publish task.assigned events for worker agents
 *
 * @param client   - Connected KadiClient
 * @param questId  - Quest these tasks belong to
 * @param tasks    - Tasks filtered by role (from task-reception)
 * @param agentId  - This agent-lead's identity (e.g. "agent-lead")
 */
export async function assignAndDispatchTasks(
  client: KadiClient,
  questId: string,
  tasks: QuestTask[],
  agentId: string,
): Promise<TaskAssignmentResult> {
  logger.info(
    MODULE_AGENT,
    `Assigning ${tasks.length} task(s) for quest ${questId}...`,
    timer.elapsed('main'),
  );

  // Step 1: Formally assign tasks via mcp-server-quest
  let assignedTaskIds: string[];
  try {
    assignedTaskIds = await assignTasksInQuest(client, questId);
    logger.info(
      MODULE_AGENT,
      `  quest_quest_assign_task returned ${assignedTaskIds.length} assigned task(s)`,
      timer.elapsed('main'),
    );
  } catch (err: any) {
    logger.error(
      MODULE_AGENT,
      `  Failed to assign tasks: ${err.message}`,
      timer.elapsed('main'),
      err,
    );
    return { questId, assignedCount: 0, publishedCount: 0, failedCount: tasks.length, taskIds: [] };
  }

  // Step 2 & 3: Update status and publish events for matching tasks
  const assignedSet = new Set(assignedTaskIds);
  const eligibleTasks = tasks.filter(
    (t) => assignedSet.has(t.taskId) || t.status === 'assigned' || t.status === 'in_progress',
  );

  let publishedCount = 0;
  let failedCount = 0;
  const publishedIds: string[] = [];

  for (const task of eligibleTasks) {
    try {
      // Update status to in_progress
      const taskAgent = task.assignedTo ?? agentId;
      await updateTaskStatus(client, questId, task.taskId, taskAgent);

      // Publish task.assigned event
      await publishTaskAssigned(client, task, questId, agentId);

      publishedCount++;
      publishedIds.push(task.taskId);

      logger.info(
        MODULE_AGENT,
        `  → Published task.assigned for [${task.taskId}] ${task.name}`,
        timer.elapsed('main'),
      );
    } catch (err: any) {
      failedCount++;
      logger.error(
        MODULE_AGENT,
        `  → Failed to dispatch [${task.taskId}]: ${err.message}`,
        timer.elapsed('main'),
        err,
      );
    }
  }

  logger.info(
    MODULE_AGENT,
    `Assignment complete: ${publishedCount} dispatched, ${failedCount} failed`,
    timer.elapsed('main'),
  );

  return {
    questId,
    assignedCount: assignedTaskIds.length,
    publishedCount,
    failedCount,
    taskIds: publishedIds,
  };
}
