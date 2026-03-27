# ability-vision
> Vision analysis ability - image understanding via multimodal LLMs (Claude, GPT-4V)

Overview
--------
ability-vision is a kadi-ability that provides vision analysis and image understanding via multimodal large language models (e.g., Anthropic Claude multimodal and OpenAI GPT-4V). It exposes a Kadi-compatible entrypoint (index.ts) and integrates with the KADI orchestration runtime to accept image inputs, run model-based analysis, and return structured interpretations.

Quick Start
-----------
1. Install runtime dependencies:
- `npm install`

2. Install Kadi (CLI / runtime) and ability registry (if you use a global kadi CLI):
- `npm i -g @kadi.build/cli` (optional, if you don't already have the kadi CLI)
- `kadi install`

3. Start the ability locally:
- `kadi run start`

Alternative direct start using the package scripts in agent.json:
- `npm run setup` (runs `npm install`)
- `npm run start` (runs `npx tsx index.ts`)
- `npm run serve` (runs `npx tsx index.ts stdio`)
- `npm run serve:broker` (runs `npx tsx index.ts broker`)

Tools
-----
| Tool | Description |
|------|-------------|
| Claude (multimodal) | Anthropic Claude multimodal model used for image+text understanding (configured via CLAUDE_API_KEY). |
| GPT-4V | OpenAI GPT-4 Vision model for visual question answering and image analysis (configured via OPENAI_API_KEY). |
| secret-ability | Declared ability dependency from agent.json ("secret-ability": "^0.9.4") — consumed by this package at runtime. |
| @kadi.build/core | Kadi core runtime package used to register ability handlers and communicate with the Kadi broker. |
| dotenv | Loads environment variables from a .env file into process.env. |
| tsx | Lightweight TypeScript runtime used to run index.ts during development and local execution. |

Configuration
-------------
Key project files:
- `agent.json` — package metadata and declared ability dependencies (present in repo root).
- `index.ts` — main entrypoint referenced by agent.json (entrypoint for Kadi runtime).
- `.env` — environment variables (create at repo root).

Relevant fields in agent.json:
- `name` — "ability-vision"
- `version` — semantic version
- `description` — short description shown in registries
- `entrypoint` — `"index.ts"` (file executed by the ability process)
- `scripts` — useful npm script shortcuts: `preflight`, `setup`, `start`, `serve`, `serve:broker`, `clean`
- `abilities` — ability-level dependencies, e.g. `"secret-ability": "^0.9.4"`

Environment variables (create a `.env` file at repo root). Typical variables used by the ability:
- `CLAUDE_API_KEY` — API key for Anthropic Claude multimodal (if used)
- `OPENAI_API_KEY` — API key for OpenAI GPT-4V (if used)
- `KADI_BROKER_URL` — WebSocket URL for Kadi broker (e.g., `ws://localhost:9229`) — used when running in broker mode
- `PORT` — optional port for local HTTP/stdio wrappers (if implemented)
- `LOG_LEVEL` — optional log verbosity (info|debug|warn|error)

Example .env (place in repo root):
CLAUDE_API_KEY=your_claude_api_key
OPENAI_API_KEY=your_openai_api_key
KADI_BROKER_URL=ws://localhost:9229
LOG_LEVEL=info

Runtime modes and scripts (from agent.json):
- `npm run start` — runs `npx tsx index.ts` (default runtime)
- `npm run serve` — runs `npx tsx index.ts stdio` (stdio transport for local testing)
- `npm run serve:broker` — runs `npx tsx index.ts broker` (connect to Kadi broker)
- `npm run setup` — runs `npm install`
- `npm run clean` — removes node_modules and package-lock.json

Architecture
------------
Data flow
1. Input (image + optional prompt or metadata) arrives via one of the transports:
   - stdio transport (`serve`) for local testing
   - broker transport (`serve:broker`) via Kadi broker (KADI_BROKER_URL)
   - direct invocation when used as a nested ability

2. Preprocessing
   - Image is validated and normalized (format checking, resizing or base64 handling).
   - Optional metadata (prompt, boxes, language) is parsed.

3. Model invocation
   - The ability selects one or more multimodal LLM clients (Claude, GPT-4V) based on configuration or request hints.
   - Image and prompt are forwarded to the LLM client(s) in the expected multimodal API format.
   - The ability handles authentication using CLAUDE_API_KEY or OPENAI_API_KEY from environment variables.

4. Postprocessing
   - Raw model output is parsed into structured response objects (labels, bounding boxes, captions, confidence scores).
   - Optional enrichment via the `secret-ability` dependency may be applied for specialized reasoning.

5. Response
   - The structured result is returned to the caller over the same transport (stdio, broker, or direct SDK call).

Key components
- index.ts — entrypoint that registers ability handlers with @kadi.build/core runtime and wires transports (stdio or broker).
- Model clients — lightweight adapters encapsulating calls to Claude and GPT-4V APIs.
- Preprocessor / Postprocessor modules — input normalization and output shaping code.
- Configuration loader — uses dotenv to load environment variables and validate keys at startup.
- Ability dependency resolver — uses agent.json abilities block to discover/consume other kadi abilities (e.g., secret-ability).

Development
-----------
Local setup
1. Install deps:
- `npm run setup` (runs `npm install`)

2. Validate Node.js:
- `npm run preflight` will print Node version (script configured as `node --version`).

Running locally
- `npm run start` — runs `npx tsx index.ts` (standalone)
- `npm run serve` — runs `npx tsx index.ts stdio` (stdio transport for testing)
- `npm run serve:broker` — runs `npx tsx index.ts broker` (connects to broker at KADI_BROKER_URL)

Kadi CLI
- If using the Kadi orchestration ecosystem, install and use the kadi CLI:
  - `npm i -g @kadi.build/cli` (optional)
  - `kadi install` — install/resolve ability dependencies and registry metadata
  - `kadi run start` — run the ability under the Kadi runner

Testing and debugging
- Use the stdio mode (`npm run serve`) to exercise the ability with local test harnesses that write requests to stdin and read responses from stdout.
- Enable verbose logs by setting `LOG_LEVEL=debug` in your `.env` file.

Cleaning and housekeeping
- `npm run clean` — removes node_modules and package-lock.json
- Keep agent.json updated with version and ability dependency constraints.

Notes and best practices
- Keep your API keys out of source control; use .env locally and a secure secret store in production.
- Validate image sizes and formats before sending binary payloads to LLM APIs to control cost and latency.
- Use the `abilities` block in agent.json to declare and pin other kadi abilities this package relies on (e.g., secret-ability).

If you need additional examples of request/response payloads, transport adapters, or model client implementations, consult the source index.ts and the @kadi.build/core documentation in your environment.