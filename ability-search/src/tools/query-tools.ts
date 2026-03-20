/**
 * Query tools — search-query, search-similar
 *
 * These tools search indexed content via semantic, keyword, or hybrid modes.
 */

import { KadiClient, z } from '@kadi.build/core';

import type { SearchConfig } from '../lib/config.js';
import {
  hybridSearch,
  keywordSearch,
  semanticSearch,
  similarSearch,
  type SearchMode,
} from '../lib/searcher.js';

export function registerQueryTools(
  client: KadiClient,
  config: SearchConfig,
): void {
  // ---- search-query ---------------------------------------------------------

  client.registerTool(
    {
      name: 'search-query',
      description:
        'Search a collection using semantic, keyword, or hybrid mode. Default mode is hybrid (combines both with Reciprocal Rank Fusion).',
      input: z.object({
        collection: z.string().describe('Collection to search'),
        query: z.string().describe('Search query text'),
        limit: z.number().optional().describe('Max results (default: 10)'),
        mode: z
          .string()
          .optional()
          .describe('Search mode: semantic, keyword, or hybrid (default: hybrid)'),
        model: z
          .string()
          .optional()
          .describe('Embedding model for semantic search (default: from config)'),
      }),
    },
    async (input) => {
      try {
        const database = config.database;
        const limit = input.limit ?? 10;
        const mode = (input.mode ?? 'hybrid') as SearchMode;
        const model = input.model ?? config.embeddingModel;

        let results;
        switch (mode) {
          case 'semantic':
            results = await semanticSearch(
              client, database, input.collection, input.query, limit, model,
              { transport: config.embeddingTransport, apiUrl: config.embeddingApiUrl, apiKey: config.apiKey },
            );
            break;
          case 'keyword':
            results = await keywordSearch(
              client, database, input.collection, input.query, limit,
            );
            break;
          case 'hybrid':
            results = await hybridSearch(
              client, database, input.collection, input.query, limit, model,
              { transport: config.embeddingTransport, apiUrl: config.embeddingApiUrl, apiKey: config.apiKey },
            );
            break;
          default:
            return {
              success: false,
              error: `[search-query] Unknown search mode: "${mode}" for collection "${input.collection}"`,
              tool: 'search-query',
              collection: input.collection,
              hint: 'Valid modes are "semantic", "keyword", or "hybrid" (default: hybrid).',
            };
        }

        return {
          results,
          count: results.length,
          query: input.query,
          collection: input.collection,
          mode,
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          success: false,
          error: `[search-query] Failed to search collection "${input.collection}" (mode: ${input.mode ?? 'hybrid'}, query: "${input.query.slice(0, 100)}"): ${message}`,
          tool: 'search-query',
          collection: input.collection,
          mode: input.mode ?? 'hybrid',
          hint: 'This tool requires arcadedb-ability (for queries) and model-manager (for embedding the query in semantic/hybrid mode) on the broker. Also verify the collection exists and has been indexed via search-index.',
        };
      }
    },
  );

  // ---- search-similar -------------------------------------------------------

  client.registerTool(
    {
      name: 'search-similar',
      description:
        'Find chunks similar to a given chunk using its embedding vector. Useful for "more like this" features.',
      input: z.object({
        collection: z.string().describe('Collection to search in'),
        chunkId: z.string().describe('ID of the source chunk to find similar chunks for'),
        limit: z.number().optional().describe('Max results (default: 10)'),
      }),
    },
    async (input) => {
      try {
        const database = config.database;
        const limit = input.limit ?? 10;

        const results = await similarSearch(
          client, database, input.collection, input.chunkId, limit,
        );

        return {
          results,
          count: results.length,
          sourceChunk: input.chunkId,
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          success: false,
          error: `[search-similar] Failed to find chunks similar to "${input.chunkId}" in collection "${input.collection}": ${message}`,
          tool: 'search-similar',
          collection: input.collection,
          chunkId: input.chunkId,
          hint: 'Verify the chunkId exists in the collection and has an embedding. You can inspect the collection with search-collection-info. If the chunk has no embedding, re-index the source document.',
        };
      }
    },
  );
}
