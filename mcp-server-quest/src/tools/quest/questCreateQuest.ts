/**
 * quest_create_quest MCP Tool
 * Creates new quests with pre-generated or template-based requirements and design documents
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { QuestModel } from '../../models/questModel.js';
import { TemplateModel } from '../../models/templateModel.js';
import type { ConversationContext, Platform } from '../../types/index.js';

/**
 * Tool definition for MCP protocol
 */
export const questCreateQuestTool: Tool = {
  name: 'quest_create_quest',
  description: 'Create a new quest with pre-generated or template-based requirements and design documents',
  inputSchema: {
    type: 'object',
    properties: {
      questName: {
        type: 'string',
        description: 'Name of the quest',
      },
      description: {
        type: 'string',
        description: 'Quest description - what needs to be built',
      },
      requirements: {
        type: 'string',
        description: 'Pre-generated requirements document (Markdown format). Required if templateName is not provided.',
      },
      design: {
        type: 'string',
        description: 'Pre-generated design document (Markdown format). Required if templateName is not provided.',
      },
      requestedBy: {
        type: 'string',
        description: 'User ID of the requester',
      },
      channel: {
        type: 'string',
        description: 'Channel ID where the quest was requested',
      },
      platform: {
        type: 'string',
        enum: ['discord', 'slack', 'dashboard'],
        description: 'Platform where the quest was requested',
      },
      templateName: {
        type: 'string',
        description: 'Optional template name to use. If provided, requirements and design will be generated from template.',
      },
    },
    required: ['description', 'requestedBy', 'channel', 'platform'],
  },
};

/**
 * Input parameters for quest_create_quest tool
 */
interface QuestCreateQuestInput {
  questName?: string;
  description: string;
  requirements?: string;
  design?: string;
  requestedBy: string;
  channel: string;
  platform: Platform;
  templateName?: string;
}

/**
 * Extract quest name from requirements document
 */
function extractQuestName(requirements: string): string {
  // Try to find project name in first heading
  const match = requirements.match(/^#\s+(.+)$/m);
  if (match) {
    return match[1].trim();
  }

  // Fallback: use first line
  const firstLine = requirements.split('\n')[0].trim();
  return firstLine.replace(/^#\s*/, '').slice(0, 100);
}

/**
 * Handle quest_create_quest tool call
 */
export async function handleQuestCreateQuest(args: unknown) {
  // Validate input
  const input = args as QuestCreateQuestInput;

  if (!input.description) {
    throw new Error('description is required');
  }
  if (!input.requestedBy) {
    throw new Error('requestedBy is required');
  }
  if (!input.channel) {
    throw new Error('channel is required');
  }
  if (!input.platform) {
    throw new Error('platform is required');
  }
  if (!['discord', 'slack', 'dashboard'].includes(input.platform)) {
    throw new Error('platform must be one of: discord, slack, dashboard');
  }

  let requirements: string;
  let design: string;
  let questName: string;

  // Use template or pre-generated content
  if (input.templateName) {
    // Use template
    const template = await TemplateModel.loadTemplate(input.templateName);
    const applied = TemplateModel.applyTemplate(template, {
      DESCRIPTION: input.description,
    });
    requirements = applied.requirements;
    design = applied.design;
    questName = input.questName || extractQuestName(requirements);
  } else {
    // Use pre-generated content from caller
    if (!input.requirements || !input.design) {
      throw new Error('requirements and design are required when templateName is not provided');
    }
    requirements = input.requirements;
    design = input.design;
    questName = input.questName || extractQuestName(requirements);
  }

  // Create conversation context
  const conversationContext: ConversationContext = {
    platform: input.platform,
    channelId: input.channel,
    userId: input.requestedBy,
  };

  // Create quest
  const quest = await QuestModel.create({
    questName,
    description: input.description,
    requirements,
    design,
    conversationContext,
  });

  // Return result
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            questId: quest.questId,
            questName: quest.questName,
            status: quest.status,
            message: `Quest "${quest.questName}" created successfully`,
            nextStep: `Now call quest_request_quest_approval with questId "${quest.questId}" to submit this quest for human review. Do NOT proceed to task splitting until the quest is approved.`,
          },
          null,
          2
        ),
      },
    ],
  };
}
