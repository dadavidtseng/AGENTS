/**
 * Task Approval Tool Registrations
 *
 * Three tools for task-level approval decisions:
 * - task_approve: Approve a completed task
 * - task_request_revision: Request revision of a task
 * - task_reject: Reject a task result
 *
 * Each tool calls mcp-server-quest's quest_update_task via KĀDI broker
 * to change the task status based on the approval decision.
 *
 * Workflow context:
 * - Step 23a: HUMAN approves task → task_approve (status → completed)
 * - Step 23b: HUMAN requests revision → task_request_revision (status → in_progress)
 * - Step 23c: HUMAN rejects task → task_reject (status → failed)
 *
 * These tools are called when a task is in pending_approval status
 * (set by quest_request_task_approval in mcp-server-quest).
 */

import { z } from '@kadi.build/core';
import type { KadiClient } from '@kadi.build/core';
import { logger, MODULE_AGENT, timer } from 'agents-library';

// --- Shared schemas ---

const taskApprovalOutputSchema = z.object({
  success: z.boolean().describe('Whether the approval action succeeded'),
  message: z.string().describe('Human-readable result message'),
  questId: z.string().describe('Quest ID containing the task'),
  taskId: z.string().describe('Task ID that was acted upon'),
  decision: z.string().describe('Decision that was submitted'),
  newStatus: z.string().describe('New task status after the decision'),
});

type TaskApprovalOutput = z.infer<typeof taskApprovalOutputSchema>;

// --- Helper ---

/**
 * Update task status via mcp-server-quest's quest_update_task tool.
 * The KĀDI broker prefixes tool names with the server name, so
 * quest_update_task becomes quest_quest_update_task.
 *
 * Note: For task approval, we use a special agentId 'approval-system'
 * since the human reviewer is not the assigned agent. The mcp-server-quest
 * tool validates agent authorization, so we need to handle this case.
 * We first query the task to get the assigned agent, then use that agentId.
 */
async function updateTaskStatus(
  client: KadiClient,
  questId: string,
  taskId: string,
  newStatus: 'completed' | 'in_progress' | 'failed',
  decision: string,
): Promise<TaskApprovalOutput> {
  try {
    // First, get the task details to find the assigned agent
    const taskResult = await client.invokeRemote<{
      content: Array<{ type: string; text: string }>;
    }>('quest_quest_query_task', {
      taskId,
    });

    const taskText = taskResult.content[0].text;
    const taskData = JSON.parse(taskText);
    const assignedAgent = taskData.task?.assignedAgent || taskData.task?.assigned_agent;

    if (!assignedAgent) {
      return {
        success: false,
        message: `Cannot ${decision} task: no assigned agent found`,
        questId,
        taskId,
        decision,
        newStatus,
      };
    }

    // Update task status using the assigned agent's ID for authorization
    const result = await client.invokeRemote<{
      content: Array<{ type: string; text: string }>;
    }>('quest_quest_update_task', {
      questId,
      taskId,
      status: newStatus,
      agentId: assignedAgent,
    });

    const resultText = result.content[0].text;
    const data = JSON.parse(resultText);

    return {
      success: true,
      message: data.message || `Task ${decision} successfully (status → ${newStatus})`,
      questId,
      taskId,
      decision,
      newStatus,
    };
  } catch (error: any) {
    logger.error(
      MODULE_AGENT,
      `Failed to ${decision} task ${taskId}: ${error.message}`,
      timer.elapsed('main'),
      error
    );
    return {
      success: false,
      message: `Failed to ${decision} task: ${error.message}`,
      questId,
      taskId,
      decision,
      newStatus,
    };
  }
}

// --- Tool 1: task_approve ---

const taskApproveInputSchema = z.object({
  questId: z.string().describe('Quest ID containing the task'),
  taskId: z.string().describe('Task ID to approve'),
  feedback: z.string().optional().describe('Optional approval comments'),
});

type TaskApproveInput = z.infer<typeof taskApproveInputSchema>;

export function registerTaskApproveTool(client: KadiClient): void {
  client.registerTool({
    name: 'task_approve',
    description: 'Approve a completed task. The task must be in pending_approval status. After approval, the task moves to completed status.',
    input: taskApproveInputSchema,
    output: taskApprovalOutputSchema,
  }, async (params: TaskApproveInput): Promise<TaskApprovalOutput> => {
    logger.info(MODULE_AGENT, `Approving task ${params.taskId} in quest ${params.questId}`, timer.elapsed('main'));

    return updateTaskStatus(client, params.questId, params.taskId, 'completed', 'approve');
  });
}

// --- Tool 2: task_request_revision ---

const taskRequestRevisionInputSchema = z.object({
  questId: z.string().describe('Quest ID containing the task'),
  taskId: z.string().describe('Task ID to request revision for'),
  feedback: z.string().describe('Revision feedback explaining what needs to change'),
});

type TaskRequestRevisionInput = z.infer<typeof taskRequestRevisionInputSchema>;

export function registerTaskRequestRevisionTool(client: KadiClient): void {
  client.registerTool({
    name: 'task_request_revision',
    description: 'Request revision of a task result. The task must be in pending_approval status. Feedback is required. The task returns to in_progress status for the agent to revise.',
    input: taskRequestRevisionInputSchema,
    output: taskApprovalOutputSchema,
  }, async (params: TaskRequestRevisionInput): Promise<TaskApprovalOutput> => {
    logger.info(MODULE_AGENT, `Requesting revision for task ${params.taskId}`, timer.elapsed('main'));

    if (!params.feedback || params.feedback.trim().length === 0) {
      return {
        success: false,
        message: 'Feedback is required when requesting task revision',
        questId: params.questId,
        taskId: params.taskId,
        decision: 'request_revision',
        newStatus: 'in_progress',
      };
    }

    return updateTaskStatus(client, params.questId, params.taskId, 'in_progress', 'request_revision');
  });
}

// --- Tool 3: task_reject ---

const taskRejectInputSchema = z.object({
  questId: z.string().describe('Quest ID containing the task'),
  taskId: z.string().describe('Task ID to reject'),
  feedback: z.string().describe('Rejection reason'),
});

type TaskRejectInput = z.infer<typeof taskRejectInputSchema>;

export function registerTaskRejectTool(client: KadiClient): void {
  client.registerTool({
    name: 'task_reject',
    description: 'Reject a task result. The task must be in pending_approval status. Feedback is required. The task moves to failed status.',
    input: taskRejectInputSchema,
    output: taskApprovalOutputSchema,
  }, async (params: TaskRejectInput): Promise<TaskApprovalOutput> => {
    logger.info(MODULE_AGENT, `Rejecting task ${params.taskId}`, timer.elapsed('main'));

    if (!params.feedback || params.feedback.trim().length === 0) {
      return {
        success: false,
        message: 'Feedback is required when rejecting a task',
        questId: params.questId,
        taskId: params.taskId,
        decision: 'reject',
        newStatus: 'failed',
      };
    }

    return updateTaskStatus(client, params.questId, params.taskId, 'failed', 'reject');
  });
}
