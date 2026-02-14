/**
 * @fileoverview MCP server factory.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { config } from '@/config/index.js';
import { registerAllTools } from '@/mcp-server/tools/tool-registration.js';
import { logger } from '@/utils/index.js';

export async function createMcpServerInstance(): Promise<McpServer> {
  const server = new McpServer(
    {
      name: config.mcpServerName,
      version: config.mcpServerVersion,
    },
    {
      capabilities: {
        logging: {},
        tools: { listChanged: true },
      },
    },
  );

  await registerAllTools(server);
  logger.info('MCP server instance created');

  return server;
}
