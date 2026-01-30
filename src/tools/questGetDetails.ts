/**
 * quest_get_details MCP Tool
 * Retrieves complete quest details including all documents and tasks
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { QuestModel } from '../models/questModel.js';

/**
 * Tool definition for MCP protocol
 */
export const questGetDetailsTool: Tool = {
  name: 'quest_get_details',
  description: 'Get complete quest details including requirements, design documents, and tasks',
  inputSchema: {
    type: 'object',
    properties: {
      questId: {
        type: 'string',
        description: 'Quest ID (UUID) to retrieve',
      },
    },
    required: ['questId'],
  },
};

/**
 * Input parameters for quest_get_details tool
 */
interface QuestGetDetailsInput {
  questId: string;
}

/**
 * Handle quest_get_details tool call
 */
export async function handleQuestGetDetails(args: unknown) {
  // Validate input
  const input = args as QuestGetDetailsInput;

  if (!input.questId) {
    throw new Error('questId is required');
  }

  if (typeof input.questId !== 'string') {
    throw new Error('questId must be a string');
  }

  // Validate UUID format (basic check)
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(input.questId)) {
    throw new Error('questId must be a valid UUID');
  }

  try {
    // Load quest using QuestModel (this will throw if not found)
    const quest = await QuestModel.load(input.questId);

    // Return complete Quest object with all fields
    // Note: Dates are converted to ISO strings for JSON serialization
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              questId: quest.questId,
              questName: quest.questName,
              description: quest.description,
              status: quest.status,
              requirements: quest.requirements,
              design: quest.design,
              tasks: quest.tasks.map((task) => ({
                ...task,
                createdAt: typeof task.createdAt === 'string' 
                  ? task.createdAt 
                  : task.createdAt.toISOString(),
                updatedAt: typeof task.updatedAt === 'string' 
                  ? task.updatedAt 
                  : task.updatedAt.toISOString(),
              })),
              approvalHistory: quest.approvalHistory.map((approval) => ({
                ...approval,
                timestamp: typeof approval.timestamp === 'string' 
                  ? approval.timestamp 
                  : approval.timestamp.toISOString(),
              })),
              conversationContext: quest.conversationContext,
              createdAt: typeof quest.createdAt === 'string' 
                ? quest.createdAt 
                : quest.createdAt.toISOString(),
              updatedAt: typeof quest.updatedAt === 'string' 
                ? quest.updatedAt 
                : quest.updatedAt.toISOString(),
              revisionNumber: quest.revisionNumber,
            },
            null,
            2
          ),
        },
      ],
    };
  } catch (error) {
    // Provide clear error message
    if (error instanceof Error) {
      if (error.message.includes('ENOENT') || error.message.includes('does not exist')) {
        throw new Error(`Quest with ID '${input.questId}' not found`);
      }
      throw new Error(`Failed to load quest: ${error.message}`);
    }
    throw new Error(`Failed to load quest: ${String(error)}`);
  }
}
