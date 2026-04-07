/**
 * ability-file-remote — Remote File Sharing via Tunneling
 *
 * Provides remote file sharing through tunneling services and SSH/SCP operations:
 *
 * Tunnel tools (8): create_tunnel, destroy_tunnel, create_temporary_url,
 *   revoke_temporary_url, list_active_tunnels, list_active_urls,
 *   get_tunnel_status, shutdown.
 *
 * SSH remote tools (9): send_file_to_remote_server, download_file_from_remote,
 *   download_folder_from_remote, create_remote_folder, delete_remote_folder,
 *   move_remote_file_or_folder, copy_remote_file, copy_remote_folder,
 *   delete_remote_file.
 *
 * Security: Host allow-list validation, connection pooling.
 */

import { exec } from 'child_process';
import { KadiClient, z } from '@kadi.build/core';
import { TunnelProvider } from './src/providers/tunnelProvider.js';

// ============================================================================
// Host Allow-List Validation
// ============================================================================

const ALLOWED_HOSTS = (process.env.ALLOWED_HOSTS || '')
  .split(',')
  .map((h) => h.trim())
  .filter(Boolean);

function isHostAllowed(host: string): boolean {
  if (ALLOWED_HOSTS.length === 0) return true;
  return ALLOWED_HOSTS.some((allowed) => {
    if (allowed.includes('/')) {
      const prefix = allowed.split('/')[0];
      return host.startsWith(prefix.replace(/\.0$/, ''));
    }
    return host === allowed;
  });
}

// ============================================================================
// Connection Pool
// ============================================================================

class TunnelConnectionPool {
  readonly maxConnections: number;
  private active: Map<string, Record<string, unknown>>;

  constructor(maxConnections = 5) {
    this.maxConnections = maxConnections;
    this.active = new Map();
  }
  canCreate(): boolean { return this.active.size < this.maxConnections; }
  add(id: string, info: Record<string, unknown>): void { this.active.set(id, { ...info, pooledAt: Date.now() }); }
  remove(id: string): void { this.active.delete(id); }
  get(id: string): Record<string, unknown> | undefined { return this.active.get(id); }
  size(): number { return this.active.size; }
  list(): Record<string, unknown>[] {
    return Array.from(this.active.entries()).map(([id, info]) => ({
      tunnelId: id, ...info,
    }));
  }
  async drainAll(provider: any): Promise<number> {
    const ids = Array.from(this.active.keys());
    for (const id of ids) {
      try { await provider.destroyTunnel(id); } catch (_) { /* best-effort */ }
      this.active.delete(id);
    }
    return ids.length;
  }
}

// ============================================================================
// KadiClient + TunnelProvider
// ============================================================================

const brokerConfig: { url: string; networks?: string[] } = {
  url: process.env.KADI_BROKER_URL || 'ws://localhost:8080/kadi',
};
if (process.env.KADI_NETWORK) {
  brokerConfig.networks = [process.env.KADI_NETWORK];
}

const client = new KadiClient({
  name: 'ability-file-remote',
  brokers: { default: brokerConfig },
});

const tunnelConfig = {
  service: process.env.TUNNEL_SERVICE || 'localtunnel',
  fallbackServices: process.env.TUNNEL_FALLBACK_SERVICES || 'pinggy,serveo',
  autoFallback: process.env.TUNNEL_AUTO_FALLBACK !== 'false',
  localRoot: process.env.LOCAL_ROOT || process.cwd(),
  subdomain: process.env.TUNNEL_SUBDOMAIN || '',
  region: process.env.TUNNEL_REGION || 'us',
};

const tunnel = new TunnelProvider(tunnelConfig);
const pool = new TunnelConnectionPool(
  parseInt(process.env.MAX_TUNNELS || '5', 10)
);

// Track temporary URLs separately
const activeUrls = new Map();

// ============================================================================
// SSH Helper
// ============================================================================

function sshExec(cmd: string): Promise<{ success: boolean; message: string }> {
  return new Promise((resolve) => {
    exec(cmd, { timeout: 60_000 }, (err, _stdout, stderr) => {
      if (err) {
        const msg = stderr?.trim() || err.message;
        return resolve({ success: false, message: msg });
      }
      resolve({ success: true, message: 'OK' });
    });
  });
}

function buildKeyFlag(privateKey?: string): string {
  return privateKey ? `-i "${privateKey}" -o StrictHostKeyChecking=no` : '-o StrictHostKeyChecking=no';
}

const sshConnSchema = {
  username: z.string().describe('SSH username'),
  host: z.string().describe('SSH host'),
  privateKey: z.string().optional().describe('Path to SSH private key'),
};

// ============================================================================
// SSH REMOTE FILE TOOLS
// ============================================================================

// R1. Upload file to remote
client.registerTool({
  name: 'send_file_to_remote_server',
  description: 'Upload a file to a remote server via SCP',
  input: z.object({
    ...sshConnSchema,
    localFilePath: z.string().describe('Local file path'),
    remoteFilePath: z.string().describe('Remote destination path'),
  }),
}, async ({ username, host, localFilePath, remoteFilePath, privateKey }) => {
  if (!isHostAllowed(host)) return { success: false, message: `Host not allowed: ${host}` };
  const kf = buildKeyFlag(privateKey);
  return sshExec(`scp ${kf} "${localFilePath}" ${username}@${host}:"${remoteFilePath}"`);
});

// R2. Download file from remote
client.registerTool({
  name: 'download_file_from_remote',
  description: 'Download a file from a remote server via SCP',
  input: z.object({
    ...sshConnSchema,
    remoteFilePath: z.string().describe('Remote file path'),
    localFilePath: z.string().describe('Local destination path'),
  }),
}, async ({ username, host, remoteFilePath, localFilePath, privateKey }) => {
  if (!isHostAllowed(host)) return { success: false, message: `Host not allowed: ${host}` };
  const kf = buildKeyFlag(privateKey);
  return sshExec(`scp ${kf} ${username}@${host}:"${remoteFilePath}" "${localFilePath}"`);
});

// R3. Download folder from remote
client.registerTool({
  name: 'download_folder_from_remote',
  description: 'Download a folder from a remote server via SCP (recursive)',
  input: z.object({
    ...sshConnSchema,
    remoteFolderPath: z.string().describe('Remote folder path'),
    localFolderPath: z.string().describe('Local destination path'),
  }),
}, async ({ username, host, remoteFolderPath, localFolderPath, privateKey }) => {
  if (!isHostAllowed(host)) return { success: false, message: `Host not allowed: ${host}` };
  const kf = buildKeyFlag(privateKey);
  return sshExec(`scp -r ${kf} ${username}@${host}:"${remoteFolderPath}" "${localFolderPath}"`);
});

// R4. Create remote folder
client.registerTool({
  name: 'create_remote_folder',
  description: 'Create a folder on a remote server via SSH',
  input: z.object({
    ...sshConnSchema,
    remoteFolderPath: z.string().describe('Remote folder path to create'),
  }),
}, async ({ username, host, remoteFolderPath, privateKey }) => {
  if (!isHostAllowed(host)) return { success: false, message: `Host not allowed: ${host}` };
  const kf = buildKeyFlag(privateKey);
  return sshExec(`ssh ${kf} ${username}@${host} "mkdir -p '${remoteFolderPath}'"`);
});

// R5. Delete remote folder
client.registerTool({
  name: 'delete_remote_folder',
  description: 'Delete a folder on a remote server via SSH',
  input: z.object({
    ...sshConnSchema,
    remoteFolderPath: z.string().describe('Remote folder path to delete'),
  }),
}, async ({ username, host, remoteFolderPath, privateKey }) => {
  if (!isHostAllowed(host)) return { success: false, message: `Host not allowed: ${host}` };
  const kf = buildKeyFlag(privateKey);
  return sshExec(`ssh ${kf} ${username}@${host} "rm -rf '${remoteFolderPath}'"`);
});

// R6. Move/rename remote file or folder
client.registerTool({
  name: 'move_remote_file_or_folder',
  description: 'Move or rename a file/folder on a remote server via SSH',
  input: z.object({
    ...sshConnSchema,
    oldRemotePath: z.string().describe('Current remote path'),
    newRemotePath: z.string().describe('New remote path'),
  }),
}, async ({ username, host, oldRemotePath, newRemotePath, privateKey }) => {
  if (!isHostAllowed(host)) return { success: false, message: `Host not allowed: ${host}` };
  const kf = buildKeyFlag(privateKey);
  return sshExec(`ssh ${kf} ${username}@${host} "mv '${oldRemotePath}' '${newRemotePath}'"`);
});

// R7. Copy remote file
client.registerTool({
  name: 'copy_remote_file',
  description: 'Copy a file on a remote server via SSH',
  input: z.object({
    ...sshConnSchema,
    sourcePath: z.string().describe('Source file path on remote'),
    destinationPath: z.string().describe('Destination file path on remote'),
  }),
}, async ({ username, host, sourcePath, destinationPath, privateKey }) => {
  if (!isHostAllowed(host)) return { success: false, message: `Host not allowed: ${host}` };
  const kf = buildKeyFlag(privateKey);
  return sshExec(`ssh ${kf} ${username}@${host} "cp '${sourcePath}' '${destinationPath}'"`);
});

// R8. Copy remote folder
client.registerTool({
  name: 'copy_remote_folder',
  description: 'Copy a folder on a remote server via SSH (recursive)',
  input: z.object({
    ...sshConnSchema,
    sourcePath: z.string().describe('Source folder path on remote'),
    destinationPath: z.string().describe('Destination folder path on remote'),
  }),
}, async ({ username, host, sourcePath, destinationPath, privateKey }) => {
  if (!isHostAllowed(host)) return { success: false, message: `Host not allowed: ${host}` };
  const kf = buildKeyFlag(privateKey);
  return sshExec(`ssh ${kf} ${username}@${host} "cp -r '${sourcePath}' '${destinationPath}'"`);
});

// R9. Delete remote file
client.registerTool({
  name: 'delete_remote_file',
  description: 'Delete a file on a remote server via SSH',
  input: z.object({
    ...sshConnSchema,
    remoteFilePath: z.string().describe('Remote file path to delete'),
  }),
}, async ({ username, host, remoteFilePath, privateKey }) => {
  if (!isHostAllowed(host)) return { success: false, message: `Host not allowed: ${host}` };
  const kf = buildKeyFlag(privateKey);
  return sshExec(`ssh ${kf} ${username}@${host} "rm -f '${remoteFilePath}'"`);
});

// ============================================================================
// TUNNEL TOOLS
// ============================================================================

// 1. Create Tunnel
client.registerTool({
  name: 'create_tunnel',
  description: 'Create a tunnel for sharing a local server remotely',
  input: z.object({
    port: z.number().optional().describe('Local port to tunnel'),
    service: z.enum(['ngrok', 'localtunnel', 'serveo', 'localhost.run', 'pinggy'])
      .optional().describe('Tunnel service (default from env)'),
    subdomain: z.string().optional().describe('Custom subdomain'),
    authToken: z.string().optional().describe('Auth token for service'),
  }),
  output: z.object({
    success: z.boolean(),
    tunnelId: z.string().optional(),
    publicUrl: z.string().optional(),
    localPort: z.number().optional(),
    service: z.string().optional(),
    error: z.string().optional(),
  }),
}, async ({ port, service, subdomain, authToken }) => {
  if (!pool.canCreate()) {
    return { success: false, error: `Pool limit reached (${pool.maxConnections})` };
  }
  try {
    const result = await tunnel.createTunnel({
      port, service: service || tunnelConfig.service, subdomain, authToken,
    });
    pool.add(result.tunnelId, {
      publicUrl: result.publicUrl,
      localPort: result.localPort,
      service: result.service,
    });
    return { success: true, ...result };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

// 2. Destroy Tunnel
client.registerTool({
  name: 'destroy_tunnel',
  description: 'Destroy an active tunnel',
  input: z.object({
    tunnelId: z.string().describe('Tunnel ID to destroy'),
  }),
  output: z.object({ success: z.boolean(), message: z.string() }),
}, async ({ tunnelId }) => {
  try {
    await tunnel.destroyTunnel(tunnelId);
    pool.remove(tunnelId);
    return { success: true, message: `Tunnel destroyed: ${tunnelId}` };
  } catch (err: any) {
    return { success: false, message: `Error: ${err.message}` };
  }
});

// 3. Create Temporary URL
client.registerTool({
  name: 'create_temporary_url',
  description: 'Create a temporary shareable URL for a file',
  input: z.object({
    filePath: z.string().describe('File path to share'),
    expiresIn: z.string().optional().default('1h').describe('Expiration (e.g. "1h", "30m", "2d")'),
    maxDownloads: z.number().optional().describe('Max download count'),
    password: z.string().optional().describe('Password protection'),
  }),
  output: z.object({
    success: z.boolean(),
    urlId: z.string().optional(),
    publicUrl: z.string().optional(),
    expiresAt: z.string().optional(),
    accessCode: z.string().optional(),
    error: z.string().optional(),
  }),
}, async ({ filePath, expiresIn, maxDownloads, password }) => {
  try {
    const result = await tunnel.createTemporaryUrl(filePath, { expiresIn, maxDownloads, password });
    activeUrls.set(result.urlId, { publicUrl: result.publicUrl, expiresAt: result.expiresAt });
    return { success: true, ...result };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

// 4. Revoke Temporary URL
client.registerTool({
  name: 'revoke_temporary_url',
  description: 'Revoke a temporary shareable URL',
  input: z.object({
    urlId: z.string().describe('URL ID to revoke'),
  }),
  output: z.object({ success: z.boolean(), message: z.string() }),
}, async ({ urlId }) => {
  try {
    await tunnel.revokeTemporaryUrl(urlId);
    activeUrls.delete(urlId);
    return { success: true, message: `Temporary URL revoked: ${urlId}` };
  } catch (err: any) {
    return { success: false, message: `Error: ${err.message}` };
  }
});

// ============================================================================
// STATUS / UTILITY TOOLS
// ============================================================================

// 5. List Active Tunnels
client.registerTool({
  name: 'list_active_tunnels',
  description: 'List all active tunnels in the connection pool',
  input: z.object({}),
  output: z.object({
    success: z.boolean(),
    count: z.number(),
    tunnels: z.array(z.object({
      tunnelId: z.string(),
      publicUrl: z.string(),
      localPort: z.number(),
      service: z.string(),
    })),
  }),
}, async () => {
  const tunnels = pool.list();
  return { success: true, count: tunnels.length, tunnels };
});

// 6. List Active URLs
client.registerTool({
  name: 'list_active_urls',
  description: 'List all active temporary URLs',
  input: z.object({}),
  output: z.object({
    success: z.boolean(),
    count: z.number(),
    urls: z.array(z.object({
      urlId: z.string(),
      publicUrl: z.string(),
      expiresAt: z.string(),
    })),
  }),
}, async () => {
  const urls = Array.from(activeUrls.entries()).map(([id, info]) => ({
    urlId: id, ...info,
  }));
  return { success: true, count: urls.length, urls };
});

// 7. Get Tunnel Status
client.registerTool({
  name: 'get_tunnel_status',
  description: 'Get status of a specific tunnel',
  input: z.object({
    tunnelId: z.string().describe('Tunnel ID to check'),
  }),
  output: z.object({
    success: z.boolean(),
    exists: z.boolean(),
    info: z.object({
      tunnelId: z.string(),
      publicUrl: z.string(),
      localPort: z.number(),
      service: z.string(),
    }).optional(),
  }),
}, async ({ tunnelId }) => {
  const info = pool.get(tunnelId);
  if (!info) return { success: true, exists: false };
  return { success: true, exists: true, info: { tunnelId, ...info } };
});

// 8. Shutdown
client.registerTool({
  name: 'shutdown',
  description: 'Gracefully shutdown: destroy all tunnels, revoke URLs, cleanup',
  input: z.object({}),
  output: z.object({ success: z.boolean(), message: z.string() }),
}, async () => {
  const drained = await pool.drainAll(tunnel);
  activeUrls.clear();
  return { success: true, message: `Shutdown complete. ${drained} tunnels closed.` };
});

// ============================================================================
// Startup
// ============================================================================

export default client;

const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  const mode = (process.env.KADI_MODE || process.argv[2] || 'stdio') as 'stdio' | 'broker';
  console.log(`[ability-file-remote] Starting in ${mode} mode...`);
  console.log(`[ability-file-remote] Tunnel service: ${tunnelConfig.service}`);
  if (ALLOWED_HOSTS.length > 0) {
    console.log(`[ability-file-remote] Host allow-list: ${ALLOWED_HOSTS.join(', ')}`);
  }
  console.log(`[ability-file-remote] Registered 17 tools`);

  (async () => {
    await client.serve(mode);
  })();
}
