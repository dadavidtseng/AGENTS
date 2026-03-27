/**
 * docs-reindex tool — Full documentation reindexing pipeline.
 *
 * Pipeline: crawl pages → chunk → for each chunk:
 *   call graph-batch-store with vertexType='DocNode'.
 *   Creates NEXT_SECTION edges between sequential chunks.
 *   Creates REFERENCES edges for cross-doc links.
 *   Uses inline processing (NOT background jobs by default).
 *
 * This is application-level batching — each vertex is its own graph-command
 * inside graph-ability. NOT arcade-batch.
 */

import { KadiClient, z } from '@kadi.build/core';

import type { DocsConfig } from '../lib/config.js';
import type { SignalAbilities } from '../lib/graph-types.js';
import { chunkByMarkdownHeaders, type DocChunk } from '../lib/chunker.js';
import {
  type PageDocument,
  splitIntoPages,
  parseLlmsTxt,
  slugFromHeading,
} from '../lib/crawler.js';
import { extractCrossDocReferences } from '../lib/references.js';

export function registerReindexTool(
  client: KadiClient,
  config: DocsConfig,
  abilities: SignalAbilities,
): void {

  client.registerTool(
    {
      name: 'docs-reindex',
      description:
        'Reindex documentation into the graph database. Crawls pages, chunks by markdown headings, ' +
        'extracts entities/topics, generates embeddings, and creates DocNode vertices with ' +
        'NextSection and References edges. Uses graph-batch-store for bulk ingestion.',
      input: z.object({
        pages: z.array(z.object({
          title: z.string().describe('Page title'),
          slug: z.string().describe('URL slug for identification'),
          pageUrl: z.string().describe('Full URL of the page'),
          source: z.string().optional().describe('Source identifier'),
          content: z.string().describe('Raw markdown content of the page'),
        })).optional().describe('Pre-loaded page documents to index'),
        llmsContent: z.string().optional()
          .describe('Raw llms-guides.txt or llms-api.txt content to split and index'),
        llmsTxt: z.string().optional()
          .describe('Raw llms.txt content for title→URL mapping'),
        collection: z.string().optional()
          .describe('Target collection name (default: from config)'),
        clearExisting: z.boolean().optional()
          .describe('Clear existing DocNodes in collection before indexing (default: true)'),
        background: z.boolean().optional()
          .describe('Run as background job (default: false for inline processing)'),
        skipExtraction: z.boolean().optional()
          .describe('Skip LLM topic/entity extraction (default: false)'),
      }),
    },
    async (input) => {
      const startTime = Date.now();
      const collection = input.collection ?? config.defaultCollection;

      try {
        // ── Step 1: Resolve pages ──────────────────────────────────────

        let pages: PageDocument[] = [];
        console.error(`[docs-reindex] Step 1: Resolving pages…`);

        if (input.pages && input.pages.length > 0) {
          pages = input.pages.map((p) => ({
            title: p.title,
            slug: p.slug,
            pageUrl: p.pageUrl,
            source: p.source ?? `docs/${p.slug}`,
            content: p.content,
          }));
        } else if (input.llmsContent) {
          const titleUrlMap = input.llmsTxt
            ? parseLlmsTxt(input.llmsTxt)
            : new Map<string, string>();
          pages = splitIntoPages(input.llmsContent, titleUrlMap, config.domain, 'guides');
        }

        if (pages.length === 0) {
          return {
            success: false,
            error: 'No pages to index. Provide either `pages` or `llmsContent`.',
            tool: 'docs-reindex',
          };
        }

        console.error(`[docs-reindex] Step 1 done: ${pages.length} pages resolved`);

        // ── Step 2: Clear existing DocNodes ────────────────────────────
        console.error(`[docs-reindex] Step 2: Clearing existing DocNodes (clearExisting=${input.clearExisting !== false})…`);

        if (input.clearExisting !== false) {
          try {
            await abilities.invoke('graph-command', {
              database: config.database,
              command: `DELETE VERTEX DocNode WHERE collection = '${escapeSimple(collection)}'`,
            });
          } catch {
            // May fail if collection is empty or type doesn't exist yet — safe to ignore
          }
        }

        // ── Step 3: Chunk all pages ────────────────────────────────────
        console.error(`[docs-reindex] Step 3: Chunking ${pages.length} pages (maxTokens=${config.maxTokens})…`);

        interface ChunkWithMeta extends DocChunk {
          slug: string;
          title: string;
          pageUrl: string;
          source: string;
        }

        const allChunks: ChunkWithMeta[] = [];
        for (const page of pages) {
          const chunks = chunkByMarkdownHeaders(page.content, config.maxTokens);
          for (const chunk of chunks) {
            allChunks.push({
              ...chunk,
              slug: page.slug,
              title: page.title,
              pageUrl: page.pageUrl,
              source: page.source,
            });
          }
        }

        if (allChunks.length === 0) {
          return {
            success: true,
            stats: { docNodes: 0, pages: pages.length, chunks: 0 },
            durationMs: Date.now() - startTime,
          };
        }

        console.error(`[docs-reindex] Step 3 done: ${allChunks.length} chunks across ${pages.length} pages`);

        // ── Step 4: Build batch items with NextSection edges ──────────

        // Group chunks by slug to determine NextSection within each page
        const chunksBySlug = new Map<string, ChunkWithMeta[]>();
        for (const chunk of allChunks) {
          if (!chunksBySlug.has(chunk.slug)) {
            chunksBySlug.set(chunk.slug, []);
          }
          chunksBySlug.get(chunk.slug)!.push(chunk);
        }

        // Build unique dedup key combining slug + chunkIndex
        const batchItems = allChunks.map((chunk) => {
          const dedupSlug = `${chunk.slug}__chunk_${chunk.chunkIndex}`;

          return {
            content: chunk.content,
            vertexType: 'DocNode',
            properties: {
              source: chunk.source,
              title: chunk.title,
              slug: dedupSlug,
              pageUrl: chunk.pageUrl,
              collection,
              chunkIndex: chunk.chunkIndex,
              totalChunks: chunk.totalChunks,
              tokens: chunk.tokens,
              importance: 0.5, // Will be updated by extraction
              metadata: chunk.metadata,
              indexedAt: new Date().toISOString(),
            },
            // NOTE: Edges are created in post-batch steps (5b, 6) because
            // batch-store processes items sequentially — forward-referencing
            // edges (NextSection to chunk N+1) would fail since the target
            // vertex doesn't exist yet.
            skipExtraction: input.skipExtraction,
          };
        });

        // ── Step 5: Batch store via graph-ability ──────────────────────

        console.error(`[docs-reindex] Step 5: Sending ${batchItems.length} items to graph-batch-store (db=${config.database})…`);
        console.log(`[docs-reindex] Sending ${batchItems.length} items to graph-batch-store (db=${config.database})`);
        console.log(`[docs-reindex] First item vertexType=${batchItems[0]?.vertexType}, props keys=${Object.keys(batchItems[0]?.properties ?? {})}`);

        const batchStart = Date.now();

        // Only use dedup when NOT clearing — avoids unnecessary graph-query
        // calls during the dedup check. When clearExisting is true (default),
        // the collection was already wiped so no duplicates can exist.
        const useDedup = input.clearExisting === false;

        const batchResult = await abilities.invoke<Record<string, unknown>>('graph-batch-store', {
          items: batchItems,
          database: config.database,
          ...(useDedup
            ? { deduplicateBy: ['slug', 'collection'], onDuplicate: 'replace' }
            : {}),
        });

        // Validate batch result
        const batchStored = (batchResult?.stored as number) ?? 0;
        const batchFailed = (batchResult?.failed as number) ?? 0;
        const batchSkipped = (batchResult?.skipped as number) ?? 0;
        const batchErrors = (batchResult?.errors as Array<{ index: number; error: string }>) ?? [];

        console.error(`[docs-reindex] Step 5 done: stored=${batchStored}, skipped=${batchSkipped}, failed=${batchFailed} (${Date.now() - batchStart}ms)`);
        console.log(`[docs-reindex] Batch result: stored=${batchStored}, skipped=${batchSkipped}, failed=${batchFailed}, errors=${batchErrors.length}`);
        if (batchErrors.length > 0) {
          console.warn(`[docs-reindex] First 3 errors:`, JSON.stringify(batchErrors.slice(0, 3)));
        }

        if (batchStored === 0 && batchFailed > 0) {
          return {
            success: false,
            error: `[docs-reindex] All ${batchFailed} chunks failed to store. First error: ${batchErrors[0]?.error ?? 'unknown'}`,
            stats: {
              pages: pages.length,
              chunks: allChunks.length,
              stored: batchStored,
              failed: batchFailed,
              errors: batchErrors.slice(0, 5),
            },
            tool: 'docs-reindex',
            durationMs: Date.now() - startTime,
          };
        }

        // ── Step 5b: Create NextSection edges between consecutive chunks ─
        //
        // Must happen AFTER batch-store so all target vertices exist.
        // Query each page's chunks ordered by chunkIndex, then create edges
        // between consecutive pairs.

        console.error(`[docs-reindex] Step 5b: Creating NextSection edges for ${chunksBySlug.size} pages…`);
        let nextSectionCreated = 0;

        for (const [pageSlug] of chunksBySlug.entries()) {
          try {
            const chunksResult = await abilities.invoke<{
              success: boolean;
              result?: Array<Record<string, unknown>>;
            }>('graph-query', {
              database: config.database,
              query:
                `SELECT @rid, chunkIndex FROM DocNode` +
                ` WHERE slug LIKE '${escapeSimple(pageSlug)}__chunk_%'` +
                ` AND collection = '${escapeSimple(collection)}'` +
                ` ORDER BY chunkIndex ASC`,
            });

            if (!chunksResult.success || !chunksResult.result || chunksResult.result.length < 2) {
              continue;
            }

            const dbChunks = chunksResult.result;
            for (let i = 0; i < dbChunks.length - 1; i++) {
              const fromRid = dbChunks[i]['@rid'] as string;
              const toRid = dbChunks[i + 1]['@rid'] as string;
              if (!fromRid || !toRid) continue;

              try {
                await abilities.invoke('graph-command', {
                  database: config.database,
                  command: `CREATE EDGE NextSection FROM ${fromRid} TO ${toRid}`,
                });
                nextSectionCreated++;
              } catch {
                // Non-fatal — continue
              }
            }
          } catch {
            // Non-fatal — skip this page's edges
          }
        }

        console.error(`[docs-reindex] Step 5b done: ${nextSectionCreated} NextSection edges`);

        // ── Step 6: Create References edges for cross-doc links ───────
        //
        // Resolve source/target slugs → RIDs via graph-query, then create
        // edges via graph-command (graph-relate requires RIDs, not queries).

        console.error(`[docs-reindex] Step 6: Creating References edges for cross-doc links…`);
        const knownSlugs = new Set(pages.map((p) => p.slug));
        let referencesCreated = 0;

        for (const page of pages) {
          const refs = extractCrossDocReferences(page.content, page.slug, knownSlugs);

          for (const ref of refs) {
            if (!ref.resolved) continue;

            try {
              const sourceSlug = `${page.slug}__chunk_0`;
              const targetSlug = `${ref.targetSlug}__chunk_0`;

              // Resolve source RID
              const sourceResult = await abilities.invoke<{
                success: boolean;
                result?: Array<Record<string, unknown>>;
              }>('graph-query', {
                database: config.database,
                query:
                  `SELECT @rid FROM DocNode` +
                  ` WHERE slug = '${escapeSimple(sourceSlug)}'` +
                  ` AND collection = '${escapeSimple(collection)}'` +
                  ` LIMIT 1`,
              });

              // Resolve target RID
              const targetResult = await abilities.invoke<{
                success: boolean;
                result?: Array<Record<string, unknown>>;
              }>('graph-query', {
                database: config.database,
                query:
                  `SELECT @rid FROM DocNode` +
                  ` WHERE slug = '${escapeSimple(targetSlug)}'` +
                  ` AND collection = '${escapeSimple(collection)}'` +
                  ` LIMIT 1`,
              });

              const sourceRid = sourceResult.result?.[0]?.['@rid'] as string | undefined;
              const targetRid = targetResult.result?.[0]?.['@rid'] as string | undefined;

              if (!sourceRid || !targetRid) {
                console.warn(`[docs-reindex] References edge skipped: source=${sourceSlug}(${sourceRid ?? 'not found'}) → target=${targetSlug}(${targetRid ?? 'not found'})`);
                continue;
              }

              await abilities.invoke('graph-command', {
                database: config.database,
                command: `CREATE EDGE References FROM ${sourceRid} TO ${targetRid} SET linkText = '${escapeSimple(ref.linkText)}', sourceSlug = '${escapeSimple(page.slug)}'`,
              });
              referencesCreated++;
            } catch (err: unknown) {
              const msg = err instanceof Error ? err.message : String(err);
              console.warn(`[docs-reindex] References edge failed: ${msg}`);
            }
          }
        }

        console.error(`[docs-reindex] Step 6 done: ${referencesCreated} References edges`);
        console.error(`[docs-reindex] Complete: ${allChunks.length} chunks, ${nextSectionCreated} NextSection, ${referencesCreated} References (${Date.now() - startTime}ms)`);

        return {
          success: true,
          stats: {
            pages: pages.length,
            chunks: allChunks.length,
            nextSectionEdges: nextSectionCreated,
            referencesEdges: referencesCreated,
            ...(batchResult as Record<string, unknown>),
          },
          collection,
          durationMs: Date.now() - startTime,
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        const stack = err instanceof Error ? err.stack : undefined;
        console.error(`[docs-reindex] CAUGHT ERROR: ${message}`);
        if (stack) console.error(`[docs-reindex] Stack: ${stack}`);
        return {
          success: false,
          error: `[docs-reindex] ${message}`,
          tool: 'docs-reindex',
          durationMs: Date.now() - startTime,
        };
      }
    },
  );
}

/** Simple SQL string escape (single quotes). */
function escapeSimple(str: string): string {
  return str.replace(/'/g, "\\'");
}
