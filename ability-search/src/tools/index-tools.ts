/**
 * Index tools — search-index, search-index-file, search-reindex, search-delete
 *
 * These tools add, replace, and remove documents from search collections.
 * All persistence goes through arcadedb-ability via broker.
 */

import { readFileSync } from 'fs';

import { KadiClient, z } from '@kadi.build/core';

import { chunkContent, type ChunkStrategy } from '../lib/chunker.js';
import type { SearchConfig } from '../lib/config.js';
import { embedTexts } from '../lib/embedder.js';
import { ensureSchema, ensureVectorIndex } from '../lib/schema.js';
import { escapeSQL, type ArcadeCommandResult } from '../lib/sql.js';

export function registerIndexTools(
  client: KadiClient,
  config: SearchConfig,
): void {
  // ---- search-index ---------------------------------------------------------

  client.registerTool(
    {
      name: 'search-index',
      description:
        'Chunk, embed, and store documents in a search collection. Creates schema and vector index automatically on first use.',
      input: z.object({
        collection: z.string().describe('Collection name to index into'),
        documents: z
          .array(
            z.object({
              source: z.string().describe('Unique source identifier (file path, URL)'),
              title: z.string().describe('Human-readable title'),
              content: z.string().describe('Full text content to chunk and index'),
              metadata: z
                .record(z.string(), z.unknown())
                .optional()
                .describe('Arbitrary metadata attached to each chunk'),
            }),
          )
          .min(1)
          .describe('Documents to index'),
        chunkStrategy: z
          .string()
          .optional()
          .describe('Chunking strategy: markdown-headers, code-blocks, paragraph, sliding-window, auto (default: auto)'),
        maxTokens: z
          .number()
          .optional()
          .describe('Max tokens per chunk (default: from config or 500)'),
        model: z
          .string()
          .optional()
          .describe('Embedding model (default: from config or nomic-embed-text)'),
      }),
    },
    async (input) => {
      try {
        const database = config.database;
        const model = input.model ?? config.embeddingModel;
        const maxTokens = input.maxTokens ?? config.chunkSize;
        const strategy = (input.chunkStrategy ?? 'auto') as ChunkStrategy;

        // 1. Ensure schema
        await ensureSchema(client, database);

        // 2. Chunk all documents
        const allChunks: Array<{
          chunkId: string;
          collection: string;
          source: string;
          title: string;
          content: string;
          tokens: number;
          metadata: Record<string, unknown>;
          chunkIndex: number;
          totalChunks: number;
        }> = [];

        for (const doc of input.documents) {
          const chunks = chunkContent(doc.content, strategy, { maxTokens });
          for (const chunk of chunks) {
            allChunks.push({
              chunkId: `${input.collection}:${doc.source}:${chunk.chunkIndex}`,
              collection: input.collection,
              source: doc.source,
              title: doc.title,
              content: chunk.content,
              tokens: chunk.tokens,
              metadata: { ...chunk.metadata, ...(doc.metadata ?? {}) },
              chunkIndex: chunk.chunkIndex,
              totalChunks: chunk.totalChunks,
            });
          }
        }

        if (allChunks.length === 0) {
          return {
            indexed: true,
            collection: input.collection,
            documents: input.documents.length,
            chunks: 0,
            model,
            dimensions: 0,
          };
        }

        // 3. Embed all chunks
        const texts = allChunks.map((c) => c.content);
        const { vectors, dimensions } = await embedTexts(client, texts, model, {
          transport: config.embeddingTransport,
          apiUrl: config.embeddingApiUrl,
          apiKey: config.apiKey,
        });

        // 4. Ensure vector index (lazy — needs dimensions)
        console.error(`[search-index] Ensuring vector index (${dimensions} dimensions)…`);
        await ensureVectorIndex(client, database, dimensions);
        console.error(`[search-index] Vector index ready`);

        // 5. Store chunks via arcade-batch (parameterized to avoid SQL escaping issues)
        const now = new Date().toISOString();
        const commands = allChunks.map((chunk, i) => {
          const embedding = vectors[i];
          // metadata is a MAP — ArcadeDB accepts raw JSON in SET syntax (unquoted)
          const metaJson = JSON.stringify(chunk.metadata);

          return {
            command:
              `INSERT INTO Chunk SET` +
              ` chunkId = :chunkId,` +
              ` collection = :collection,` +
              ` source = :source,` +
              ` title = :title,` +
              ` content = :content,` +
              ` embedding = [${embedding.join(',')}],` +
              ` tokens = ${chunk.tokens},` +
              ` metadata = ${metaJson},` +
              ` chunkIndex = ${chunk.chunkIndex},` +
              ` totalChunks = ${chunk.totalChunks},` +
              ` createdAt = :createdAt`,
            params: {
              chunkId: chunk.chunkId,
              collection: chunk.collection,
              source: chunk.source,
              title: chunk.title,
              content: chunk.content,
              createdAt: now,
            },
          };
        });

        // Batch in groups to avoid overwhelming the DB
        const BATCH_SIZE = 50;
        const totalBatches = Math.ceil(commands.length / BATCH_SIZE);
        console.error(`[search-index] Storing ${commands.length} chunks in ${totalBatches} batches of ${BATCH_SIZE}…`);
        const storeStart = Date.now();

        for (let i = 0; i < commands.length; i += BATCH_SIZE) {
          const batch = commands.slice(i, i + BATCH_SIZE);
          const batchNum = Math.floor(i / BATCH_SIZE) + 1;
          const result = (await client.invokeRemote('arcade-batch', {
            database,
            commands: batch,
          })) as ArcadeCommandResult;

          if (!result.success) {
            console.error(`[search-index] Batch ${batchNum}/${totalBatches} FAILED: ${result.error}`);
            return {
              success: false,
              error: `[search-index] Batch insert failed while storing chunks ${i + 1}–${i + batch.length} of ${commands.length} into collection "${input.collection}" (database: ${database}): ${result.error}`,
              tool: 'search-index',
              collection: input.collection,
              storedSoFar: i,
              totalChunks: commands.length,
              hint: `${i} chunks were already stored before this failure. Use search-collection-info to check the current state, then retry the full indexing operation (search-index will insert new chunks).`,
            };
          }

          console.error(`[search-index] Batch ${batchNum}/${totalBatches} stored (${i + batch.length}/${commands.length} chunks)`);
        }

        const storeElapsed = ((Date.now() - storeStart) / 1000).toFixed(1);
        console.error(`[search-index] All ${commands.length} chunks stored in ${storeElapsed}s`);

        return {
          indexed: true,
          collection: input.collection,
          documents: input.documents.length,
          chunks: allChunks.length,
          model,
          dimensions,
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          success: false,
          error: `[search-index] Failed to index ${input.documents.length} document(s) into collection "${input.collection}": ${message}`,
          tool: 'search-index',
          collection: input.collection,
          documents: input.documents.length,
          hint: 'This tool requires arcadedb-ability (for storage) and model-manager (for embeddings) to be registered on the broker. Check that both are running and connected.',
        };
      }
    },
  );

  // ---- search-index-file ----------------------------------------------------

  client.registerTool(
    {
      name: 'search-index-file',
      description:
        'Read a file from disk, detect its format, and index it into a search collection.',
      input: z.object({
        collection: z.string().describe('Collection name to index into'),
        filePath: z.string().describe('Absolute path to the file'),
        format: z
          .string()
          .optional()
          .describe('File format: markdown, json, text (auto-detected from extension if omitted)'),
        chunkStrategy: z
          .string()
          .optional()
          .describe('Chunking strategy (default: auto)'),
      }),
    },
    async (input) => {
      try {
        let content: string;
        try {
          content = readFileSync(input.filePath, 'utf8');
        } catch {
          return {
            success: false,
            error: `[search-index-file] File not found or unreadable: "${input.filePath}" (target collection: "${input.collection}")`,
            tool: 'search-index-file',
            filePath: input.filePath,
            collection: input.collection,
            hint: 'Provide an absolute path to an existing, readable file.',
          };
        }

        // Detect format from extension
        const format =
          input.format ?? detectFormat(input.filePath);

        // Extract title from filename
        const parts = input.filePath.split('/');
        const filename = parts[parts.length - 1] ?? input.filePath;
        const title = filename.replace(/\.[^.]+$/, '');

        let documents: Array<{
          source: string;
          title: string;
          content: string;
          metadata?: Record<string, unknown>;
        }>;

        if (format === 'json') {
          // Try to parse as array of documents or single document
          try {
            const parsed = JSON.parse(content);
            if (Array.isArray(parsed)) {
              documents = parsed.map((item: Record<string, unknown>, i: number) => ({
                source: (item.source as string) ?? `${filename}#${i}`,
                title: (item.title as string) ?? title,
                content: (item.content as string) ?? JSON.stringify(item),
              }));
            } else {
              documents = [
                {
                  source: filename,
                  title: (parsed.title as string) ?? title,
                  content: (parsed.content as string) ?? JSON.stringify(parsed),
                },
              ];
            }
          } catch {
            // Not valid JSON — treat as plain text
            documents = [{ source: filename, title, content }];
          }
        } else {
          documents = [
            {
              source: filename,
              title,
              content,
              metadata: { format },
            },
          ];
        }

        // Delegate to search-index pipeline
        const strategy = (input.chunkStrategy ?? 'auto') as ChunkStrategy;
        const model = config.embeddingModel;
        const database = config.database;
        const maxTokens = config.chunkSize;

        await ensureSchema(client, database);

        const allChunks: Array<{
          chunkId: string;
          collection: string;
          source: string;
          title: string;
          content: string;
          tokens: number;
          metadata: Record<string, unknown>;
          chunkIndex: number;
          totalChunks: number;
        }> = [];

        for (const doc of documents) {
          const chunks = chunkContent(doc.content, strategy, { maxTokens });
          for (const chunk of chunks) {
            allChunks.push({
              chunkId: `${input.collection}:${doc.source}:${chunk.chunkIndex}`,
              collection: input.collection,
              source: doc.source,
              title: doc.title,
              content: chunk.content,
              tokens: chunk.tokens,
              metadata: { ...chunk.metadata, ...(doc.metadata ?? {}) },
              chunkIndex: chunk.chunkIndex,
              totalChunks: chunk.totalChunks,
            });
          }
        }

        if (allChunks.length === 0) {
          return {
            indexed: true,
            collection: input.collection,
            documents: documents.length,
            chunks: 0,
            model,
            dimensions: 0,
          };
        }

        const texts = allChunks.map((c) => c.content);
        const { vectors, dimensions } = await embedTexts(client, texts, model, {
          transport: config.embeddingTransport,
          apiUrl: config.embeddingApiUrl,
          apiKey: config.apiKey,
        });
        await ensureVectorIndex(client, database, dimensions);

        const now = new Date().toISOString();
        const commands = allChunks.map((chunk, i) => {
          const embedding = vectors[i];
          const metaJson = JSON.stringify(chunk.metadata);

          return {
            command:
              `INSERT INTO Chunk SET` +
              ` chunkId = :chunkId,` +
              ` collection = :collection,` +
              ` source = :source,` +
              ` title = :title,` +
              ` content = :content,` +
              ` embedding = [${embedding.join(',')}],` +
              ` tokens = ${chunk.tokens},` +
              ` metadata = ${metaJson},` +
              ` chunkIndex = ${chunk.chunkIndex},` +
              ` totalChunks = ${chunk.totalChunks},` +
              ` createdAt = :createdAt`,
            params: {
              chunkId: chunk.chunkId,
              collection: chunk.collection,
              source: chunk.source,
              title: chunk.title,
              content: chunk.content,
              createdAt: now,
            },
          };
        });

        const BATCH_SIZE = 50;
        for (let i = 0; i < commands.length; i += BATCH_SIZE) {
          const batch = commands.slice(i, i + BATCH_SIZE);
          const result = (await client.invokeRemote('arcade-batch', {
            database,
            commands: batch,
          })) as ArcadeCommandResult;

          if (!result.success) {
            return {
              success: false,
              error: `[search-index-file] Batch insert failed while storing chunks ${i + 1}–${i + batch.length} of ${commands.length} from file "${input.filePath}" into collection "${input.collection}" (database: ${database}): ${result.error}`,
              tool: 'search-index-file',
              filePath: input.filePath,
              collection: input.collection,
              storedSoFar: i,
              totalChunks: commands.length,
              hint: `${i} chunks were already stored before this failure. Use search-collection-info to check the current state, then retry.`,
            };
          }
        }

        return {
          indexed: true,
          collection: input.collection,
          documents: documents.length,
          chunks: allChunks.length,
          model,
          dimensions,
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          success: false,
          error: `[search-index-file] Failed to index file "${input.filePath}" into collection "${input.collection}": ${message}`,
          tool: 'search-index-file',
          filePath: input.filePath,
          collection: input.collection,
          hint: 'Verify the file exists at the given absolute path. This tool also requires arcadedb-ability (for storage) and model-manager (for embeddings) to be registered on the broker.',
        };
      }
    },
  );

  // ---- search-reindex -------------------------------------------------------

  client.registerTool(
    {
      name: 'search-reindex',
      description:
        'Delete all chunks in a collection. Caller must re-index afterward to repopulate.',
      input: z.object({
        collection: z.string().describe('Collection to clear'),
      }),
    },
    async (input) => {
      try {
        const database = config.database;

        const result = (await client.invokeRemote('arcade-command', {
          database,
          command: `DELETE FROM Chunk WHERE collection = '${escapeSQL(input.collection)}'`,
        })) as ArcadeCommandResult;

        if (!result.success) {
          return {
            success: false,
            error: `[search-reindex] Failed to clear collection "${input.collection}" in database "${database}": ${result.error}`,
            tool: 'search-reindex',
            collection: input.collection,
            hint: 'Ensure arcadedb-ability is registered on the broker and the database is accessible.',
          };
        }

        const deleted = result.result?.length ?? 0;
        return {
          collection: input.collection,
          deleted,
          message: `Collection "${input.collection}" cleared (${deleted} chunks deleted). Re-index to repopulate.`,
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          success: false,
          error: `[search-reindex] Unexpected error while clearing collection "${input.collection}": ${message}`,
          tool: 'search-reindex',
          collection: input.collection,
          hint: 'Ensure arcadedb-ability is registered on the broker and the database is accessible.',
        };
      }
    },
  );

  // ---- search-delete --------------------------------------------------------

  client.registerTool(
    {
      name: 'search-delete',
      description:
        'Delete chunks by collection, optionally filtered by source document.',
      input: z.object({
        collection: z.string().describe('Collection to delete from'),
        source: z
          .string()
          .optional()
          .describe('Delete only chunks from this source'),
      }),
    },
    async (input) => {
      try {
        const database = config.database;
        let sql = `DELETE FROM Chunk WHERE collection = '${escapeSQL(input.collection)}'`;
        if (input.source) {
          sql += ` AND source = '${escapeSQL(input.source)}'`;
        }

        const result = (await client.invokeRemote('arcade-command', {
          database,
          command: sql,
        })) as ArcadeCommandResult;

        if (!result.success) {
          const target = input.source
            ? `chunks from source "${input.source}" in collection "${input.collection}"`
            : `all chunks in collection "${input.collection}"`;
          return {
            success: false,
            error: `[search-delete] Failed to delete ${target} (database: ${database}): ${result.error}`,
            tool: 'search-delete',
            collection: input.collection,
            source: input.source ?? null,
            hint: 'Ensure arcadedb-ability is registered on the broker and the database is accessible.',
          };
        }

        const deleted = result.result?.length ?? 0;
        return {
          deleted,
          collection: input.collection,
          source: input.source ?? null,
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        const target = input.source
          ? `chunks from source "${input.source}" in collection "${input.collection}"`
          : `all chunks in collection "${input.collection}"`;
        return {
          success: false,
          error: `[search-delete] Unexpected error while deleting ${target}: ${message}`,
          tool: 'search-delete',
          collection: input.collection,
          source: input.source ?? null,
          hint: 'Ensure arcadedb-ability is registered on the broker and the database is accessible.',
        };
      }
    },
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function detectFormat(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'md':
    case 'markdown':
      return 'markdown';
    case 'json':
      return 'json';
    case 'txt':
    case 'text':
      return 'text';
    default:
      return 'text';
  }
}
