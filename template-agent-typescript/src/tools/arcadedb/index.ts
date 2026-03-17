/**
 * ArcadeDB Tools - Entry Point
 *
 * Exports all ArcadeDB tool registration functions.
 */

import type { KadiClient } from '@kadi.build/core';

// Container Management
export {
  registerStartContainerTool,
  registerStopContainerTool,
  registerGetContainerStatusTool,
} from './container-tools.js';

// Database Management
export {
  registerCreateDatabaseTool,
  registerListDatabasesTool,
  registerDropDatabaseTool,
} from './database-tools.js';

// Backup & Restore
export {
  registerCreateBackupTool,
  registerRestoreBackupTool,
  registerListBackupsTool,
} from './backup-tools.js';

// Import & Export
export {
  registerImportDataTool,
  registerExportDataTool,
} from './import-export-tools.js';

import {
  registerStartContainerTool,
  registerStopContainerTool,
  registerGetContainerStatusTool,
} from './container-tools.js';

import {
  registerCreateDatabaseTool,
  registerListDatabasesTool,
  registerDropDatabaseTool,
} from './database-tools.js';

import {
  registerCreateBackupTool,
  registerRestoreBackupTool,
  registerListBackupsTool,
} from './backup-tools.js';

import {
  registerImportDataTool,
  registerExportDataTool,
} from './import-export-tools.js';

/**
 * Register all ArcadeDB tools at once
 *
 * @param client - The KadiClient instance to register tools with
 */
export function registerAllArcadeDbTools(client: KadiClient) {
  // Container Management (3 tools)
  registerStartContainerTool(client);
  registerStopContainerTool(client);
  registerGetContainerStatusTool(client);

  // Database Management (3 tools)
  registerCreateDatabaseTool(client);
  registerListDatabasesTool(client);
  registerDropDatabaseTool(client);

  // Backup & Restore (3 tools)
  registerCreateBackupTool(client);
  registerRestoreBackupTool(client);
  registerListBackupsTool(client);

  // Import & Export (2 tools)
  registerImportDataTool(client);
  registerExportDataTool(client);
}
