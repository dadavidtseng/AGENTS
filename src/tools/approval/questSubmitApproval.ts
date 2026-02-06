/**
 * quest_submit_approval MCP Tool
 * Submits approval decisions with automatic revision workflow
 */

import { randomUUID } from 'crypto';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { QuestModel } from '../../models/questModel.js';
import { ApprovalModel } from '../../models/approvalModel.js';
import type { ApprovalDecision, ApprovalDecisionType, Platform } from '../../types/index.js';
import { handleQuestRevise } from '../quest/questRevise.js';
import { handleQuestRequestApproval } from './questRequestApproval.js';

/**
 * Tool definition for MCP protocol
 */
export const questSubmitApprovalTool: Tool = {
  name: 'quest_submit_approval',
  description: 'Submit approval decision for quest',
  inputSchema: {
    type: 'object',
    properties: {
      questId: {
        type: 'string',
        description: 'Quest ID to submit approval for',
      },
      decision: {
        type: 'string',
        enum: ['approved', 'revision_requested', 'rejected'],
        description: 'Approval decision',
      },
      approvedBy: {
        type: 'string',
        description: 'User ID who made the decision',
      },
      approvedVia: {
        type: 'string',
        enum: ['discord', 'slack', 'dashboard'],
        description: 'Platform where approval was made',
      },
      feedback: {
        type: 'string',
        description: 'Feedback/comments (required for revision_requested or rejected)',
      },
      timestamp: {
        type: 'string',
        description: 'ISO 8601 timestamp of decision',
      },
    },
    required: ['questId', 'decision', 'approvedBy', 'approvedVia', 'timestamp'],
  },
};

/**
 * Input parameters for quest_submit_approval tool
 */
interface QuestSubmitApprovalInput {
  questId: string;
  decision: ApprovalDecisionType;
  approvedBy: string;
  approvedVia: Platform;
  feedback?: string;
  timestamp: string;
}

/**
 * Handle quest_submit_approval tool call
 */
export async function handleQuestSubmitApproval(args: unknown) {
  // Validate input
  const input = args as QuestSubmitApprovalInput;

  if (!input.questId) {
    throw new Error('questId is required');
  }
  if (!input.decision) {
    throw new Error('decision is required');
  }
  if (!['approved', 'revision_requested', 'rejected'].includes(input.decision)) {
    throw new Error('decision must be one of: approved, revision_requested, rejected');
  }
  if (!input.approvedBy) {
    throw new Error('approvedBy is required');
  }
  if (!input.approvedVia) {
    throw new Error('approvedVia is required');
  }
  if (!['discord', 'slack', 'dashboard'].includes(input.approvedVia)) {
    throw new Error('approvedVia must be one of: discord, slack, dashboard');
  }
  if (!input.timestamp) {
    throw new Error('timestamp is required');
  }

  // Validate feedback requirement
  if (
    (input.decision === 'revision_requested' || input.decision === 'rejected') &&
    (!input.feedback || input.feedback.trim().length === 0)
  ) {
    throw new Error(
      `feedback is required when decision is '${input.decision}'`
    );
  }

  // Load quest to validate status
  let quest;
  try {
    quest = await QuestModel.load(input.questId);
  } catch (error) {
    throw new Error(`Quest not found: ${input.questId}`);
  }

  // Validate quest status
  if (quest.status !== 'pending_approval') {
    throw new Error(
      `Quest must be in 'pending_approval' status (current status: ${quest.status})`
    );
  }

  // Parse timestamp
  let timestamp: Date;
  try {
    timestamp = new Date(input.timestamp);
    if (isNaN(timestamp.getTime())) {
      throw new Error('Invalid date');
    }
  } catch (error) {
    throw new Error('timestamp must be a valid ISO 8601 date string');
  }

  // Create approval decision
  const approvalDecision: ApprovalDecision = {
    approvalId: randomUUID(),
    questId: input.questId,
    decision: input.decision,
    approvedBy: input.approvedBy,
    approvedVia: input.approvedVia,
    feedback: input.feedback,
    timestamp,
  };

  // Submit approval
  const result = await ApprovalModel.submitApproval(input.questId, approvalDecision);

  // Handle automatic revision workflow
  if (input.decision === 'revision_requested' && input.feedback) {
    try {
      // Trigger revision
      await handleQuestRevise({
        questId: input.questId,
        feedback: input.feedback,
      });

      // Re-request approval after revision
      await handleQuestRequestApproval({
        questId: input.questId,
      });

      // Return result with revision workflow completion
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                questId: input.questId,
                questName: quest.questName,
                decision: input.decision,
                nextAction: result.nextAction,
                questStatus: 'pending_approval', // After automatic re-request
                revisionApplied: true,
                approvalRequested: true,
                message: `Quest "${quest.questName}" revised and re-submitted for approval`,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (revisionError) {
      // If revision fails, return error but approval was still recorded
      const errorMessage =
        revisionError instanceof Error ? revisionError.message : 'Unknown error';
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                questId: input.questId,
                questName: quest.questName,
                decision: input.decision,
                nextAction: result.nextAction,
                questStatus: result.questStatus,
                revisionApplied: false,
                approvalRequested: false,
                error: `Approval recorded but automatic revision failed: ${errorMessage}`,
                message: `Approval decision recorded, but automatic revision workflow failed. Manual revision required.`,
              },
              null,
              2
            ),
          },
        ],
      };
    }
  }

  // Return standard result for approved/rejected
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            success: result.success,
            questId: input.questId,
            questName: quest.questName,
            decision: input.decision,
            nextAction: result.nextAction,
            questStatus: result.questStatus,
            message:
              input.decision === 'approved'
                ? `Quest "${quest.questName}" approved and ready for execution`
                : `Quest "${quest.questName}" rejected`,
          },
          null,
          2
        ),
      },
    ],
  };
}
