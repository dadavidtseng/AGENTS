/**
 * quest_split_tasks MCP Tool
 * Splits approved quest into executable tasks with pre-generated task list
 */

import { randomUUID } from 'node:crypto';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { QuestModel } from '../models/questModel.js';
import { TaskModel } from '../models/taskModel.js';
import type { Task } from '../types';

/**
 * Tool definition for MCP protocol
 */
export const questSplitTasksTool: Tool = {
  name: 'quest_split_tasks',
  description: 'Split approved quest into executable tasks. Task IDs are auto-generated as UUIDs - do not provide task IDs in the input.',
  inputSchema: {
    type: 'object',
    properties: {
      questId: {
        type: 'string',
        description: 'Quest ID to split into tasks',
      },
      tasks: {
        type: 'array',
        description: 'Array of tasks to create. Task IDs will be auto-generated as UUIDs.',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            description: { type: 'string' },
            implementationGuide: { type: 'string' },
            verificationCriteria: { type: 'string' },
            dependencies: {
              type: 'array',
              items: { type: 'string' },
            },
            relatedFiles: { 
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: true,
              },
            },
          },
          required: ['name', 'description'],
        },
      },
    },
    required: ['questId', 'tasks'],
  },
};

/**
 * Input parameters for quest_split_tasks tool
 */
interface QuestSplitTasksInput {
  questId: string;
  tasks: Array<{
    name: string;
    description: string;
    implementationGuide?: string;
    verificationCriteria?: string;
    dependencies?: string[];
    relatedFiles?: any[];
  }>;
}

/**
 * Generate dependency graph visualization
 */
function generateDependencyGraph(tasks: Task[]): string {
  const lines: string[] = ['Task Dependency Graph:', ''];

  for (const task of tasks) {
    lines.push(`${task.id}: ${task.name}`);
    if (task.dependencies.length > 0) {
      lines.push(`  Depends on: ${task.dependencies.join(', ')}`);
    }
  }

  return lines.join('\n');
}

/**
 * Handle quest_split_tasks tool call
 */
export async function handleQuestSplitTasks(args: unknown) {
  // Validate input
  const input = args as QuestSplitTasksInput;

  if (!input.questId) {
    throw new Error('questId is required');
  }

  if (!input.tasks || !Array.isArray(input.tasks)) {
    throw new Error('tasks array is required');
  }

  if (input.tasks.length === 0) {
    throw new Error('tasks array cannot be empty');
  }

  // Load quest
  let quest;
  try {
    quest = await QuestModel.load(input.questId);
  } catch (error) {
    throw new Error(`Quest not found: ${input.questId}`);
  }

  // Validate quest status
  if (quest.status !== 'approved') {
    throw new Error(
      `Quest must be in 'approved' status to split tasks (current status: ${quest.status})`
    );
  }

  // Convert input tasks to Task objects with auto-generated UUIDs
  const now = new Date();
  const tasks: Task[] = input.tasks.map((taskData) => {
    if (!taskData.name || !taskData.description) {
      throw new Error('Each task must have name and description');
    }

    return {
      id: randomUUID(),
      questId: input.questId,
      name: taskData.name,
      description: taskData.description,
      status: 'pending' as const,
      implementationGuide: taskData.implementationGuide || '',
      verificationCriteria: taskData.verificationCriteria || '',
      dependencies: Array.isArray(taskData.dependencies) ? taskData.dependencies : [],
      relatedFiles: Array.isArray(taskData.relatedFiles) ? taskData.relatedFiles : [],
      createdAt: now,
      updatedAt: now,
    };
  });

  // Validate dependencies
  console.log('[quest_split_tasks] Validating dependencies...');
  const validation = TaskModel.validateDependencies(tasks);

  if (!validation.valid) {
    throw new Error(
      `Task dependency validation failed:\n${validation.errors.join('\n')}`
    );
  }

  // Update quest with tasks
  quest.tasks = tasks;
  quest.status = 'in_progress';
  await QuestModel.save(quest);

  // Generate dependency graph
  const dependencyGraph = generateDependencyGraph(tasks);

  // Return result
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            success: true,
            questId: quest.questId,
            questName: quest.questName,
            taskCount: tasks.length,
            tasks: tasks.map((t) => ({
              id: t.id,
              name: t.name,
              description: t.description,
              dependencies: t.dependencies,
              status: t.status,
            })),
            dependencyGraph,
            message: `Quest "${quest.questName}" split into ${tasks.length} tasks`,
          },
          null,
          2
        ),
      },
    ],
  };
}
