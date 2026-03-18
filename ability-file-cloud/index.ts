/**
 * ability-file-cloud — Cloud File Operations
 *
 * Provides cloud storage operations (Dropbox, Google Drive, Box)
 * wrapped in KadiClient for native/stdio/broker transport.
 */

import dotenv from 'dotenv';
dotenv.config();

import { KadiClient, z } from '@kadi.build/core';
// @ts-ignore — JS modules without type declarations
import { CloudStorageManager } from './src/cloudStorageManager.js';
// @ts-ignore
import { ConfigManager } from './src/configManager.js';

// ============================================================================
// KadiClient
// ============================================================================

const brokerConfig: Record<string, unknown> = {
  url: process.env.KADI_BROKER_URL || 'ws://localhost:8080/kadi',
};
if (process.env.KADI_NETWORK) {
  brokerConfig.networks = [process.env.KADI_NETWORK];
}

const client = new KadiClient({
  name: 'ability-file-cloud',
  brokers: { default: brokerConfig },
});

// ============================================================================
// Manager (lazy init)
// ============================================================================

let manager: any;
async function getManager(): Promise<any> {
  if (!manager) {
    const config = new ConfigManager();
    await config.load();
    manager = new CloudStorageManager(config);
  }
  return manager;
}

const serviceEnum = z.enum(['dropbox', 'googledrive', 'box']);

// ============================================================================
// FILE OPERATIONS
// ============================================================================

// 1. Upload file to cloud storage
client.registerTool({
  name: 'cloud_upload_file',
  description: 'Upload a file to cloud storage (Dropbox, Google Drive, Box)',
  input: z.object({
    serviceName: serviceEnum.describe('Cloud service name'),
    localPath: z.string().describe('Local file path to upload'),
    remotePath: z.string().describe('Remote destination path'),
  }),
}, async ({ serviceName, localPath, remotePath }) => {
  try {
    const mgr = await getManager();
    const result = await mgr.uploadFile(serviceName, localPath, remotePath);
    return { success: true, result };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

// 2. Download file from cloud storage
client.registerTool({
  name: 'cloud_download_file',
  description: 'Download a file from cloud storage',
  input: z.object({
    serviceName: serviceEnum,
    remotePath: z.string().describe('Remote file path'),
    localPath: z.string().describe('Local destination path'),
  }),
}, async ({ serviceName, remotePath, localPath }) => {
  try {
    const mgr = await getManager();
    await mgr.downloadFile(serviceName, remotePath, localPath);
    return { success: true, message: `Downloaded to ${localPath}` };
  } catch (err: any) {
    return { success: false, message: err.message };
  }
});

// 3. Get file info
client.registerTool({
  name: 'cloud_get_file_info',
  description: 'Get metadata about a file in cloud storage',
  input: z.object({
    serviceName: serviceEnum,
    remotePath: z.string().describe('Remote file path'),
  }),
}, async ({ serviceName, remotePath }) => {
  try {
    const mgr = await getManager();
    const fileInfo = await mgr.getFileInfo(serviceName, remotePath);
    return { success: true, fileInfo };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

// 4. List files in cloud storage
client.registerTool({
  name: 'cloud_list_files',
  description: 'List files in a cloud storage directory',
  input: z.object({
    serviceName: serviceEnum,
    remotePath: z.string().optional().describe('Remote directory path (default: "/")'),
  }),
}, async ({ serviceName, remotePath = '/' }) => {
  try {
    const mgr = await getManager();
    const files = await mgr.listFiles(serviceName, remotePath);
    return { success: true, files };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

// 5. Delete file
client.registerTool({
  name: 'cloud_delete_file',
  description: 'Delete a file from cloud storage',
  input: z.object({
    serviceName: serviceEnum,
    remotePath: z.string().describe('Remote file path to delete'),
  }),
}, async ({ serviceName, remotePath }) => {
  try {
    const mgr = await getManager();
    await mgr.deleteFile(serviceName, remotePath);
    return { success: true, message: `Deleted ${remotePath}` };
  } catch (err: any) {
    return { success: false, message: err.message };
  }
});

// 6. Rename file
client.registerTool({
  name: 'cloud_rename_file',
  description: 'Rename a file in cloud storage',
  input: z.object({
    serviceName: serviceEnum,
    remotePath: z.string().describe('Current file path'),
    newName: z.string().describe('New file name'),
  }),
}, async ({ serviceName, remotePath, newName }) => {
  try {
    const mgr = await getManager();
    const result = await mgr.renameFile(serviceName, remotePath, newName);
    return { success: true, result };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

// 7. Copy file
client.registerTool({
  name: 'cloud_copy_file',
  description: 'Copy a file within cloud storage',
  input: z.object({
    serviceName: serviceEnum,
    sourcePath: z.string().describe('Source file path'),
    destinationPath: z.string().describe('Destination file path'),
  }),
}, async ({ serviceName, sourcePath, destinationPath }) => {
  try {
    const mgr = await getManager();
    const result = await mgr.copyFile(serviceName, sourcePath, destinationPath);
    return { success: true, result };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

// ============================================================================
// FOLDER OPERATIONS
// ============================================================================

// 8. Create folder
client.registerTool({
  name: 'cloud_create_folder',
  description: 'Create a folder in cloud storage',
  input: z.object({
    serviceName: serviceEnum,
    remotePath: z.string().describe('Remote folder path to create'),
  }),
}, async ({ serviceName, remotePath }) => {
  try {
    const mgr = await getManager();
    const result = await mgr.createFolder(serviceName, remotePath);
    return { success: true, result };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

// 9. List folders
client.registerTool({
  name: 'cloud_list_folders',
  description: 'List folders in a cloud storage directory',
  input: z.object({
    serviceName: serviceEnum,
    remotePath: z.string().optional().describe('Remote directory path (default: "/")'),
  }),
}, async ({ serviceName, remotePath = '/' }) => {
  try {
    const mgr = await getManager();
    const folders = await mgr.listFolders(serviceName, remotePath);
    return { success: true, folders };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

// 10. Delete folder
client.registerTool({
  name: 'cloud_delete_folder',
  description: 'Delete a folder from cloud storage',
  input: z.object({
    serviceName: serviceEnum,
    remotePath: z.string().describe('Remote folder path to delete'),
    recursive: z.boolean().optional().describe('Delete contents recursively'),
  }),
}, async ({ serviceName, remotePath, recursive = false }) => {
  try {
    const mgr = await getManager();
    await mgr.deleteFolder(serviceName, remotePath, recursive);
    return { success: true, message: `Deleted folder ${remotePath}` };
  } catch (err: any) {
    return { success: false, message: err.message };
  }
});

// 11. Rename folder
client.registerTool({
  name: 'cloud_rename_folder',
  description: 'Rename a folder in cloud storage',
  input: z.object({
    serviceName: serviceEnum,
    remotePath: z.string().describe('Current folder path'),
    newName: z.string().describe('New folder name'),
  }),
}, async ({ serviceName, remotePath, newName }) => {
  try {
    const mgr = await getManager();
    const result = await mgr.renameFolder(serviceName, remotePath, newName);
    return { success: true, result };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

// 12. Search files
client.registerTool({
  name: 'cloud_search_files',
  description: 'Search for files in cloud storage',
  input: z.object({
    serviceName: serviceEnum,
    query: z.string().describe('Search query'),
    remotePath: z.string().optional().describe('Directory to search in'),
  }),
}, async ({ serviceName, query, remotePath }) => {
  try {
    const mgr = await getManager();
    const results = await mgr.searchFiles(serviceName, query, { path: remotePath });
    return { success: true, results };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

// ============================================================================
// UTILITY TOOLS
// ============================================================================

// 13. Test connection to a cloud service
client.registerTool({
  name: 'cloud_test_connection',
  description: 'Test connection to a cloud storage service',
  input: z.object({
    serviceName: serviceEnum,
  }),
}, async ({ serviceName }) => {
  try {
    const mgr = await getManager();
    const result = await mgr.testConnection(serviceName);
    return { success: true, result };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

// 14. Configure service credentials
client.registerTool({
  name: 'cloud_configure_service',
  description: 'Configure credentials for a cloud storage service. Pass credentials as JSON string, e.g. {"access_token":"..."}',
  input: z.object({
    serviceName: serviceEnum,
    credentialsJson: z.string().describe('JSON string of credentials key-value pairs'),
  }),
}, async ({ serviceName, credentialsJson }) => {
  try {
    const credentials = JSON.parse(credentialsJson as string);
    const config = new ConfigManager();
    await config.load();
    for (const [key, value] of Object.entries(credentials)) {
      config.set(`${serviceName}_${key}`, String(value));
    }
    await config.save();
    manager = null; // force re-init with new config
    return { success: true, message: `Configured ${serviceName}` };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

// 15. List configured services
client.registerTool({
  name: 'cloud_list_services',
  description: 'List available cloud storage services and their status',
  input: z.object({}),
}, async () => {
  try {
    const config = new ConfigManager();
    await config.load();
    const services = config.getConfiguredServices();
    return { success: true, services };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

// ============================================================================
// Startup
// ============================================================================

export default client;

const mode = process.env.KADI_MODE || process.argv[2] || 'stdio';
console.log(`[ability-file-cloud] Starting in ${mode} mode...`);
(async () => {
  await client.serve(mode);
})();
