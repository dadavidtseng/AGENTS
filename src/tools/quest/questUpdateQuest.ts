/**
 * quest_update_quest MCP Tool
 * Revises quest requirements and design with pre-generated revised content
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { QuestModel } from '../../models/questModel.js';

/**
 * Tool definition for MCP protocol
 */
export const questUpdateQuestTool: Tool = {
  name: 'quest_update_quest',
  description: 'Revise quest requirements and design with pre-generated revised content',
  inputSchema: {
    type: 'object',
    properties: {
      questId: {
        type: 'string',
        description: 'Quest ID to revise',
      },
      feedback: {
        type: 'string',
        description: 'Revision feedback from human reviewer',
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
    required: ['questId', 'feedback', 'revisedRequirements', 'revisedDesign'],
  },
};

/**
 * Input parameters for quest_update_quest tool
 */
interface QuestUpdateQuestInput {
  questId: string;
  feedback: string;
  revisedRequirements: string;
  revisedDesign: string;
}

/**
 * Handle quest_update_quest tool call
 */
export async function handleQuestUpdateQuest(args: unknown) {
  // Validate input
  const input = args as QuestUpdateQuestInput;

  if (!input.questId) {
    throw new Error('questId is required');
  }
  if (!input.feedback) {
    throw new Error('feedback is required');
  }
  if (input.feedback.trim().length === 0) {
    throw new Error('feedback cannot be empty');
  }
  if (!input.revisedRequirements) {
    throw new Error('revisedRequirements is required');
  }
  if (!input.revisedDesign) {
    throw new Error('revisedDesign is required');
  }

  // Save revision with pre-generated content
  const revisedQuest = await QuestModel.revise(
    input.questId,
    input.feedback,
    input.revisedRequirements,
    input.revisedDesign
  );

  // Return result
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            success: true,
            questId: revisedQuest.questId,
            questName: revisedQuest.questName,
            revisionNumber: revisedQuest.revisionNumber,
            updatedAt: revisedQuest.updatedAt,
            message: `Quest "${revisedQuest.questName}" revised successfully (revision #${revisedQuest.revisionNumber})`,
          },
          null,
          2
        ),
      },
    ],
  };
}
