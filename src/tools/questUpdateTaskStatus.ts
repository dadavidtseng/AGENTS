/**
 * quest_update_task_status MCP Tool
 * Updates task status with authorization and validation
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { QuestModel } from '../models/questModel.js';
import { TaskModel } from '../models/taskModel.js';
import { AgentModel } from '../models/agentModel.js';
import type { TaskStatus } from '../types/index.js';

/**
 * Tool definition for MCP protocol
 */
export const questUpdateTaskStatusTool: Tool = {
  name: 'quest_update_task_status',
  description: 'Update task status (in_progress, completed, failed) with authorization',
  inputSchema: {
    type: 'object',
    properties: {
      taskId: {
        type: 'string',
        description: 'Task ID (UUID) to update',
      },
      status: {
        type: 'string',
        enum: ['in_progress', 'completed', 'failed'],
        description: 'New task status',
      },
      agentId: {
        type: 'string',
        description: 'Agent ID making the update',
      },
    },
    required: ['taskId', 'status', 'agentId'],
  },
};

/**
 * Input parameters for quest_update_task_status tool
 */
interface QuestUpdateTaskStatusInput {
  taskId: string;
  status: TaskStatus;
  agentId: string;
}

/**
 * Find quest and task by task ID
 */
async function findTaskAndQuest(taskId: string): Promise<{ task: any; quest: any } | null> {
  const allQuests = await QuestModel.listAll();
  
  for (const quest of allQuests) {
    const task = quest.tasks.find((t) => t.id === taskId);
    if (task) {
      return { task, quest };
    }
  }
  
  return null;
}

/**
 * Validate status transition
 */
function isValidTransition(currentStatus: TaskStatus, newStatus: TaskStatus): boolean {
  const validTransitions: Record<TaskStatus, TaskStatus[]> = {
    pending: ['in_progress'],
    in_progress: ['completed', 'failed'],
    completed: [], // Cannot transition from completed
    failed: [], // Cannot transition from failed
  };
  
  return validTransitions[currentStatus]?.includes(newStatus) ?? false;
}

/**
 * Handle quest_update_task_status tool call
 */
export async function handleQuestUpdateTaskStatus(args: unknown) {
  // Validate input
  const input = args as QuestUpdateTaskStatusInput;
  
  if (!input.taskId) {
    throw new Error('taskId is required');
  }
  
  if (!input.status) {
    throw new Error('status is required');
  }
  
  if (!input.agentId) {
    throw new Error('agentId is required');
  }
  
  const validStatuses: TaskStatus[] = ['in_progress', 'completed', 'failed'];
  if (!validStatuses.includes(input.status)) {
    throw new Error(`status must be one of: ${validStatuses.join(', ')}`);
  }
  
  // Find task and quest
  const result = await findTaskAndQuest(input.taskId);
  
  if (!result) {
    throw new Error(`Task with ID '${input.taskId}' not found in any quest`);
  }
  
  const { task, quest } = result;
  
  // Validate agent authorization
  if (task.assignedAgent !== input.agentId) {
    throw new Error(
      `Agent '${input.agentId}' is not authorized to update this task (assigned to: ${task.assignedAgent || 'unassigned'})`
    );
  }
  
  // Validate status transition
  if (!isValidTransition(task.status, input.status)) {
    throw new Error(
      `Invalid status transition: ${task.status} → ${input.status}. ` +
      `Valid transitions from ${task.status}: ${
        task.status === 'pending' ? 'in_progress' :
        task.status === 'in_progress' ? 'completed, failed' :
        'none (terminal state)'
      }`
    );
  }
  
  // Update status using TaskModel
  await TaskModel.updateStatus(input.taskId, quest.questId, input.status);
  
  // If task completed or failed, remove from agent's workload
  if (input.status === 'completed' || input.status === 'failed') {
    try {
      await AgentModel.removeTaskFromAgent(input.agentId, input.taskId);
    } catch (error) {
      // Log warning but don't fail - task status update succeeded
      console.warn(
        `[quest_update_task_status] Failed to remove task from agent workload: ${error}`
      );
    }
  }
  
  // Return success
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            success: true,
            taskId: input.taskId,
            status: input.status,
            updatedAt: new Date().toISOString(),
            message: `Task status updated to '${input.status}'`,
          },
          null,
          2
        ),
      },
    ],
  };
}
