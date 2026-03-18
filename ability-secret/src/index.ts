/**
 * ability-secret — Encrypted secret management for KĀDI agents
 *
 * Tools available:
 *   - config.read, config.createVault, config.destroyVault
 *   - vault.fromJson, vault.fromEnv
 *   - get, set, list, delete, exists
 *   - encrypt, decrypt, key.init, key.delete
 *   - remote.get, remote.set, remote.list, remote.delete
 *   - remote.share, remote.revoke, remote.listShared, remote.getShared
 *   - remote.auditLogs
 *
 * See tools.ts for implementation details.
 */

import 'dotenv/config';
import { pathToFileURL } from 'url';
import { KadiClient } from '@kadi.build/core';
import { disconnectAllProviders } from './providers/index.js';
import { registerTools } from './tools.js';

const client = new KadiClient({
  name: 'ability-secret',
  version: '0.7.0',
  description: 'Encrypted secret management for KĀDI agents',
  ...(process.env.KADI_BROKER_URL && {
    brokers: {
      default: {
        url: process.env.KADI_BROKER_URL,
        ...(process.env.KADI_NETWORK && {
          networks: [process.env.KADI_NETWORK]
        })
      }
    }
  })
});

client.onDisconnect(async () => {
  await disconnectAllProviders();
});

// Register all 23 tools
registerTools(client);

export default client;

// Auto-serve when run directly
const scriptPath = pathToFileURL(process.argv[1]).href;
if (import.meta.url === scriptPath) {
  const mode = (process.env.KADI_MODE || 'stdio') as any;

  if (mode === 'stdio') {
    console.error(`[ability-secret] Starting in ${mode} mode...`);
  } else {
    console.log(`[ability-secret] Starting in ${mode} mode...`);
  }

  client.serve(mode).catch((error: Error) => {
    console.error('[ability-secret] Failed to start:', error);
    process.exit(1);
  });
}
