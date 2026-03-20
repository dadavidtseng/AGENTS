/**
 * Schema bootstrap — idempotent creation of the target database, the Chunk
 * document type, properties, and indexes in ArcadeDB via arcadedb-ability tools.
 *
 * **Startup validation** (`ensureDatabase`):
 *   - On startup, validates that ArcadeDB is reachable and the target database
 *     exists.  If the database is missing it is created automatically.
 *   - Uses exponential back-off with retry (default 5 attempts, 2 s → 16 s)
 *     because arcadedb-ability may still be starting when search-ability
 *     connects to the broker.
 *   - After the database is confirmed, `ensureSchema` is called once to
 *     bootstrap the Chunk type, properties, and indexes.
 *
 * **Idempotency strategy**:
 *   - Type and property DDL use `IF NOT EXISTS` (validated in `.dev/validated-sql.md`
 *     sections 1–2).  These are batched into a single `arcade-batch` call.
 *   - Index DDL (`CREATE INDEX ON ...`) does NOT support `IF NOT EXISTS` in
 *     ArcadeDB — so we catch "already exists" errors by matching the error
 *     message string.  Each index is a separate call because `arcade-batch`
 *     rolls back on any error.
 *   - The vector index is created lazily after the first embedding reveals
 *     the dimensionality of the model output.
 *
 * **Performance**: Schema verification is cached per-process via `schemaCreated`.
 * First call makes 1 batch + up to 4 individual calls.  Subsequent calls are no-ops.
 *
 * All DDL syntax follows `.dev/validated-sql.md` exactly.  The IF NOT EXISTS
 * placement for properties is between the property name and the type
 * (e.g., `CREATE PROPERTY Chunk.name IF NOT EXISTS STRING`).
 */

import type { KadiClient } from '@kadi.build/core';

import { sanitizeInt, type ArcadeCommandResult } from './sql.js';

// ---------------------------------------------------------------------------
// Module-level cache flags
// ---------------------------------------------------------------------------

/**
 * Tracks whether `ensureDatabase` has successfully validated (and potentially
 * created) the target database + schema during this process lifetime.
 */
let databaseReady = false;

/**
 * Module-level flag tracking whether the schema has been verified during
 * this process lifetime.  Resets on restart (safe — DDL is idempotent).
 */
let schemaCreated = false;

// ---------------------------------------------------------------------------
// Database startup validation
// ---------------------------------------------------------------------------

/** Default retry settings for ensureDatabase(). */
const DB_RETRY_DEFAULTS = {
  maxAttempts: 5,
  initialDelayMs: 2_000,
} as const;

/**
 * Sleep helper.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Validate that the target ArcadeDB database exists and is ready.
 * If it does not exist, create it.  Then bootstrap the Chunk schema.
 *
 * Uses exponential back-off to tolerate arcadedb-ability still starting.
 *
 * @param client   - KadiClient already connected to the broker.
 * @param database - Target database name (e.g., `kadi_memory`).
 * @param options  - Optional retry tuning.
 */
export async function ensureDatabase(
  client: KadiClient,
  database: string,
  options?: { maxAttempts?: number; initialDelayMs?: number },
): Promise<void> {
  if (databaseReady) return;

  const maxAttempts = options?.maxAttempts ?? DB_RETRY_DEFAULTS.maxAttempts;
  const initialDelay = options?.initialDelayMs ?? DB_RETRY_DEFAULTS.initialDelayMs;

  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      console.log(
        `[search-ability] Database validation attempt ${attempt}/${maxAttempts}…`,
      );

      // Step 1 — Check if arcadedb-ability is reachable and list databases.
      const listResult = (await client.invokeRemote('arcade-db-list', {})) as {
        success: boolean;
        databases?: string[];
        error?: string;
      };

      if (!listResult.success) {
        throw new Error(
          `arcade-db-list failed: ${listResult.error ?? 'unknown error'}`,
        );
      }

      const databases: string[] = listResult.databases ?? [];

      // Step 2 — Create the database if it's missing.
      if (!databases.includes(database)) {
        console.log(
          `[search-ability] Database "${database}" not found — creating…`,
        );

        const createResult = (await client.invokeRemote('arcade-db-create', {
          name: database,
        })) as ArcadeCommandResult;

        if (!createResult.success) {
          // Race condition: another process may have just created it.
          const err = (createResult.error ?? '').toLowerCase();
          if (!err.includes('already exists') && !err.includes('exists')) {
            throw new Error(
              `arcade-db-create failed: ${createResult.error ?? 'unknown error'}`,
            );
          }
          console.log(
            `[search-ability] Database "${database}" was created concurrently — continuing.`,
          );
        } else {
          console.log(
            `[search-ability] Database "${database}" created successfully.`,
          );
        }
      } else {
        console.log(
          `[search-ability] Database "${database}" already exists.`,
        );
      }

      // Step 3 — Bootstrap the Chunk schema (idempotent).
      await ensureSchema(client, database);

      databaseReady = true;
      console.log(
        `[search-ability] ✓ Database "${database}" validated and ready.`,
      );
      return;
    } catch (err: unknown) {
      lastError =
        err instanceof Error ? err : new Error(String(err));

      if (attempt < maxAttempts) {
        const delay = initialDelay * Math.pow(2, attempt - 1);
        console.warn(
          `[search-ability] Validation attempt ${attempt} failed: ${lastError.message}` +
            ` — retrying in ${delay}ms…`,
        );
        await sleep(delay);
      }
    }
  }

  // All attempts exhausted — non-fatal.  Tools will still try ensureSchema()
  // lazily on first request, but warn loudly so operators notice.
  console.error(
    `[search-ability] ⚠ Database validation failed after ${maxAttempts} attempts. ` +
      `Last error: ${lastError?.message ?? 'unknown'}. ` +
      `Tools will attempt lazy schema setup on first request.`,
  );
}

// ---------------------------------------------------------------------------
// Schema bootstrap
// ---------------------------------------------------------------------------

/**
 * Ensure the Chunk document type, all properties, and basic indexes exist.
 *
 * Safe to call on every request — all DDL is idempotent and results are
 * cached after the first successful run.
 *
 * @param client   - KadiClient connected to a broker with arcadedb-ability.
 * @param database - Target ArcadeDB database name.
 */
export async function ensureSchema(
  client: KadiClient,
  database: string,
): Promise<void> {
  if (schemaCreated) return;

  // Phase 1: Batch the type + properties in a single call.
  // All use IF NOT EXISTS so they're safe to batch (no errors on re-run).
  const ddlCommands = [
    'CREATE DOCUMENT TYPE Chunk IF NOT EXISTS',
    'CREATE PROPERTY Chunk.chunkId IF NOT EXISTS STRING',
    'CREATE PROPERTY Chunk.collection IF NOT EXISTS STRING',
    'CREATE PROPERTY Chunk.source IF NOT EXISTS STRING',
    'CREATE PROPERTY Chunk.title IF NOT EXISTS STRING',
    'CREATE PROPERTY Chunk.content IF NOT EXISTS STRING',
    'CREATE PROPERTY Chunk.embedding IF NOT EXISTS LIST',
    'CREATE PROPERTY Chunk.tokens IF NOT EXISTS INTEGER',
    'CREATE PROPERTY Chunk.metadata IF NOT EXISTS MAP',
    'CREATE PROPERTY Chunk.chunkIndex IF NOT EXISTS INTEGER',
    'CREATE PROPERTY Chunk.totalChunks IF NOT EXISTS INTEGER',
    'CREATE PROPERTY Chunk.createdAt IF NOT EXISTS DATETIME',
  ];

  const batchResult = (await client.invokeRemote('arcade-batch', {
    database,
    commands: ddlCommands,
  })) as ArcadeCommandResult;

  if (!batchResult.success) {
    throw new Error(
      `Schema setup failed during type/property creation (database: ${database}): ${batchResult.error}`,
    );
  }

  // Phase 2: Create indexes individually — ArcadeDB has no IF NOT EXISTS
  // for indexes, so each may fail with "already exists" which we ignore.
  const indexCommands = [
    'CREATE INDEX ON Chunk (chunkId) UNIQUE',
    'CREATE INDEX ON Chunk (collection) NOTUNIQUE',
    'CREATE INDEX ON Chunk (source) NOTUNIQUE',
    'CREATE INDEX ON Chunk (content) FULL_TEXT',
  ];

  for (const command of indexCommands) {
    const result = (await client.invokeRemote('arcade-command', {
      database,
      command,
    })) as ArcadeCommandResult;

    if (!result.success && result.error) {
      if (isAlreadyExistsError(result.error)) continue;
      throw new Error(
        `Schema setup failed on command "${command}" (database: ${database}): ${result.error}`,
      );
    }
  }

  schemaCreated = true;
}

/**
 * Module-level flag tracking whether the vector index has been created
 * during this process lifetime.
 *
 * This is an optimization to avoid a round-trip on every indexing call.
 * It resets on process restart, which is safe: a redundant CREATE INDEX
 * attempt will simply hit the "already exists" path and set the flag again.
 *
 * NOT safe across multiple processes — each process independently verifies
 * the index exists on its first embedding operation.
 */
let vectorIndexCreated = false;

/**
 * Ensure the LSM_VECTOR index exists for cosine similarity search.
 *
 * Called lazily after the first embedding operation determines the vector
 * dimensionality (e.g., 768 for nomic-embed-text).  Subsequent calls within
 * the same process are no-ops.
 *
 * @param client     - KadiClient connected to a broker with arcadedb-ability.
 * @param database   - Target ArcadeDB database name.
 * @param dimensions - Embedding vector dimensions (e.g., 768, 1536).
 */
export async function ensureVectorIndex(
  client: KadiClient,
  database: string,
  dimensions: number,
): Promise<void> {
  if (vectorIndexCreated) return;

  const safeDimensions = sanitizeInt(dimensions, 'dimensions');

  // Pattern: validated-sql.md section 4 — "Create Vector Index (LSM_VECTOR)"
  const command =
    `CREATE INDEX ON Chunk (embedding) LSM_VECTOR METADATA` +
    ` {"dimensions": ${safeDimensions}, "similarity": "COSINE"}`;

  const result = (await client.invokeRemote('arcade-command', {
    database,
    command,
  })) as ArcadeCommandResult;

  if (result.success) {
    vectorIndexCreated = true;
    return;
  }

  if (result.error && isAlreadyExistsError(result.error)) {
    vectorIndexCreated = true;
    return;
  }

  // result.success is false and the error is not an "already exists" message.
  // Even if result.error is empty, this is a failed command -- do not silently succeed.
  throw new Error(
    `Vector index creation failed for ${safeDimensions}-dimensional embedding ` +
    `(database: ${database}): ${result.error ?? 'unknown error (no message returned by arcade-command)'}`,
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Check whether an ArcadeDB error message indicates that the DDL target
 * (type, property, or index) already exists.
 *
 * ArcadeDB does not support `IF NOT EXISTS` for `CREATE INDEX`, so we must
 * detect idempotent failures by inspecting the error text.  This is fragile
 * by nature — if ArcadeDB changes its error wording, this function must be
 * updated.  The set of patterns was validated against ArcadeDB 26.2.1
 * (see `.dev/validated-sql.md`).
 */
function isAlreadyExistsError(error: string): boolean {
  const lower = error.toLowerCase();
  return (
    lower.includes('already exists') ||
    lower.includes('index already') ||
    lower.includes('duplicate')
  );
}
