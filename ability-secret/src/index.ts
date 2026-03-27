/**
 * Secret Ability - Encrypted secrets for KADI
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

import { KadiClient } from '@kadi.build/core';
import { disconnectAllProviders } from './providers/index.js';
import { registerTools } from './tools.js';

const client = new KadiClient({
  name: 'secret-ability',
  version: '0.5.0',
});

client.onDisconnect(async () => {
  await disconnectAllProviders();
});

// Register all tools
registerTools(client);

export default client;

// Serve when run directly
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  const mode = process.argv[2] === 'broker' ? 'broker' : 'stdio';
  await client.serve(mode);
}
