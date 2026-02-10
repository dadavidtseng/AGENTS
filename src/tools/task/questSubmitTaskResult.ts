/**
 * quest_submit_task_result MCP Tool
 * Submits task completion with artifacts and summary
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { QuestModel } from '../../models/questModel.js';
import { TaskModel } from '../../models/taskModel.js';
import { AgentModel } from '../../models/agentModel.js';
import type { TaskArtifacts } from '../../types/index.js';

/**
 * Tool definition for MCP protocol
 */
export const questSubmitTaskResultTool: Tool = {
  name: 'quest_submit_task_result',
  description: 'Submit task completion with artifacts and summary',
  inputSchema: {
    type: 'object',
    properties: {
      taskId: {
        type: 'string',
        description: 'Task ID (UUID) to submit',
      },
      agentId: {
        type: 'string',
        description: 'Agent ID submitting the result',
      },
      artifacts: {
        type: 'object',
        description: 'Task artifacts (files, components, functions, etc.)',
        properties: {
          apiEndpoints: {
            type: 'array',
            description: 'API endpoints created or modified',
            items: { 
              type: 'object',
              additionalProperties: true,
            },
          },
          components: {
            type: 'array',
            description: 'UI components created',
            items: { 
              type: 'object',
              additionalProperties: true,
            },
          },
          functions: {
            type: 'array',
            description: 'Utility functions created',
            items: { 
              type: 'object',
              additionalProperties: true,
            },
          },
          classes: {
            type: 'array',
            description: 'Classes created',
            items: { 
              type: 'object',
              additionalProperties: true,
            },
          },
          integrations: {
            type: 'array',
            description: 'Frontend-backend integrations',
            items: { 
              type: 'object',
              additionalProperties: true,
            },
          },
        },
      },
      summary: {
        type: 'string',
        description: 'Summary of work completed',
      },
    },
    required: ['taskId', 'agentId', 'artifacts', 'summary'],
  },
};

/**
 * Input parameters for quest_submit_task_result tool
 */
interface QuestSubmitTaskResultInput {
  taskId: string;
  agentId: string;
  artifacts: TaskArtifacts;
  summary: string;
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
 * Validate artifacts have at least some content
 */
function validateArtifacts(artifacts: TaskArtifacts): void {
  const hasContent = 
    (artifacts.apiEndpoints && artifacts.apiEndpoints.length > 0) ||
    (artifacts.components && artifacts.components.length > 0) ||
    (artifacts.functions && artifacts.functions.length > 0) ||
    (artifacts.classes && artifacts.classes.length > 0) ||
    (artifacts.integrations && artifacts.integrations.length > 0) ||
    Object.keys(artifacts).some(key => 
      !['apiEndpoints', 'components', 'functions', 'classes', 'integrations'].includes(key)
    );
  
  if (!hasContent) {
    throw new Error('artifacts must contain at least one artifact type (apiEndpoints, components, functions, classes, integrations, or custom fields)');
  }
}

/**
 * Handle quest_submit_task_result tool call
 */
export async function handleQuestSubmitTaskResult(args: unknown) {
  // Validate input
  const input = args as QuestSubmitTaskResultInput;
  
  if (!input.taskId) {
    throw new Error('taskId is required');
  }
  
  if (!input.agentId) {
    throw new Error('agentId is required');
  }
  
  if (!input.artifacts) {
    throw new Error('artifacts is required');
  }
  
  if (!input.summary) {
    throw new Error('summary is required');
  }
  
  if (typeof input.summary !== 'string' || input.summary.trim().length === 0) {
    throw new Error('summary must be a non-empty string');
  }
  
  // Validate artifacts have content
  validateArtifacts(input.artifacts);
  
  // Find task and quest
  const result = await findTaskAndQuest(input.taskId);
  
  if (!result) {
    throw new Error(`Task with ID '${input.taskId}' not found in any quest`);
  }
  
  const { task, quest } = result;
  
  // Validate agent authorization
  if (task.assignedAgent !== input.agentId) {
    throw new Error(
      `Agent '${input.agentId}' is not authorized to submit results for this task (assigned to: ${task.assignedAgent || 'unassigned'})`
    );
  }
  
  // Validate task status
  if (task.status !== 'in_progress') {
    throw new Error(
      `Task must be 'in_progress' to submit results (current status: ${task.status})`
    );
  }
  
  // Submit result using TaskModel
  await TaskModel.submitResult(input.taskId, quest.questId, input.artifacts, input.summary);
  
  // Remove task from agent's workload
  try {
    await AgentModel.removeTaskFromAgent(input.agentId, input.taskId);
  } catch (error) {
    // Log warning but don't fail - task submission succeeded
    console.warn(
      `[quest_submit_task_result] Failed to remove task from agent workload: ${error}`
    );
  }
  
  // Return success
  const completedAt = new Date();
  
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            success: true,
            taskId: input.taskId,
            status: 'completed',
            completedAt: completedAt.toISOString(),
            message: `Task completed successfully: ${input.summary}`,
            nextStep: `Task result submitted. Now call quest_request_task_approval with taskId "${input.taskId}" to submit this task for human review.`,
          },
          null,
          2
        ),
      },
    ],
  };
}
