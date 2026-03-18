/**
 * quest_request_task_approval MCP Tool
 * Requests human approval for a completed task before marking it as done.
 * This is the task-level approval gate (workflow step 21).
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { QuestModel } from '../../models/questModel.js';
import { TaskModel } from '../../models/taskModel.js';
import type { TaskStatus, QuestStatus } from '../../types/index.js';
import { broadcastQuestUpdated } from '../../events/broadcast.js';

/**
 * Tool definition for MCP protocol
 */
export const questRequestTaskApprovalTool: Tool = {
  name: 'quest_request_task_approval',
  description: `Request human approval for a completed task.

This is the task-level approval gate in the quest workflow (step 21).
When an agent finishes a task, it should request approval before the task
is marked as completed. The human reviewer can then approve, request revision,
or reject the task result.

**Flow:**
1. Agent completes work on a task (status: in_progress)
2. Agent calls quest_request_task_approval → task status becomes pending_approval
3. Human reviews the task result via dashboard
4. Human approves (→ completed), requests revision (→ in_progress), or rejects (→ failed)

**Parameters:**
- questId (required): Quest containing the task
- taskId (required): Task to request approval for
- summary (optional): Brief summary of what was implemented
- agentId (required): Agent requesting approval (must be assigned agent)`,
  inputSchema: {
    type: 'object',
    properties: {
      questId: {
        type: 'string',
        description: 'Quest ID containing the task',
      },
      taskId: {
        type: 'string',
        description: 'Task ID to request approval for',
      },
      summary: {
        type: 'string',
        description: 'Brief summary of what was implemented (optional)',
      },
      agentId: {
        type: 'string',
        description: 'Agent ID requesting approval (must be assigned agent)',
      },
    },
    required: ['questId', 'taskId', 'agentId'],
  },
};

/**
 * Input type
 */
interface QuestRequestTaskApprovalInput {
  questId: string;
  taskId: string;
  summary?: string;
  agentId: string;
}

/**
 * Handle quest_request_task_approval tool call
 */
export async function handleQuestRequestTaskApproval(args: unknown) {
  const input = args as QuestRequestTaskApprovalInput;

  if (!input.questId) {
    throw new Error('questId is required');
  }
  if (!input.taskId) {
    throw new Error('taskId is required');
  }
  if (!input.agentId) {
    throw new Error('agentId is required');
  }

  // Load quest
  let quest;
  try {
    quest = await QuestModel.load(input.questId);
  } catch (error) {
    throw new Error(`Quest not found: ${input.questId}`);
  }

  // Find task
  const task = quest.tasks.find((t) => t.id === input.taskId);
  if (!task) {
    throw new Error(`Task '${input.taskId}' not found in quest '${input.questId}'`);
  }

  // Validate agent authorization
  if (task.assignedAgent !== input.agentId) {
    throw new Error(
      `Agent '${input.agentId}' is not authorized (task assigned to: ${task.assignedAgent || 'unassigned'})`
    );
  }

  // Validate task status — must be in_progress
  if (task.status !== 'in_progress') {
    throw new Error(
      `Task must be in 'in_progress' status to request approval (current: ${task.status})`
    );
  }

  // Update task status to pending_approval
  await TaskModel.updateStatus(input.taskId, input.questId, 'pending_approval' as TaskStatus);

  // Broadcast update — reload quest to get current status
  const updatedQuest = await QuestModel.load(input.questId);
  await broadcastQuestUpdated(input.questId, updatedQuest.status);

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            success: true,
            questId: input.questId,
            taskId: input.taskId,
            taskName: task.name,
            previousStatus: 'in_progress',
            newStatus: 'pending_approval',
            summary: input.summary || 'No summary provided',
            message: `Task "${task.name}" is now pending approval. A human reviewer will approve, request revision, or reject the result.`,
            nextSteps: [
              'Human reviewer checks task result via dashboard',
              'Approve → task status becomes "completed"',
              'Request revision → task status returns to "in_progress"',
              'Reject → task status becomes "failed"',
            ],
          },
          null,
          2
        ),
      },
    ],
  };
}
