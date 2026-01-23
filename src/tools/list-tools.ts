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
      // Get configuration from client
      const config = {
        networks: (client as any).networks || ['global']
      };

      // 1. Get local tools (registered on this agent)
      const localTools = client.getAllRegisteredTools();

      // 2. Get network tools from broker
      const protocol = client.getBrokerProtocol();
      const networkResult = await (protocol as any).connection.sendRequest({
        jsonrpc: '2.0',
        method: 'kadi.ability.list',
        params: {
          networks: config.networks,
          includeProviders: false
        },
        id: `list_tools_${Date.now()}`
      }) as {
        tools: Array<{
          name: string;
          description?: string;
        }>;
      };

      // 3. Deduplicate: prefer local tools over network tools
      const localNames = new Set(localTools.map(t => t.definition.name));
      const uniqueNetworkTools = networkResult.tools.filter(t => !localNames.has(t.name));

      // 4. Combine all tools
      const allTools = [
        ...localTools.map(t => ({
          name: t.definition.name,
          description: t.definition.description || 'No description'
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
      const localTools = client.getAllRegisteredTools();
      const tools = localTools.map(t => ({
        name: t.definition.name,
        description: t.definition.description || 'No description'
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
