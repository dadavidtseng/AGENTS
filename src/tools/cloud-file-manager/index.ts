/**
 * Cloud File Manager Tools
 *
 * Tools that provide direct 1:1 mapping to cloud-file-manager-ability methods.
 * No proxy layers - direct calls to ability methods.
 *
 * Supports Dropbox, Google Drive, and Box cloud storage providers.
 *
 * @module tools/cloud-file-manager
 */

import type { KadiClient } from '@kadi.build/core';

// File operations
import { registerUploadFileTool } from './upload-file.js';
import { registerDownloadFileTool } from './download-file.js';
import { registerListFilesTool } from './list-files.js';
import { registerDeleteFileTool } from './delete-file.js';
import { registerRenameFileTool } from './rename-file.js';
import { registerCopyFileTool } from './copy-file.js';
import { registerGetFileInfoTool } from './get-file-info.js';

// Folder operations
import { registerCreateFolderTool } from './create-folder.js';
import { registerListFoldersTool } from './list-folders.js';
import { registerDeleteFolderTool } from './delete-folder.js';
import { registerRenameFolderTool } from './rename-folder.js';
import { registerGetFolderInfoTool } from './get-folder-info.js';

// Search and utility operations
import { registerSearchFilesTool } from './search-files.js';
import { registerTestConnectionTool } from './test-connection.js';
import { registerGetAvailableServicesTool } from './get-available-services.js';

// Re-export all registration functions
export {
  // File operations
  registerUploadFileTool,
  registerDownloadFileTool,
  registerListFilesTool,
  registerDeleteFileTool,
  registerRenameFileTool,
  registerCopyFileTool,
  registerGetFileInfoTool,
  // Folder operations
  registerCreateFolderTool,
  registerListFoldersTool,
  registerDeleteFolderTool,
  registerRenameFolderTool,
  registerGetFolderInfoTool,
  // Search and utility operations
  registerSearchFilesTool,
  registerTestConnectionTool,
  registerGetAvailableServicesTool
};

/**
 * Register all cloud-file-manager tools at once
 *
 * @param client - The KadiClient instance to register tools with
 */
export function registerAllCloudFileManagerTools(client: KadiClient) {
  // File operations (7 tools)
  registerUploadFileTool(client);
  registerDownloadFileTool(client);
  registerListFilesTool(client);
  registerDeleteFileTool(client);
  registerRenameFileTool(client);
  registerCopyFileTool(client);
  registerGetFileInfoTool(client);

  // Folder operations (5 tools)
  registerCreateFolderTool(client);
  registerListFoldersTool(client);
  registerDeleteFolderTool(client);
  registerRenameFolderTool(client);
  registerGetFolderInfoTool(client);

  // Search and utility operations (3 tools)
  registerSearchFilesTool(client);
  registerTestConnectionTool(client);
  registerGetAvailableServicesTool(client);
}

