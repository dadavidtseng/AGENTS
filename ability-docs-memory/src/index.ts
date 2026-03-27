/**
 * ability-docs-memory — Documentation search engine built on graph-ability.
 *
 * Crawls, chunks, indexes, and searches documentation with 4-signal hybrid
 * recall including structural navigation (NEXT_SECTION + REFERENCES edges).
 *
 * Adapted from kadi-docs-memory-ability for the AGENTS ecosystem.
 * Default collection: 'agents-docs', database: 'agents_memory'.
 *
 * Supports three deployment modes:
 *   1. Native library  — `loadNative('ability-docs-memory')` → tools in-process
 *   2. Remote library   — `invokeRemote('docs-search', ...)` via broker
 *   3. CLI `kadi run`   — connects to broker and serves tools to other agents
 *
 * Tools:
 *   - docs-search       — 4-signal hybrid search over DocNode vertices
 *   - docs-reindex      — Full reindex pipeline: crawl → chunk → batch-store
 *   - docs-page         — Fetch a single documentation page by slug
 *   - docs-index-status — Index statistics: counts, health, last indexed time
 */

import { existsSync, readFileSync, realpathSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

import { KadiClient, type LoadedAbility } from '@kadi.build/core';

import { loadDocsConfigWithVault, type DocsConfig } from './lib/config.js';
import type { SignalAbilities } from './lib/graph-types.js';
import { registerSearchTool } from './tools/search.js';
import { registerReindexTool } from './tools/reindex.js';
import { registerPageTool } from './tools/page.js';
import { registerIndexStatusTool } from './tools/index-status.js';
import { DOCNODE_SCHEMA } from './lib/schema.js';

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
  const defaultKey = agent.defaultBroker ?? Object.keys(brokers)[0];
  const entry = brokers[defaultKey];
  if (typeof entry === 'string') return entry;
  if (entry?.url) return entry.url;

  return 'ws://localhost:8080/kadi';
}

// ── Build the client ──────────────────────────────────────────────────

const brokerUrl = resolveBrokerUrl();
const agentJson = loadAgentJson();

const client = new KadiClient({
  name: agentJson.name ?? 'ability-docs-memory',
  version: agentJson.version ?? '0.0.1',
  brokers: {
    default: { url: brokerUrl },
  },
});

// ── Async initialization (top-level await) ────────────────────────────

console.log('[ability-docs-memory] Loading configuration…');
const config: DocsConfig = await loadDocsConfigWithVault(client);

console.log('[ability-docs-memory] Loading graph-ability…');
let graphAbility: LoadedAbility | null = null;
try {
  graphAbility = await client.loadNative('graph-ability', { timeout: 0 });
  console.log('[ability-docs-memory] graph-ability loaded');
} catch (err: any) {
  console.warn(
    '[ability-docs-memory] graph-ability native load failed, continuing:',
    err?.message ?? err,
  );
}

const LONG_RUNNING_TOOLS = new Set(['graph-batch-store']);
const abilities: SignalAbilities = {
  invoke: <T>(tool: string, params: Record<string, unknown>) => {
    if (!graphAbility) {
      throw new Error('graph-ability not loaded — cannot invoke tools');
    }
    const opts = LONG_RUNNING_TOOLS.has(tool) ? { timeout: 0 } : undefined;
    return graphAbility.invoke<T>(tool, params, opts);
  },
};

// Register all 4 docs-* tools
registerSearchTool(client, config, abilities);
registerReindexTool(client, config, abilities);
registerPageTool(client, config, abilities);
registerIndexStatusTool(client, config, abilities);
console.log('[ability-docs-memory] All docs-* tools registered');

// ── CLI entry point ───────────────────────────────────────────────────

function detectIsMainModule(): boolean {
  const thisFile = fileURLToPath(import.meta.url);
  const argv1 = process.argv[1];
  if (!argv1) return false;

  if (import.meta.url === `file://${argv1}`) return true;

  try {
    const resolvedThis = realpathSync(thisFile);
    const resolvedArgv = realpathSync(resolve(argv1));
    return resolvedThis === resolvedArgv;
  } catch {
    return false;
  }
}

const isMainModule = detectIsMainModule();
if (isMainModule) {
  const mode = process.argv.includes('stdio') ? 'stdio' : 'broker';
  console.log(`[ability-docs-memory] Starting in ${mode} mode → ${brokerUrl}`);

  if (mode === 'stdio') {
    await client.serve('stdio');
  } else {
    console.log('[ability-docs-memory] Serving via broker.');

    try {
      await client.connect();
      console.log(`[ability-docs-memory] Connected to broker: ${brokerUrl}`);
    } catch (err: any) {
      console.warn('[ability-docs-memory] Broker connection failed:', err?.message ?? err);
    }

    // Register schema via native graph-ability
    try {
      console.log('[ability-docs-memory] Registering DocNode schema…');
      const schemaResult = await abilities.invoke('graph-schema-register', {
        name: DOCNODE_SCHEMA.name,
        vertexTypes: DOCNODE_SCHEMA.vertexTypes,
        edgeTypes: DOCNODE_SCHEMA.edgeTypes,
        entityTypes: DOCNODE_SCHEMA.entityTypes,
        database: config.database,
      });
      console.log('[ability-docs-memory] DocNode schema registered:', schemaResult);
    } catch (err: any) {
      console.warn('[ability-docs-memory] Schema registration deferred:', err?.message ?? err);
    }

    // Keep process alive
    await new Promise(() => {});
  }
}

// ── Graceful shutdown ─────────────────────────────────────────────────

function forceExit(): void {
  console.log('[ability-docs-memory] Shutting down…');
  client.disconnect?.().catch(() => {});
  setTimeout(() => {
    console.log('[ability-docs-memory] Force exit');
    process.exit(0);
  }, 3000).unref();
}

process.on('SIGINT', forceExit);
process.on('SIGTERM', forceExit);

// ── Exports ───────────────────────────────────────────────────────────

export default client;

export { DOCNODE_SCHEMA, DOCNODE_VERTEX, NEXT_SECTION_EDGE, REFERENCES_EDGE } from './lib/schema.js';
export { loadDocsConfig, loadDocsConfigWithVault, type DocsConfig } from './lib/config.js';
export {
  chunkByMarkdownHeaders,
  estimateTokens,
  splitIntoMarkdownSections,
  splitAtSentenceBoundary,
  splitToFitTokenLimit,
  type DocChunk,
} from './lib/chunker.js';
export {
  parseLlmsTxt,
  slugFromUrl,
  slugFromHeading,
  splitIntoPages,
  parseHeadings,
  extractSections,
  fetchPage,
  stripHtml,
  type PageDocument,
  type ParsedHeading,
  type ContentSection,
} from './lib/crawler.js';
export {
  parseMarkdownLinks,
  parseAllMarkdownLinks,
  normalizeTargetToSlug,
  resolveRelativeUrl,
  extractCrossDocReferences,
  type MarkdownLink,
  type CrossDocReference,
} from './lib/references.js';
