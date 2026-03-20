/**
 * Integration test — round-trip: index document -> query -> verify results.
 *
 * Requires:
 *   - KADI broker running at ws://localhost:8080/kadi
 *   - arcadedb-ability registered on broker
 *   - model-manager registered on broker with nomic-embed-text available
 *
 * Run: npm run test:integration
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { KadiClient } from '@kadi.build/core';

import { loadSearchConfig } from '../../src/lib/config.js';
import { registerIndexTools } from '../../src/tools/index-tools.js';
import { registerQueryTools } from '../../src/tools/query-tools.js';
import { registerCollectionTools } from '../../src/tools/collection-tools.js';

const TEST_COLLECTION = `test-search-${Date.now()}`;
const config = loadSearchConfig();
let client: KadiClient;

beforeAll(async () => {
  client = new KadiClient({
    name: 'search-ability-test',
    version: '0.0.1',
    brokers: { default: { url: 'ws://kadi.build:8080/kadi' } },
  });

  registerIndexTools(client, config);
  registerQueryTools(client, config);
  registerCollectionTools(client, config);

  await client.connect();
}, 30_000);

afterAll(async () => {
  // Cleanup: delete test collection
  try {
    await client.invokeRemote('arcade-command', {
      database: config.database,
      command: `DELETE FROM Chunk WHERE collection = '${TEST_COLLECTION}'`,
    });
  } catch {
    // Ignore cleanup errors
  }
  await client.disconnect();
}, 15_000);

describe('search round-trip', () => {
  it('indexes a markdown document', async () => {
    // invokeRemote calls our own registered tool via the broker
    const result = await client.invokeRemote<Record<string, unknown>>('search-index', {
      collection: TEST_COLLECTION,
      documents: [
        {
          source: 'test-doc.md',
          title: 'Test Document',
          content: `# Introduction

Reciprocal Rank Fusion (RRF) is a method for combining multiple ranked lists into a single ranking.

## Algorithm

The RRF score for a document d is computed as the sum over all rankings of 1/(k + rank).

## Applications

RRF is commonly used in hybrid search systems that combine keyword and semantic retrieval.`,
        },
      ],
      chunkStrategy: 'markdown-headers',
    });

    expect(result.indexed).toBe(true);
    expect(result.collection).toBe(TEST_COLLECTION);
    expect(result.chunks).toBeGreaterThan(0);
    expect(result.dimensions).toBeGreaterThan(0);
  }, 120_000);

  it('finds relevant chunks via hybrid search', async () => {
    const result = await client.invokeRemote<Record<string, unknown>>('search-query', {
      collection: TEST_COLLECTION,
      query: 'rank fusion algorithm',
      mode: 'hybrid',
      limit: 5,
    });

    expect(result.results).toBeDefined();
    expect(result.count).toBeGreaterThan(0);
    expect(result.mode).toBe('hybrid');

    const results = result.results as Array<{ content: string }>;
    const hasRelevant = results.some(
      (r) =>
        r.content.toLowerCase().includes('rrf') ||
        r.content.toLowerCase().includes('rank'),
    );
    expect(hasRelevant).toBe(true);
  }, 60_000);

  it('finds similar chunks', async () => {
    const queryResult = await client.invokeRemote<Record<string, unknown>>('search-query', {
      collection: TEST_COLLECTION,
      query: 'algorithm',
      mode: 'semantic',
      limit: 1,
    });

    const results = queryResult.results as Array<{ chunkId: string }>;
    expect(results.length).toBeGreaterThan(0);
    const chunkId = results[0].chunkId;

    const result = await client.invokeRemote<Record<string, unknown>>('search-similar', {
      collection: TEST_COLLECTION,
      chunkId,
      limit: 5,
    });

    expect(result.results).toBeDefined();
    expect(result.sourceChunk).toBe(chunkId);
  }, 60_000);

  it('lists collection stats', async () => {
    const result = await client.invokeRemote<Record<string, unknown>>('search-collections', {});
    expect(result.collections).toBeDefined();

    const collections = result.collections as Array<{ name: string; chunks: number }>;
    const testCol = collections.find((c) => c.name === TEST_COLLECTION);
    expect(testCol).toBeDefined();
    expect(testCol!.chunks).toBeGreaterThan(0);
  }, 30_000);

  it('gets collection info with sources', async () => {
    const result = await client.invokeRemote<Record<string, unknown>>('search-collection-info', {
      collection: TEST_COLLECTION,
    });

    expect(result.collection).toBe(TEST_COLLECTION);
    expect(result.chunks).toBeGreaterThan(0);
    expect(result.sources).toContain('test-doc.md');
  }, 30_000);

  it('clears collection with reindex', async () => {
    const result = await client.invokeRemote<Record<string, unknown>>('search-reindex', {
      collection: TEST_COLLECTION,
    });

    expect(result.collection).toBe(TEST_COLLECTION);
    expect(result.deleted).toBeGreaterThan(0);

    // Verify collection is empty
    const info = await client.invokeRemote<Record<string, unknown>>('search-collection-info', {
      collection: TEST_COLLECTION,
    });
    expect(info.chunks).toBe(0);
  }, 30_000);
});
