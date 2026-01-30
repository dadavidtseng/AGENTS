/**
 * quest_delete_approval Tool
 * Clean up approval requests after completion
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { QuestModel } from '../models/questModel.js';
import { commitQuestChanges } from '../utils/git.js';
import { config } from '../utils/config.js';
import { broadcastQuestUpdated } from '../dashboard/events.js';

/**
 * Tool definition for MCP protocol
 */
export const questDeleteApprovalTool: Tool = {
  name: 'quest_delete_approval',
  description: `Clean up approval requests after completion.

**Usage Guidelines:**
Use this tool to delete approval records from quest history after they have been processed. This is a cleanup operation for completed approval workflows.

**Safety Rules:**
- CANNOT delete approvals for quests in 'pending_approval' status
- Can only delete approvals after quest has moved to another status
- This prevents accidental deletion of active approval requests

**When to Use:**
- After quest has been approved and moved to 'approved' status
- After quest has been rejected and moved to 'rejected' status
- To clean up old approval records for maintenance
- To remove specific approval decisions from history

**Cannot Use When:**
- Quest is in 'pending_approval' status (approval is still active)
- Approval is currently being reviewed

**Returns:**
- Success confirmation with deleted approval details
- Updated quest status
- Remaining approval count

**Example Use Cases:**
- "Delete approval abc-123 from quest xyz-456"
- "Clean up old approval records"
- "Remove specific approval decision from history"

**Important:**
- This is a destructive operation
- Cannot be undone
- Blocked for pending approvals to prevent workflow disruption`,
  inputSchema: {
    type: 'object',
    properties: {
      questId: {
        type: 'string',
        description: 'Quest identifier (UUID)',
      },
      approvalId: {
        type: 'string',
        description: 'Approval identifier (UUID) to delete',
      },
    },
    required: ['questId', 'approvalId'],
  },
};

/**
 * Input type for quest_delete_approval
 */
interface QuestDeleteApprovalInput {
  questId: string;
  approvalId: string;
}

/**
 * Handle quest_delete_approval tool call
 */
export async function handleQuestDeleteApproval(args: unknown) {
  // Validate input
  const input = args as QuestDeleteApprovalInput;

  if (!input.questId) {
    throw new Error('questId is required');
  }

  if (!input.approvalId) {
    throw new Error('approvalId is required');
  }

  // Load quest
  const quest = await QuestModel.load(input.questId);

  // Check if quest is in pending_approval status
  if (quest.status === 'pending_approval') {
    throw new Error(
      `BLOCKED: Cannot delete approval - quest is in "pending_approval" status. ` +
        `This approval is still active and awaiting review. ` +
        `Wait for approval to be processed (approved/rejected) before deleting. ` +
        `Current status: ${quest.status}`
    );
  }

  // Find the approval in history
  const approvalIndex = quest.approvalHistory.findIndex(
    (approval) => approval.approvalId === input.approvalId
  );

  if (approvalIndex === -1) {
    throw new Error(
      `Approval ${input.approvalId} not found in quest ${input.questId}. ` +
        `Quest has ${quest.approvalHistory.length} approval(s) in history.`
    );
  }

  // Get approval details before deletion
  const deletedApproval = quest.approvalHistory[approvalIndex];

  // Remove approval from history
  quest.approvalHistory.splice(approvalIndex, 1);

  // Update quest timestamp
  quest.updatedAt = new Date();

  // Save quest
  await QuestModel.save(quest);

  // Commit to git
  const commitMessage = `chore: delete approval ${input.approvalId} from quest ${quest.questName}`;
  await commitQuestChanges(config.questDataDir, commitMessage);

  // Broadcast update
  await broadcastQuestUpdated(quest.questId, quest.status);

  // Return success
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            success: true,
            questId: quest.questId,
            questName: quest.questName,
            deletedApproval: {
              approvalId: deletedApproval.approvalId,
              decision: deletedApproval.decision,
              approvedBy: deletedApproval.approvedBy,
              approvedVia: deletedApproval.approvedVia,
              timestamp: deletedApproval.timestamp,
              feedback: deletedApproval.feedback,
            },
            remainingApprovals: quest.approvalHistory.length,
            currentStatus: quest.status,
            message: `Approval ${input.approvalId} deleted successfully from quest "${quest.questName}". ${quest.approvalHistory.length} approval(s) remaining in history.`,
          },
          null,
          2
        ),
      },
    ],
  };
}
