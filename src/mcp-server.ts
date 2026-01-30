#!/usr/bin/env node
/**
 * MCP Server Entry Point
 * Runs the Model Context Protocol server for quest management tools
 * AND starts the dashboard server for human users
 *
 * This entry point is designed for production use where both:
 * - MCP stdio server (for KĀDI broker integration)
 * - Dashboard HTTP/WebSocket server (for human users)
 * run in the same process
 */

import { startMCPServer } from './mcp/server.js';
import { dashboardServer } from './dashboard/server.js';
import { initQuestDataRepo } from './utils/git.js';
import { TemplateModel } from './models/templateModel.js';
import { config } from './utils/config.js';

async function main() {
  try {
    console.log('[Startup] Initializing mcp-server-quest...');
    console.log(`[Startup] Quest data directory: ${config.questDataDir}`);

    // Initialize quest data repository
    console.log('[Startup] Initializing Git repository...');
    await initQuestDataRepo(config.questDataDir);

    // Initialize quest templates
    console.log('[Startup] Initializing quest templates...');
    await TemplateModel.initBuiltInTemplates();

    // Start dashboard server
    console.log('[Startup] Starting dashboard server...');
    await dashboardServer.start();

    // Start MCP server (this will keep the process alive via stdio)
    console.log('[Startup] Starting MCP server...');
    await startMCPServer();

    console.log('[Startup] ✅ All services ready!');
    console.log(`[Startup] Dashboard: http://${config.dashboardHost}:${config.dashboardPort}`);
    console.log(`[Startup] WebSocket: ws://${config.dashboardHost}:${config.dashboardPort}/ws`);
    console.log(`[Startup] MCP: stdio transport (connected to KĀDI broker)`);
  } catch (error) {
    console.error('[Startup] ❌ Failed to start:', error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n[Shutdown] Received SIGINT, shutting down gracefully...');
  await dashboardServer.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n[Shutdown] Received SIGTERM, shutting down gracefully...');
  await dashboardServer.stop();
  process.exit(0);
});

main();
