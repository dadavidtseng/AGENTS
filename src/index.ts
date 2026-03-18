#!/usr/bin/env node
/**
 * @fileoverview Entry point for the GitHub MCP Server.
 * Follows the same startup pattern as mcp-server-git.
 */

// Disable ANSI colors in STDIO mode (MCP spec requirement)
const transportType = process.env.MCP_TRANSPORT_TYPE?.toLowerCase();
const isStdioMode = !transportType || transportType === 'stdio';
if (isStdioMode) {
  process.env.NO_COLOR = '1';
  process.env.FORCE_COLOR = '0';
}

import 'reflect-metadata';
import { composeContainer } from '@/container/index.js';
import { createMcpServerInstance } from '@/mcp-server/server.js';
import { startTransport } from '@/mcp-server/transports/manager.js';
import { logger } from '@/utils/index.js';
import { config } from '@/config/index.js';

async function main(): Promise<void> {
  logger.info('============================================================');
  logger.info(`Starting ${config.mcpServerName} v${config.mcpServerVersion}`);
  logger.info('============================================================');
  logger.info(`Transport: ${config.mcpTransportType}`);
  logger.info(`GitHub API: ${config.githubHost || config.githubApiUrl}`);
  logger.info(`Token: ${config.githubToken ? '***' + config.githubToken.slice(-4) : 'NOT SET'}`);
  logger.info('');

  // Initialize DI container
  composeContainer();

  // Create MCP server with all tools registered
  const server = await createMcpServerInstance();

  // Start the selected transport
  // For HTTP, pass the factory so each session gets a fresh server instance
  await startTransport(server, createMcpServerInstance);
}

// Graceful shutdown
const shutdown = (signal: string) => {
  logger.info(`${signal} received, shutting down...`);
  process.exit(0);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('uncaughtException', (error) => {
  logger.error({ error: error.message, stack: error.stack }, 'Uncaught exception');
  process.exit(1);
});

main().catch((error) => {
  // In STDIO mode, write to stderr
  if (isStdioMode) {
    process.stderr.write(`Fatal: ${error.message}\n`);
  } else {
    logger.error({ error: error.message }, 'Fatal startup error');
  }
  process.exit(1);
});
