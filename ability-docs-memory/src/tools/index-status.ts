/**
 * docs-index-status tool — Query documentation index statistics.
 *
 * Returns counts: total docs, by collection, last indexed time, index health.
 */

import { KadiClient, z } from '@kadi.build/core';

import type { DocsConfig } from '../lib/config.js';
import type { SignalAbilities } from '../lib/graph-types.js';

export function registerIndexStatusTool(
  client: KadiClient,
  config: DocsConfig,
  abilities: SignalAbilities,
): void {

  client.registerTool(
    {
      name: 'docs-index-status',
      description:
        'Get documentation index statistics: total DocNodes, counts by collection, ' +
        'topic/entity counts, edge counts, and last indexed time.',
      input: z.object({
        collection: z.string().optional()
          .describe('Filter to a specific collection (default: all collections)'),
      }),
    },
    async (input) => {
      try {
        const database = config.database;

        // Total DocNodes
        const totalResult = await safeQuery(abilities, database,
          'SELECT count(*) AS total FROM DocNode',
        );
        const totalDocNodes = (totalResult?.[0]?.total as number) ?? 0;

        // DocNodes by collection
        const collectionResult = await safeQuery(abilities, database,
          'SELECT collection, count(*) AS count FROM DocNode GROUP BY collection',
        );
        const collections: Record<string, number> = {};
        if (collectionResult) {
          for (const row of collectionResult) {
            const col = (row.collection as string) ?? 'unknown';
            collections[col] = (row.count as number) ?? 0;
          }
        }

        // Topic count
        const topicResult = await safeQuery(abilities, database,
          'SELECT count(*) AS total FROM Topic',
        );
        const totalTopics = (topicResult?.[0]?.total as number) ?? 0;

        // Entity count
        const entityResult = await safeQuery(abilities, database,
          'SELECT count(*) AS total FROM Entity',
        );
        const totalEntities = (entityResult?.[0]?.total as number) ?? 0;

        // NextSection edge count
        const nextSectionResult = await safeQuery(abilities, database,
          'SELECT count(*) AS total FROM NextSection',
        );
        const totalNextSectionEdges = (nextSectionResult?.[0]?.total as number) ?? 0;

        // References edge count
        const referencesResult = await safeQuery(abilities, database,
          'SELECT count(*) AS total FROM References',
        );
        const totalReferencesEdges = (referencesResult?.[0]?.total as number) ?? 0;

        // Last indexed time (if filtering by collection)
        let lastIndexedAt: string | null = null;
        if (input.collection) {
          const safeCollection = escapeSimple(input.collection);
          const lastResult = await safeQuery(abilities, database,
            `SELECT indexedAt FROM DocNode WHERE collection = '${safeCollection}' ORDER BY indexedAt DESC LIMIT 1`,
          );
          lastIndexedAt = (lastResult?.[0]?.indexedAt as string) ?? null;
        } else {
          const lastResult = await safeQuery(abilities, database,
            'SELECT indexedAt FROM DocNode ORDER BY indexedAt DESC LIMIT 1',
          );
          lastIndexedAt = (lastResult?.[0]?.indexedAt as string) ?? null;
        }

        // Embedding coverage
        let embeddingCoverage = 0;
        const embResult = await safeQuery(abilities, database,
          'SELECT count(*) AS total FROM DocNode WHERE embedding IS NOT NULL',
        );
        const withEmbeddings = (embResult?.[0]?.total as number) ?? 0;
        embeddingCoverage = totalDocNodes > 0
          ? Math.round((withEmbeddings / totalDocNodes) * 100)
          : 0;

        return {
          success: true,
          totalDocNodes,
          collections,
          totalTopics,
          totalEntities,
          edges: {
            nextSection: totalNextSectionEdges,
            references: totalReferencesEdges,
          },
          lastIndexedAt,
          health: {
            embeddingCoverage: `${embeddingCoverage}%`,
            withEmbeddings,
            withoutEmbeddings: totalDocNodes - withEmbeddings,
          },
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          success: false,
          error: `[docs-index-status] ${message}`,
          tool: 'docs-index-status',
        };
      }
    },
  );
}

/**
 * Execute a query with graceful error handling.
 */
async function safeQuery(
  abilities: SignalAbilities,
  database: string,
  query: string,
): Promise<Array<Record<string, unknown>> | null> {
  try {
    const result = await abilities.invoke<{
      success: boolean;
      result?: Array<Record<string, unknown>>;
    }>('graph-query', { database, query });
    return result.success ? (result.result ?? null) : null;
  } catch {
    return null;
  }
}

/** Simple SQL string escape (single quotes). */
function escapeSimple(str: string): string {
  return str.replace(/'/g, "\\'");
}
