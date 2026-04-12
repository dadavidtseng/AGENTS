/**
 * ability-file-cloud — Cloud File Operations
 *
 * Provides cloud storage operations (Dropbox, Google Drive, Box)
 * wrapped in KadiClient for native/stdio/broker transport.
 *
 * 22 tools total:
 *   - Core file ops (9): cloud-upload, cloud-download, cloud-delete, cloud-copy,
 *     cloud-list, cloud-mkdir, cloud-search, cloud-info, cloud-providers
 *   - Extra ops (6): cloud-rename, cloud-list-folders, cloud-delete-folder,
 *     cloud-rename-folder, cloud-test, cloud-configure
 *   - URL transfer (3): cloud-get-download-url, cloud-upload-from-url, cloud-download-to-url
 *   - OAuth (4): cloud-token-status, cloud-token-refresh, cloud-token-auth-url, cloud-token-exchange
 */

import { KadiClient, z } from '@kadi.build/core';
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
// @ts-ignore — JS modules without type declarations
import { CloudStorageManager } from './src/cloudStorageManager.js';
// @ts-ignore
import { ConfigManager } from './src/configManager.js';

// ============================================================================
// Load agent.json for broker URLs + metadata
// ============================================================================

const __dirname = dirname(fileURLToPath(import.meta.url));

// agent.json is at project root. When compiled (dist/index.js), __dirname is dist/
// so we need '..'. When running via tsx (index.ts at root), __dirname IS the root.
const agentJsonPath = existsSync(join(__dirname, 'agent.json'))
  ? join(__dirname, 'agent.json')
  : join(__dirname, '..', 'agent.json');
const agentJson = JSON.parse(
  readFileSync(agentJsonPath, 'utf8'),
) as { name: string; version: string; brokers?: Record<string, string> };

// ============================================================================
// KadiClient — broker URLs from agent.json
// ============================================================================

const client = new KadiClient({
  name: agentJson.name,
  version: agentJson.version,
  brokers: Object.fromEntries(
    Object.entries(agentJson.brokers ?? {}).map(([key, url]) => [key, { url }]),
  ),
});

// ============================================================================
// Manager (lazy init)
// ============================================================================

let manager: any;
async function getManager(): Promise<any> {
  if (!manager) {
    const config = new ConfigManager();
    await config.load(client); // pass KadiClient for secret-ability vault access
    manager = new CloudStorageManager(config);
  }
  return manager;
}

const providerEnum = z.enum(['dropbox', 'googledrive', 'box']);

// ============================================================================
// CORE FILE OPERATIONS (9 tools)
// ============================================================================

// 1. cloud-upload
client.registerTool({
  name: 'cloud-upload',
  description: 'Upload a file to cloud storage (Dropbox, Google Drive, Box)',
  input: z.object({
    provider: providerEnum.describe('Cloud provider'),
    localPath: z.string().describe('Local file path to upload'),
    remotePath: z.string().describe('Remote destination path'),
    createFolders: z.boolean().optional().describe('Auto-create parent folders (default: true)'),
  }),
}, async ({ provider, localPath, remotePath, createFolders }) => {
  try {
    const mgr = await getManager();
    if (createFolders !== false) {
      const path = await import('path');
      const dir = path.dirname(remotePath);
      if (dir && dir !== '/' && dir !== '.') {
        try { await mgr.createFolder(provider, dir); } catch (_e: any) { /* ignore if exists */ }
      }
    }
    const result = await mgr.uploadFile(provider, localPath, remotePath);
    return { success: true, result };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

// 2. cloud-download
client.registerTool({
  name: 'cloud-download',
  description: 'Download a file from cloud storage',
  input: z.object({
    provider: providerEnum,
    remotePath: z.string().describe('Remote file path'),
    localPath: z.string().describe('Local destination path'),
  }),
}, async ({ provider, remotePath, localPath }) => {
  try {
    const mgr = await getManager();
    await mgr.downloadFile(provider, remotePath, localPath);
    return { success: true, message: `Downloaded to ${localPath}` };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

// 3. cloud-delete
client.registerTool({
  name: 'cloud-delete',
  description: 'Delete a file from cloud storage',
  input: z.object({
    provider: providerEnum,
    path: z.string().describe('Remote file path to delete'),
    confirm: z.boolean().optional().describe('Safety confirmation flag'),
  }),
}, async ({ provider, path: remotePath, confirm }) => {
  try {
    if (confirm === false) {
      return { success: false, error: 'Delete not confirmed' };
    }
    const mgr = await getManager();
    await mgr.deleteFile(provider, remotePath);
    return { success: true, message: `Deleted ${remotePath}` };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

// 4. cloud-copy
client.registerTool({
  name: 'cloud-copy',
  description: 'Copy a file within cloud storage',
  input: z.object({
    provider: providerEnum,
    sourcePath: z.string().describe('Source file path'),
    destPath: z.string().describe('Destination file path'),
  }),
}, async ({ provider, sourcePath, destPath }) => {
  try {
    const mgr = await getManager();
    const result = await mgr.copyFile(provider, sourcePath, destPath);
    return { success: true, result };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

// 5. cloud-list
client.registerTool({
  name: 'cloud-list',
  description: 'List files in a cloud storage directory',
  input: z.object({
    provider: providerEnum,
    path: z.string().optional().describe('Remote directory path (default: "/")'),
    recursive: z.boolean().optional().describe('List recursively'),
  }),
}, async ({ provider, path: remotePath = '/', recursive }) => {
  try {
    const mgr = await getManager();
    const files = await mgr.listFiles(provider, remotePath, { recursive });
    return { success: true, files };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

// 6. cloud-mkdir
client.registerTool({
  name: 'cloud-mkdir',
  description: 'Create a folder in cloud storage',
  input: z.object({
    provider: providerEnum,
    path: z.string().describe('Remote folder path to create'),
  }),
}, async ({ provider, path: remotePath }) => {
  try {
    const mgr = await getManager();
    const result = await mgr.createFolder(provider, remotePath);
    return { success: true, result };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

// 7. cloud-search
client.registerTool({
  name: 'cloud-search',
  description: 'Search for files in cloud storage',
  input: z.object({
    provider: providerEnum,
    query: z.string().describe('Search query'),
    path: z.string().optional().describe('Directory to search in'),
    limit: z.number().optional().describe('Max results'),
  }),
}, async ({ provider, query, path: remotePath, limit }) => {
  try {
    const mgr = await getManager();
    const results = await mgr.searchFiles(provider, query, { path: remotePath, limit });
    return { success: true, results };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

// 8. cloud-info
client.registerTool({
  name: 'cloud-info',
  description: 'Get metadata about a file in cloud storage',
  input: z.object({
    provider: providerEnum,
    path: z.string().describe('Remote file path'),
  }),
}, async ({ provider, path: remotePath }) => {
  try {
    const mgr = await getManager();
    const fileInfo = await mgr.getFileInfo(provider, remotePath);
    return { success: true, fileInfo };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

// 9. cloud-providers
client.registerTool({
  name: 'cloud-providers',
  description: 'List available cloud storage providers and their status',
  input: z.object({}),
}, async () => {
  try {
    const mgr = await getManager();
    const services = mgr.config.getConfiguredServices();
    return { success: true, services };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

// ============================================================================
// EXTRA OPERATIONS (6 tools)
// ============================================================================

// 10. cloud-rename
client.registerTool({
  name: 'cloud-rename',
  description: 'Rename a file in cloud storage',
  input: z.object({
    provider: providerEnum,
    remotePath: z.string().describe('Current file path'),
    newName: z.string().describe('New file name'),
  }),
}, async ({ provider, remotePath, newName }) => {
  try {
    const mgr = await getManager();
    const result = await mgr.renameFile(provider, remotePath, newName);
    return { success: true, result };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

// 11. cloud-list-folders
client.registerTool({
  name: 'cloud-list-folders',
  description: 'List folders in a cloud storage directory',
  input: z.object({
    provider: providerEnum,
    path: z.string().optional().describe('Remote directory path (default: "/")'),
  }),
}, async ({ provider, path: remotePath = '/' }) => {
  try {
    const mgr = await getManager();
    const folders = await mgr.listFolders(provider, remotePath);
    return { success: true, folders };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

// 12. cloud-delete-folder
client.registerTool({
  name: 'cloud-delete-folder',
  description: 'Delete a folder from cloud storage',
  input: z.object({
    provider: providerEnum,
    path: z.string().describe('Remote folder path to delete'),
    recursive: z.boolean().optional().describe('Delete contents recursively'),
  }),
}, async ({ provider, path: remotePath, recursive = false }) => {
  try {
    const mgr = await getManager();
    await mgr.deleteFolder(provider, remotePath, recursive);
    return { success: true, message: `Deleted folder ${remotePath}` };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

// 13. cloud-rename-folder
client.registerTool({
  name: 'cloud-rename-folder',
  description: 'Rename a folder in cloud storage',
  input: z.object({
    provider: providerEnum,
    path: z.string().describe('Current folder path'),
    newName: z.string().describe('New folder name'),
  }),
}, async ({ provider, path: remotePath, newName }) => {
  try {
    const mgr = await getManager();
    const result = await mgr.renameFolder(provider, remotePath, newName);
    return { success: true, result };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

// 14. cloud-test
client.registerTool({
  name: 'cloud-test',
  description: 'Test connection to a cloud storage provider',
  input: z.object({
    provider: providerEnum,
  }),
}, async ({ provider }) => {
  try {
    const mgr = await getManager();
    const result = await mgr.testConnection(provider);
    return { success: true, result };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

// 15. cloud-configure
client.registerTool({
  name: 'cloud-configure',
  description: 'Configure credentials for a cloud storage provider. Pass credentials as JSON string.',
  input: z.object({
    provider: providerEnum,
    credentialsJson: z.string().describe('JSON string of credentials key-value pairs'),
  }),
}, async ({ provider, credentialsJson }) => {
  try {
    const credentials = JSON.parse(credentialsJson as string);
    const mgr = await getManager();
    // Set credentials directly on the manager's config (runtime only)
    for (const [key, value] of Object.entries(credentials)) {
      mgr.config.set(`${provider.toUpperCase()}_${key}`, String(value));
    }
    manager = null; // force re-init with new config on next call
    return { success: true, message: `Configured ${provider} (runtime only — persist via secrets.toml)` };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

// ============================================================================
// URL TRANSFER TOOLS (3 tools)
// ============================================================================

// 16. cloud-get-download-url
client.registerTool({
  name: 'cloud-get-download-url',
  description: 'Get a temporary download URL for a file in cloud storage',
  input: z.object({
    provider: providerEnum,
    remotePath: z.string().describe('Remote file path'),
  }),
}, async ({ provider, remotePath }) => {
  try {
    const mgr = await getManager();
    const result = await mgr.getDownloadUrl(provider, remotePath);
    return { success: true, ...result };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

// 17. cloud-upload-from-url
client.registerTool({
  name: 'cloud-upload-from-url',
  description: 'Download a file from a URL and upload it to cloud storage',
  input: z.object({
    provider: providerEnum,
    sourceUrl: z.string().describe('URL to download from'),
    remotePath: z.string().describe('Remote destination path'),
    authHeader: z.string().optional().describe('Authorization header for source URL'),
    createFolders: z.boolean().optional().describe('Auto-create parent folders'),
  }),
}, async ({ provider, sourceUrl, remotePath, authHeader, createFolders }) => {
  try {
    const mgr = await getManager();
    const result = await mgr.uploadFromUrl(provider, sourceUrl, remotePath, authHeader, createFolders);
    return { success: true, result };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

// 18. cloud-download-to-url
client.registerTool({
  name: 'cloud-download-to-url',
  description: 'Download a file from cloud storage and upload it to a target URL',
  input: z.object({
    provider: providerEnum,
    remotePath: z.string().describe('Remote file path'),
    targetUrl: z.string().describe('URL to upload to (HTTP PUT)'),
    authHeader: z.string().optional().describe('Authorization header for target URL'),
  }),
}, async ({ provider, remotePath, targetUrl, authHeader }) => {
  try {
    const mgr = await getManager();
    const result = await mgr.downloadToUrl(provider, remotePath, targetUrl, authHeader);
    return { success: true, result };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

// ============================================================================
// OAUTH TOKEN MANAGEMENT TOOLS (4 tools)
// ============================================================================

// 19. cloud-token-status
client.registerTool({
  name: 'cloud-token-status',
  description: 'Check token health and expiry for cloud providers',
  input: z.object({
    provider: providerEnum.optional().describe('Specific provider (omit for all)'),
    testConnection: z.boolean().optional().describe('Test connection after checking token'),
  }),
}, async ({ provider, testConnection }) => {
  try {
    const mgr = await getManager();
    const result = await mgr.getTokenStatus(provider, testConnection);
    return { success: true, ...result };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

// 20. cloud-token-refresh
client.registerTool({
  name: 'cloud-token-refresh',
  description: 'Force refresh OAuth access token for a cloud provider',
  input: z.object({
    provider: providerEnum,
    testAfterRefresh: z.boolean().optional().describe('Test connection after refresh'),
  }),
}, async ({ provider, testAfterRefresh }) => {
  try {
    const mgr = await getManager();
    const result = await mgr.refreshProviderToken(provider, testAfterRefresh);
    return { success: true, ...result };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

// 21. cloud-token-auth-url
client.registerTool({
  name: 'cloud-token-auth-url',
  description: 'Generate OAuth authorization URL for a cloud provider',
  input: z.object({
    provider: providerEnum,
    callbackUrl: z.string().optional().describe('OAuth callback URL'),
  }),
}, async ({ provider, callbackUrl }) => {
  try {
    const mgr = await getManager();
    const result = await mgr.generateAuthUrl(provider, callbackUrl);
    return { success: true, ...result };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

// 22. cloud-token-exchange
client.registerTool({
  name: 'cloud-token-exchange',
  description: 'Exchange OAuth authorization code for tokens',
  input: z.object({
    provider: providerEnum,
    code: z.string().describe('OAuth authorization code'),
    callbackUrl: z.string().optional().describe('OAuth callback URL'),
  }),
}, async ({ provider, code, callbackUrl }) => {
  try {
    const mgr = await getManager();
    const result = await mgr.exchangeCode(provider, code, callbackUrl);
    return { success: true, ...result };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

// ============================================================================
// Startup
// ============================================================================

export default client;

// Serve when run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const mode = process.argv.includes('stdio') ? 'stdio' : 'broker';
  console.log(`[file-cloud] Starting in ${mode} mode...`);
  client.serve(mode);
}
