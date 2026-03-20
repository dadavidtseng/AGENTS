/**
 * Embedding pipeline -- batches text through model-manager via either:
 *   - **broker** (default): `invokeRemote('create-embedding', ...)` over KADI protocol
 *   - **api**: direct HTTP POST to an OpenAI-compatible `/v1/embeddings` endpoint
 *
 * The transport is selected via {@link EmbeddingConfig.transport}.
 *
 * Both paths return the same {@link EmbedResult} shape. The response contract
 * mirrors the OpenAI `/v1/embeddings` response schema regardless of transport.
 */

import type { KadiClient } from '@kadi.build/core';

import type { EmbeddingTransport } from './config.js';

// ---------------------------------------------------------------------------
// OpenAI-compatible embedding API response types
// ---------------------------------------------------------------------------

/** A single embedding vector returned by the embedding API. */
interface EmbeddingEntry {
  /** The embedding vector (array of floats). */
  embedding: number[];
  /** Positional index corresponding to the input text at that offset. */
  index: number;
}

/** Token usage statistics returned alongside embeddings. */
interface EmbeddingUsage {
  prompt_tokens: number;
  total_tokens: number;
}

/**
 * Full response from model-manager's `create-embedding` tool.
 * Mirrors the OpenAI `/v1/embeddings` response schema.
 */
interface EmbeddingApiResponse {
  data: EmbeddingEntry[];
  model: string;
  usage: EmbeddingUsage;
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Result of an embedding operation over one or more texts. */
export interface EmbedResult {
  /** Embedding vectors in the same order as the input texts. */
  vectors: number[][];
  /** Dimensionality of the embedding model (e.g. 768 for nomic-embed-text). */
  dimensions: number;
}

/** Configuration for how to reach the embedding service. */
export interface EmbeddingConfig {
  transport: EmbeddingTransport;
  apiUrl?: string;
  apiKey?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Maximum texts per batch request.
 *
 * OpenAI-compatible embedding APIs (including Ollama and vLLM) typically cap
 * batch size at 2048 inputs, but many local model servers (especially Ollama
 * behind model-manager) perform best with smaller batches. 100 keeps memory
 * pressure low on GPU-constrained hosts while still amortizing per-request
 * overhead effectively.
 */
const MAX_BATCH_SIZE = 100;

/** Max retries for transient embedding failures (network drops, 502/503). */
const MAX_RETRIES = 3;

/** Base delay between retries (exponential backoff: 2s, 4s, 8s). */
const RETRY_BASE_MS = 2000;

// ---------------------------------------------------------------------------
// Core pipeline
// ---------------------------------------------------------------------------

/**
 * Embed an array of texts using model-manager.
 *
 * Texts are batched in groups of {@link MAX_BATCH_SIZE} to stay within API
 * limits and manage memory on the model server. Batches are processed
 * sequentially to avoid overwhelming the model server with concurrent
 * requests -- embedding is GPU-bound, so parallelism offers no throughput
 * gain and risks OOM on smaller hosts.
 *
 * @param client   - KadiClient (only used when transport is "broker").
 * @param texts    - Array of texts to embed. May be empty.
 * @param model    - Embedding model name (e.g. "text-embedding-3-small").
 * @param embedding - Transport configuration (broker vs api, URL, key).
 * @returns Vectors in input order, plus the dimensionality of the model.
 * @throws {Error} If any batch request fails or returns a malformed response.
 */
export async function embedTexts(
  client: KadiClient,
  texts: string[],
  model: string = 'nomic-embed-text',
  embedding: EmbeddingConfig = { transport: 'broker' },
): Promise<EmbedResult> {
  if (texts.length === 0) {
    return { vectors: [], dimensions: 0 };
  }

  const allVectors: number[][] = [];
  const totalBatches = Math.ceil(texts.length / MAX_BATCH_SIZE);
  console.error(`[embedder] Embedding ${texts.length} texts in ${totalBatches} batches (model: ${model}, transport: ${embedding.transport})`);

  for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
    const start = batchIndex * MAX_BATCH_SIZE;
    const batch = texts.slice(start, start + MAX_BATCH_SIZE);

    const context: BatchContext = { batchIndex, totalBatches, globalOffset: start };

    // Retry transient failures (network drops, 502/503) with exponential backoff
    let lastError: Error | undefined;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        if (attempt > 0) {
          const delay = RETRY_BASE_MS * Math.pow(2, attempt - 1);
          console.error(
            `[embedder] Retry ${attempt}/${MAX_RETRIES} for batch ${batchIndex + 1}/${totalBatches} after ${delay}ms...`,
          );
          await new Promise((r) => setTimeout(r, delay));
        }

        const response = embedding.transport === 'api'
          ? await requestEmbeddingsHttp(batch, model, embedding, context)
          : await requestEmbeddingsBroker(client, batch, model, embedding.apiKey, context);

        // The API may return entries out of order (parallelized internally),
        // so sort by index to guarantee input-order alignment.
        const sorted = [...response.data].sort((a, b) => a.index - b.index);

        for (const entry of sorted) {
          allVectors.push(entry.embedding);
        }

        if (attempt > 0) {
          console.error(`[embedder] Batch ${batchIndex + 1}/${totalBatches} succeeded on attempt ${attempt + 1}`);
        } else {
          console.error(`[embedder] Batch ${batchIndex + 1}/${totalBatches} done (${sorted.length} vectors)`);
        }

        lastError = undefined;
        break; // Success — move to next batch
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));

        // Only retry on transient errors (network, 502, 503, 504)
        if (!isTransientError(lastError) || attempt === MAX_RETRIES) {
          throw lastError;
        }
      }
    }
  }

  return {
    vectors: allVectors,
    dimensions: allVectors[0].length,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Context passed to error messages for debugging batch failures. */
interface BatchContext {
  batchIndex: number;
  totalBatches: number;
  globalOffset: number;
}

/**
 * Send a batch via KADI broker (`invokeRemote('create-embedding', ...)`).
 */
async function requestEmbeddingsBroker(
  client: KadiClient,
  texts: string[],
  model: string,
  apiKey: string | undefined,
  context: BatchContext,
): Promise<EmbeddingApiResponse> {
  const batchLabel = `batch ${context.batchIndex + 1}/${context.totalBatches}`;

  let response: EmbeddingApiResponse;
  try {
    const params: Record<string, unknown> = { model, input: texts };
    if (apiKey) params.api_key = apiKey;
    response = await client.invokeRemote<EmbeddingApiResponse>(
      'create-embedding',
      params,
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Embedding request failed via broker (${batchLabel}, ` +
      `offset ${context.globalOffset}, ${texts.length} texts, model: ${model}): ${message}`,
    );
  }

  return validateResponse(response, texts.length, model, batchLabel);
}

/**
 * Send a batch via direct HTTP to an OpenAI-compatible `/v1/embeddings` endpoint.
 */
async function requestEmbeddingsHttp(
  texts: string[],
  model: string,
  config: EmbeddingConfig,
  context: BatchContext,
): Promise<EmbeddingApiResponse> {
  const batchLabel = `batch ${context.batchIndex + 1}/${context.totalBatches}`;

  if (!config.apiUrl) {
    throw new Error(
      `Embedding transport is "api" but no embedding_api_url is configured. ` +
      `Set SEARCH_EMBEDDING_API_URL or add embedding_api_url to config.yml.`,
    );
  }

  // Normalize URL: strip trailing slash, append /v1/embeddings if not present
  const baseUrl = config.apiUrl.replace(/\/+$/, '');
  const url = baseUrl.includes('/v1/embeddings')
    ? baseUrl
    : `${baseUrl}/v1/embeddings`;

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (config.apiKey) {
    headers['Authorization'] = `Bearer ${config.apiKey}`;
  }

  let httpResponse: Response;
  try {
    httpResponse = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model, input: texts }),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Embedding HTTP request failed (${batchLabel}, ` +
      `offset ${context.globalOffset}, ${texts.length} texts, model: ${model}, ` +
      `url: ${url}): ${message}`,
    );
  }

  if (!httpResponse.ok) {
    let body: string;
    try {
      body = await httpResponse.text();
    } catch {
      body = '(could not read response body)';
    }
    throw new Error(
      `Embedding HTTP ${httpResponse.status} from ${url} (${batchLabel}, ` +
      `model: ${model}): ${body.slice(0, 500)}`,
    );
  }

  let response: EmbeddingApiResponse;
  try {
    response = (await httpResponse.json()) as EmbeddingApiResponse;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Embedding response is not valid JSON (${batchLabel}, ` +
      `model: ${model}, url: ${url}): ${message}`,
    );
  }

  return validateResponse(response, texts.length, model, batchLabel);
}

/**
 * Validate that an embedding response has the expected shape and count.
 */
function validateResponse(
  response: EmbeddingApiResponse,
  expectedCount: number,
  model: string,
  batchLabel: string,
): EmbeddingApiResponse {
  if (!response || !Array.isArray(response.data)) {
    throw new Error(
      `Malformed embedding response (${batchLabel}, model: ${model}): ` +
      `expected { data: [...] }, got ${summarizeValue(response)}`,
    );
  }

  if (response.data.length !== expectedCount) {
    throw new Error(
      `Embedding count mismatch (${batchLabel}, model: ${model}): ` +
      `sent ${expectedCount} texts, received ${response.data.length} embeddings`,
    );
  }

  // Spot-check that entries have the expected fields.
  for (const entry of response.data) {
    if (!Array.isArray(entry.embedding) || typeof entry.index !== 'number') {
      throw new Error(
        `Malformed embedding entry (${batchLabel}, model: ${model}): ` +
        `expected { embedding: number[], index: number }, ` +
        `got ${summarizeValue(entry)}`,
      );
    }
  }

  return response;
}

/**
 * Produce a short, safe string summary of a value for error messages.
 * Avoids circular-reference crashes and truncates long output.
 */
function summarizeValue(value: unknown): string {
  if (value === null || value === undefined) return String(value);

  try {
    const json = JSON.stringify(value);
    if (json.length <= 200) return json;
    return json.slice(0, 200) + '...';
  } catch {
    return typeof value;
  }
}

/**
 * Determine if an embedding error is transient and safe to retry.
 * Matches network-level failures and server-side HTTP errors (502/503/504).
 */
function isTransientError(err: Error): boolean {
  const msg = err.message.toLowerCase();
  return (
    msg.includes('fetch failed') ||
    msg.includes('econnreset') ||
    msg.includes('econnrefused') ||
    msg.includes('etimedout') ||
    msg.includes('socket hang up') ||
    msg.includes('network') ||
    msg.includes('http 502') ||
    msg.includes('http 503') ||
    msg.includes('http 504') ||
    msg.includes('embedding http 502') ||
    msg.includes('embedding http 503') ||
    msg.includes('embedding http 504')
  );
}
