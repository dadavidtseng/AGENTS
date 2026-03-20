/**
 * Collection tools — search-collections, search-collection-info
 *
 * These tools inspect indexed collections and their statistics.
 */

import { KadiClient, z } from '@kadi.build/core';

import type { SearchConfig } from '../lib/config.js';
import { escapeSQL, type ArcadeQueryResult } from '../lib/sql.js';

export function registerCollectionTools(
  client: KadiClient,
  config: SearchConfig,
): void {
  // ---- search-collections ---------------------------------------------------

  client.registerTool(
    {
      name: 'search-collections',
      description:
        'List all search collections with chunk count and token statistics.',
      input: z.object({}),
    },
    async () => {
      try {
        const database = config.database;
        const sql = `SELECT collection, count(*) AS chunks, min(tokens) AS minTokens, max(tokens) AS maxTokens, avg(tokens) AS avgTokens FROM Chunk GROUP BY collection`;

        const response = (await client.invokeRemote('arcade-query', {
          database,
          query: sql,
        })) as ArcadeQueryResult;

        if (!response.success) {
          // If the Chunk type doesn't exist yet, return empty list (no collections indexed yet).
          // Match the specific ArcadeDB error for missing document types.
          if (
            response.error?.includes('not found') ||
            response.error?.includes('does not exist') ||
            response.error?.includes('Unknown type')
          ) {
            return { collections: [] };
          }
          return {
            success: false,
            error: `[search-collections] Failed to list collections from database "${database}": ${response.error}`,
            tool: 'search-collections',
            hint: 'Ensure arcadedb-ability is registered on the broker and the database is accessible.',
          };
        }

        const collections = (response.result ?? []).map((row) => ({
          name: row.collection as string,
          chunks: row.chunks as number,
          minTokens: row.minTokens as number,
          maxTokens: row.maxTokens as number,
          avgTokens: Math.round(row.avgTokens as number),
        }));

        return { collections };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          success: false,
          error: `[search-collections] Unexpected error while listing collections: ${message}`,
          tool: 'search-collections',
          hint: 'Ensure arcadedb-ability is registered on the broker and the database is accessible.',
        };
      }
    },
  );

  // ---- search-collection-info -----------------------------------------------

  client.registerTool(
    {
      name: 'search-collection-info',
      description:
        'Get detailed statistics and source list for a single search collection.',
      input: z.object({
        collection: z.string().describe('Collection name'),
      }),
    },
    async (input) => {
      try {
        const database = config.database;
        const escaped = escapeSQL(input.collection);

        // Stats query
        const statsSql = `SELECT count(*) AS chunks, min(tokens) AS minTokens, max(tokens) AS maxTokens, avg(tokens) AS avgTokens FROM Chunk WHERE collection = '${escaped}'`;

        // Sources query
        const sourcesSql = `SELECT DISTINCT(source) AS source FROM Chunk WHERE collection = '${escaped}'`;

        const [statsResponse, sourcesResponse] = (await Promise.all([
          client.invokeRemote('arcade-query', { database, query: statsSql }),
          client.invokeRemote('arcade-query', { database, query: sourcesSql }),
        ])) as [ArcadeQueryResult, ArcadeQueryResult];

        if (!statsResponse.success) {
          return {
            success: false,
            error: `[search-collection-info] Failed to query stats for collection "${input.collection}" in database "${database}": ${statsResponse.error}`,
            tool: 'search-collection-info',
            collection: input.collection,
            hint: 'Ensure arcadedb-ability is registered on the broker. If the collection has not been indexed yet, use search-index first.',
          };
        }

        const stats = statsResponse.result?.[0] ?? {};
        const sources = (sourcesResponse.result ?? []).map(
          (row) => row.source as string,
        );

        return {
          collection: input.collection,
          chunks: (stats.chunks as number) ?? 0,
          minTokens: (stats.minTokens as number) ?? 0,
          maxTokens: (stats.maxTokens as number) ?? 0,
          avgTokens: Math.round((stats.avgTokens as number) ?? 0),
          sources,
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          success: false,
          error: `[search-collection-info] Unexpected error while querying collection "${input.collection}": ${message}`,
          tool: 'search-collection-info',
          collection: input.collection,
          hint: 'Ensure arcadedb-ability is registered on the broker and the database is accessible.',
        };
      }
    },
  );
}
