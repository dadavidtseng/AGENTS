/**
 * docs-search tool — Search documentation via graph-recall with 4-signal
 * hybrid recall including structural navigation.
 *
 * Wrapper over graph-recall: enforces vertexType='DocNode', adds collection
 * filter, uses 4-signal default (semantic, keyword, graph, structural),
 * and configures structural edges (NEXT_SECTION, REFERENCES).
 *
 * The structural signal is what differentiates docs search from agent memory
 * search. NEXT_SECTION edges allow "read the next paragraph" expansion.
 * REFERENCES edges allow "what else links to this topic" expansion.
 */

import { KadiClient, z } from '@kadi.build/core';

import type { DocsConfig } from '../lib/config.js';
import type { SignalAbilities } from '../lib/graph-types.js';

export function registerSearchTool(
  client: KadiClient,
  config: DocsConfig,
  abilities: SignalAbilities,
): void {

  client.registerTool(
    {
      name: 'docs-search',
      description:
        'Search documentation using 4-signal hybrid recall (semantic, keyword, graph, structural). ' +
        'Structural signals follow NEXT_SECTION and REFERENCES edges for contextual expansion. ' +
        'Results are ranked by RRF fusion with importance weighting.',
      input: z.object({
        query: z.string().describe('Search query text'),
        collection: z.string().optional()
          .describe('Documentation collection to search (default: from config)'),
        limit: z.number().optional()
          .describe('Maximum results to return (default: 10)'),
        mode: z.enum(['semantic', 'keyword', 'graph', 'hybrid']).optional()
          .describe('Search mode (default: hybrid)'),
        signals: z.array(z.string()).optional()
          .describe('Signals for hybrid mode (default: semantic, keyword, graph, structural)'),
        structuralDepth: z.number().optional()
          .describe('Structural expansion hops (default: 1)'),
        structuralTopK: z.number().optional()
          .describe('Expand from top N results for structural (default: 5)'),
      }),
    },
    async (input) => {
      try {
        const collection = input.collection ?? config.defaultCollection;
        const limit = input.limit ?? 10;
        const mode = input.mode ?? 'hybrid';

        // Build collection filter
        const filters: Record<string, unknown> = {
          collection,
        };

        // 4-signal default: semantic, keyword, graph, structural
        const signals = input.signals ?? ['semantic', 'keyword', 'graph', 'structural'];

        // Delegate to graph-recall with enforced vertexType='DocNode'
        const result = await abilities.invoke<Record<string, unknown>>('graph-recall', {
          query: input.query,
          vertexType: 'DocNode',
          mode,
          signals,
          structuralEdges: ['NextSection', 'References'],
          structuralDepth: input.structuralDepth ?? 1,
          structuralTopK: input.structuralTopK ?? 5,
          filters,
          limit,
          database: config.database,
          embedding: {
            model: config.embeddingModel,
            transport: config.embeddingTransport,
            apiUrl: config.apiUrl,
            apiKey: config.apiKey,
          },
        });

        return {
          success: true,
          ...result,
          collection,
          mode,
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          success: false,
          error: `[docs-search] ${message}`,
          tool: 'docs-search',
          hint: 'This tool requires arcadedb-ability and model-manager on the broker.',
        };
      }
    },
  );
}
