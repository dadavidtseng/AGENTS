/**
 * Local Remote File Manager Tools
 *
 * Comprehensive file management tools using local-remote-file-manager-ability.
 * Provides 33 tools across 6 categories with native transport for development.
 */

import type { KadiClient } from '@kadi.build/core';

// File operations (11 tools)
import { registerUploadFile } from './upload-file.js';
import { registerDownloadFile } from './download-file.js';
import { registerGetFileInfo } from './get-file-info.js';
import { registerListFiles } from './list-files.js';
import { registerDeleteFile } from './delete-file.js';
import { registerRenameFile } from './rename-file.js';
import { registerCopyFile } from './copy-file.js';
import { registerMoveFile } from './move-file.js';
import { registerUploadMultipleFiles } from './upload-multiple-files.js';
import { registerDownloadMultipleFiles } from './download-multiple-files.js';
import { registerSearchFiles } from './search-files.js';

// Folder operations (7 tools)
import { registerCreateFolder } from './create-folder.js';
import { registerListFolders } from './list-folders.js';
import { registerDeleteFolder } from './delete-folder.js';
import { registerRenameFolder } from './rename-folder.js';
import { registerGetFolderInfo } from './get-folder-info.js';
import { registerCopyFolder } from './copy-folder.js';
import { registerMoveFolder } from './move-folder.js';

// Compression (4 tools)
import { registerCompressFile } from './compress-file.js';
import { registerDecompressFile } from './decompress-file.js';
import { registerCompressMultipleFiles } from './compress-multiple-files.js';
import { registerDecompressMultipleFiles } from './decompress-multiple-files.js';

// Watching (3 tools)
import { registerStartWatching } from './start-watching.js';
import { registerStopWatching } from './stop-watching.js';
import { registerStopAllWatching } from './stop-all-watching.js';

// Tunneling (4 tools)
import { registerCreateTunnel } from './create-tunnel.js';
import { registerDestroyTunnel } from './destroy-tunnel.js';
import { registerCreateTemporaryUrl } from './create-temporary-url.js';
import { registerRevokeTemporaryUrl } from './revoke-temporary-url.js';

// Utilities (4 tools)
import { registerTestConnection } from './test-connection.js';
import { registerValidateProvider } from './validate-provider.js';
import { registerGetUsageStats } from './get-usage-stats.js';
import { registerShutdown } from './shutdown.js';

// Re-export all registration functions
export {
  // File operations
  registerUploadFile,
  registerDownloadFile,
  registerGetFileInfo,
  registerListFiles,
  registerDeleteFile,
  registerRenameFile,
  registerCopyFile,
  registerMoveFile,
  registerUploadMultipleFiles,
  registerDownloadMultipleFiles,
  registerSearchFiles,
  // Folder operations
  registerCreateFolder,
  registerListFolders,
  registerDeleteFolder,
  registerRenameFolder,
  registerGetFolderInfo,
  registerCopyFolder,
  registerMoveFolder,
  // Compression
  registerCompressFile,
  registerDecompressFile,
  registerCompressMultipleFiles,
  registerDecompressMultipleFiles,
  // Watching
  registerStartWatching,
  registerStopWatching,
  registerStopAllWatching,
  // Tunneling
  registerCreateTunnel,
  registerDestroyTunnel,
  registerCreateTemporaryUrl,
  registerRevokeTemporaryUrl,
  // Utilities
  registerTestConnection,
  registerValidateProvider,
  registerGetUsageStats,
  registerShutdown
};

/**
 * Register all local-remote-file-manager tools at once
 *
 * @param client - The KadiClient instance to register tools with
 */
export function registerAllLocalRemoteFileManagerTools(client: KadiClient) {
  // File operations (11 tools)
  registerUploadFile(client);
  registerDownloadFile(client);
  registerGetFileInfo(client);
  registerListFiles(client);
  registerDeleteFile(client);
  registerRenameFile(client);
  registerCopyFile(client);
  registerMoveFile(client);
  registerUploadMultipleFiles(client);
  registerDownloadMultipleFiles(client);
  registerSearchFiles(client);

  // Folder operations (7 tools)
  registerCreateFolder(client);
  registerListFolders(client);
  registerDeleteFolder(client);
  registerRenameFolder(client);
  registerGetFolderInfo(client);
  registerCopyFolder(client);
  registerMoveFolder(client);

  // Compression (4 tools)
  registerCompressFile(client);
  registerDecompressFile(client);
  registerCompressMultipleFiles(client);
  registerDecompressMultipleFiles(client);

  // Watching (3 tools)
  registerStartWatching(client);
  registerStopWatching(client);
  registerStopAllWatching(client);

  // Tunneling (4 tools)
  registerCreateTunnel(client);
  registerDestroyTunnel(client);
  registerCreateTemporaryUrl(client);
  registerRevokeTemporaryUrl(client);

  // Utilities (4 tools)
  registerTestConnection(client);
  registerValidateProvider(client);
  registerGetUsageStats(client);
  registerShutdown(client);
}
