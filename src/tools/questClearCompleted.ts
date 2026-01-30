/**
 * quest_clear_completed MCP Tool
 * Archive or delete completed quests for maintenance with safety checks
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { QuestModel } from '../models/questModel.js';
import type { Quest } from '../types/index.js';
import { commitQuestChanges } from '../utils/git.js';
import { config } from '../utils/config.js';
import { broadcastQuestUpdated } from '../dashboard/events.js';
import { mkdir, cp, rm, rename } from 'fs/promises';
import { join } from 'path';

/**
 * Tool definition for MCP protocol
 */
export const questClearCompletedTool: Tool = {
  name: 'quest_clear_completed',
  description: `Archive or delete completed quests for maintenance and cleanup.

**Purpose:**
- Clean up old completed quests to reduce clutter
- Archive quests for long-term storage
- Permanently delete quests that are no longer needed

**Safety Features:**
- Explicit confirmation required (confirm parameter must be true)
- Only affects completed quests
- Optional age filter (olderThanDays parameter)
- Creates automatic backup before deletion
- Archive option for safer cleanup
- Commits changes to Git for audit trail

**Actions:**
- 'archive': Moves quests to .quest-data/archive/ directory (safer, reversible)
- 'delete': Permanently deletes quests with backup (irreversible)

**Parameters:**
- action (required): 'archive' or 'delete'
- confirm (required): Must be true to confirm operation
- olderThanDays (optional): Only affect quests completed more than N days ago

**Returns:**
- success: Boolean indicating if operation succeeded
- action: The action performed
- affectedQuests: List of quests that were archived/deleted
- backupPath: Path to backup directory (for delete action)
- message: Human-readable confirmation message`,
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['archive', 'delete'],
        description: 'Action to perform: archive (safer) or delete (permanent)',
      },
      confirm: {
        type: 'boolean',
        description: 'Must be true to confirm operation (safety check)',
      },
      olderThanDays: {
        type: 'number',
        minimum: 0,
        description: 'Only affect quests completed more than N days ago (optional)',
      },
    },
    required: ['action', 'confirm'],
  },
};

/**
 * Zod schema for input validation
 */
const InputSchema = z.object({
  action: z.enum(['archive', 'delete']),
  confirm: z.boolean(),
  olderThanDays: z.number().min(0).optional(),
});

type QuestClearCompletedInput = z.infer<typeof InputSchema>;

/**
 * Filter completed quests by age
 */
function filterCompletedQuests(quests: Quest[], olderThanDays?: number): Quest[] {
  const now = new Date();
  const cutoffDate = olderThanDays 
    ? new Date(now.getTime() - olderThanDays * 24 * 60 * 60 * 1000)
    : null;

  return quests.filter((quest) => {
    // Must be completed
    if (quest.status !== 'completed') {
      return false;
    }

    // Check age if specified
    if (cutoffDate && quest.updatedAt) {
      const questDate = quest.updatedAt instanceof Date 
        ? quest.updatedAt 
        : new Date(quest.updatedAt);
      return questDate < cutoffDate;
    }

    return true;
  });
}

/**
 * Create backup of quests before deletion
 */
async function createBackup(quests: Quest[]): Promise<string> {
  const backupDir = join(config.questDataDir, 'backups');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = join(backupDir, `clear_completed_${timestamp}`);

  // Ensure backup directory exists
  await mkdir(backupPath, { recursive: true });

  // Copy each quest directory to backup
  for (const quest of quests) {
    const questDir = join(config.questDataDir, 'quests', quest.questId);
    const questBackupPath = join(backupPath, quest.questId);
    await cp(questDir, questBackupPath, { recursive: true });
  }

  return backupPath;
}

/**
 * Archive quests by moving to archive directory
 */
async function archiveQuests(quests: Quest[]): Promise<void> {
  const archiveDir = join(config.questDataDir, 'archive');
  await mkdir(archiveDir, { recursive: true });

  for (const quest of quests) {
    const questDir = join(config.questDataDir, 'quests', quest.questId);
    const archivePath = join(archiveDir, quest.questId);
    await rename(questDir, archivePath);
  }
}

/**
 * Delete quests permanently
 */
async function deleteQuests(quests: Quest[]): Promise<void> {
  for (const quest of quests) {
    const questDir = join(config.questDataDir, 'quests', quest.questId);
    await rm(questDir, { recursive: true, force: true });
  }
}

/**
 * Handle quest_clear_completed tool call
 */
export async function handleQuestClearCompleted(args: unknown) {
  // Validate input
  const input = InputSchema.parse(args);

  // Validate confirmation
  if (input.confirm !== true) {
    throw new Error(
      `Operation not confirmed. You must set confirm=true to ${input.action} completed quests. ` +
      `This operation affects multiple quests and should be used carefully.`
    );
  }

  // Load all quests
  const allQuests = await QuestModel.listAll();

  // Filter completed quests
  const completedQuests = filterCompletedQuests(allQuests, input.olderThanDays);

  // Check if any quests match criteria
  if (completedQuests.length === 0) {
    const ageFilter = input.olderThanDays 
      ? ` older than ${input.olderThanDays} days`
      : '';
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              action: input.action,
              affectedQuests: [],
              message: `No completed quests found${ageFilter}. Nothing to ${input.action}.`,
            },
            null,
            2
          ),
        },
      ],
    };
  }

  // Create backup before any destructive operation
  let backupPath: string | undefined;
  if (input.action === 'delete') {
    try {
      backupPath = await createBackup(completedQuests);
    } catch (error) {
      throw new Error(
        `Failed to create backup before deletion: ${error instanceof Error ? error.message : 'Unknown error'}. ` +
        `Operation aborted for safety.`
      );
    }
  }

  // Perform action
  try {
    if (input.action === 'archive') {
      await archiveQuests(completedQuests);
    } else {
      await deleteQuests(completedQuests);
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    if (backupPath) {
      throw new Error(
        `Failed to ${input.action} quests: ${errorMsg}. ` +
        `Backup preserved at: ${backupPath}`
      );
    } else {
      throw new Error(`Failed to ${input.action} quests: ${errorMsg}`);
    }
  }

  // Commit changes to Git
  const questNames = completedQuests.map((q) => q.questName).join(', ');
  const commitMessage = `chore: ${input.action} ${completedQuests.length} completed quest(s)`;
  const commitBody = [
    `Action: ${input.action}`,
    `Count: ${completedQuests.length}`,
    `Quests: ${questNames}`,
  ];
  if (input.olderThanDays) {
    commitBody.push(`Age filter: older than ${input.olderThanDays} days`);
  }
  if (backupPath) {
    commitBody.push(`Backup: ${backupPath}`);
  }

  try {
    await commitQuestChanges(
      config.questDataDir,
      commitMessage,
      commitBody.join('\n')
    );
  } catch (error) {
    console.warn(
      `[quest_clear_completed] Failed to commit changes to Git: ${error}. ` +
      `Operation succeeded, but not recorded in Git.`
    );
  }

  // Broadcast WebSocket events
  // Note: Using 'completed' status since 'archived'/'deleted' are not valid QuestStatus values
  for (const quest of completedQuests) {
    try {
      await broadcastQuestUpdated(quest.questId, 'completed');
    } catch (error) {
      console.warn(
        `[quest_clear_completed] Failed to broadcast event for quest ${quest.questId}: ${error}`
      );
    }
  }

  // Return success
  const affectedQuests = completedQuests.map((q) => ({
    questId: q.questId,
    questName: q.questName,
    completedAt: q.updatedAt,
  }));

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            success: true,
            action: input.action,
            count: completedQuests.length,
            affectedQuests,
            backupPath: backupPath || undefined,
            ageFilter: input.olderThanDays 
              ? `Older than ${input.olderThanDays} days`
              : 'All completed quests',
            message: `Successfully ${input.action}d ${completedQuests.length} completed quest(s)${backupPath ? `. Backup created at: ${backupPath}` : ''}`,
          },
          null,
          2
        ),
      },
    ],
  };
}
