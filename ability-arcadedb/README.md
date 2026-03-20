# arcadedb-ability

KADI ability that wraps [ArcadeDB](https://arcadedb.com/) as 17 broker-callable tools. Provides graph database operations (queries, commands, transactions, schema management, import/export) and backup/restore with distributed file transfer to any KADI agent through the broker or stdio transport.

ArcadeDB uses an SQL dialect with extensions for graph operations (MATCH, TRAVERSE). It also supports Cypher and Gremlin. See the [ArcadeDB SQL reference](https://docs.arcadedb.com/#SQL) for full syntax.

## Loading This Ability

From another KADI agent:

```typescript
// Via broker (remote, any machine)
const arcade = await client.loadBroker('arcadedb-ability');

// Via stdio (local, same machine)
const arcade = await client.loadStdio('arcadedb-ability');

// Then invoke any tool
const result = await arcade.invoke('arcade-query', {
  database: 'mydb',
  query: 'SELECT FROM V LIMIT 10',
});
```

## Tools

### Query Tools

These are the primary tools for reading and writing data.

#### arcade-query

Execute a read-only query (SELECT, MATCH, TRAVERSE).

**Input:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `database` | string | yes | Target database name |
| `query` | string | yes | SQL query to execute |
| `language` | string | no | `sql` (default), `cypher`, or `gremlin` |
| `params` | object | no | Named parameters for parameterized queries |

**Output:**

```json
{ "success": true, "result": [{ "name": "Alice", "age": 30 }], "count": 1 }
```

**Examples:**

```
arcade-query { database: "mydb", query: "SELECT FROM Person WHERE age > 25" }

arcade-query { database: "mydb", query: "SELECT FROM Person WHERE name = :name", params: { name: "Alice" } }

arcade-query { database: "mydb", query: "MATCH {type: Person, as: p}-Knows->{as: friend} RETURN p.name, friend.name" }

arcade-query { database: "mydb", query: "TRAVERSE out('Knows') FROM #1:0 MAXDEPTH 3" }

arcade-query { database: "mydb", query: "MATCH (p:Person)-[:Knows]->(f) RETURN p.name, f.name", language: "cypher" }
```

#### arcade-command

Execute a write command (CREATE, INSERT, UPDATE, DELETE, DROP).

**Input:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `database` | string | yes | Target database name |
| `command` | string | yes | SQL command to execute |
| `language` | string | no | `sql` (default), `cypher`, or `gremlin` |
| `params` | object | no | Named parameters |

**Output:**

```json
{ "success": true, "result": [{ "@rid": "#1:0", "@type": "Person", "name": "Alice" }], "count": 1 }
```

**Examples:**

```
arcade-command { database: "mydb", command: "CREATE VERTEX TYPE Person IF NOT EXISTS" }

arcade-command { database: "mydb", command: "CREATE PROPERTY Person.name IF NOT EXISTS STRING" }

arcade-command { database: "mydb", command: "INSERT INTO Person SET name = 'Alice', age = 30" }

arcade-command { database: "mydb", command: "CREATE EDGE Knows FROM #1:0 TO #1:1 SET since = 2024" }

arcade-command { database: "mydb", command: "UPDATE Person SET age = 31 WHERE name = 'Alice'" }
```

#### arcade-batch

Execute multiple commands in a single transaction. All commands succeed or all are rolled back.

**Input:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `database` | string | yes | Target database name |
| `commands` | (string \| object)[] | yes | Array of SQL commands (min 1). Each item is either a plain SQL string or an object `{ command, params? }` for parameterized queries. |

When using parameterized commands, the `command` string contains `:paramName` placeholders and the `params` object carries the bindings. This avoids SQL-escaping issues with strings that contain quotes, newlines, or other special characters.

**Output (success):**

```json
{ "success": true, "committed": true, "results": [{ "@rid": "#1:0" }, { "@rid": "#1:1" }] }
```

**Output (failure -- transaction rolled back, no partial writes):**

```json
{ "success": false, "committed": false, "error": "Command failed: BAD SQL -- ..." }
```

**Examples:**

Plain SQL strings (simple cases):

```
arcade-batch {
  database: "mydb",
  commands: [
    "CREATE VERTEX TYPE Article IF NOT EXISTS",
    "INSERT INTO Article SET title = 'First', body = '...'",
    "INSERT INTO Article SET title = 'Second', body = '...'"
  ]
}
```

Parameterized commands (for user-generated content with quotes/newlines):

```
arcade-batch {
  database: "mydb",
  commands: [
    "CREATE DOCUMENT TYPE Chunk IF NOT EXISTS",
    {
      command: "INSERT INTO Chunk SET title = :title, content = :content",
      params: { title: "O'Brien's Notes", content: "Line 1\nLine 2" }
    }
  ]
}
```

You can mix plain strings and parameterized objects in the same batch.
```

### Database Tools

#### arcade-db-create

Create a new database.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | yes | Database name to create |
| `schema` | string | no | SQL schema to execute after creation |

```json
{ "success": true, "database": "mydb" }
```

#### arcade-db-list

List all databases. Takes no input.

```json
{ "success": true, "databases": ["test", "mydb", "experiment_01"] }
```

#### arcade-db-info

Get schema, types, indexes, and stats for a database.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `database` | string | yes | Database name |

```json
{
  "success": true,
  "name": "mydb",
  "schema": { "types": 3, "indexes": 1, "details": { "typeList": ["Person", "Document", "Knows"], "indexList": [] } },
  "statistics": { "recordCount": 150, "typeCount": 3 },
  "serverInfo": { "host": "localhost:2480", "accessible": true }
}
```

#### arcade-db-drop

Drop (delete) a database. Requires explicit confirmation.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `database` | string | yes | Database name to drop |
| `confirm` | boolean | yes | Must be `true` to confirm deletion |

```json
{ "success": true }
```

If `confirm` is not `true`:

```json
{ "success": false, "error": "Refused: confirm must be true to drop a database", "hint": "Set confirm: true to confirm deletion" }
```

#### arcade-db-stats

Get statistics for all databases or a specific one.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `database` | string | no | Specific database name, or omit for all |

```json
{
  "success": true,
  "totalDatabases": 2,
  "databases": [
    { "name": "test", "size": 4096, "sizeFormatted": "4 KB", "recordCount": 0 },
    { "name": "mydb", "size": 32768, "sizeFormatted": "32 KB", "recordCount": 150 }
  ]
}
```

### Container Tools

These tools manage the ArcadeDB server lifecycle. They are **deployment-aware**: when the `KADI_DEPLOY_MODE` environment variable is set to `container` (set automatically by the build profile), Docker calls are skipped and ArcadeDB is expected to be running as a native process alongside the agent.

| Mode | ArcadeDB runs as | Docker required |
|------|-----------------|----------------|
| Local dev | Docker container via `ContainerManager` | Yes |
| Deployed (Akash/Docker) | Native Java process via `start-arcadedb.sh` | No |

#### arcade-start

Start the ArcadeDB server. Returns early if already running.

In container mode, verifies the HTTP API is ready (ArcadeDB is started by the entrypoint script).
In local dev mode, starts a Docker container.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `withTestData` | boolean | no | Include test data on first start |

```json
{ "success": true, "container": "kadi-arcadedb", "ports": ["2480:2480"] }
```

#### arcade-stop

Stop the ArcadeDB server.

In container mode, this returns an error — the server is managed by the container entrypoint and cannot be stopped independently.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `force` | boolean | no | Force stop (docker kill instead of stop) |

```json
{ "success": true }
```

#### arcade-status

Get the current status of the ArcadeDB server. Takes no input.

In container mode, checks the HTTP API directly instead of Docker.

```json
{ "running": true, "container": "kadi-arcadedb", "uptime": "2 hours", "ports": ["2480:2480"] }
```

When stopped:

```json
{ "running": false }
```

#### arcade-health

Run a multi-point health check. Takes no input.

```json
{ "healthy": true, "checks": { "container": true, "api": true, "database": true } }
```

### Data Tools

#### arcade-import

Import data from a local file into an ArcadeDB database.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `database` | string | yes | Target database name |
| `filePath` | string | yes | Path to the import file (on the machine running this ability) |
| `type` | string | no | Target vertex type name |
| `format` | string | no | `json`, `csv`, or `tsv` (auto-detected from extension if omitted) |
| `batchSize` | number | no | Records per batch (default: 100) |

```json
{ "success": true, "imported": 42 }
```

#### arcade-export

Export data from an ArcadeDB database to a local file.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `database` | string | yes | Source database name |
| `outputPath` | string | yes | Path for the output file |
| `type` | string | no | Export a specific vertex type |
| `query` | string | no | SQL query to select data (exports all if omitted) |
| `format` | string | no | `json`, `csv`, or `tsv` (auto-detected from extension if omitted) |

```json
{ "success": true, "exported": 42, "data": "/tmp/export.json" }
```

## Error Handling

All tools return `{ "success": false, "error": "..." }` on failure. They never throw.

Common error patterns:

| Situation | Error looks like |
|-----------|-----------------|
| Database does not exist | `HTTP 400: ...` or manager error |
| Invalid SQL syntax | `HTTP 400: ...` with parse error detail |
| Connection refused | `ECONNREFUSED` |
| Bad credentials | `HTTP 403: ...` |
| Type does not exist | `HTTP 500: ...` with type name |

## Configuration

Settings come from `config.yml` (searched upward from the working directory) and can be overridden by environment variables. Credentials are never stored in `config.yml`.

### config.yml

Storage paths are defined per deployment mode — `local:` for development (Docker mode, dev machine) and `container:` for when the agent + ArcadeDB run inside a single image (`KADI_DEPLOY_MODE=container`).

```yaml
arcadedb:
  host: localhost
  port: 2480
  container_name: kadi-arcadedb
  backup_retention_days: 30
  log_lines: 50

  local:
    data_dir: ./arcadedb-data
    backup_dir: ./arcadedb-data/backups
  container:
    data_dir: /home/arcadedb/databases
    backup_dir: /home/arcadedb/backups

tunnel:
  server_addr: broker.kadi.build
  tunnel_domain: tunnel.kadi.build
  server_port: 7000
  ssh_port: 2200
  mode: frpc
  transport: wss
  wss_control_host: tunnel-control.kadi.build
  agent_id: arcadedb-ability
```

### Environment variables

| Variable | Default | Source |
|----------|---------|--------|
| `ARCADE_HOST` | `localhost` | config.yml or env |
| `ARCADE_PORT` | `2480` | config.yml or env |
| `ARCADE_USERNAME` | `root` | secret-ability vault or env |
| `ARCADE_PASSWORD` | `playwithdata` | secret-ability vault or env |
| `ARCADE_CONTAINER_NAME` | `kadi-arcadedb` | config.yml or env |
| `ARCADE_DATA_DIR` | mode-dependent | env override for data directory |
| `ARCADE_BACKUP_DIR` | mode-dependent | env override for backup directory |
| `KADI_DEPLOY_MODE` | (unset) | Set to `container` in deployed images |
| `KADI_STAGING_PORT` | `9090` | Port for backup file-sharing server |

Resolution order (highest wins): environment variables > config.yml (mode section) > built-in defaults.

In production, credentials come from `secret-ability` via the `arcadedb` vault, delivered as env vars by `kadi secret receive` at container startup. In development, the defaults (`root`/`playwithdata`) match the docker-compose configuration.

---

## For Developers

Everything below is for humans working on this ability's source code.

### Prerequisites

- Node.js 22+
- Docker (for local development only — not needed in deployed containers)

### Setup

```bash
# Start ArcadeDB (from tmis-paper/)
docker compose up -d arcadedb

# Install and build
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

All tests run against a live ArcadeDB instance. There are no mocks.

```bash
# All tests (requires running ArcadeDB)
npm test

# Integration tests only
npm run test:integration
```

45 tests: database lifecycle, SQL queries, parameterized queries, DDL/DML, Cypher language, transactional batches with rollback, graph edges and traversal, MATCH queries, schema idempotency, import/export, authentication, error structure, tool discovery and invocation via KADI stdio protocol.

### Build and Deploy

Profiles are defined in `agent.json`.

```bash
kadi build              # Build container image
kadi deploy local       # Deploy locally
kadi deploy production  # Deploy to Akash
```

The container image uses a multi-stage build:
- **Stage 1** (`arcadedb-src`): Copies Java 21 and ArcadeDB binaries from `arcadedata/arcadedb:26.2.1`
- **Stage 2** (`kadi-cli-builder`): Builds the KADI CLI (auto-generated by kadi-build)
- **Final** (`node:22-alpine`): Combines Node.js + Java 21 + ArcadeDB + agent code

**Exposed ports (local deploy):**
- `2480` — ArcadeDB HTTP API (Studio web UI + REST)
- `9090` — Backup file-sharing staging server (used by distributed backup pipeline)

At runtime, `scripts/start-arcadedb.sh` is **sourced** (not subshelled) so that exported credentials (`ARCADE_USERNAME`, `ARCADE_PASSWORD`) persist into the agent process. It starts ArcadeDB as a native Java process, waits for it to be ready, then `kadi run start` launches the KADI agent. Secrets are delivered via `kadi secret receive --vault arcadedb` in the deploy `command` before any of this runs.

**Important:** The startup script is sourced with `. ./scripts/start-arcadedb.sh` (not `sh scripts/start-arcadedb.sh`) to ensure credential environment variables propagate to the agent process. The script saves and restores the working directory to avoid CWD corruption.

### Project Structure

```
arcadedb-ability/
  agent.json              KADI manifest (broker URLs, build, deploy profiles)
  config.yml              Non-sensitive settings (local/container paths, tunnel)
  scripts/
    start-arcadedb.sh     Container entrypoint — starts ArcadeDB, preserves CWD
  lib/                    Vendored CJS managers from arcade-admin (DO NOT MODIFY)
  src/
    index.ts              Entry point: KadiClient + 17 tools + serve
    lib/
      types.ts            All interfaces + BatchCommand union type
      config.ts           Config loader (walk-up config.yml + env vars, mode-aware)
      http-client.ts      query/command/batch with transaction + parameterized query support
      arcade-admin.ts     Typed adapter bridging CJS managers into ESM
      errors.ts           Shared error utilities
    tools/
      container.ts        arcade-start, arcade-stop, arcade-status, arcade-health
      database.ts         arcade-db-create, arcade-db-list, arcade-db-info, arcade-db-drop, arcade-db-stats
      query.ts            arcade-query, arcade-command, arcade-batch
      data.ts             arcade-import, arcade-export
      backup.ts           arcade-backup, arcade-restore, arcade-backup-cleanup
  tests/
    integration/
      tools.test.ts       40 tests against live ArcadeDB
      stdio.test.ts       5 tests via KADI stdio transport
```
