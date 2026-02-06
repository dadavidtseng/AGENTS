/**
 * quest_get_task_details MCP Tool
 * Retrieves complete task details with quest context for worker agents
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { QuestModel } from '../../models/questModel.js';
import type { Task } from '../../types';

/**
 * Tool definition for MCP protocol
 */
export const questGetTaskDetailsTool: Tool = {
  name: 'quest_get_task_details',
  description: 'Get full task details including quest context for execution',
  inputSchema: {
    type: 'object',
    properties: {
      taskId: {
        type: 'string',
        description: 'Task ID (UUID) to retrieve',
      },
    },
    required: ['taskId'],
  },
};

/**
 * Input parameters for quest_get_task_details tool
 */
interface QuestGetTaskDetailsInput {
  taskId: string;
}

/**
 * Quest context provided with task details
 */
interface QuestContext {
  questId: string;
  questName: string;
  requirements: string;
  design: string;
}

/**
 * Find quest and task by task ID
 */
async function findTaskInQuests(taskId: string): Promise<{ task: Task; quest: any } | null> {
  // Load all quests
  const allQuests = await QuestModel.listAll();
  
  // Search for task in all quests
  for (const quest of allQuests) {
    const task = quest.tasks.find((t) => t.id === taskId);
    if (task) {
      return { task, quest };
    }
  }
  
  return null;
}

/**
 * Handle quest_get_task_details tool call
 */
export async function handleQuestGetTaskDetails(args: unknown) {
  // Validate input
  const input = args as QuestGetTaskDetailsInput;
  
  if (!input.taskId) {
    throw new Error('taskId is required');
  }
  
  if (typeof input.taskId !== 'string') {
    throw new Error('taskId must be a string');
  }
  
  // Find task across all quests
  const result = await findTaskInQuests(input.taskId);
  
  if (!result) {
    throw new Error(`Task with ID '${input.taskId}' not found in any quest`);
  }
  
  const { task, quest } = result;
  
  // Build quest context
  const questContext: QuestContext = {
    questId: quest.questId,
    questName: quest.questName,
    requirements: quest.requirements,
    design: quest.design,
  };
  
  // Return task with quest context
  // Convert Date objects to ISO strings for JSON serialization
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            task: {
              ...task,
              createdAt: typeof task.createdAt === 'string' 
                ? task.createdAt 
                : task.createdAt.toISOString(),
              updatedAt: typeof task.updatedAt === 'string' 
                ? task.updatedAt 
                : task.updatedAt.toISOString(),
              startedAt: task.startedAt 
                ? (typeof task.startedAt === 'string' 
                  ? task.startedAt 
                  : task.startedAt.toISOString()) 
                : undefined,
              completedAt: task.completedAt 
                ? (typeof task.completedAt === 'string' 
                  ? task.completedAt 
                  : task.completedAt.toISOString()) 
                : undefined,
            },
            questContext,
          },
          null,
          2
        ),
      },
    ],
  };
}
