/**
 * docs-page tool — Fetch a single documentation page by slug.
 *
 * Simple utility tool that queries the graph for a DocNode by slug
 * and returns its content and metadata. Optionally fetches from URL.
 */

import { KadiClient, z } from '@kadi.build/core';

import type { DocsConfig } from '../lib/config.js';
import type { SignalAbilities } from '../lib/graph-types.js';

export function registerPageTool(
  client: KadiClient,
  config: DocsConfig,
  abilities: SignalAbilities,
): void {

  client.registerTool(
    {
      name: 'docs-page',
      description:
        'Fetch a single documentation page by slug. Returns all chunks of the page ' +
        'in order, with their content, metadata, and related pages.',
      input: z.object({
        slug: z.string().describe('Document slug to fetch (e.g., "architecture/agent-model")'),
        collection: z.string().optional()
          .describe('Documentation collection (default: from config)'),
        includeRelated: z.boolean().optional()
          .describe('Include related pages via References edges (default: false)'),
      }),
    },
    async (input) => {
      try {
        const collection = input.collection ?? config.defaultCollection;
        const safeSlug = escapeSimple(input.slug);
        const safeCollection = escapeSimple(collection);

        // Query all chunks for this page, ordered by chunkIndex
        // Use a LIKE query to match the slug prefix (slug__chunk_N pattern)
        const queryResult = await abilities.invoke<{
          success: boolean;
          result?: Array<Record<string, unknown>>;
        }>('graph-query', {
          database: config.database,
          query:
            `SELECT @rid, content, title, slug, pageUrl, source, chunkIndex, tokens, importance, metadata, indexedAt` +
            ` FROM DocNode` +
            ` WHERE slug LIKE '${safeSlug}%'` +
            ` AND collection = '${safeCollection}'` +
            ` ORDER BY chunkIndex ASC`,
        });

        if (!queryResult.success || !queryResult.result || queryResult.result.length === 0) {
          return {
            success: false,
            error: `Page not found: "${input.slug}" in collection "${collection}"`,
            tool: 'docs-page',
          };
        }

        const chunks = queryResult.result;

        // Combine chunk content into full page content
        const fullContent = chunks.map((c) => c.content as string).join('\n\n');
        const firstChunk = chunks[0];

        // Optionally fetch related pages via References edges
        let relatedPages: Array<{ slug: string; title: string; linkText: string }> = [];
        if (input.includeRelated) {
          const firstRid = (firstChunk['@rid'] as string) ?? '';
          if (firstRid) {
            try {
              const refResult = await abilities.invoke<{
                success: boolean;
                result?: Array<Record<string, unknown>>;
              }>('graph-query', {
                database: config.database,
                query:
                  `SELECT slug, title FROM (` +
                  `  SELECT expand(out('References')) FROM ${firstRid}` +
                  `)`,
              });

              if (refResult.success && refResult.result) {
                relatedPages = refResult.result.map((r) => ({
                  slug: (r.slug as string) ?? '',
                  title: (r.title as string) ?? '',
                  linkText: '',
                }));
              }
            } catch {
              // Non-fatal
            }
          }
        }

        return {
          success: true,
          title: (firstChunk.title as string) ?? '',
          slug: input.slug,
          pageUrl: (firstChunk.pageUrl as string) ?? '',
          source: (firstChunk.source as string) ?? '',
          collection,
          chunks: chunks.length,
          content: fullContent,
          relatedPages,
          indexedAt: (firstChunk.indexedAt as string) ?? '',
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          success: false,
          error: `[docs-page] ${message}`,
          tool: 'docs-page',
        };
      }
    },
  );
}

/** Simple SQL string escape (single quotes). */
function escapeSimple(str: string): string {
  return str.replace(/'/g, "\\'");
}
