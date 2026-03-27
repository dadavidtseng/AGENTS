# ability-file-cloud
> Cloud file operations for Dropbox, Google Drive, and Box

Overview
This kadi-ability implements cloud file operations (upload, download, list, delete) across Dropbox, Google Drive, and Box. It is intended to be run as a KADI ability (agent) with entrypoint index.ts and integrates with the KADI core runtime.

Quick Start
1. Install dependencies:
   npm install

2. Register/install with KADI (run from the repository root where agent.json is present):
   kadi install

3. Start the ability using KADI:
   kadi run start

You can also run locally using the npm scripts defined in agent.json:
- Perform preflight check:
  npm run preflight
- Install dependencies as defined in the package scripts:
  npm run setup
- Start in standard mode:
  npm run start
- Start in stdio mode:
  npm run serve
- Start in broker mode:
  npm run serve:broker
- Clean local artifacts:
  npm run clean

Tools
| Tool | Description |
| --- | --- |
| dropbox | Connector for Dropbox: upload, download, list, delete files in a Dropbox account using an access token. |
| google-drive | Connector for Google Drive: upload, download, list, delete files using OAuth2 client/refresh token flow. |
| box | Connector for Box: upload, download, list, delete files for Box accounts using Box credentials or developer token. |

Configuration
Files and entrypoints
- agent.json — agent manifest (present in the package root). Key fields: name, version, description, entrypoint (index.ts), scripts.
- index.ts — main TypeScript entrypoint (as referenced by agent.json).
- abilities/ — (convention) directory to place provider/ability modules and connectors (create if adding new connectors).
- agent-lock.json and package-lock.json — lock files used by the agent scripts (cleaned by npm run clean).

Environment variables
Place credentials and runtime options in a .env file at the repository root (dotenv is a dependency and is loaded at runtime). Example variables expected by the ability:

- Dropbox
  - DROPBOX_ACCESS_TOKEN — OAuth2 access token for Dropbox API
  - DROPBOX_APP_KEY — (optional) Dropbox app key for app-based operations

- Google Drive
  - GOOGLE_CLIENT_ID — OAuth2 client ID
  - GOOGLE_CLIENT_SECRET — OAuth2 client secret
  - GOOGLE_REFRESH_TOKEN — OAuth2 refresh token used to fetch access tokens
  - GOOGLE_API_KEY — (optional) API key for Drive-specific endpoints

- Box
  - BOX_CLIENT_ID — Box application client ID
  - BOX_CLIENT_SECRET — Box application client secret
  - BOX_DEVELOPER_TOKEN — (optional) short-lived developer token for quick testing

- KADI / runtime
  - KADI_ENV — (optional) runtime environment name
  - LOG_LEVEL — (optional) set logging verbosity (info, debug, warn, error)

Make sure to keep .env out of source control (add to .gitignore). The ability expects the presence of index.ts and agent.json and will fail startup if required env vars for a configured provider are missing.

Architecture
High-level components and data flow:
- index.ts (entrypoint)
  - Loads configuration (.env + agent.json)
  - Initializes KADI ability bindings via @kadi.build/core
  - Registers provider connectors (Dropbox, Google Drive, Box) as tools/handlers

- Provider connector modules (convention: abilities/<provider>.ts or src/providers/<provider>.ts)
  - Implement a normalized capability interface for operations:
    - uploadFile({ path, stream|buffer, metadata })
    - downloadFile({ id|path })
    - listFiles({ path, query })
    - deleteFile({ id|path })
  - Handle provider-specific authentication and token refresh logic.
  - Use node-fetch and form-data for HTTP interactions (listed dependencies).

- KADI core
  - Routes incoming tasks/requests from various transports (stdio, broker) into the registered tool handlers.
  - Provides a message/response lifecycle that this ability implements for file operations.

Data flow example (upload):
1. A KADI client sends an "ability.file.upload" request to the ability via stdio or broker.
2. KADI core receives the request and invokes the registered provider tool (e.g., dropbox.uploadFile).
3. The provider module reads .env credentials, ensures a valid access token, makes an HTTP multipart/form-data POST to the provider API using node-fetch/form-data.
4. Provider returns a normalized response (file id, path, size, metadata) to the KADI core.
5. KADI core returns the response to the client.

Runtime modes
- stdio mode (npm run serve): ability reads/writes messages on stdin/stdout for direct piping to a KADI conductor or child process setup.
- broker mode (npm run serve:broker): ability connects to a broker (if configured) and processes messages via that broker.

Development
Prerequisites
- Node.js (check with npm run preflight which runs node --version)
- kadi CLI available in PATH to run kadi install and kadi run start
- TypeScript runtime (tsx is used to run index.ts at runtime; tsx is a dependency)

Local development workflow
1. Install dependencies:
   npm run setup

2. Create a .env file at the repository root with the required credentials (see Configuration).

3. Start the agent locally:
   npm run serve
   or
   kadi run start

4. To iterate on provider connectors:
   - Add connector modules under abilities/ or src/providers/
   - Export/register them in index.ts so KADI core can discover and route requests to them
   - Use tsx to run the TypeScript entrypoint without a build step (index.ts runs directly via npx tsx index.ts)

Adding a new provider
1. Create a new file at abilities/<provider>.ts implementing uploadFile, downloadFile, listFiles, deleteFile.
2. Add environment variable keys to .env and document them in Configuration.
3. Register the tool in index.ts with a name that matches the tools table entry (for example "onedrive" if adding OneDrive).
4. Update README Tools table and tests as needed.

Testing and debugging
- Use LOG_LEVEL=debug to increase runtime logging.
- For one-off API testing, populate the provider developer token (e.g., BOX_DEVELOPER_TOKEN) and call the connector methods via an ad-hoc script.
- Use npm run clean to remove node_modules and lock files when resetting local state.

Dependencies (from package.json/agent.json)
- @kadi.build/core — local kadi core reference (file:../../humin-game-lab/KADI/kadi-core)
- dotenv — environment variable loader
- form-data — for multipart uploads
- node-fetch — HTTP client (v2.x)
- tsx — run TypeScript files directly in Node.js

Files of interest
- agent.json — agent manifest (entrypoint, scripts, metadata)
- index.ts — ability entrypoint (referenced in agent.json)
- abilities/ — connector modules (convention for adding providers)
- .env — runtime environment variables (developer-provided)

Support and contribution
- Follow the Development section to add connectors or modify behavior.
- Keep secrets out of source control (.env ignored).
- When contributing: document new environment variables and update the Tools table and Configuration sections.

License
- This repository does not include a license file by default. Add LICENSE at the repository root if you intend to open-source.

## Quick Start

```bash
cd ability-file-cloud
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
