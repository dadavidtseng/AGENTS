/**
 * quest_approval_status Tool
 * Check approval status without modifying anything, separate from submission
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { QuestModel } from '../models/questModel.js';
import type { ApprovalDecision, QuestStatus } from '../types/index.js';

/**
 * Tool definition for MCP protocol
 */
export const questApprovalStatusTool: Tool = {
  name: 'quest_approval_status',
  description: `Check approval status without modifying anything.

**Usage Guidelines:**
Use this tool to poll approval status separately from submission. This is a read-only operation that does not modify quest state.

**When to Use:**
- After calling quest_request_approval, poll this tool to check status
- Monitor approval progress without making changes
- Check approval history for a quest
- Determine if quest is ready to proceed after approval

**Returns:**
- Current quest status (draft, pending_approval, approved, rejected, etc.)
- Approval history with all decisions
- Latest approval decision details
- Whether quest can proceed (approved status)
- Next steps based on current status

**Example Use Cases:**
- "What's the approval status of quest abc-123?"
- "Has the authentication quest been approved yet?"
- "Show me the approval history for this quest"

**Important:**
- This is a read-only operation
- Does not modify quest state
- Use quest_submit_approval to actually approve/reject
- Verbal approval is NOT accepted - must use proper approval workflow`,
  inputSchema: {
    type: 'object',
    properties: {
      questId: {
        type: 'string',
        description: 'Quest identifier (UUID)',
      },
    },
    required: ['questId'],
  },
};

/**
 * Input type for quest_approval_status
 */
interface QuestApprovalStatusInput {
  questId: string;
}

/**
 * Handle quest_approval_status tool call
 */
export async function handleQuestApprovalStatus(args: unknown) {
  // Validate input
  const input = args as QuestApprovalStatusInput;

  if (!input.questId) {
    throw new Error('questId is required');
  }

  // Load quest
  const quest = await QuestModel.load(input.questId);

  // Get current status
  const currentStatus = quest.status;

  // Get approval history
  const approvalHistory = quest.approvalHistory || [];

  // Get latest approval (most recent)
  const latestApproval = approvalHistory.length > 0
    ? approvalHistory[approvalHistory.length - 1]
    : null;

  // Determine if quest can proceed
  const canProceed = currentStatus === 'approved' || currentStatus === 'in_progress' || currentStatus === 'completed';
  const isPending = currentStatus === 'pending_approval';
  const isRejected = currentStatus === 'rejected';
  const isDraft = currentStatus === 'draft';
  const isCancelled = currentStatus === 'cancelled';

  // Count approval decisions by type
  const approvalCounts = {
    approved: approvalHistory.filter((a) => a.decision === 'approved').length,
    rejected: approvalHistory.filter((a) => a.decision === 'rejected').length,
    revisionRequested: approvalHistory.filter((a) => a.decision === 'revision_requested').length,
    total: approvalHistory.length,
  };

  // Generate next steps based on current status
  const nextSteps: string[] = [];

  if (isDraft) {
    nextSteps.push('Quest is in draft status');
    nextSteps.push('Call quest_request_approval to submit for approval');
  } else if (isPending) {
    nextSteps.push('BLOCKED - Quest is pending approval');
    nextSteps.push('VERBAL APPROVAL NOT ACCEPTED');
    nextSteps.push('Approval must be done via Discord/Slack/Dashboard');
    nextSteps.push('Approver must call quest_submit_approval');
    nextSteps.push('Continue polling with quest_approval_status');
  } else if (isRejected) {
    nextSteps.push('BLOCKED - Quest was rejected');
    nextSteps.push('Review rejection feedback in approval history');
    nextSteps.push('Call quest_revise to update requirements/design');
    nextSteps.push('Resubmit for approval with quest_request_approval');
    if (latestApproval?.feedback) {
      nextSteps.push(`Latest feedback: ${latestApproval.feedback}`);
    }
  } else if (canProceed) {
    nextSteps.push('APPROVED - Quest can proceed');
    if (currentStatus === 'approved') {
      nextSteps.push('Call quest_split_tasks to break down into tasks');
    } else if (currentStatus === 'in_progress') {
      nextSteps.push('Quest is currently being implemented');
      nextSteps.push('Call quest_get_details to view task progress');
    } else if (currentStatus === 'completed') {
      nextSteps.push('Quest has been completed');
    }
  } else if (isCancelled) {
    nextSteps.push('Quest has been cancelled');
    nextSteps.push('Review cancellation reason in metadata');
  }

  // Format approval history for display
  const formattedHistory = approvalHistory.map((approval) => ({
    approvalId: approval.approvalId,
    decision: approval.decision,
    approvedBy: approval.approvedBy,
    approvedVia: approval.approvedVia,
    feedback: approval.feedback,
    timestamp: approval.timestamp,
  }));

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
            currentStatus,
            canProceed,
            isPending,
            isRejected,
            isDraft,
            isCancelled,
            approvalCounts,
            latestApproval: latestApproval
              ? {
                  approvalId: latestApproval.approvalId,
                  decision: latestApproval.decision,
                  approvedBy: latestApproval.approvedBy,
                  approvedVia: latestApproval.approvedVia,
                  feedback: latestApproval.feedback,
                  timestamp: latestApproval.timestamp,
                }
              : null,
            approvalHistory: formattedHistory,
            nextSteps,
            message: isPending
              ? `BLOCKED: Quest "${quest.questName}" is pending approval. Verbal approval is NOT accepted. Use proper approval workflow.`
              : canProceed
              ? `Quest "${quest.questName}" is approved and can proceed.`
              : isRejected
              ? `BLOCKED: Quest "${quest.questName}" was rejected. Review feedback and revise.`
              : isDraft
              ? `Quest "${quest.questName}" is in draft status. Submit for approval.`
              : `Quest "${quest.questName}" status: ${currentStatus}`,
          },
          null,
          2
        ),
      },
    ],
  };
}
