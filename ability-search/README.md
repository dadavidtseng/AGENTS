# search-ability

KADI ability that provides chunking, embedding, and hybrid search over text content. Exposes 8 broker-callable tools for indexing documents, querying with semantic/keyword/hybrid search, and managing search collections.

**search-ability stores nothing directly.** All persistence goes through `arcadedb-ability` tools via the broker, and all embeddings come from `model-manager`'s `create-embedding` tool via the broker. This makes search-ability a pure intermediary — it chunks text, orchestrates embedding, builds search queries, and merges results.

## Loading This Ability

From another KADI agent:

```typescript
// Via broker (remote, any machine)
const search = await client.loadBroker('search-ability');

// Via stdio (local, same machine)
const search = await client.loadStdio('search-ability');

// Then invoke any tool
const result = await search.invoke('search-query', {
  collection: 'papers',
  query: 'reciprocal rank fusion',
  mode: 'hybrid',
});
```

## Tools

### Index Tools

These tools add, replace, and remove documents from search collections.

#### search-index

Chunk, embed, and store documents in a collection. Creates the database schema and vector index automatically on first use.

**Input:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `collection` | string | yes | Collection name to index into |
| `documents` | array | yes | Documents to index (see format below) |
| `chunkStrategy` | string | no | `markdown-headers`, `code-blocks`, `paragraph`, `sliding-window`, or `auto` (default: `auto`) |
| `maxTokens` | number | no | Max tokens per chunk (default: 500) |
| `model` | string | no | Embedding model (default: `nomic-embed-text`) |

Each document in the `documents` array:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `source` | string | yes | Unique source identifier (e.g., file path, URL) |
| `title` | string | yes | Human-readable title |
| `content` | string | yes | Full text content to chunk and index |
| `metadata` | object | no | Arbitrary metadata attached to each chunk |

**Output:**

```json
{
  "indexed": true,
  "collection": "papers",
  "documents": 3,
  "chunks": 42,
  "model": "nomic-embed-text",
  "dimensions": 768
}
```

**Example:**

```
search-index {
  collection: "papers",
  documents: [
    {
      source: "paper-01.md",
      title: "Reciprocal Rank Fusion",
      content: "# Introduction\n\nRRF is a method for combining...",
      metadata: { year: 2024, topic: "information-retrieval" }
    }
  ],
  chunkStrategy: "markdown-headers"
}
```

#### search-index-file

Read a file from disk, detect its format, and index it. Delegates to the `search-index` pipeline.

**Input:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `collection` | string | yes | Collection name to index into |
| `filePath` | string | yes | Absolute path to the file |
| `format` | string | no | `markdown`, `json`, or `text` (auto-detected from extension if omitted) |
| `chunkStrategy` | string | no | Chunking strategy (default: `auto`) |

**Output:** Same as `search-index`.

**Example:**

```
search-index-file {
  collection: "docs",
  filePath: "/data/architecture.md",
  chunkStrategy: "markdown-headers"
}
```

#### search-reindex

Delete all chunks in a collection. The caller must re-index afterward.

**Input:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `collection` | string | yes | Collection to clear |

**Output:**

```json
{
  "collection": "papers",
  "deleted": 42,
  "message": "Collection cleared. Re-index to repopulate."
}
```

#### search-delete

Delete chunks by collection, optionally filtered by source document.

**Input:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `collection` | string | yes | Collection to delete from |
| `source` | string | no | Delete only chunks from this source |

**Output:**

```json
{ "deleted": 12, "collection": "papers", "source": "paper-01.md" }
```

### Query Tools

These tools search indexed content.

#### search-query

Search a collection using semantic, keyword, or hybrid mode.

**Input:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `collection` | string | yes | Collection to search |
| `query` | string | yes | Search query text |
| `limit` | number | no | Max results (default: 10) |
| `mode` | string | no | `semantic`, `keyword`, or `hybrid` (default: `hybrid`) |
| `model` | string | no | Embedding model for semantic search (default: `nomic-embed-text`) |

**Output:**

```json
{
  "results": [
    {
      "chunkId": "papers:paper-01.md:3",
      "source": "paper-01.md",
      "title": "Reciprocal Rank Fusion",
      "content": "RRF combines multiple ranked lists...",
      "score": 0.847,
      "metadata": { "year": 2024 }
    }
  ],
  "count": 5,
  "query": "rank fusion methods",
  "collection": "papers",
  "mode": "hybrid"
}
```

**Search Modes:**

- **`semantic`** — Embeds the query and finds chunks with similar embeddings using cosine similarity. Best for meaning-based search ("concepts related to X").
- **`keyword`** — Full-text search using ArcadeDB's `search_fields()` with Lucene syntax. Best for exact terms, names, or technical identifiers.
- **`hybrid`** (default) — Runs both semantic and keyword search in parallel, then merges results using Reciprocal Rank Fusion (RRF). Best general-purpose mode.

#### search-similar

Find chunks similar to a given chunk using its embedding vector.

**Input:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `collection` | string | yes | Collection to search in |
| `chunkId` | string | yes | ID of the source chunk |
| `limit` | number | no | Max results (default: 10) |

**Output:**

```json
{
  "results": [
    {
      "chunkId": "papers:paper-02.md:1",
      "source": "paper-02.md",
      "title": "Learning to Rank",
      "content": "Ranking methods for information retrieval...",
      "score": 0.923
    }
  ],
  "count": 3,
  "sourceChunk": "papers:paper-01.md:3"
}
```

### Collection Tools

These tools inspect indexed collections.

#### search-collections

List all collections with chunk statistics.

**Input:** `{}` (no parameters)

**Output:**

```json
{
  "collections": [
    { "name": "papers", "chunks": 42, "minTokens": 50, "maxTokens": 498, "avgTokens": 312 },
    { "name": "docs", "chunks": 18, "minTokens": 80, "maxTokens": 450, "avgTokens": 290 }
  ]
}
```

#### search-collection-info

Get detailed statistics and source list for a single collection.

**Input:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `collection` | string | yes | Collection name |

**Output:**

```json
{
  "collection": "papers",
  "chunks": 42,
  "minTokens": 50,
  "maxTokens": 498,
  "avgTokens": 312,
  "sources": ["paper-01.md", "paper-02.md", "paper-03.md"]
}
```

## Chunking Strategies

When indexing documents, you choose how content is split into chunks. Each strategy is optimized for different content types.

| Strategy | Best For | How It Works |
|----------|----------|-------------|
| `markdown-headers` | Markdown documents with `#` headings | Splits on headings, preserves hierarchy as breadcrumbs (e.g., `"Main > Sub"`). Never splits fenced code blocks. |
| `code-blocks` | Technical docs with fenced code blocks | Each fenced block becomes its own chunk with `metadata.language`. Prose between blocks becomes context chunks. |
| `paragraph` | Plain text, prose, articles | Splits on `\n\n`. Merges short paragraphs below threshold. Splits long ones at sentence boundaries. |
| `sliding-window` | Dense text where context overlap matters | Fixed-size windows (default 500 tokens, 50 overlap). Snaps to sentence/paragraph breaks. |
| `auto` (default) | When you don't know the content type | Inspects content: 3+ headings -> `markdown-headers`, 3+ fenced code blocks -> `code-blocks`, else -> `paragraph`. |

## How Hybrid Search Works

Hybrid search combines two complementary retrieval methods:

1. **Semantic search** — The query is embedded via `create-embedding`, then compared against chunk embeddings using `vectorCosineSimilarity()`. Finds conceptually similar content even with different wording.

2. **Keyword search** — The query is passed to ArcadeDB's full-text index via `search_fields()`. Finds exact term matches using Lucene syntax.

3. **Reciprocal Rank Fusion (RRF)** — Both result lists are merged using:

   ```
   RRF(d) = sum over rankings of 1 / (k + rank(d))
   ```

   where `k = 60`. Documents appearing in both lists get combined scores. Final results are sorted by RRF score descending.

This approach ensures that documents strongly ranked by either method surface to the top, while documents ranked well by both methods get a significant boost.

## Error Handling

All tools return structured responses. On failure:

```json
{
  "success": false,
  "error": "Description of what went wrong",
  "hint": "Actionable suggestion for the calling agent"
}
```

Common error patterns:

| Situation | Error looks like |
|-----------|-----------------|
| ArcadeDB not running | `invokeRemote failed: arcade-command ...` |
| Model not available | `invokeRemote failed: create-embedding ...` |
| Collection not found | `No chunks found for collection "..."` |
| File not found | `File not found: /path/to/file` |
| Invalid chunk strategy | `Unknown chunk strategy: "..."` |

## Prerequisites

search-ability **auto-validates its database on startup**. When connecting in broker mode, it checks whether the target ArcadeDB database exists (via `arcade-db-list`) and creates it automatically if missing (via `arcade-db-create`), then bootstraps the Chunk schema (type, properties, indexes). This uses exponential back-off retry (5 attempts, 2s → 16s) to tolerate arcadedb-ability still starting.

Startup validation is **non-fatal** — if arcadedb-ability is unreachable after all retries, the agent logs a warning and tools fall back to lazy schema setup on first request.

Startup log output:

```
[search-ability] Database validation attempt 1/5…
[search-ability] Database "kadi_memory" already exists.
[search-ability] ✓ Database "kadi_memory" validated and ready.
```

Or if the database was missing:

```
[search-ability] Database validation attempt 1/5…
[search-ability] Database "kadi_memory" not found — creating…
[search-ability] Database "kadi_memory" created successfully.
[search-ability] ✓ Database "kadi_memory" validated and ready.
```

### Dependencies

search-ability requires these services on the broker:

| Service | Tools Used | Purpose |
|---------|-----------|---------|
| `arcadedb-ability` | `arcade-command`, `arcade-query`, `arcade-batch`, `arcade-db-list`, `arcade-db-create` | Store and retrieve chunks; startup database validation |
| `model-manager` | `create-embedding` | Generate embedding vectors |

## Configuration

Settings come from three sources, resolved in priority order:

1. **Environment variables** — highest priority, override everything
2. **Vault `models`** — credentials encrypted in `secrets.toml` (walk-up discovery)
3. **`config.yml`** — non-secret settings only (walk-up discovery)
4. **Built-in defaults** — lowest priority

> **Convention Section 6:** Credentials (API keys, URLs with tokens) are stored in the `models` vault via `secrets.toml`, never in `config.yml`.

### config.yml

Non-sensitive settings only. Credentials go in the vault.

```yaml
search:
  chunk_size: 500
  embedding_model: nomic-embed-text
  database: kadi_memory
  embedding_transport: api        # 'api' (default) or 'broker'
  # embedding_api_url comes from vault SEARCH_EMBEDDING_API_URL — do not put it here
```

### Secrets (vault `models`)

Credentials are stored in the encrypted `models` vault in `secrets.toml`. search-ability loads them at startup via `secret-ability` (`loadNative`).

| Vault Key | Used As | Description |
|-----------|---------|-------------|
| `SEARCH_API_KEY` | `apiKey` | API key for model-manager (required when `REQUIRE_USER_KEY=true`) |
| `SEARCH_EMBEDDING_API_URL` | `embeddingApiUrl` | Direct URL for model-manager API transport |

To set up the vault:

```bash
# Store API key in the models vault
kadi secret set SEARCH_API_KEY "your-api-key" -v models

# Store model-manager URL
kadi secret set SEARCH_EMBEDDING_API_URL "http://model-manager:8000" -v models
```

### Environment variables

Env vars override both vault and config.yml values.

| Variable | Default | Description |
|----------|---------|-------------|
| `SEARCH_CHUNK_SIZE` | `500` | Default max tokens per chunk |
| `SEARCH_EMBEDDING_MODEL` | `nomic-embed-text` | Default embedding model |
| `SEARCH_DATABASE` | `kadi_memory` | ArcadeDB database name for chunk storage |
| `SEARCH_EMBEDDING_TRANSPORT` | `api` | `broker` or `api` (see below) |
| `SEARCH_EMBEDDING_API_URL` | — | Direct URL for API transport (overrides vault `SEARCH_EMBEDDING_API_URL`) |
| `SEARCH_API_KEY` | — | API key for model-manager (overrides vault `SEARCH_API_KEY`) |

### Embedding transport

search-ability supports two ways to reach the embedding service:

| Transport | How it works | When to use |
|-----------|-------------|-------------|
| `api` (default) | Direct HTTP POST to an OpenAI-compatible `/v1/embeddings` endpoint | ~10x faster than broker messages. Use when model-manager is reachable over HTTP (same network, sidecar, etc.) |
| `broker` | Calls `create-embedding` via KADI broker messages | Fallback when model-manager is not directly reachable over HTTP |

The URL and key are loaded from the `models` vault automatically:

```bash
kadi secret set SEARCH_EMBEDDING_API_URL "http://model-manager:8000" -v models
kadi secret set SEARCH_API_KEY "your-key-here" -v models
```

To fall back to broker transport, set it in `config.yml`:

```yaml
search:
  embedding_transport: broker
```

Or via env var override (e.g. for one-off testing):

```bash
SEARCH_EMBEDDING_TRANSPORT=broker \
node dist/index.js broker
```

### API key

When model-manager runs with `REQUIRE_USER_KEY=true`, every `create-embedding` call must include an API key. The key is resolved as: `SEARCH_API_KEY` env var → vault `SEARCH_API_KEY` → (none). This key is passed through on both broker and API transports.

---

## For Developers

Everything below is for humans working on this ability's source code.

### Prerequisites

- Node.js 22+
- A KADI broker with `arcadedb-ability` and `model-manager` registered (for integration tests)

### Setup

```bash
npm install
npm run build
```

### Running

```bash
# Stdio mode (for loadStdio)
node dist/index.js

# Broker mode (registers tools with KADI broker)
node dist/index.js broker

# Dev mode (TypeScript directly)
npx tsx src/index.ts
```

### Testing

```bash
# Unit tests (no external deps)
npm run test:unit

# Integration tests (requires broker + arcadedb-ability + model-manager)
npm run test:integration

# All tests
npm test
```

### Project Structure

```
search-ability/
  agent.json              KADI manifest (kind: ability, secret-ability dep)
  config.yml              Non-sensitive settings (chunk_size, model, database)
  src/
    index.ts              Entry point: async init, vault config, KadiClient + 8 tools + connect + startup DB validation
    lib/
      config.ts           Config loader (env vars → vault → config.yml → defaults)
      tokens.ts           Lightweight token estimation (no tokenizer dep)
      chunker.ts          5 chunking strategies
      embedder.ts         Batched embedding via model-manager
      searcher.ts         Semantic, keyword, and hybrid search
      rrf.ts              Reciprocal Rank Fusion
      schema.ts           ensureDatabase() startup validation + idempotent Chunk type + indexes bootstrap
      sql.ts              SQL escaping utilities (escapeSQL, sanitizeInt)
    tools/
      index-tools.ts      search-index, search-index-file, search-reindex, search-delete
      query-tools.ts      search-query, search-similar
      collection-tools.ts search-collections, search-collection-info
  tests/
    unit/
      tokens.test.ts      Token estimation tests
      chunker.test.ts     All 5 strategies tested
      rrf.test.ts         RRF math and merging
    integration/
      search.test.ts      Round-trip: index -> query -> verify results
```
