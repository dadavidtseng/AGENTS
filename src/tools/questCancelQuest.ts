/**
 * quest_cancel_quest MCP Tool
 * Cancels a quest without deleting it, preserving history for later review
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { QuestModel } from '../models/questModel.js';
import type { QuestStatus } from '../types/index.js';
import { commitQuestChanges } from '../utils/git.js';
import { config } from '../utils/config.js';
import { broadcastQuestUpdated } from '../dashboard/events.js';

/**
 * Tool definition for MCP protocol
 */
export const questCancelQuestTool: Tool = {
  name: 'quest_cancel_quest',
  description: `Cancel a quest without deleting it, preserving history for later review.

**Usage Guidelines:**
- Non-destructive operation that preserves quest history
- Only allows cancellation of draft, pending_approval, or in_progress quests
- Completed quests cannot be cancelled (use archive instead)
- Cancelled quests remain in the system for audit purposes

**Parameters:**
- questId (required): UUID of the quest to cancel
- reason (optional): Reason for cancellation (for audit trail)

**Returns:**
- success: Boolean indicating if cancellation succeeded
- questId: ID of the cancelled quest
- previousStatus: Status before cancellation
- cancelledAt: Timestamp of cancellation
- message: Human-readable confirmation message`,
  inputSchema: {
    type: 'object',
    properties: {
      questId: {
        type: 'string',
        description: 'Quest ID (UUID) to cancel',
      },
      reason: {
        type: 'string',
        description: 'Optional reason for cancellation (for audit trail)',
      },
    },
    required: ['questId'],
  },
};

/**
 * Input parameters for quest_cancel_quest tool
 */
interface QuestCancelQuestInput {
  questId: string;
  reason?: string;
}

/**
 * Validate if quest status allows cancellation
 */
function canCancelQuest(status: QuestStatus): boolean {
  const cancellableStatuses: QuestStatus[] = ['draft', 'pending_approval', 'in_progress'];
  return cancellableStatuses.includes(status);
}

/**
 * Handle quest_cancel_quest tool call
 */
export async function handleQuestCancelQuest(args: unknown) {
  // Validate input
  const input = args as QuestCancelQuestInput;

  if (!input.questId) {
    throw new Error('questId is required');
  }

  // Load quest
  let quest;
  try {
    quest = await QuestModel.load(input.questId);
  } catch (error) {
    throw new Error(`Quest with ID '${input.questId}' not found`);
  }

  // Check if quest is already cancelled
  if (quest.status === 'cancelled') {
    throw new Error(
      `Quest '${quest.questName}' (${input.questId}) is already cancelled`
    );
  }

  // Validate quest status allows cancellation
  if (!canCancelQuest(quest.status)) {
    throw new Error(
      `Cannot cancel quest with status '${quest.status}'. ` +
      `Only draft, pending_approval, or in_progress quests can be cancelled. ` +
      `Completed quests should be archived instead.`
    );
  }

  // Store previous status for response
  const previousStatus = quest.status;

  // Update quest status to cancelled
  quest.status = 'cancelled';

  // Add cancellation metadata
  if (!quest.metadata) {
    quest.metadata = {};
  }

  quest.metadata.cancellation = {
    cancelledAt: new Date().toISOString(),
    cancelledBy: 'system', // TODO: Add user context when available
    reason: input.reason || 'No reason provided',
    previousStatus,
  };

  // Save quest
  await QuestModel.save(quest);

  // Commit changes to Git
  const commitMessage = input.reason
    ? `chore: cancel quest ${input.questId} - ${input.reason}`
    : `chore: cancel quest ${input.questId}`;

  await commitQuestChanges(config.questDataDir, commitMessage);

  // Broadcast WebSocket event to dashboard
  await broadcastQuestUpdated(quest.questId, 'cancelled');

  // Return success
  const cancelledAt = quest.metadata.cancellation.cancelledAt;

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            success: true,
            questId: input.questId,
            questName: quest.questName,
            previousStatus,
            status: 'cancelled',
            cancelledAt,
            reason: input.reason || 'No reason provided',
            message: `Quest '${quest.questName}' has been cancelled. Previous status: ${previousStatus}`,
          },
          null,
          2
        ),
      },
    ],
  };
}
