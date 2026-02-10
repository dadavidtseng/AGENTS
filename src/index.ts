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
  console.log('[Startup] Initializing mcp-server-quest...');
  console.log(`[Startup] Quest data directory: ${config.questDataDir}`);

  try {
    // Initialize quest data repository with Git
    console.log('[Startup] Initializing Git repository...');
    await initQuestDataRepo(config.questDataDir);

    // Initialize built-in quest templates
    console.log('[Startup] Initializing quest templates...');
    await TemplateModel.initBuiltInTemplates();

    console.log('[Startup] ✅ Data layer ready!');
  } catch (error) {
    console.error('[Startup] ❌ Failed to initialize:', error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[Shutdown] Received SIGINT, shutting down...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n[Shutdown] Received SIGTERM, shutting down...');
  process.exit(0);
});

// Start initialization
main().catch((error) => {
  console.error('[Startup] Unhandled error:', error);
  process.exit(1);
});
