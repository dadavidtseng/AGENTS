/**
 * MCP Server Quest - Main Entry Point
 * Initializes data directory and quest templates.
 *
 * The dashboard UI is now served by the separate mcp-client-quest package.
 * This entry point only bootstraps the data layer (Git repo + templates).
 */

import { initQuestDataRepo } from './utils/git.js';
import { TemplateModel } from './models/templateModel.js';
import { config } from './utils/config.js';

/**
 * Main server initialization
 */
async function main() {
  console.error('[Startup] Initializing mcp-server-quest...');
  console.error(`[Startup] Quest data directory: ${config.questDataDir}`);

  try {
    // Initialize quest data repository with Git
    console.error('[Startup] Initializing Git repository...');
    await initQuestDataRepo(config.questDataDir);

    // Initialize built-in quest templates
    console.error('[Startup] Initializing quest templates...');
    await TemplateModel.initBuiltInTemplates();

    console.error('[Startup] ✅ Data layer ready!');
  } catch (error) {
    console.error('[Startup] ❌ Failed to initialize:', error);
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

// Start initialization
main().catch((error) => {
  console.error('[Startup] Unhandled error:', error);
  process.exit(1);
});
