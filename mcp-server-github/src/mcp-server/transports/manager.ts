/**
 * @fileoverview Transport manager — selects and starts the appropriate transport.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { config } from '@/config/index.js';
import { startStdioTransport } from '@/mcp-server/transports/stdio/stdioTransport.js';
import { startHttpTransport } from '@/mcp-server/transports/http/httpTransport.js';
import { logger } from '@/utils/index.js';

export async function startTransport(
  server: McpServer,
  serverFactory?: () => Promise<McpServer>,
): Promise<void> {
  if (config.mcpTransportType === 'http') {
    logger.info('Starting HTTP transport...');
    await startHttpTransport(serverFactory ?? (async () => server));
  } else {
    logger.info('Starting STDIO transport...');
    await startStdioTransport(server);
  }
}
