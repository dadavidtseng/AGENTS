/**
 * List Tools Utility Registration
 *
 * Provides a human-readable formatted list of all available tools (local + network).
 * This solves the UX problem where raw JSON tool schemas are unreadable in Slack.
 */

import { z } from '@kadi.build/core';
import type { KadiClient } from '@kadi.build/core';
import { logger, MODULE_AGENT, timer } from 'agents-library';

/**
 * Input schema for list_tools utility
 * No parameters needed - just lists all available tools
 */
export const listToolsInputSchema = z.object({});

/**
 * Output schema for list_tools utility (structured format)
 */
export const listToolsOutputSchema = z.object({
  status: z.enum(['complete', 'partial', 'error']).describe('Task completion status'),
  result: z.object({
    tools: z.array(z.object({
      name: z.string().describe('Tool name'),
      description: z.string().describe('Tool description')
    })).describe('Array of all available tools'),
    count: z.object({
      local: z.number().describe('Number of local tools'),
      network: z.number().describe('Number of network tools'),
      total: z.number().describe('Total number of tools')
    }).describe('Tool counts')
  }).describe('Structured tool listing data'),
  presentation: z.object({
    summary: z.string().describe('Short summary for quick reference'),
    details: z.string().describe('Full formatted tool list with descriptions'),
    format_hint: z.string().describe('Guidance for LLM on how to present this data to the user')
  }).describe('Presentation layer for LLM to customize output')
});

/** Inferred TypeScript type for list_tools output */
export type ListToolsOutput = z.infer<typeof listToolsOutputSchema>;

/**
 * Register list_tools utility
 *
 * @param client - KĀDI client instance
 */
export function registerListToolsTool(client: KadiClient): void {
  /**
   * List Tools Utility
   *
   * Provides a human-readable formatted list of all available tools (local + network).
   * This solves the UX problem where raw JSON tool schemas are unreadable in Slack.
   *
   * @returns Formatted markdown list of tools with names and descriptions
   *
   * @example
   * ```typescript
   * const result = await client.invokeTool('list_tools', {});
   * // Returns:
   * // {
   * //   summary: "I have 43 tools available:\n\n• *echo*: Echo text...\n• *git_add*: Stage files...",
   * //   tools: [{ name: 'echo', description: '...' }, ...]
   * // }
   * ```
   */
  client.registerTool({
    name: 'list_tools',
    description: 'List all available tools in human-readable format. This is a one-time operation that completes immediately. Do not retry on success.',
    input: listToolsInputSchema,
    output: listToolsOutputSchema
  }, async (): Promise<ListToolsOutput> => {
    logger.info(MODULE_AGENT, 'Listing all available tools', timer.elapsed('main'));

    try {
      // 1. Get local tools (registered on this agent)
      const localTools = client.readAgentJson().tools;

      // 2. Get network tools from broker
      let networkTools: Array<{ name: string; description: string }> = [];

      try {
        // Check if client is connected to any broker
        if (client.isConnected()) {
          // Use kadi-core v0.6.0+ API to discover tools from broker
          const response = await client.invokeRemote<{ tools: Array<{
            name: string;
            description?: string;
            inputSchema?: Record<string, unknown>;
            tags?: string[];
          }> }>('kadi.ability.list', { includeProviders: false });

          if (response?.tools && Array.isArray(response.tools)) {
            networkTools = response.tools.map(tool => ({
              name: tool.name,
              description: tool.description || 'No description'
            }));
            logger.debug(MODULE_AGENT, `Discovered ${networkTools.length} network tools from broker`, timer.elapsed('main'));
          }
        } else {
          logger.debug(MODULE_AGENT, 'No broker connection available for network tool discovery', timer.elapsed('main'));
        }
      } catch (error) {
        logger.warn(MODULE_AGENT, 'Failed to query network tools from broker (continuing with local tools only)', timer.elapsed('main'), error as Error | string);
      }

      // 3. Deduplicate: prefer local tools over network tools
      const localNames = new Set(localTools.map(t => t.name));
      const uniqueNetworkTools = networkTools.filter(t => !localNames.has(t.name));

      // 4. Combine all tools
      const allTools = [
        ...localTools.map(t => ({
          name: t.name,
          description: t.description || 'No description'
        })),
        ...uniqueNetworkTools.map(t => ({
          name: t.name,
          description: t.description || 'No description'
        }))
      ];

      // 5. Format structured output
      const toolCount = {
        local: localTools.length,
        network: uniqueNetworkTools.length,
        total: allTools.length
      };

      const details = allTools.map(t => `• *${t.name}*: ${t.description}`).join('\n');

      logger.info(MODULE_AGENT, `Listed ${allTools.length} tools (${localTools.length} local + ${uniqueNetworkTools.length} network)`, timer.elapsed('main'));

      return {
        status: 'complete',
        result: {
          tools: allTools,
          count: toolCount
        },
        presentation: {
          summary: `I have ${allTools.length} tools available (${localTools.length} local + ${uniqueNetworkTools.length} network).`,
          details: details,
          format_hint: 'Present the tool list according to the user\'s request. If they want names only, extract just the tool names. If they want full details, use the details field. If they want a specific format or filter, customize accordingly.'
        }
      };
    } catch (error: any) {
      logger.error(MODULE_AGENT, 'Error listing tools', "+0ms", error);

      // Fallback: return only local tools if broker query fails
      const localTools = client.readAgentJson().tools;
      const tools = localTools.map(t => ({
        name: t.name,
        description: t.description || 'No description'
      }));

      const details = tools.map(t => `• *${t.name}*: ${t.description}`).join('\n');

      return {
        status: 'complete',
        result: {
          tools: tools,
          count: {
            local: tools.length,
            network: 0,
            total: tools.length
          }
        },
        presentation: {
          summary: `Partial list (broker unavailable): ${tools.length} local tools available.`,
          details: details,
          format_hint: 'Present the tool list according to the user\'s request. Note: This is a partial list as network tools could not be retrieved.'
        }
      };
    }
  });
}