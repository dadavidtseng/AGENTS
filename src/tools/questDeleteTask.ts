/**
 * quest_delete_task MCP Tool
 * Removes individual tasks from a quest with safety checks
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { QuestModel } from '../models/questModel.js';
import type { TaskStatus } from '../types/index.js';
import { commitQuestChanges } from '../utils/git.js';
import { config } from '../utils/config.js';
import { broadcastQuestUpdated } from '../dashboard/events.js';

/**
 * Tool definition for MCP protocol
 */
export const questDeleteTaskTool: Tool = {
  name: 'quest_delete_task',
  description: `Remove individual tasks from a quest with safety checks.

**Safety Requirements:**
- Explicit confirmation required (confirm parameter must be true)
- Only allows deletion of pending or failed tasks
- Prevents deletion of in_progress or completed tasks (maintains data integrity)
- Updates quest metadata after deletion
- Commits changes to Git for audit trail

**Usage Guidelines:**
- Use for removing incorrectly created tasks
- Use for cleaning up failed tasks that won't be retried
- DO NOT use for in_progress tasks (let them complete or fail first)
- DO NOT use for completed tasks (they are part of the historical record)

**Parameters:**
- questId (required): UUID of the quest containing the task
- taskId (required): ID of the task to delete (e.g., "T1", "T2.1")
- confirm (required): Must be true to confirm deletion

**Returns:**
- success: Boolean indicating if deletion succeeded
- questId: ID of the quest
- taskId: ID of the deleted task
- taskName: Name of the deleted task
- message: Human-readable confirmation message`,
  inputSchema: {
    type: 'object',
    properties: {
      questId: {
        type: 'string',
        description: 'Quest ID (UUID) containing the task',
      },
      taskId: {
        type: 'string',
        description: 'Task ID to delete (e.g., "T1", "T2.1")',
      },
      confirm: {
        type: 'boolean',
        description: 'Must be true to confirm deletion (safety check)',
      },
    },
    required: ['questId', 'taskId', 'confirm'],
  },
};

/**
 * Input parameters for quest_delete_task tool
 */
interface QuestDeleteTaskInput {
  questId: string;
  taskId: string;
  confirm: boolean;
}

/**
 * Validate if task status allows deletion
 */
function canDeleteTask(status: TaskStatus): boolean {
  const deletableStatuses: TaskStatus[] = ['pending', 'failed'];
  return deletableStatuses.includes(status);
}

/**
 * Handle quest_delete_task tool call
 */
export async function handleQuestDeleteTask(args: unknown) {
  // Validate input
  const input = args as QuestDeleteTaskInput;

  if (!input.questId) {
    throw new Error('questId is required');
  }

  if (!input.taskId) {
    throw new Error('taskId is required');
  }

  if (input.confirm !== true) {
    throw new Error(
      'Deletion not confirmed. You must set confirm=true to delete a task. ' +
      'This operation will remove the task from the quest.'
    );
  }

  // Load quest
  let quest;
  try {
    quest = await QuestModel.load(input.questId);
  } catch (error) {
    throw new Error(`Quest with ID '${input.questId}' not found`);
  }

  // Find task in quest
  const taskIndex = quest.tasks.findIndex((t) => t.id === input.taskId);

  if (taskIndex === -1) {
    throw new Error(
      `Task with ID '${input.taskId}' not found in quest '${quest.questName}' (${input.questId})`
    );
  }

  const task = quest.tasks[taskIndex];

  // Validate task status allows deletion
  if (!canDeleteTask(task.status)) {
    throw new Error(
      `Cannot delete task with status '${task.status}'. ` +
      `Only pending or failed tasks can be deleted. ` +
      `Current status: ${task.status}. ` +
      `For in_progress tasks, wait for completion or failure. ` +
      `For completed tasks, they should remain as part of the historical record.`
    );
  }

  // Store task info for response
  const taskName = task.name;
  const taskStatus = task.status;

  // Remove task from quest's tasks array
  quest.tasks.splice(taskIndex, 1);

  // Save quest
  await QuestModel.save(quest);

  // Commit changes to Git
  const commitMessage = `chore: delete task ${input.taskId} from quest ${input.questId} (${quest.questName})`;
  try {
    await commitQuestChanges(config.questDataDir, commitMessage);
  } catch (error) {
    // Log warning but don't fail - deletion succeeded
    console.warn(
      `[quest_delete_task] Failed to commit deletion to Git: ${error}. ` +
      `Task was deleted successfully.`
    );
  }

  // Broadcast WebSocket event to dashboard
  try {
    await broadcastQuestUpdated(quest.questId, quest.status);
  } catch (error) {
    // Log warning but don't fail - deletion succeeded
    console.warn(
      `[quest_delete_task] Failed to broadcast update event: ${error}`
    );
  }

  // Return success
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            success: true,
            questId: input.questId,
            questName: quest.questName,
            taskId: input.taskId,
            taskName,
            previousStatus: taskStatus,
            remainingTasks: quest.tasks.length,
            message: `Task '${taskName}' (${input.taskId}) has been deleted from quest '${quest.questName}'. ${quest.tasks.length} tasks remaining.`,
          },
          null,
          2
        ),
      },
    ],
  };
}
