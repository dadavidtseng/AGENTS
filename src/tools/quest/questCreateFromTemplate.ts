/**
 * quest_create_from_template MCP Tool
 * Creates quests from predefined templates with variable substitution
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { QuestModel } from '../../models/questModel.js';
import { TemplateModel } from '../../models/templateModel.js';
import type { ConversationContext, Platform } from '../../types';

/**
 * Tool definition for MCP protocol
 */
export const questCreateFromTemplateTool: Tool = {
  name: 'quest_create_from_template',
  description: 'Create quest from predefined template with variable substitution',
  inputSchema: {
    type: 'object',
    properties: {
      templateName: {
        type: 'string',
        description: 'Template name to use',
      },
      variables: {
        type: 'object',
        description: 'Variables for template substitution (e.g., {"PROJECT_NAME": "MyApp"})',
        additionalProperties: {
          type: 'string',
        },
      },
      requestedBy: {
        type: 'string',
        description: 'User ID who requested the quest',
      },
      channel: {
        type: 'string',
        description: 'Channel ID where quest was requested',
      },
      platform: {
        type: 'string',
        enum: ['discord', 'slack', 'dashboard'],
        description: 'Platform where quest was requested',
      },
    },
    required: ['templateName', 'variables', 'requestedBy', 'channel', 'platform'],
  },
};

/**
 * Input parameters for quest_create_from_template tool
 */
interface QuestCreateFromTemplateInput {
  templateName: string;
  variables: Record<string, string>;
  requestedBy: string;
  channel: string;
  platform: Platform;
}

/**
 * Extract quest name from requirements document
 */
function extractQuestName(requirements: string): string {
  const match = requirements.match(/^#\s+(.+)$/m);
  if (match) {
    return match[1].trim();
  }
  const firstLine = requirements.split('\n')[0].trim();
  return firstLine.replace(/^#\s*/, '').slice(0, 100);
}

/**
 * Handle quest_create_from_template tool call
 */
export async function handleQuestCreateFromTemplate(args: unknown) {
  const input = args as QuestCreateFromTemplateInput;
  
  // Validate input
  if (!input.templateName) {
    throw new Error('templateName is required');
  }
  
  if (!input.variables) {
    throw new Error('variables is required');
  }
  
  if (typeof input.variables !== 'object' || Array.isArray(input.variables)) {
    throw new Error('variables must be an object');
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
  
  const validPlatforms: Platform[] = ['discord', 'slack', 'dashboard'];
  if (!validPlatforms.includes(input.platform)) {
    throw new Error(`platform must be one of: ${validPlatforms.join(', ')}`);
  }
  
  // Load template
  let template;
  try {
    template = await TemplateModel.loadTemplate(input.templateName);
  } catch (error) {
    throw new Error(`Template '${input.templateName}' not found`);
  }
  
  // Apply template with variables
  const applied = TemplateModel.applyTemplate(template, input.variables);
  
  // Extract quest name from applied requirements
  const questName = extractQuestName(applied.requirements);
  
  // Create conversation context
  const conversationContext: ConversationContext = {
    platform: input.platform,
    channelId: input.channel,
    userId: input.requestedBy,
  };
  
  // Create quest
  const quest = await QuestModel.create({
    questName,
    description: `Quest created from template: ${input.templateName}`,
    requirements: applied.requirements,
    design: applied.design,
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
            templateName: input.templateName,
            variablesApplied: Object.keys(input.variables).length,
            message: `Quest "${quest.questName}" created successfully from template "${input.templateName}"`,
          },
          null,
          2
        ),
      },
    ],
  };
}
