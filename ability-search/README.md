# ability-search
> KADI ability providing chunking, embedding, and hybrid search over text content via 8 broker-callable tools.

Overview
This package (agent name: search-ability) is a KADI "ability" that provides chunking, embedding, and hybrid search over text content. It exposes eight broker-callable tools for indexing, querying, and collection inspection. All persistence is delegated to arcadedb-ability and all embeddings come from model-manager; search-ability acts as an intermediary and orchestrator.

Quick Start
1. Clone the repo and install dependencies
   npm install

2. (Optional) Build the project (the agent expects dist/index.js as the entrypoint)
   npm run build

3. Install KADI runtime helpers (used by container/build scripts)
   kadi install

4. Start the ability connected to the broker
   kadi run start

Alternatively, to run directly (stdio mode useful for local debugging):
   node dist/index.js stdio

Notes:
- The agent.json defines scripts: "setup" runs npm install && npm run build and "start" runs node dist/index.js broker.
- Broker URL resolution follows this order: BROKER_URL env var → agent.json.brokers.default.

Tools
| Tool | Description |
| --- | --- |
| search-collections | List all search collections with chunk count and token statistics. |
| search-collection-info | Get detailed statistics and source list for a single search collection. |
| search-index | Chunk, embed, and store documents in a search collection. Creates schema and vector index automatically on first use. |
| search-index-file | Read a file from disk, detect its format, and index it into a search collection. |
| search-reindex | Delete all chunks in a collection. Caller must re-index afterward to repopulate. |
| search-delete | Delete chunks by collection, optionally filtered by source document. |
| search-query | Search a collection using semantic, keyword, or hybrid mode. Default mode is hybrid (combines both with Reciprocal Rank Fusion). |
| search-similar | Find chunks similar to a given chunk using its embedding vector. Useful for finding related passages and context expansion. |

Configuration
Files and resolution
- agent.json — present at the project root (see agent.json in repository). Used to expose broker defaults, scripts, build and deploy metadata.
- config.yml — standard KADI config walk-up (search-ability loads configuration via loadSearchConfigWithVault). Place configuration in a config.yml file located at the repo root or a parent directory.
- secrets.toml — secrets stored in the vault named "models" (walk-up). Vault keys are delivered via broker in deployment flows.
- Environment variables override config and secrets where applicable.

Important config fields (examples referenced in code and comments)
- chunk_size — integer, size (in tokens/characters) used when chunking documents.
- embedding_model — string name/identifier for the embedding model (used by model-manager).
- database — object or name pointing to the ArcadeDB database used by arcadedb-ability.
- SEARCH_API_KEY — (secret) API key for the embedding/search provider.
- SEARCH_EMBEDDING_API_URL — (secret) base URL for the embedding API.

Required secrets (declared in agent.json deploy blocks)
- SEARCH_API_KEY
- SEARCH_EMBEDDING_API_URL

Broker resolution
- The broker URL is resolved in src/index.ts using:
  1. BROKER_URL environment variable
  2. agent.json → brokers.default (string or object with url)
- If neither is present, the agent will throw an error on start.

Architecture
Key components
- src/index.ts — entrypoint. Builds a KadiClient, loads configuration and vault-based secrets, registers tools, connects to the broker, and ensures the ArcadeDB database/schema exists.
- lib/config.js — exposes loadSearchConfigWithVault used to read config.yml + secrets vault.
- lib/schema.js — exposes ensureDatabase which ensures ArcadeDB database and schema (called at startup; tools will lazily ensure schema on first request if arcadedb-ability is unavailable).
- tools/*.js — three tool registration modules:
  - tools/index-tools.js — registers indexing tools (search-index, search-index-file, search-reindex, search-delete).
  - tools/query-tools.js — registers query tools (search-query, search-similar).
  - tools/collection-tools.js — registers collection tools (search-collections, search-collection-info).
- External abilities:
  - arcadedb-ability — persistence (stores chunks, indexes, collection metadata).
  - model-manager — provides embeddings used for semantic/search vectors.

Data flow (typical index + query)
1. Indexing
   - Client calls search-index or search-index-file.
   - search-ability chunks input documents using configured chunk_size and other rules.
   - For each chunk, it requests embeddings from model-manager (via configured SEARCH_EMBEDDING_API_URL and SEARCH_API_KEY).
   - Embeddings and chunk metadata are persisted into ArcadeDB through arcadedb-ability. On first use the ability creates necessary schema and vector index automatically (ensureDatabase / lazy ensureSchema).
2. Querying
   - Client calls search-query (mode: semantic, keyword, or hybrid).
   - For semantic queries, a query embedding is requested from model-manager and nearest vectors are retrieved via arcadedb-ability.
   - Hybrid mode combines keyword ranking and semantic ranking via Reciprocal Rank Fusion (default).
   - search-similar accepts a chunk id/embedding and returns nearest chunk neighbors.
3. Collection management
   - search-collections lists collections with chunk counts and token statistics.
   - search-collection-info returns detailed per-collection stats and source lists.

Startup and runtime
- The agent registers all eight tools before connecting to the broker (see src/index.ts register*Tools calls).
- It supports two runtime modes:
  - broker (default): connects to a broker URL and serves requests over WebSocket.
  - stdio: serve on stdin/stdout (useful for testing or container entrypoints that route I/O).
- Graceful shutdown is handled on SIGINT/SIGTERM.

Development
Repository layout (relevant paths)
- agent.json — ability metadata, scripts, build & deploy definitions
- src/index.ts — main entrypoint and client startup logic
- lib/config.js — config + vault loading
- lib/schema.js — database/schema ensure logic
- tools/collection-tools.js — collection tool registration
- tools/index-tools.js — indexing tool registration
- tools/query-tools.js — query tool registration
- dist/index.js — compiled entrypoint (used in production/start script)

Common commands
- Install deps
  npm install

- Setup (as defined in agent.json)
  npm run setup
  (runs: npm install && npm run build)

- Build
  npm run build
  (project should provide a build script to compile TypeScript into dist/)

- Start (as defined in agent.json)
  npm run start
  (runs: node dist/index.js broker)

- Run via KADI (recommended runtime entry)
  kadi install
  kadi run start

- Run in stdio mode (direct)
  node dist/index.js stdio

Testing and tooling
- Unit tests: vitest (devDependency). Run via test command if present in package.json:
  npm run test

Container / deploy
- agent.json contains a build section (image: search-ability:0.1.4) and deploy targets for local (Docker) and akash (cloud). The local deploy command executes:
  kadi secret receive --vault models && kadi run start
  to fetch model secrets from the broker-delivered vault before launching the agent.

Contributing
- Follow the existing tool registration pattern in src/index.ts and the tools/*-tools.js modules.
- Keep config keys backward-compatible and document new config fields in config.yml.
- Register new external ability interactions centrally (lib/config.js, lib/schema.js) to keep startup validation consistent.

If you need more examples (tool inputs/outputs, config.yml sample, or CI/build helpers) say which area you want and I will add concrete examples and snippets.