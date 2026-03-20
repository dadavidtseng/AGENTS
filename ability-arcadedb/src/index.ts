/**
 * arcadedb-ability -- KADI ability that exposes ArcadeDB as 17 broker-callable tools.
 *
 * Tools are grouped into five categories:
 *   - Container  (start, stop, status, health)
 *   - Database   (create, list, info, drop, stats)
 *   - Query      (query, command, batch)
 *   - Data       (import, export)
 *   - Backup     (backup, restore, cleanup)
 */

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

import { KadiClient } from '@kadi.build/core';

import { createManagers } from './lib/arcade-admin.js';
import { loadArcadeConfig } from './lib/config.js';
import { ArcadeHttpClient } from './lib/http-client.js';
import { registerBackupTools } from './tools/backup.js';
import { registerContainerTools } from './tools/container.js';
import { registerDataTools } from './tools/data.js';
import { registerDatabaseTools } from './tools/database.js';
import { registerQueryTools } from './tools/query.js';

/** Load agent.json from the project root (one level up from src/). */
const __dirname = dirname(fileURLToPath(import.meta.url));
const agentJson = JSON.parse(
  readFileSync(join(__dirname, '..', 'agent.json'), 'utf8'),
) as { name: string; version: string; brokers: Record<string, string> };

const config = loadArcadeConfig();
const httpClient = new ArcadeHttpClient(config);
const managers = createManagers(config);

const client = new KadiClient({
  name: agentJson.name,
  version: agentJson.version,
  brokers: Object.fromEntries(
    Object.entries(agentJson.brokers).map(([key, url]) => [key, { url }]),
  ),
});

registerContainerTools(client, managers, httpClient);
registerDatabaseTools(client, managers);
registerQueryTools(client, httpClient);
registerDataTools(client, managers);
registerBackupTools(client, managers);

export default client;

// Serve when run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const mode = process.argv[2] === 'broker' ? 'broker' : 'stdio';
  client.serve(mode);
}
