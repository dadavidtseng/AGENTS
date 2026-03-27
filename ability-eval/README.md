# ability-eval
> Evaluation engine ability - code diffs, test results, logs, behavior traces analysis

Overview
--------
ability-eval is a kadi-ability that evaluates code diffs, test results, runtime logs and behavior traces to produce assessment results for multi-agent orchestration. It is implemented as a TypeScript entrypoint (index.ts) and integrates with the Kadi runtime via @kadi.build/core. The package uses dotenv for runtime configuration and tsx for lightweight TypeScript execution.

Quick Start
-----------
1. Clone the repository and install Node dependencies:
```bash
npm install
```

2. Install Kadi runtime/tools if required by your environment:
```bash
kadi install
```

3. Start the ability (three common ways):
- Using the package start script:
```bash
npm run start
```
- Directly with Kadi run (recommended when running inside a Kadi workspace):
```bash
kadi run start
```
- For stdio mode or broker mode (as defined in agent.json scripts):
```bash
npm run serve       # runs `npx tsx index.ts stdio`
npm run serve:broker# runs `npx tsx index.ts broker`
```

4. Clean local deps:
```bash
npm run clean
# or
rm -rf node_modules package-lock.json
```

Tools
-----
| Tool | Description |
|------|-------------|
| secret-ability (^0.9.4) | Declared ability dependency used by ability-eval (registered in agent.json under "abilities"). Provides domain-specific evaluation helpers or connectors required by this package. |
| @kadi.build/core (^0.9.0) | Kadi runtime core used by the ability to register handlers, message routing and lifecycle integration. |
| dotenv (^17.3.1) | Loads configuration values from a .env file into process.env at startup. |
| tsx (^4.21.0) | Lightweight TypeScript runner used by the start/serve scripts to execute index.ts without a separate compile step. |
| typescript (@ dev) (^5.9.3) | Development dependency for type checking and local editing. |
| @types/node (@ dev) (^25.3.1) | Node.js type definitions used during development and type-checking. |

Configuration
-------------
Primary configuration lives in agent.json and environment variables loaded via dotenv.

Key files and fields:
- agent.json (root)
  - name: "ability-eval"
  - version: "0.1.0"
  - description: "Evaluation engine ability - code diffs, test results, logs, behavior traces analysis"
  - entrypoint: "index.ts" (main runtime file)
  - scripts: preflight, setup, start, serve, serve:broker, clean
    - start: npx tsx index.ts
    - serve: npx tsx index.ts stdio
    - serve:broker: npx tsx index.ts broker
  - abilities:
    - secret-ability: "^0.9.4" (registered dependency required at runtime)

- package.json / dependencies
  - @kadi.build/core, dotenv, tsx (runtime)
  - typescript, @types/node (dev)

Environment variables
- Any variables required by your deployment or index.ts should be provided via a .env file loaded with dotenv. Common example entries you may add to .env:
```
KADI_BROKER_URL=amqp://localhost:5672
KADI_AGENT_ID=ability-eval
LOG_LEVEL=info
```
index.ts is expected to call dotenv.config() early in startup to pick these up.

File paths referenced in this project
- agent.json (project root) — Kadi ability descriptor
- index.ts (project root) — entrypoint used by start/serve scripts
- node_modules/ — installed dependencies
- package-lock.json — lockfile created by npm
- .env (optional, project root) — runtime environment variables

Architecture
------------
ability-eval is organized around a small set of runtime components and a simple data flow tailored for evaluation tasks.

Key components
- Entrypoint (index.ts)
  - Initializes the environment (dotenv), bootstraps the @kadi.build/core runtime, and registers ability handlers.
  - Accepts runtime mode args (e.g., "stdio" or "broker") as implemented in the scripts.
- Ability registry (agent.json -> abilities)
  - Declares dependent abilities (secret-ability) that are resolved/loaded by the Kadi runtime or package manager before runtime.
- Kadi runtime (@kadi.build/core)
  - Provides lifecycle, message routing, and inter-agent communication primitives.
- Evaluation engine / handlers
  - The logic in index.ts (and any imported modules) consumes inputs (code diffs, test results, logs, traces), performs analysis using internal heuristics and helpers from secret-ability, and emits evaluation results to the configured sink (stdout in stdio mode or a Kadi broker in broker mode).
- Configuration loader (dotenv)
  - Loads runtime configuration from .env and process.env.

Data flow
1. On start, index.ts initializes configuration and connects to the runtime/broker if requested.
2. Input events arrive via Kadi messages or stdio (depending on mode).
3. The evaluation handlers parse inputs (diffs, test output, logs, traces), enrich or transform them, and invoke analysis routines (may call into secret-ability).
4. Results are emitted as structured evaluation messages to either the Kadi broker or written to stdout for downstream consumers.

Development
-----------
Local development is TypeScript-first with immediate execution via tsx.

Common tasks
- Preflight (check node):
```bash
npm run preflight
```

- Install dependencies:
```bash
npm run setup
# or
npm install
```

- Start locally (development):
```bash
npm run start   # runs `npx tsx index.ts`
```

- Run in stdio or broker mode:
```bash
npm run serve        # stdio mode
npm run serve:broker # broker mode
```

- Clean local artifacts:
```bash
npm run clean
```

Working with abilities
- To add or update an ability, edit agent.json -> abilities and run:
```bash
npm install
kadi install
```
- Confirm that the required ability (e.g., secret-ability) is resolvable in your Kadi environment or in npm.

Type checking
- Run TypeScript checks (using the project's dev dependencies):
```bash
npx tsc --noEmit
```

Notes and tips
- index.ts is the canonical entrypoint — keep initialization and Kadi runtime registration logic centralized there.
- Use dotenv to manage environment-specific configuration and keep secrets out of source control.
- The package relies on secret-ability (^0.9.4) being present — ensure the runtime environment can resolve that dependency (via kadi install or npm).

License and publishing
- This README omits license and publishing instructions. Add a LICENSE file and update agent.json/package.json if you plan to publish the ability to a registry.

If you need sample index.ts scaffolding, tests, or help wiring secret-ability into handlers, I can generate an example implementation to match this README.