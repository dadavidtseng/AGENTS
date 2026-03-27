# ability-file-local
> Local file operations for AGENTS: list, move, copy, delete, create, and watch files/folders

Overview
This kadi-ability provides local filesystem operations for the AGENTS orchestration platform. It exposes a set of tools for listing, moving, copying, deleting, creating, and watching files and directories. The ability is implemented in TypeScript and uses common Node.js libraries (chokidar for watching, archiver/tar/unzipper for archives). The package entry point is index.ts and the agent metadata is defined in agent.json.

Quick Start
1. Clone or add the ability to your AGENTS abilities folder.
2. Install dependencies:
npm install

3. Install the ability into your local kadi runtime (requires kadi CLI):
kadi install

4. Start the ability via kadi:
kadi run start

Alternative direct run (local development, bypassing kadi):
npm run setup
npm run start
- or to serve over stdio:
npm run serve
- or to run in broker mode:
npm run serve:broker

Available npm scripts (from agent.json)
- preflight: node --version
- setup: npm install
- start: npx tsx index.ts
- serve: npx tsx index.ts stdio
- serve:broker: npx tsx index.ts broker
- clean: rm -rf node_modules abilities agent-lock.json package-lock.json

Tools
| Tool | Description |
|------|-------------|
| list | List files and directories in a path (supports filters, recursion options) |
| move | Move/rename files or directories |
| copy | Copy files or directories (preserve structure when requested) |
| delete | Delete files or directories (with safe/recursive options) |
| create | Create files or directories (create parent directories when required) |
| watch | Watch files or directories for events (create, change, delete) and emit events to the broker/stdio |

Configuration
agent.json
- name: ability-file-local
- version: 1.0.0
- description: Local file operations - list, move, copy, delete, create, watch
- entrypoint: index.ts
- scripts: defined as shown in Quick Start

File paths and important files
- index.ts — main entrypoint (registered in agent.json)
- agent.json — agent/ability metadata and scripts
- package.json (dependencies listed in the repository)
- abilities/ — (runtime path where kadi keeps installed abilities)
- agent-lock.json, package-lock.json — lock files cleaned by npm run clean

Environment and .env
- dotenv is included as a dependency. The ability will honor process.env variables loaded via a .env file if used.
- There are no bespoke config keys mandated by the repository, so any runtime configuration should be passed through environment variables or via the kadi runtime broker when invoking tools.
- Recommended environment variables you might set in .env (examples, optional):
  - LOG_LEVEL=info
  - WATCH_POLL_INTERVAL=1000

Note: Because this ability interacts directly with the local filesystem, ensure the runtime user has the necessary read/write permissions for paths you intend to operate on.

Architecture
High-level components
- Kadi Core (@kadi.build/core)
  - Routes incoming tool invocations to this ability (via stdio broker or kadi broker).
- Entry (index.ts)
  - Registers tools with the Kadi runtime and wires handlers for each tool name.
- Tool Handlers (one per tool)
  - Implement the behavior for list, move, copy, delete, create, watch.
  - Validate input parameters (paths, flags) and perform FS operations.
- FileOps utilities
  - Utilities wrapping Node.js fs/promises and helper libraries for recursive operations.
- Watcher (chokidar)
  - Uses chokidar to monitor paths and emits events back to the broker or stdio.
- Archiver / Unpackers
  - Uses archiver, tar, and unzipper when creating or extracting archives as required by higher-level operations.

Data flow
1. A client invokes a tool (e.g., file:list) via the Kadi broker or stdio.
2. Kadi Core routes the invocation to this ability using the name specified in agent.json and the tool name registered by index.ts.
3. The registered handler receives the request payload (path, options).
4. Handler performs validation and calls FileOps utilities or Watcher.
5. FileOps uses Node.js fs APIs or archiver/unzipper/tar to perform operations.
6. Results (success, error, event notifications for watch) are sent back to the caller through the Kadi runtime channel (broker/stdio).

Security considerations
- This ability performs local filesystem I/O. Limit exposure by running in a controlled environment, validating inputs (no path traversal), and setting filesystem permissions appropriately.
- When used in multi-tenant environments, apply sandboxing or mount-level restrictions.

Development
Prerequisites
- Node.js (see preflight script to verify)
- npm
- kadi CLI (for integration testing with the runtime)
- TypeScript is used as a dev dependency; tsx runs index.ts directly.

Install and run locally
1. Install dependencies:
npm install

2. Run the ability locally (direct):
npm run start
- For broker mode:
npm run serve:broker
- For stdio mode:
npm run serve

3. Install to kadi runtime and run:
kadi install
kadi run start

Testing and iterative development
- Modify index.ts to add or update tool registrations.
- Use tsx to run TypeScript directly for fast iteration (no build step).
- When changing dependencies or package metadata, re-run npm install or npm run setup as needed.

Cleaning
- To remove node_modules and runtime artifacts:
npm run clean

Extending tools
- To add a new tool:
  1. Update index.ts to register the new tool name with @kadi.build/core tool registration API.
  2. Implement a handler that performs the required filesystem logic and returns a structured result or emits events.
  3. Restart the ability (npm run start or kadi run start).

Dependencies (selected)
- @kadi.build/core — integration with the Kadi runtime
- chokidar — file system watching
- archiver, tar, unzipper — create and extract archives
- dotenv — environment variable loading
- tsx — run TypeScript files in Node without a build step
- typescript — dev dependency for type checking

Support and issues
- Report issues to your AGENTS/kadi project issue tracker. Include index.ts, sample request payload, expected behavior, and actual behavior.

License
- Check your repository root for a LICENSE file. If none exists, coordinate with your organization to add an appropriate license.

This README provides the essential information to run, configure, and extend the ability-file-local kadi-ability. For implementation details, see index.ts and the helper modules in the repository.

## Quick Start

```bash
cd ability-file-local
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
| **Version** | 1.0.0 |
| **Type** | N/A |
| **Entrypoint** | `index.ts` |

## Architecture

<!-- TODO: Add Architecture content -->

## Development

```bash
npm install
npm run build
kadi run start
```
