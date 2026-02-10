/**
 * Quest Approval Tool Registrations
 *
 * Three tools for quest-level approval decisions:
 * - quest_approve: Approve a quest plan
 * - quest_request_revision: Request revision of a quest plan
 * - quest_reject: Reject a quest plan
 *
 * Each tool calls mcp-server-quest's quest_submit_approval via KĀDI broker
 * with the appropriate decision type.
 *
 * Workflow context:
 * - Step 10a: HUMAN approves quest → quest_approve
 * - Step 10b: HUMAN requests revision → quest_request_revision
 * - Step 10c: HUMAN rejects quest → quest_reject
 */

import { z } from '@kadi.build/core';
import type { KadiClient } from '@kadi.build/core';
import { logger, MODULE_AGENT, timer } from 'agents-library';

// --- Shared schemas ---

const approvalOutputSchema = z.object({
  success: z.boolean().describe('Whether the approval action succeeded'),
  message: z.string().describe('Human-readable result message'),
  questId: z.string().describe('Quest ID that was acted upon'),
  decision: z.string().describe('Decision that was submitted'),
});

type ApprovalOutput = z.infer<typeof approvalOutputSchema>;

// --- Helper ---

/**
 * Submit an approval decision to mcp-server-quest via KĀDI broker.
 * The KĀDI broker prefixes tool names with the server name, so
 * quest_submit_approval becomes quest_quest_submit_approval.
 */
async function submitQuestApproval(
  client: KadiClient,
  questId: string,
  decision: 'approved' | 'revision_requested' | 'rejected',
  feedback: string,
  userId: string,
  platform: string,
): Promise<ApprovalOutput> {
  try {
    const result = await client.invokeRemote<{
      content: Array<{ type: string; text: string }>;
    }>('quest_quest_submit_approval', {
      questId,
      decision,
      approvedBy: userId,
      approvedVia: platform,
      feedback: feedback || undefined,
      timestamp: new Date().toISOString(),
    });

    const resultText = result.content[0].text;
    const data = JSON.parse(resultText);

    return {
      success: true,
      message: data.message || `Quest ${decision} successfully`,
      questId,
      decision,
    };
  } catch (error: any) {
    logger.error(
      MODULE_AGENT,
      `Failed to submit quest approval (${decision}): ${error.message}`,
      timer.elapsed('main'),
      error
    );
    return {
      success: false,
      message: `Failed to ${decision} quest: ${error.message}`,
      questId,
      decision,
    };
  }
}

// --- Tool 1: quest_approve ---

const questApproveInputSchema = z.object({
  questId: z.string().describe('Quest ID to approve'),
  feedback: z.string().optional().describe('Optional approval comments'),
  userId: z.string().optional().describe('User ID who approved (default: dashboard)'),
  platform: z.enum(['discord', 'slack', 'dashboard']).optional().describe('Platform (default: dashboard)'),
});

type QuestApproveInput = z.infer<typeof questApproveInputSchema>;

export function registerQuestApproveTool(client: KadiClient): void {
  client.registerTool({
    name: 'quest_approve',
    description: 'Approve a quest plan. The quest must be in pending_approval status. After approval, the quest moves to approved status and is ready for task splitting.',
    input: questApproveInputSchema,
    output: approvalOutputSchema,
  }, async (params: QuestApproveInput): Promise<ApprovalOutput> => {
    logger.info(MODULE_AGENT, `Approving quest ${params.questId}`, timer.elapsed('main'));

    return submitQuestApproval(
      client,
      params.questId,
      'approved',
      params.feedback || '',
      params.userId || 'dashboard-user',
      params.platform || 'dashboard',
    );
  });
}

// --- Tool 2: quest_request_revision ---

const questRequestRevisionInputSchema = z.object({
  questId: z.string().describe('Quest ID to request revision for'),
  feedback: z.string().describe('Revision feedback explaining what needs to change'),
  userId: z.string().optional().describe('User ID who requested revision (default: dashboard)'),
  platform: z.enum(['discord', 'slack', 'dashboard']).optional().describe('Platform (default: dashboard)'),
});

type QuestRequestRevisionInput = z.infer<typeof questRequestRevisionInputSchema>;

export function registerQuestRequestRevisionTool(client: KadiClient): void {
  client.registerTool({
    name: 'quest_request_revision',
    description: 'Request revision of a quest plan. The quest must be in pending_approval status. Feedback is required to explain what needs to change. The quest returns to draft status for revision.',
    input: questRequestRevisionInputSchema,
    output: approvalOutputSchema,
  }, async (params: QuestRequestRevisionInput): Promise<ApprovalOutput> => {
    logger.info(MODULE_AGENT, `Requesting revision for quest ${params.questId}`, timer.elapsed('main'));

    if (!params.feedback || params.feedback.trim().length === 0) {
      return {
        success: false,
        message: 'Feedback is required when requesting revision',
        questId: params.questId,
        decision: 'revision_requested',
      };
    }

    return submitQuestApproval(
      client,
      params.questId,
      'revision_requested',
      params.feedback,
      params.userId || 'dashboard-user',
      params.platform || 'dashboard',
    );
  });
}

// --- Tool 3: quest_reject ---

const questRejectInputSchema = z.object({
  questId: z.string().describe('Quest ID to reject'),
  feedback: z.string().describe('Rejection reason'),
  userId: z.string().optional().describe('User ID who rejected (default: dashboard)'),
  platform: z.enum(['discord', 'slack', 'dashboard']).optional().describe('Platform (default: dashboard)'),
});

type QuestRejectInput = z.infer<typeof questRejectInputSchema>;

export function registerQuestRejectTool(client: KadiClient): void {
  client.registerTool({
    name: 'quest_reject',
    description: 'Reject a quest plan. The quest must be in pending_approval status. Feedback is required to explain the rejection reason. The quest moves to rejected status.',
    input: questRejectInputSchema,
    output: approvalOutputSchema,
  }, async (params: QuestRejectInput): Promise<ApprovalOutput> => {
    logger.info(MODULE_AGENT, `Rejecting quest ${params.questId}`, timer.elapsed('main'));

    if (!params.feedback || params.feedback.trim().length === 0) {
      return {
        success: false,
        message: 'Feedback is required when rejecting a quest',
        questId: params.questId,
        decision: 'rejected',
      };
    }

    return submitQuestApproval(
      client,
      params.questId,
      'rejected',
      params.feedback,
      params.userId || 'dashboard-user',
      params.platform || 'dashboard',
    );
  });
}
