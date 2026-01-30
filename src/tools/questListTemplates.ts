/**
 * quest_list_templates MCP Tool
 * Lists available quest templates for rapid project creation
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { TemplateModel } from '../models/templateModel.js';

/**
 * Tool definition for MCP protocol
 */
export const questListTemplatesTool: Tool = {
  name: 'quest_list_templates',
  description: 'List available quest templates',
  inputSchema: {
    type: 'object',
    properties: {},
  },
};

/**
 * Handle quest_list_templates tool call
 */
export async function handleQuestListTemplates(_args: unknown) {
  // List all available templates
  const templates = await TemplateModel.listTemplates();
  
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            templates,
            total: templates.length,
            message:
              templates.length > 0
                ? `Found ${templates.length} template(s)`
                : 'No templates available',
          },
          null,
          2
        ),
      },
    ],
  };
}
