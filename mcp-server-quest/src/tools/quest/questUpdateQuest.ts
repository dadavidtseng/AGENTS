/**
 * quest_update_quest MCP Tool
 * Updates quest status and/or revises requirements and design.
 * Supports two modes:
 *   - Status update only: provide questId + status
 *   - Revision: provide questId + feedback + revisedRequirements + revisedDesign
 *   - Both: provide all fields
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { QuestStatus } from '../../types/index.js';
import { QuestModel } from '../../models/questModel.js';

/** Valid status transitions — key is current status, value is set of allowed next statuses. */
const VALID_TRANSITIONS: Record<QuestStatus, Set<QuestStatus>> = {
  draft:             new Set(['pending_approval', 'cancelled']),
  pending_approval:  new Set(['approved', 'rejected', 'draft', 'cancelled']),
  approved:          new Set(['in_progress', 'cancelled']),
  rejected:          new Set(['draft', 'cancelled']),
  in_progress:       new Set(['completed', 'cancelled']),
  completed:         new Set([]),          // terminal
  cancelled:         new Set(['draft']),   // allow reopen to draft
};

const ALL_STATUSES: QuestStatus[] = [
  'draft', 'pending_approval', 'approved', 'rejected',
  'in_progress', 'completed', 'cancelled',
];

/**
 * Tool definition for MCP protocol
 */
export const questUpdateQuestTool: Tool = {
  name: 'quest_update_quest',
  description:
    'Update a quest. Can change status, revise requirements/design, or both. ' +
    'For status-only updates, provide questId + status. ' +
    'For revisions, provide questId + feedback + revisedRequirements + revisedDesign.',
  inputSchema: {
    type: 'object',
    properties: {
      questId: {
        type: 'string',
        description: 'Quest ID to update',
      },
      status: {
        type: 'string',
        enum: ALL_STATUSES,
        description: 'New quest status (optional). Must be a valid transition from current status.',
      },
      feedback: {
        type: 'string',
        description: 'Revision feedback from human reviewer (required for revisions)',
      },
      revisedRequirements: {
        type: 'string',
        description: 'Pre-generated revised requirements document (Markdown format)',
      },
      revisedDesign: {
        type: 'string',
        description: 'Pre-generated revised design document (Markdown format)',
      },
    },
    required: ['questId'],
  },
};

/**
 * Input parameters for quest_update_quest tool
 */
interface QuestUpdateQuestInput {
  questId: string;
  status?: QuestStatus;
  feedback?: string;
  revisedRequirements?: string;
  revisedDesign?: string;
}

/**
 * Handle quest_update_quest tool call
 */
export async function handleQuestUpdateQuest(args: unknown) {
  const input = args as QuestUpdateQuestInput;

  if (!input.questId) {
    throw new Error('questId is required');
  }

  const isRevision = !!(input.feedback || input.revisedRequirements || input.revisedDesign);
  const isStatusUpdate = !!input.status;

  if (!isRevision && !isStatusUpdate) {
    throw new Error('At least one of status, or revision fields (feedback + revisedRequirements + revisedDesign) must be provided');
  }

  // Validate revision fields are complete if any are provided
  if (isRevision) {
    if (!input.feedback || input.feedback.trim().length === 0) {
      throw new Error('feedback is required and cannot be empty for revisions');
    }
    if (!input.revisedRequirements) {
      throw new Error('revisedRequirements is required for revisions');
    }
    if (!input.revisedDesign) {
      throw new Error('revisedDesign is required for revisions');
    }
  }

  // Load quest
  const quest = await QuestModel.load(input.questId);
  const previousStatus = quest.status;
  const actions: string[] = [];

  // Apply status transition
  if (isStatusUpdate) {
    const allowed = VALID_TRANSITIONS[quest.status];
    if (!allowed || !allowed.has(input.status!)) {
      throw new Error(
        `Invalid status transition: '${quest.status}' → '${input.status}'. ` +
        `Allowed transitions from '${quest.status}': ${[...(allowed ?? [])].join(', ') || 'none (terminal state)'}`,
      );
    }
    quest.status = input.status!;
    actions.push(`status: ${previousStatus} → ${input.status}`);
  }

  // Apply revision
  if (isRevision) {
    quest.requirements = input.revisedRequirements!;
    quest.design = input.revisedDesign!;
    quest.revisionNumber += 1;
    actions.push(`revised to #${quest.revisionNumber}`);
  }

  // Save
  await QuestModel.save(quest);

  // Return result
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            success: true,
            questId: quest.questId,
            questName: quest.questName,
            previousStatus,
            status: quest.status,
            revisionNumber: quest.revisionNumber,
            updatedAt: quest.updatedAt,
            actions,
            message: `Quest "${quest.questName}" updated: ${actions.join(', ')}`,
          },
          null,
          2
        ),
      },
    ],
  };
}
