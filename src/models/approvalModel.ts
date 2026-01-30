/**
 * Approval Model - Multi-channel approval workflow management
 * State machine for quest approval decisions (Discord, Slack, Dashboard)
 */

import { ApprovalDecision, ConversationContext, QuestStatus } from '../types/index.js';
import { QuestModel } from './questModel.js';
import { commitQuestChanges } from '../utils/git.js';
import { config } from '../utils/config.js';
import { broadcastApprovalRequested, broadcastApprovalDecision } from '../dashboard/events.js';

/**
 * Approval state returned when requesting approval
 */
export interface ApprovalState {
  /** Quest being approved */
  questId: string;
  /** Current approval status */
  status: 'pending' | 'approved' | 'rejected' | 'needs_revision';
  /** When approval was requested */
  requestedAt: Date;
  /** Original conversation context for routing response */
  conversationContext: ConversationContext;
}

/**
 * Result of approval submission
 */
export interface ApprovalResult {
  /** Whether approval was processed successfully */
  success: boolean;
  /** Next action to take based on decision */
  nextAction: 'execute' | 'revise' | 'cancel';
  /** New quest status after approval */
  questStatus: QuestStatus;
}

/**
 * Approval Model - Manages approval workflow state machine
 * Handles multi-channel approvals (Discord, Slack, Dashboard)
 */
export class ApprovalModel {
  /**
   * Request approval for a quest
   * Updates quest status to pending_approval
   * Note: Does NOT send notifications - caller's responsibility
   * 
   * @param questId - Quest to request approval for
   * @returns Approval state with routing information
   * 
   * @example
   * const approvalState = await ApprovalModel.requestApproval('quest-123');
   * // Send notification to Discord/Slack/Dashboard based on approvalState.conversationContext
   */
  static async requestApproval(questId: string): Promise<ApprovalState> {
    // Load quest
    const quest = await QuestModel.load(questId);

    // Update status to pending approval
    quest.status = 'pending_approval';

    // Save quest
    await QuestModel.save(quest);

    // Broadcast approval requested event
    await broadcastApprovalRequested(quest.questId, quest.questName);

    // Return approval state
    return {
      questId: quest.questId,
      status: 'pending',
      requestedAt: new Date(),
      conversationContext: quest.conversationContext,
    };
  }

  /**
   * Submit approval decision for a quest
   * Updates quest status based on decision and records in history
   * 
   * State Transitions:
   * - 'approved' → quest.status = 'approved' (ready for task splitting)
   * - 'revision_requested' → quest.status = 'draft' (return to editing)
   * - 'rejected' → quest.status = 'rejected' (quest cancelled)
   * 
   * @param questId - Quest being approved
   * @param decision - Approval decision with reviewer info
   * @returns Approval result with next action
   * 
   * @example
   * const result = await ApprovalModel.submitApproval('quest-123', {
   *   approvalId: 'approval-456',
   *   questId: 'quest-123',
   *   decision: 'approved',
   *   approvedBy: 'user-789',
   *   approvedVia: 'discord',
   *   timestamp: new Date()
   * });
   * 
   * if (result.nextAction === 'execute') {
   *   // Proceed to task splitting
   * }
   */
  static async submitApproval(
    questId: string,
    decision: ApprovalDecision
  ): Promise<ApprovalResult> {
    // Load quest
    const quest = await QuestModel.load(questId);

    // Add decision to approval history
    quest.approvalHistory.push(decision);

    // Update quest status based on decision
    let nextAction: 'execute' | 'revise' | 'cancel';

    switch (decision.decision) {
      case 'approved':
        quest.status = 'approved';
        nextAction = 'execute';
        break;

      case 'revision_requested':
        quest.status = 'draft';
        nextAction = 'revise';
        break;

      case 'rejected':
        quest.status = 'rejected';
        nextAction = 'cancel';
        break;

      default:
        // TypeScript exhaustiveness check
        const _exhaustive: never = decision.decision;
        throw new Error(`Unknown decision type: ${_exhaustive}`);
    }

    // Save quest
    await QuestModel.save(quest);

    // Git commit
    const feedbackNote = decision.feedback ? `\n\nFeedback: ${decision.feedback}` : '';
    await commitQuestChanges(
      config.questDataDir,
      `chore: ${decision.decision} quest ${quest.questName}`,
      `Approved by: ${decision.approvedBy}\nApproved via: ${decision.approvedVia}${feedbackNote}`
    );

    // Broadcast approval decision event
    await broadcastApprovalDecision(questId, decision);

    return {
      success: true,
      nextAction,
      questStatus: quest.status,
    };
  }

  /**
   * Get approval history for a quest
   * Returns chronological list of all approval decisions
   * 
   * @param questId - Quest to get history for
   * @returns Array of approval decisions
   * 
   * @example
   * const history = await ApprovalModel.getApprovalHistory('quest-123');
   * console.log(`Quest has ${history.length} approval decisions`);
   */
  static async getApprovalHistory(questId: string): Promise<ApprovalDecision[]> {
    const quest = await QuestModel.load(questId);
    return quest.approvalHistory;
  }
}
