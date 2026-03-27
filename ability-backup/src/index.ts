/**
 * backup-ability — entry point.
 *
 * Pure orchestrator: composes backup/restore pipelines from broker tools.
 * Supports both co-located and distributed deployment topologies with
 * automatic detection.
 *
 * Tools registered:
 *   1. backup-database  — backup pipeline (export → compress → upload)
 *   2. backup-list      — list available cloud backups for restoration
 *   3. backup-restore   — reverse pipeline (download → decompress → restore)
 *   4. backup-schedule  — create/remove in-memory periodic schedules
 *   5. backup-status    — list schedules and recent cloud backups
 *
 * Dependencies (broker):
 *   - arcade-backup / arcade-restore / arcade-db-info  (arcadedb-ability)
 *   - cloud-upload / cloud-download      (cloud-storage-ability, co-located)
 *   - cloud-upload-from-url / cloud-download-to-url  (distributed fallback)
 *   - file-compress / file-decompress    (file-manager)
 *   - secret-get                         (secret-ability)
 *   - cloud-list                         (cloud-storage-ability)
 *
 * Direct npm dependencies:
 *   - @kadi.build/core         (KadiClient, Zod)
 *   - @kadi.build/file-sharing (FileSharingServer for staging)
 *   - @kadi.build/tunnel-services (KĀDI tunnel client)
 *
 * Convention Section 6 compliance:
 *   Config  → config.yml walk-up (tunnel, backup sections)
 *   Secrets → secrets.toml vault "tunnel" walk-up (KADI_TUNNEL_TOKEN)
 *   Env var overrides for both systems
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { KadiClient } from '@kadi.build/core';
import { loadConfig } from './lib/config.js';
import { createStagingServer, type StagingServer } from './lib/staging-server.js';
import { clearAllSchedules } from './lib/scheduler.js';
import { registerBackupTool } from './tools/backup.js';
import { registerListTool } from './tools/list.js';
import { registerRestoreTool } from './tools/restore.js';
import { registerScheduleTool } from './tools/schedule.js';
import { registerStatusTool } from './tools/status.js';
import { startDashboardServer } from './server.js';

// ── Broker URL resolution ─────────────────────────────────────────────

function loadAgentJson(): Record<string, any> {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  let dir = __dirname;
  while (true) {
    try {
      const candidate = join(dir, 'agent.json');
      const content = readFileSync(candidate, 'utf8');
      return JSON.parse(content);
    } catch {
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return {};
}

function resolveBrokerUrl(): string {
  if (process.env.BROKER_URL) return process.env.BROKER_URL;

  const agent = loadAgentJson();
  const brokers = agent.brokers ?? {};
  const defaultBroker = brokers.default;
  if (typeof defaultBroker === 'string') return defaultBroker;
  if (defaultBroker?.url) return defaultBroker.url;

  throw new Error(
    'No broker URL found. Set BROKER_URL env var or add brokers.default to agent.json.',
  );
}

// ── Build the client ──────────────────────────────────────────────────

const brokerUrl = resolveBrokerUrl();

const client = new KadiClient({
  name: 'backup-ability',
  version: '0.1.0',
  brokers: {
    default: { url: brokerUrl },
  },
});

// ── Lazy staging server factory ───────────────────────────────────────
//
// The staging server is only created when distributed mode is detected
// (Rule 5: lazy start).  Tunnel token is loaded from vault on first use.
//

// ── Secret-ability native loader ──────────────────────────────────────

interface SecretAbilityInstance {
  invoke(tool: string, params: Record<string, unknown>): Promise<{ value?: string }>;
  disconnect(): Promise<void>;
}

let secretAbility: SecretAbilityInstance | null = null;

async function loadSecretAbility(): Promise<SecretAbilityInstance | null> {
  if (secretAbility) return secretAbility;
  try {
    secretAbility = await client.loadNative('secret-ability') as SecretAbilityInstance;
    console.log('[backup-ability] secret-ability loaded natively');
    return secretAbility;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[backup-ability] Could not load secret-ability: ${msg}`);
    return null;
  }
}

/** Read a single secret from a vault via the native secret-ability. */
async function getSecretFromVault(
  ability: SecretAbilityInstance,
  key: string,
  vault: string,
): Promise<string | undefined> {
  try {
    const result = await ability.invoke('get', { vault, key });
    return result?.value || undefined;
  } catch {
    return undefined;
  }
}

let cachedStagingServer: StagingServer | null = null;

async function getStagingServer(): Promise<StagingServer> {
  if (cachedStagingServer?.isRunning) return cachedStagingServer;

  // Load tunnel config from config.yml
  const tunnelConfig = loadConfig('tunnel', 'KADI_TUNNEL');
  const backupConfig = loadConfig('backup', 'BACKUP');

  // Load tunnel token from env var or vault via secret-ability
  let tunnelToken: string | undefined;
  tunnelToken = process.env.KADI_TUNNEL_TOKEN || undefined;

  if (!tunnelToken && secretAbility) {
    tunnelToken = await getSecretFromVault(secretAbility, 'KADI_TUNNEL_TOKEN', 'backup');
    if (!tunnelToken) {
      tunnelToken = await getSecretFromVault(secretAbility, 'KADI_TUNNEL_TOKEN', 'tunnel');
    }
    if (tunnelToken) {
      console.log('[backup-ability] Tunnel token loaded from vault');
    }
  }

  if (!tunnelToken) {
    console.warn('[backup-ability] Could not load tunnel token from env or vault');
    console.warn('[backup-ability] Staging server will operate without tunnel (local only)');
  }

  cachedStagingServer = createStagingServer(tunnelConfig, backupConfig, tunnelToken);
  return cachedStagingServer;
}

// ── Register all 4 tools (before connect) ─────────────────────────────

registerBackupTool(client, getStagingServer);
registerListTool(client);
registerRestoreTool(client, getStagingServer);
registerScheduleTool(client);
registerStatusTool(client);
console.log('[backup-ability] 5 tools registered');

// ── Default export for loadNative ─────────────────────────────────────
export default client;

// ── Main: run as a service ────────────────────────────────────────────

async function main(): Promise<void> {
  const mode = process.argv.includes('stdio') ? 'stdio' : 'broker';
  console.log(`[backup-ability] Starting in ${mode} mode → ${brokerUrl}`);

  // Load secret-ability natively for vault access
  await loadSecretAbility();

  // Start the web dashboard server (pass secret getter for auth)
  const dashboardPort = parseInt(process.env.DASHBOARD_PORT ?? '80', 10);
  try {
    const secretGetter = secretAbility
      ? (key: string, vault: string) => getSecretFromVault(secretAbility!, key, vault)
      : undefined;
    const dashboard = await startDashboardServer(client, { port: dashboardPort, getSecret: secretGetter });
    console.log(`[backup-ability] Dashboard available at http://0.0.0.0:${dashboard.port}`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[backup-ability] Dashboard server failed to start: ${msg}`);
    console.warn('[backup-ability] Agent will continue without web dashboard');
  }

  // serve() connects + keeps the process alive + handles SIGTERM/SIGINT
  await client.serve(mode as 'stdio' | 'broker');
}

// Graceful shutdown
function shutdown() {
  console.log('[backup-ability] Shutting down…');
  clearAllSchedules();

  // Stop cached staging server if running
  if (cachedStagingServer?.isRunning) {
    cachedStagingServer.stop().catch(() => {});
  }

  setTimeout(() => {
    console.log('[backup-ability] Force exit');
    process.exit(0);
  }, 3000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

main().catch((err) => {
  console.error('[backup-ability] Fatal error:', err.message ?? err);
  process.exit(1);
});
