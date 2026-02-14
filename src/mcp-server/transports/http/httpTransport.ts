/**
 * @fileoverview HTTP transport for MCP server using Hono + @hono/mcp.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPTransport } from '@hono/mcp';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { config } from '@/config/index.js';
import { logger } from '@/utils/index.js';

export async function startHttpTransport(server: McpServer): Promise<void> {
  const app = new Hono();

  app.use('*', cors());

  app.get('/healthz', (c) => c.json({ status: 'ok', server: config.mcpServerName }));

  app.all('/mcp', async (c) => {
    const transport = new StreamableHTTPTransport({ sessionIdGenerator: undefined });
    await server.connect(transport);

    const response = await transport.handleRequest(c);
    if (response) return response;
    return c.body(null, 204);
  });

  serve(
    { fetch: app.fetch, port: config.mcpHttpPort, hostname: config.mcpHttpHost },
    () => {
      logger.info(`MCP Server listening on http://${config.mcpHttpHost}:${config.mcpHttpPort}/mcp`);
    },
  );
}
