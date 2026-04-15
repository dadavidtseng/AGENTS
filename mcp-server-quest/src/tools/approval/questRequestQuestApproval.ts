/**
 * quest_request_quest_approval MCP Tool
 * Requests human approval for quest plans with platform-formatted messages
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { QuestModel } from '../../models/questModel.js';
import { ApprovalModel } from '../../models/approvalModel.js';
import type { Platform } from '../../types/index.js';

/**
 * Tool definition for MCP protocol
 */
export const questRequestQuestApprovalTool: Tool = {
  name: 'quest_request_quest_approval',
  description: 'Request human approval for quest plans',
  inputSchema: {
    type: 'object',
    properties: {
      questId: {
        type: 'string',
        description: 'Quest ID to request approval for',
      },
    },
    required: ['questId'],
  },
};

/**
 * Input parameters for quest_request_quest_approval tool
 */
interface QuestRequestQuestApprovalInput {
  questId: string;
}

/**
 * Platform-specific character limits for message fields
 */
const PLATFORM_LIMITS = {
  discord: {
    field: 2000,
  },
  slack: {
    block: 3000,
  },
  dashboard: {
    field: Number.MAX_SAFE_INTEGER, // No limit
  },
};

/**
 * Truncate text to fit platform limits
 */
function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }

  // Truncate with ellipsis
  return text.substring(0, maxLength - 3) + '...';
}

/**
 * Extract key highlights from requirements document
 */
function extractRequirementsHighlights(requirements: string): string {
  // Find functional requirements section
  const frMatch = requirements.match(/##?\s*Functional\s+Requirements[\s\S]*?(?=##|\n\n)/i);
  if (frMatch) {
    const frSection = frMatch[0];
    // Extract FR-X.Y items
    const items = frSection.match(/FR-\d+\.\d+[^\n]*/g);
    if (items && items.length > 0) {
      return items.slice(0, 5).join('\n'); // First 5 items
    }
  }

  // Fallback: extract user stories
  const storiesMatch = requirements.match(/##?\s*User\s+Stories[\s\S]*?(?=##|\n\n)/i);
  if (storiesMatch) {
    const storiesSection = storiesMatch[0];
    const items = storiesSection.match(/[-*]\s*As\s+[^\n]*/gi);
    if (items && items.length > 0) {
      return items.slice(0, 3).join('\n'); // First 3 stories
    }
  }

  // Last resort: first paragraph
  const firstPara = requirements.split('\n\n')[0];
  return firstPara;
}

/**
 * Generate formatted approval message for specific platform
 */
function generateApprovalMessage(
  questName: string,
  description: string,
  requirements: string,
  design: string,
  platform: Platform
) {
  // Summary (always short)
  const summary = `Quest: ${questName}\n\nDescription: ${description}`;

  // Requirements highlights
  const requirementsHighlights = extractRequirementsHighlights(requirements);
  let requirementsSummary: string;
  if (platform === 'dashboard') {
    requirementsSummary = requirements;
  } else if (platform === 'discord') {
    requirementsSummary = truncateText(requirementsHighlights, PLATFORM_LIMITS.discord.field);
  } else {
    requirementsSummary = truncateText(requirementsHighlights, PLATFORM_LIMITS.slack.block);
  }

  // Design summary
  let designSummary: string;
  if (platform === 'dashboard') {
    designSummary = design;
  } else if (platform === 'discord') {
    designSummary = truncateText(design, PLATFORM_LIMITS.discord.field);
  } else {
    designSummary = truncateText(design, PLATFORM_LIMITS.slack.block);
  }

  // Estimates (placeholder until tasks are split)
  const estimates = 'Task breakdown pending (will be generated after approval)';

  return {
    summary,
    requirements: requirementsSummary,
    design: designSummary,
    estimates,
  };
}

/**
 * Handle quest_request_quest_approval tool call
 */
export async function handleQuestRequestQuestApproval(args: unknown) {
  // Validate input
  const input = args as QuestRequestQuestApprovalInput;

  if (!input.questId) {
    throw new Error('questId is required');
  }

  // Load quest
  let quest;
  try {
    quest = await QuestModel.load(input.questId);
  } catch (error) {
    throw new Error(`Quest not found: ${input.questId}`);
  }

  // Validate quest status
  if (quest.status !== 'draft') {
    throw new Error(
      `Quest must be in 'draft' status to request approval (current status: ${quest.status})`
    );
  }

  // Request approval
  const approvalState = await ApprovalModel.requestApproval(input.questId);

  // Generate platform-formatted message
  const message = generateApprovalMessage(
    quest.questName,
    quest.description,
    quest.requirements,
    quest.design,
    quest.conversationContext.platform
  );

  // Return result
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            approvalId: approvalState.questId, // Using questId as approvalId
            status: approvalState.status,
            requestedAt: approvalState.requestedAt,
            message,
            conversationContext: {
              platform: quest.conversationContext.platform,
              channelId: quest.conversationContext.channelId,
              threadId: quest.conversationContext.threadId,
              userId: quest.conversationContext.userId,
            },
            nextStep: `Quest is now pending human approval. Inform the user that the quest has been submitted for review and they can approve it in the dashboard. STOP here — do not call any more quest tools until the user confirms the quest is approved.`,
          },
          null,
          2
        ),
      },
    ],
  };
}
