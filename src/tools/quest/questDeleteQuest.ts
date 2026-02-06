/**
 * quest_delete_quest MCP Tool
 * Permanently deletes a quest and all associated data with safety checks and backup
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { QuestModel } from '../../models/questModel.js';
import type { QuestStatus } from '../../types/index.js';
import { commitQuestChanges } from '../../utils/git.js';
import { config } from '../../utils/config.js';
import { broadcastQuestUpdated } from '../../dashboard/events.js';
import { mkdir, cp, rm } from 'fs/promises';
import { join } from 'path';

/**
 * Tool definition for MCP protocol
 */
export const questDeleteQuestTool: Tool = {
  name: 'quest_delete_quest',
  description: `Permanently delete a quest and all associated data with safety checks and backup.

**DANGER: This is a destructive operation!**

**Safety Requirements:**
- Explicit confirmation required (confirm parameter must be true)
- Only allows deletion of draft, rejected, or cancelled quests
- Prevents deletion of in_progress or completed quests (use archive instead)
- Creates automatic backup before deletion
- Commits deletion to Git for audit trail

**Usage Guidelines:**
- Use for cleaning up test quests or mistakes
- Use for removing rejected/cancelled quests
- DO NOT use for completed quests (they should be archived)
- Backup is created in .quest-data/backups/ directory

**Parameters:**
- questId (required): UUID of the quest to delete
- confirm (required): Must be true to confirm deletion

**Returns:**
- success: Boolean indicating if deletion succeeded
- questId: ID of the deleted quest
- questName: Name of the deleted quest
- backupPath: Path to the backup directory
- message: Human-readable confirmation message`,
  inputSchema: {
    type: 'object',
    properties: {
      questId: {
        type: 'string',
        description: 'Quest ID (UUID) to delete',
      },
      confirm: {
        type: 'boolean',
        description: 'Must be true to confirm deletion (safety check)',
      },
    },
    required: ['questId', 'confirm'],
  },
};

/**
 * Input parameters for quest_delete_quest tool
 */
interface QuestDeleteQuestInput {
  questId: string;
  confirm: boolean;
}

/**
 * Validate if quest status allows deletion
 */
function canDeleteQuest(status: QuestStatus): boolean {
  const deletableStatuses: QuestStatus[] = ['draft', 'rejected', 'cancelled'];
  return deletableStatuses.includes(status);
}

/**
 * Create backup of quest before deletion
 */
async function createQuestBackup(questId: string): Promise<string> {
  const questDir = join(config.questDataDir, 'quests', questId);
  const backupDir = join(config.questDataDir, 'backups');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = join(backupDir, `${questId}_${timestamp}`);

  // Ensure backup directory exists
  await mkdir(backupDir, { recursive: true });

  // Copy quest directory to backup
  await cp(questDir, backupPath, { recursive: true });

  return backupPath;
}

/**
 * Handle quest_delete_quest tool call
 */
export async function handleQuestDeleteQuest(args: unknown) {
  // Validate input
  const input = args as QuestDeleteQuestInput;

  if (!input.questId) {
    throw new Error('questId is required');
  }

  if (input.confirm !== true) {
    throw new Error(
      'Deletion not confirmed. You must set confirm=true to delete a quest. ' +
      'This is a destructive operation that cannot be undone (except from backup).'
    );
  }

  // Load quest
  let quest;
  try {
    quest = await QuestModel.load(input.questId);
  } catch (error) {
    throw new Error(`Quest with ID '${input.questId}' not found`);
  }

  // Validate quest status allows deletion
  if (!canDeleteQuest(quest.status)) {
    throw new Error(
      `Cannot delete quest with status '${quest.status}'. ` +
      `Only draft, rejected, or cancelled quests can be deleted. ` +
      `Current status: ${quest.status}. ` +
      `For in_progress or completed quests, use archive functionality instead.`
    );
  }

  // Create backup before deletion
  let backupPath: string;
  try {
    backupPath = await createQuestBackup(input.questId);
  } catch (error) {
    throw new Error(
      `Failed to create backup before deletion: ${error instanceof Error ? error.message : 'Unknown error'}. ` +
      `Deletion aborted for safety.`
    );
  }

  // Delete quest directory
  const questDir = join(config.questDataDir, 'quests', input.questId);
  try {
    await rm(questDir, { recursive: true, force: true });
  } catch (error) {
    throw new Error(
      `Failed to delete quest directory: ${error instanceof Error ? error.message : 'Unknown error'}. ` +
      `Backup preserved at: ${backupPath}`
    );
  }

  // Commit deletion to Git
  const commitMessage = `chore: delete quest ${input.questId} (${quest.questName})`;
  try {
    await commitQuestChanges(config.questDataDir, commitMessage);
  } catch (error) {
    // Log warning but don't fail - deletion succeeded
    console.warn(
      `[quest_delete_quest] Failed to commit deletion to Git: ${error}. ` +
      `Quest was deleted successfully, backup at: ${backupPath}`
    );
  }

  // Broadcast WebSocket event to dashboard
  try {
    await broadcastQuestUpdated(input.questId, 'deleted' as QuestStatus);
  } catch (error) {
    // Log warning but don't fail - deletion succeeded
    console.warn(
      `[quest_delete_quest] Failed to broadcast deletion event: ${error}`
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
            status: quest.status,
            backupPath,
            message: `Quest '${quest.questName}' (${input.questId}) has been permanently deleted. Backup created at: ${backupPath}`,
          },
          null,
          2
        ),
      },
    ],
  };
}
