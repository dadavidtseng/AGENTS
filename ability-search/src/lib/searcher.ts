/**
 * Search engine — semantic, keyword, and hybrid search over Chunk documents
 * stored in ArcadeDB via arcadedb-ability.
 *
 * SQL patterns used here are drawn from `.dev/validated-sql.md`:
 *   - `vectorCosineSimilarity()` for semantic search (NOT `distance()`)
 *   - `search_fields()` for full-text search (NOT the LUCENE predicate)
 *
 * All user-supplied strings are escaped via {@link escapeSQL} before
 * interpolation.  Numeric limits are validated via {@link sanitizeInt}.
 */

import type { KadiClient } from '@kadi.build/core';

import { embedTexts, type EmbeddingConfig } from './embedder.js';
import { reciprocalRankFusion } from './rrf.js';
import { escapeSQL, sanitizeInt, type ArcadeQueryResult } from './sql.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type SearchMode = 'semantic' | 'keyword' | 'hybrid';

export interface SearchResult {
  chunkId: string;
  source: string;
  title: string;
  content: string;
  score: number;
  metadata: Record<string, unknown>;
}

/** SearchResult with an `id` field for RRF deduplication. */
interface RankedSearchResult extends SearchResult {
  id: string;
}

/**
 * Multiplier applied to the requested limit when fetching candidates for
 * hybrid search.  A larger pool gives Reciprocal Rank Fusion more signal
 * to work with, at the cost of fetching more rows from each source.
 *
 * 3x is a standard starting point for two-source RRF.  Tune upward if
 * recall matters more than latency.
 */
const HYBRID_FETCH_MULTIPLIER = 3;

/**
 * Execute a semantic search — embed the query and find similar chunks via
 * cosine similarity over the vector index.
 *
 * @param client     - KadiClient connected to a broker with arcadedb-ability.
 * @param database   - Target ArcadeDB database name.
 * @param collection - Collection to search within.
 * @param query      - Natural-language query text.
 * @param limit      - Maximum number of results to return.
 * @param model      - Embedding model name passed to model-manager.
 * @returns Chunks ranked by cosine similarity (highest first).
 */
export async function semanticSearch(
  client: KadiClient,
  database: string,
  collection: string,
  query: string,
  limit: number,
  model: string,
  embedding?: EmbeddingConfig,
): Promise<SearchResult[]> {
  const safeLimit = sanitizeInt(limit, 'limit');
  const { vectors } = await embedTexts(client, [query], model, embedding);
  if (vectors.length === 0) return [];

  const vectorStr = '[' + vectors[0].join(',') + ']';

  // Pattern: validated-sql.md section 4 — "Vector Similarity Search (Ranked)"
  const sql =
    `SELECT chunkId, source, title, content, metadata,` +
    ` vectorCosineSimilarity(embedding, ${vectorStr}) AS score` +
    ` FROM Chunk` +
    ` WHERE collection = '${escapeSQL(collection)}'` +
    ` AND embedding IS NOT NULL` +
    ` ORDER BY score DESC` +
    ` LIMIT ${safeLimit}`;

  const response = (await client.invokeRemote('arcade-query', {
    database,
    query: sql,
  })) as ArcadeQueryResult;

  if (!response.success) {
    throw new Error(
      `Semantic search failed on collection "${collection}" (database: ${database}): ${response.error ?? 'unknown error from arcade-query'}`,
    );
  }

  return mapResults(response.result ?? []);
}

/**
 * Execute a keyword search using ArcadeDB's full-text index.
 *
 * ArcadeDB's `search_fields()` function does not return a relevance score,
 * so results are assigned a descending pseudo-score based on their position
 * in the result set (1.0 for first, decreasing by 0.01 per rank).
 *
 * This pseudo-score is intentionally coarse.  When used standalone it
 * preserves the database's relevance ordering.  When fed into Reciprocal
 * Rank Fusion (hybrid mode), RRF uses ordinal rank — not the score value
 * itself — so the exact magnitude does not affect fusion quality.
 *
 * @param client     - KadiClient connected to a broker with arcadedb-ability.
 * @param database   - Target ArcadeDB database name.
 * @param collection - Collection to search within.
 * @param query      - Full-text query (supports Lucene syntax: AND, OR, phrases).
 * @param limit      - Maximum number of results to return.
 * @returns Chunks ordered by full-text relevance with pseudo-scores.
 */
export async function keywordSearch(
  client: KadiClient,
  database: string,
  collection: string,
  query: string,
  limit: number,
): Promise<SearchResult[]> {
  const safeLimit = sanitizeInt(limit, 'limit');

  // Pattern: validated-sql.md section 5 — "search_fields() function"
  const sql =
    `SELECT chunkId, source, title, content, metadata` +
    ` FROM Chunk` +
    ` WHERE collection = '${escapeSQL(collection)}'` +
    ` AND search_fields('content', '${escapeSQL(query)}') = true` +
    ` LIMIT ${safeLimit}`;

  const response = (await client.invokeRemote('arcade-query', {
    database,
    query: sql,
  })) as ArcadeQueryResult;

  if (!response.success) {
    throw new Error(
      `Keyword search failed on collection "${collection}" (database: ${database}, query: "${query.slice(0, 100)}"): ${response.error ?? 'unknown error from arcade-query'}`,
    );
  }

  if (!response.result) return [];

  // Assign rank-based pseudo-scores (see JSDoc above for rationale).
  return response.result.map((row, index) => ({
    chunkId: row.chunkId as string,
    source: row.source as string,
    title: row.title as string,
    content: row.content as string,
    score: 1 - index * 0.01,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
  }));
}

/**
 * Execute a hybrid search — run semantic and keyword searches in parallel,
 * then merge results using Reciprocal Rank Fusion (RRF).
 *
 * Each source fetches `limit * {@link HYBRID_FETCH_MULTIPLIER}` candidates
 * so that RRF has enough signal to produce a well-ranked final list.  The
 * fused results are then trimmed back to the requested limit.
 *
 * @param client     - KadiClient connected to a broker with arcadedb-ability.
 * @param database   - Target ArcadeDB database name.
 * @param collection - Collection to search within.
 * @param query      - Query text (used for both embedding and full-text).
 * @param limit      - Maximum number of final results to return.
 * @param model      - Embedding model name passed to model-manager.
 * @returns Chunks ranked by fused RRF score (highest first).
 */
export async function hybridSearch(
  client: KadiClient,
  database: string,
  collection: string,
  query: string,
  limit: number,
  model: string,
  embedding?: EmbeddingConfig,
): Promise<SearchResult[]> {
  const fetchLimit = limit * HYBRID_FETCH_MULTIPLIER;

  const [semanticResults, keywordResults] = await Promise.all([
    semanticSearch(client, database, collection, query, fetchLimit, model, embedding),
    keywordSearch(client, database, collection, query, fetchLimit),
  ]);

  // Add `id` field (required by RRF) using chunkId as the dedup key
  const toRanked = (r: SearchResult): RankedSearchResult => ({
    ...r,
    id: r.chunkId,
  });

  const fused = reciprocalRankFusion([
    semanticResults.map(toRanked),
    keywordResults.map(toRanked),
  ]);

  // RRF returns ScoredItem<RankedSearchResult>, which already has all
  // SearchResult fields plus the fused `score` — just drop the extra `id`.
  return fused.slice(0, limit).map(({ id: _id, ...item }) => item);
}

/**
 * Find chunks similar to a given chunk by reusing its stored embedding.
 *
 * Looks up the source chunk's embedding, then runs a cosine similarity
 * search excluding the source chunk itself.  Throws if the source chunk
 * exists but has no embedding (caller should re-index to fix this).
 *
 * @param client     - KadiClient connected to a broker with arcadedb-ability.
 * @param database   - Target ArcadeDB database name.
 * @param collection - Collection to search within.
 * @param chunkId    - ID of the source chunk to find neighbors for.
 * @param limit      - Maximum number of results to return.
 * @returns Similar chunks ranked by cosine similarity, excluding the source.
 */
export async function similarSearch(
  client: KadiClient,
  database: string,
  collection: string,
  chunkId: string,
  limit: number,
): Promise<SearchResult[]> {
  const safeLimit = sanitizeInt(limit, 'limit');
  const escapedChunkId = escapeSQL(chunkId);

  // Step 1: Fetch the source chunk's embedding vector
  const fetchSql = `SELECT embedding FROM Chunk WHERE chunkId = '${escapedChunkId}'`;
  const fetchResponse = (await client.invokeRemote('arcade-query', {
    database,
    query: fetchSql,
  })) as ArcadeQueryResult;

  if (!fetchResponse.success) {
    throw new Error(
      `Similar search failed: could not fetch source chunk "${chunkId}" from collection "${collection}" (database: ${database}): ${fetchResponse.error ?? 'unknown error from arcade-query'}`,
    );
  }

  if (!fetchResponse.result || fetchResponse.result.length === 0) {
    throw new Error(
      `Similar search failed: chunk "${chunkId}" not found in collection "${collection}" (database: ${database}). ` +
      `Verify the chunkId is correct and the collection has been indexed.`,
    );
  }

  const embedding = fetchResponse.result[0].embedding as number[] | null;
  if (!embedding || embedding.length === 0) {
    throw new Error(
      `Chunk "${chunkId}" exists but has no embedding vector. ` +
      `Re-index the source document to generate embeddings.`,
    );
  }

  // Step 2: Find similar chunks using the fetched embedding
  const vectorStr = '[' + embedding.join(',') + ']';

  // Pattern: validated-sql.md section 4 — "Vector Similarity Search (Ranked)"
  const sql =
    `SELECT chunkId, source, title, content, metadata,` +
    ` vectorCosineSimilarity(embedding, ${vectorStr}) AS score` +
    ` FROM Chunk` +
    ` WHERE collection = '${escapeSQL(collection)}'` +
    ` AND embedding IS NOT NULL` +
    ` AND chunkId != '${escapedChunkId}'` +
    ` ORDER BY score DESC` +
    ` LIMIT ${safeLimit}`;

  const response = (await client.invokeRemote('arcade-query', {
    database,
    query: sql,
  })) as ArcadeQueryResult;

  if (!response.success) {
    throw new Error(
      `Similar search failed: cosine similarity query failed for chunk "${chunkId}" in collection "${collection}" (database: ${database}): ${response.error ?? 'unknown error from arcade-query'}`,
    );
  }

  return mapResults(response.result ?? []);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Map raw ArcadeDB result rows into typed {@link SearchResult} objects.
 */
function mapResults(rows: Array<Record<string, unknown>>): SearchResult[] {
  return rows.map((row) => ({
    chunkId: row.chunkId as string,
    source: row.source as string,
    title: row.title as string,
    content: row.content as string,
    score: (row.score as number) ?? 0,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
  }));
}
