# ability-arcadedb

> KADI ability wrapping ArcadeDB 26.2.1 as 17 broker-callable tools (includes backup/restore with distributed file transfer)

Overview
- ability-arcadedb exposes an ArcadeDB server and operational tooling via KADI as a set of broker-callable tools.
- It groups container lifecycle, database management, query/command execution, data import/export, and backup/restore into 17 tools.
- Entry point: dist/index.js
- Agent manifest: agent.json
- Broker endpoints declared in agent.json: default (wss://broker.dadavidtseng.info/kadi), local (ws://localhost:8080/kadi), remote (wss://broker.dadavidtseng.info/kadi)

Quick Start
1. Clone the repository and install dependencies
   - npm install
2. (Optional) Install KADI helper abilities used by the build image
   - kadi install
3. Start the ability in broker mode (uses dist/index.js entrypoint)
   - kadi run start
   - Alternatively, start directly:
     - node dist/index.js broker
   - To run in stdio mode (local testing):
     - node dist/index.js

Notes for local deployment (matching agent.json deploy.local):
- Retrieve required secrets before starting:
  - kadi secret receive --vault arcadedb
- The local docker service exposes ports:
  - 2480 (ArcadeDB HTTP API)
  - 9090 (ArcadeDB Studio / console)

Tools
| Tool | Description |
| --- | --- |
| arcade-backup | Create a database backup. The backup file is made available for download via the built-in file-sharing server / tunnel. |
| arcade-restore | Restore a database from a backup. Accepts either a local path or a file-sharing / tunnel URL. |
| arcade-backup-cleanup | Stop the temporary file-sharing/tunnel server started by arcade-backup to finalize cleanup. |
| arcade-start | Start the ArcadeDB container. Returns early if already running. |
| arcade-stop | Stop the ArcadeDB container. |
| arcade-status | Get the current status of the ArcadeDB container (running state, exposed ports, uptime). |
| arcade-health | Run a multi-point health check on ArcadeDB (container running, HTTP API responsive, database accessible). |
| arcade-import | Import data into an ArcadeDB database from a file (JSON, CSV, or TSV). |
| arcade-export | Export data from an ArcadeDB database to a file (JSON, CSV, or TSV). |
| arcade-db-create | Create a new ArcadeDB database. |
| arcade-db-list | List all databases available on the ArcadeDB server. |
| arcade-db-info | Get database schema, types, indexes, and stats for a specific database. |
| arcade-db-drop | Drop (delete) a database. Safety: requires confirm: true to execute. |
| arcade-db-stats | Get statistics (record counts, sizes) for all databases or a specific database. |
| arcade-query | Execute a read query (SELECT, MATCH, TRAVERSE) against an ArcadeDB database. |
| arcade-command | Execute a write command (CREATE, INSERT, UPDATE, DELETE, DROP) against an ArcadeDB database. |
| arcade-batch | Execute multiple write commands in a single transaction. All commands succeed or all are rolled back. |

Configuration
- Primary config sources:
  - agent.json (project root) — contains name, version, brokers, build, deploy, and scripts.
  - Environment variables (used at runtime and by build/deploy).
  - A local config loader: loadArcadeConfig() (src/lib/config.js) — reads runtime ArcadeDB connection settings if present.

- Important environment variables (used in build/deploy and at runtime)
  - ARCADE_HOST — host name for ArcadeDB (default in build: arcadedb.kadi.build)
  - ARCADE_PORT — port for ArcadeDB (default in build: 80)
  - ARCADEDB_HOME — path to the ArcadeDB home inside the container (/home/arcadedb)
  - ARCADE_USERNAME — ArcadeDB username (required in deploy configurations)
  - ARCADE_PASSWORD — ArcadeDB password (required in deploy configurations)
  - JAVA_HOME — Java runtime location (build: /opt/java/openjdk)
  - PATH — ensures java bin is on PATH in build image
  - BROKER_URL — broker endpoint override (production uses wss://broker.dadavidtseng.info/kadi)
  - KADI_TUNNEL_TOKEN — token used by tunnel services for backup/restore file sharing
  - KADI_DEPLOY_MODE — build/deploy mode (example: container)

- Secrets
  - The agent.json local and production deploy configurations reference a secret vault named "arcadedb".
  - Required secrets: ARCADE_USERNAME, ARCADE_PASSWORD, KADI_TUNNEL_TOKEN
  - Secret delivery: broker (kadi secret receive --vault arcadedb)

- File paths referenced by the package
  - agent.json — root manifest
  - dist/index.js — compiled entrypoint (served by the agent)
  - src/index.ts — main registration of tools
  - scripts/start-arcadedb.sh — helper script used by container command
  - build stages copy ArcadeDB files into /home/arcadedb and Java into /opt/java/openjdk

Architecture
- Key components
  - KadiClient (from @kadi.build/core): registers and serves broker-callable tools and routes remote invocations to tool handlers.
  - Tool modules (src/tools/*): grouped modules that register 17 tools in categories:
    - Container: start, stop, status, health
    - Database: create, list, info, drop, stats
    - Query: query, command, batch
    - Data: import, export
    - Backup: backup, restore, cleanup
  - ArcadeHttpClient (src/lib/http-client.js): encapsulates HTTP interactions with the ArcadeDB REST API for queries, commands, import/export, and health checks.
  - Managers (src/lib/arcade-admin.js -> createManagers): responsible for container/process control, database administration operations, and orchestrating multi-step actions (backup lifecycle, import/export orchestration).
  - File-sharing and Tunnel Services (@kadi.build/file-sharing, @kadi.build/tunnel-services): used by backup/restore to make backup artifacts available to remote callers and to fetch remote backup files.
  - Broker network: the Kadi broker(s) declared in agent.json (default/local/remote) act as the RPC transport for tool invocations.

- Data flow (typical scenarios)
  - Tool invocation: a client calls a named tool via the KADI broker -> KadiClient receives request -> tool handler executes using managers and/or ArcadeHttpClient -> results/URLs/status are returned to caller.
  - Query/Command: arcade-query / arcade-command / arcade-batch use ArcadeHttpClient to communicate with ArcadeDB HTTP API and return results or status.
  - Backup: arcade-backup instructs managers to create a snapshot, starts a temporary file-sharing + tunnel, and returns a download URL. arcade-backup-cleanup stops the file share once transfer is complete.
  - Restore: arcade-restore accepts either a local file path or a remote shared URL, retrieves the backup, and instructs managers to restore into ArcadeDB.
  - Container lifecycle: arcade-start and arcade-stop call container/process managers to ensure the ArcadeDB process is running/stopped and report status and exposed ports.

Development
- Common scripts (defined in agent.json)
  - npm run preflight — echo "Setting up ArcadeDB ability..."
  - npm run setup — runs npm install && npm run build (project-specific build assumed)
  - npm run start — node dist/index.js broker (starts the compiled agent in broker mode)

- Build and run (development iteration)
  1. Install dependencies:
     - npm ci
  2. Build (project should provide a build script that compiles TypeScript to dist/):
     - npm run build
  3. Install kadi helper abilities if needed:
     - kadi install kadi-install
     - kadi install kadi-run
     - kadi install kadi-secret
  4. Run locally:
     - node dist/index.js broker
     - or use kadi runner:
       - kadi run start

- Tests and linting
  - DevDependencies include eslint, prettier, jest, vitest, and typescript. Standard project commands (lint/test) should be available in package.json; run:
    - npm run lint
    - npm run test

- Working with secrets during development
  - Use kadi secret receive --vault arcadedb to pull secrets required by deploy/local flow.
  - Ensure KADI_TUNNEL_TOKEN is available when using backup/restore features that rely on tunnel services.

- Source layout (paths you will work with)
  - src/index.ts — main registration (calls register*Tools functions)
  - src/tools/* — tool implementations (backup.js, container.js, data.js, database.js, query.js)
  - src/lib/* — arcade-admin.js, config.js, http-client.js
  - scripts/start-arcadedb.sh — start wrapper used inside the container
  - agent.json — agent manifest and build/deploy configuration

Safety and notes
- arcade-db-drop requires confirm: true to prevent accidental deletion.
- Backup uses a temporary file-sharing/tunnel that must be cleaned up — call arcade-backup-cleanup when transfers finish or rely on built-in cleanup behavior.
- Production deploy exposes the HTTP API port and expects ARCADE_USERNAME/ARCADE_PASSWORD to be provided by the deploy secret vault or env injection.

If you need examples of tool payloads (query bodies, import file formats, or backup/restore parameter shapes) or help extending a specific tool implementation, tell me which tool and I will provide sample request/response examples.

## Quick Start

```bash
cd arcadedb-ability
npm install
kadi install
kadi run start
```

## Tools

<!-- TODO: Add Tools content -->

## Configuration

### agent.json

| Field | Value |
|-------|-------|
| **Version** | 0.1.1 |
| **Type** | ability |
| **Entrypoint** | `dist/index.js` |

### Abilities

- `secret-ability` ^0.9.0

### Brokers

- **default**: `wss://broker.dadavidtseng.info/kadi`
- **local**: `ws://localhost:8080/kadi`
- **remote**: `wss://broker.dadavidtseng.info/kadi`

## Architecture

<!-- TODO: Add Architecture content -->

## Development

```bash
npm install
npm run build
kadi run start
```
