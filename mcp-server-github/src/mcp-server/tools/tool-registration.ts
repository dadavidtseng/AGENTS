/**
 * @fileoverview Tool registry — registers all tools with the MCP server.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { allToolDefinitions } from '@/mcp-server/tools/definitions/index.js';
import { createMcpToolHandler } from '@/mcp-server/tools/utils/toolHandlerFactory.js';
import { logger } from '@/utils/index.js';

export async function registerAllTools(server: McpServer): Promise<void> {
  for (const toolDef of allToolDefinitions) {
    // Use type assertion for heterogeneous tool definitions
    const def = toolDef as {
      name: string;
      description: string;
      inputSchema: { shape: Record<string, unknown> };
      logic: (input: any, appContext: any, sdkContext: any) => Promise<any>;
      responseFormatter?: (result: any) => any[];
    };

    const handler = createMcpToolHandler({
      toolName: def.name,
      logic: def.logic,
      responseFormatter: def.responseFormatter,
    });

    server.tool(
      def.name,
      def.description,
      def.inputSchema.shape,
      handler,
    );

    logger.debug(`Registered tool: ${def.name}`);
  }

  logger.info(`Registered ${allToolDefinitions.length} tool(s)`);
}
