/**
 * quest_update_task MCP Tool
 * Updates task details and metadata with validation
 */

import { randomUUID } from 'node:crypto';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { QuestModel } from '../../models/questModel.js';
import { TaskModel } from '../../models/taskModel.js';
import type { Task, RelatedFile } from '../../types/index.js';
import { commitQuestChanges } from '../../utils/git.js';
import { config } from '../../utils/config.js';
import { broadcastQuestUpdated } from '../../dashboard/events.js';

/**
 * Tool definition for MCP protocol
 */
export const questUpdateTaskTool: Tool = {
  name: 'quest_update_task',
  description: 'Update task details and metadata. Allows modifying task name, description, implementation guide, verification criteria, dependencies, and related files.',
  inputSchema: {
    type: 'object',
    properties: {
      questId: {
        type: 'string',
        format: 'uuid',
        description: 'Quest ID containing the task',
      },
      taskId: {
        type: 'string',
        format: 'uuid',
        description: 'Task ID to update',
      },
      name: {
        type: 'string',
        description: 'New task name (optional)',
      },
      description: {
        type: 'string',
        description: 'New task description (optional)',
      },
      implementationGuide: {
        type: 'string',
        description: 'New implementation guide (optional)',
      },
      verificationCriteria: {
        type: 'string',
        description: 'New verification criteria (optional)',
      },
      dependencies: {
        type: 'array',
        items: { type: 'string', format: 'uuid' },
        description: 'New task dependencies array (optional, replaces existing)',
      },
      relatedFiles: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            type: { 
              type: 'string',
              enum: ['TO_MODIFY', 'REFERENCE', 'CREATE', 'DEPENDENCY', 'OTHER']
            },
            description: { type: 'string' },
            lineStart: { type: 'number' },
            lineEnd: { type: 'number' },
          },
          required: ['path', 'type'],
        },
        description: 'New related files array (optional, replaces existing)',
      },
      notes: {
        type: 'string',
        description: 'Additional notes about the update (optional)',
      },
    },
    required: ['questId', 'taskId'],
  },
};

/**
 * Zod schema for input validation
 */
const RelatedFileSchema = z.object({
  path: z.string(),
  type: z.enum(['TO_MODIFY', 'REFERENCE', 'CREATE', 'DEPENDENCY', 'OTHER']),
  description: z.string().optional(),
  lineStart: z.number().optional(),
  lineEnd: z.number().optional(),
});

const InputSchema = z.object({
  questId: z.string().uuid(),
  taskId: z.string().uuid(),
  name: z.string().optional(),
  description: z.string().optional(),
  implementationGuide: z.string().optional(),
  verificationCriteria: z.string().optional(),
  dependencies: z.array(z.string().uuid()).optional(),
  relatedFiles: z.array(RelatedFileSchema).optional(),
  notes: z.string().optional(),
});

type QuestUpdateTaskInput = z.infer<typeof InputSchema>;

/**
 * Handle quest_update_task tool call
 */
export async function handleQuestUpdateTask(args: unknown) {
  // Validate input
  const input = InputSchema.parse(args);

  // Check if at least one field is being updated
  const hasUpdates = 
    input.name !== undefined ||
    input.description !== undefined ||
    input.implementationGuide !== undefined ||
    input.verificationCriteria !== undefined ||
    input.dependencies !== undefined ||
    input.relatedFiles !== undefined;

  if (!hasUpdates) {
    throw new Error('At least one field must be provided for update');
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
    throw new Error(`Task not found: ${input.taskId}`);
  }

  // Store original values for change tracking
  const changes: string[] = [];

  // Update fields
  if (input.name !== undefined && input.name !== task.name) {
    changes.push(`name: "${task.name}" → "${input.name}"`);
    task.name = input.name;
  }

  if (input.description !== undefined && input.description !== task.description) {
    changes.push(`description updated`);
    task.description = input.description;
  }

  if (input.implementationGuide !== undefined && input.implementationGuide !== task.implementationGuide) {
    changes.push(`implementationGuide updated`);
    task.implementationGuide = input.implementationGuide;
  }

  if (input.verificationCriteria !== undefined && input.verificationCriteria !== task.verificationCriteria) {
    changes.push(`verificationCriteria updated`);
    task.verificationCriteria = input.verificationCriteria;
  }

  if (input.dependencies !== undefined) {
    const oldDeps = task.dependencies.join(', ') || 'none';
    const newDeps = input.dependencies.join(', ') || 'none';
    if (oldDeps !== newDeps) {
      changes.push(`dependencies: [${oldDeps}] → [${newDeps}]`);
      task.dependencies = input.dependencies;
    }
  }

  if (input.relatedFiles !== undefined) {
    changes.push(`relatedFiles updated (${input.relatedFiles.length} files)`);
    task.relatedFiles = input.relatedFiles as RelatedFile[];
  }

  // Check if any changes were actually made
  if (changes.length === 0) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              message: 'No changes detected - all provided values match existing values',
              taskId: input.taskId,
              questId: input.questId,
            },
            null,
            2
          ),
        },
      ],
    };
  }

  // Validate dependencies if updated
  if (input.dependencies !== undefined) {
    const validation = TaskModel.validateDependencies(quest.tasks);
    if (!validation.valid) {
      throw new Error(
        `Task dependency validation failed after update:\n${validation.errors.join('\n')}`
      );
    }
  }

  // Update timestamp
  task.updatedAt = new Date();

  // Save quest
  await QuestModel.save(quest);

  // Commit to Git
  const commitMessage = `update: modify task "${task.name}"`;
  const commitBody = [
    `Quest: ${quest.questName}`,
    `Task ID: ${input.taskId}`,
    `Changes:`,
    ...changes.map((c) => `  - ${c}`),
  ];
  if (input.notes) {
    commitBody.push('', `Notes: ${input.notes}`);
  }

  await commitQuestChanges(
    config.questDataDir,
    commitMessage,
    commitBody.join('\n')
  );

  // Broadcast WebSocket event
  broadcastQuestUpdated(quest.questId, quest.status);

  // Return success
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
            changes,
            updatedAt: task.updatedAt.toISOString(),
            message: `Task updated successfully (${changes.length} changes)`,
          },
          null,
          2
        ),
      },
    ],
  };
}
