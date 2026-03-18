#!/usr/bin/env node
/**
 * MCP Server Entry Point
 * Runs the Model Context Protocol server for quest management tools.
 *
 * This entry point is designed for production use where the MCP stdio server
 * (for KĀDI broker integration) runs as a standalone process.
 * The dashboard UI is now served by the separate mcp-client-quest package.
 */

import { startMCPServer } from './mcp/server.js';
import { initQuestDataRepo } from './utils/git.js';
import { TemplateModel } from './models/templateModel.js';
import { config } from './utils/config.js';

async function main() {
  try {
    console.error('[Startup] Initializing mcp-server-quest...');
    console.error(`[Startup] Quest data directory: ${config.questDataDir}`);

    // Initialize quest data repository
    console.error('[Startup] Initializing Git repository...');
    await initQuestDataRepo(config.questDataDir);

    // Initialize quest templates
    console.error('[Startup] Initializing quest templates...');
    await TemplateModel.initBuiltInTemplates();

    // Start MCP server (this will keep the process alive via stdio)
    console.error('[Startup] Starting MCP server...');
    await startMCPServer();

    const transportType = process.env.MCP_TRANSPORT_TYPE || 'stdio';
    const port = process.env.MCP_PORT || '3100';
    console.error('[Startup] ✅ MCP server ready!');
    console.error(`[Startup] MCP: ${transportType} transport${transportType === 'http' ? ` → http://0.0.0.0:${port}/mcp` : ' (connected to KĀDI broker)'}`);
  } catch (error) {
    console.error('[Startup] ❌ Failed to start:', error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.error('\n[Shutdown] Received SIGINT, shutting down...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.error('\n[Shutdown] Received SIGTERM, shutting down...');
  process.exit(0);
});

main();
