/**
 * search-ability — KADI ability that provides chunking, embedding, and hybrid
 * search over text content via 8 broker-callable tools.
 *
 * Tools are grouped into three categories:
 *   - Index      (search-index, search-index-file, search-reindex, search-delete)
 *   - Query      (search-query, search-similar)
 *   - Collection (search-collections, search-collection-info)
 *
 * All persistence goes through arcadedb-ability. All embeddings come from
 * model-manager. search-ability is a pure intermediary.
 *
 * Convention Section 6 compliance:
 *   Config  → config.yml walk-up (chunk_size, embedding_model, database, etc.)
 *   Secrets → secrets.toml vault "models" walk-up (SEARCH_API_KEY, SEARCH_EMBEDDING_API_URL)
 *   Env var overrides for both systems
 *
 * Broker URL resolution order:
 *   1. BROKER_URL env var
 *   2. agent.json → brokers.default (walk-up)
 */

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

import { KadiClient } from '@kadi.build/core';

import { loadSearchConfigWithVault } from './lib/config.js';
import { ensureDatabase } from './lib/schema.js';
import { registerCollectionTools } from './tools/collection-tools.js';
import { registerIndexTools } from './tools/index-tools.js';
import { registerQueryTools } from './tools/query-tools.js';

// ── Read broker config from agent.json ────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadAgentJson(): Record<string, any> {
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
const agentJson = loadAgentJson();

const client = new KadiClient({
  name: agentJson.name ?? 'search-ability',
  version: agentJson.version ?? '0.1.0',
  brokers: {
    default: { url: brokerUrl },
  },
});

export default client;

// ── Main: async init + connect + validate ─────────────────────────────

async function main(): Promise<void> {
  // 1. Load config with vault credentials (async — needs loadNative)
  console.log('[search-ability] Loading configuration…');
  const config = await loadSearchConfigWithVault(client);

  // 2. Register all 8 tools (before connect)
  registerIndexTools(client, config);
  registerQueryTools(client, config);
  registerCollectionTools(client, config);
  console.log('[search-ability] 8 tools registered');

  // 3. Connect to broker (resolves once handshake is complete)
  const mode = process.argv.includes('stdio') ? 'stdio' : 'broker';
  console.log(`[search-ability] Starting in ${mode} mode → ${brokerUrl}`);

  if (mode === 'stdio') {
    // stdio mode — serve() is the only option (redirects stdin/stdout)
    await client.serve('stdio');
    return;
  }

  // Broker mode — connect, then validate, then keep alive
  await client.connect();
  console.log('[search-ability] Connected to broker.');

  // 4. Startup validation: ensure ArcadeDB database + schema exist.
  //    Non-fatal — if arcadedb-ability is unavailable, tools will try
  //    lazy ensureSchema() on first request.
  await ensureDatabase(client, config.database);

  // 5. Keep process alive (replicate what serve('broker') does internally)
  await new Promise(() => {});
}

// ── Graceful shutdown ─────────────────────────────────────────────────

function forceExit(): void {
  console.log('[search-ability] Shutting down…');
  client.disconnect?.().catch(() => {});
  setTimeout(() => {
    console.log('[search-ability] Force exit');
    process.exit(0);
  }, 3000).unref();
}

process.on('SIGINT', forceExit);
process.on('SIGTERM', forceExit);

// ── Run ───────────────────────────────────────────────────────────────

main().catch((err) => {
  console.error('[search-ability] Fatal error:', err?.message ?? err);
  process.exit(1);
});
