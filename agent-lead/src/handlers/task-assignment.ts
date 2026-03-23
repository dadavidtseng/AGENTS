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
  role?: string,
  assignments?: Array<{ taskId: string; agentId: string }>,
): Promise<string[]> {
  const params: Record<string, unknown> = { questId };
  if (role) {
    params.role = role;
  }
  if (assignments && assignments.length > 0) {
    params.assignments = assignments;
  }

  const result = await client.invokeRemote<{
    content: Array<{ type: string; text: string }>;
  }>('quest_quest_assign_task', params);

  const text = result.content[0].text;

  // Handle error responses that aren't valid JSON
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(text);
  }

  return (data.assignedTaskIds as string[]) ?? [];
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
 * Publishes to the role-specific network so the correct worker receives it.
 * Includes predecessor info for cross-worktree file access.
 */
async function publishTaskAssigned(
  client: KadiClient,
  task: QuestTask,
  questId: string,
  assignedBy: string,
  leadRole: string,
  allTasks?: QuestTask[],
): Promise<void> {
  const taskRole = task.role ?? task.assignedTo?.replace(/^agent-worker-/, '') ?? leadRole;

  // Build predecessor context from completed dependency tasks
  const predecessors: Array<{ taskId: string; role: string; branch: string; commitHash?: string }> = [];
  if (task.dependencies && task.dependencies.length > 0 && allTasks) {
    for (const depId of task.dependencies) {
      const depTask = allTasks.find((t) => t.taskId === depId);
      if (depTask && depTask.status === 'completed') {
        const depRole = depTask.role ?? depTask.assignedTo?.replace(/^agent-worker-/, '') ?? '';
        // Worktree branch convention: agent-playground-{role}
        const branch = depRole ? `agent-playground-${depRole}` : '';
        if (branch) {
          predecessors.push({
            taskId: depId,
            role: depRole,
            branch,
            commitHash: (depTask as any).commitHash ?? undefined,
          });
        }
      }
    }
    if (predecessors.length > 0) {
      logger.info(
        MODULE_AGENT,
        `  Task ${task.taskId} has ${predecessors.length} predecessor(s): ${predecessors.map(p => `${p.role}@${p.branch}`).join(', ')}`,
        timer.elapsed('main'),
      );
    }
  }

  const payload: TaskAssignedEvent = {
    taskId: task.taskId,
    questId,
    role: taskRole,
    description: task.description,
    requirements: task.implementationGuide ?? task.description,
    timestamp: new Date().toISOString(),
    assignedBy,
    ...(predecessors.length > 0 ? { predecessors } : {}),
  };

  await client.publish('task.assigned', payload, {
    broker: 'default',
    network: taskRole,
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
 * @param agentId  - This agent-lead's identity (e.g. "agent-lead-programmer")
 * @param role     - This agent-lead's role (e.g. "programmer")
 */
export async function assignAndDispatchTasks(
  client: KadiClient,
  questId: string,
  tasks: QuestTask[],
  agentId: string,
  role: string,
  allQuestTasks?: QuestTask[],
): Promise<TaskAssignmentResult> {
  logger.info(
    MODULE_AGENT,
    `Assigning ${tasks.length} task(s) for quest ${questId}...`,
    timer.elapsed('main'),
  );

  // Step 0: Query available agents and select workers for each task
  let workerAssignments: Array<{ taskId: string; agentId: string }> | undefined;
  try {
    const agentsResult = await client.invokeRemote<{
      content: Array<{ type: string; text: string }>;
    }>('quest_quest_list_agents', {});
    const agentsData = JSON.parse(agentsResult.content[0].text);
    const agents = agentsData.agents ?? [];

    // Filter to workers only: exclude lead agents, match role, check capacity
    const availableWorkers = agents.filter(
      (a: any) =>
        !a.agentId.includes('-lead-') &&
        a.role === role &&
        (a.currentTasks?.length ?? 0) < (a.maxConcurrentTasks ?? 1),
    );

    logger.info(
      MODULE_AGENT,
      `  Available workers for role "${role}": ${availableWorkers.map((a: any) => `${a.agentId} (load: ${a.currentTasks?.length ?? 0}/${a.maxConcurrentTasks ?? 1})`).join(', ') || 'none'}`,
      timer.elapsed('main'),
    );

    if (availableWorkers.length > 0) {
      // Sort workers by current workload (ascending) for least-loaded selection
      availableWorkers.sort(
        (a: any, b: any) => (a.currentTasks?.length ?? 0) - (b.currentTasks?.length ?? 0),
      );

      // Round-robin assign tasks to least-loaded workers
      workerAssignments = [];
      // Track tentative assignments to balance load across this batch
      const tentativeLoad = new Map<string, number>();
      for (const w of availableWorkers) {
        tentativeLoad.set(w.agentId, w.currentTasks?.length ?? 0);
      }

      for (const task of tasks) {
        // Skip tasks that are already assigned or in progress
        if (task.status === 'assigned' || task.status === 'in_progress') {
          continue;
        }

        // Pick worker with lowest tentative load
        let bestWorker: any = null;
        let bestLoad = Infinity;
        for (const w of availableWorkers) {
          const load = tentativeLoad.get(w.agentId) ?? 0;
          const maxTasks = w.maxConcurrentTasks ?? 1;
          if (load < maxTasks && load < bestLoad) {
            bestLoad = load;
            bestWorker = w;
          }
        }

        if (bestWorker) {
          workerAssignments.push({ taskId: task.taskId, agentId: bestWorker.agentId });
          tentativeLoad.set(bestWorker.agentId, (tentativeLoad.get(bestWorker.agentId) ?? 0) + 1);

          logger.info(
            MODULE_AGENT,
            `  Selecting worker ${bestWorker.agentId} for task ${task.taskId} (${task.name})`,
            timer.elapsed('main'),
          );
        } else {
          logger.warn(
            MODULE_AGENT,
            `  No worker with capacity for task ${task.taskId} (${task.name}), falling back to auto-assign`,
            timer.elapsed('main'),
          );
        }
      }

      // If no assignments were built (all tasks already assigned), clear to let auto-assign handle it
      if (workerAssignments.length === 0) {
        workerAssignments = undefined;
      }
    } else {
      logger.warn(
        MODULE_AGENT,
        `  No available workers for role "${role}", falling back to role-only auto-assign`,
        timer.elapsed('main'),
      );
    }
  } catch (err: any) {
    logger.warn(MODULE_AGENT, `  Failed to list agents for worker selection: ${err.message}`, timer.elapsed('main'));
  }

  // Step 1: Formally assign tasks via mcp-server-quest
  let assignedTaskIds: string[];
  try {
    assignedTaskIds = await assignTasksInQuest(client, questId, role, workerAssignments);
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

      // Publish task.assigned event to the role-specific network
      await publishTaskAssigned(client, task, questId, agentId, role, allQuestTasks ?? tasks);

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
