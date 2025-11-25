# MCP_Slack_Client

**MCP Server for Slack Event Listening with Claude-Powered Responses**

---

## Changelog

### 2025-11-24 - Initial AI Context Documentation
- Generated comprehensive AI context documentation
- Documented architecture, configuration, and MCP integration patterns
- Identified single-module structure with complete TypeScript implementation

---

## Project Vision

MCP_Slack_Client is a Model Context Protocol (MCP) server that bridges Slack workspace mentions with AI-powered autonomous responses. It operates as part of the KADI broker architecture, listening for Slack @mentions in real-time via Socket Mode, queuing them in memory, and exposing them through an MCP tool interface for consumption by Agent_TypeScript.

The server enables asynchronous, event-driven AI conversation flows where Slack users can mention a bot and receive intelligent Claude-powered responses without manual intervention.

---

## Architecture Overview

```mermaid
graph LR
    A[Slack User] -->|@mentions bot| B[Slack Socket Mode]
    B --> C[SlackManager]
    C --> D[MentionQueue]
    D --> E[MCP Server]
    E -->|get_slack_mentions tool| F[KADI Broker]
    F --> G[Agent_TypeScript]
    G -->|processes with Claude API| H[MCP_Slack_Server]
    H -->|posts reply| A
```

### Key Components

1. **Slack Socket Mode Listener**: Real-time event streaming from Slack workspace
2. **Mention Queue**: In-memory FIFO queue (max 100 items) for unprocessed mentions
3. **MCP Server**: Exposes `get_slack_mentions` tool via stdio transport
4. **Configuration Manager**: Zod-validated environment configuration with graceful stub mode
5. **SlackManager**: Encapsulates Slack Bolt app lifecycle and event handling

### Data Flow

1. User @mentions the bot in a Slack channel/thread
2. Slack Socket Mode pushes `app_mention` event to the server
3. Event is parsed, sanitized (bot mention removed), and queued
4. Agent_TypeScript polls `get_slack_mentions` tool periodically (e.g., every 10s)
5. Mentions are retrieved and cleared from queue
6. Agent processes with Claude API and replies via MCP_Slack_Server

---

## Module Structure

```mermaid
graph TD
    A["(Root) MCP_Slack_Client"] --> B["src/"];
    B --> C["index.ts (main entry)"];

    click C "#/src/module" "View src module documentation"
```

### Module Index

| Module Path | Language | Responsibility | Entry Point |
|-------------|----------|----------------|-------------|
| `src/` | TypeScript | Core server implementation | `index.ts` |

---

## Running and Development

### Prerequisites

- Node.js 20+
- npm or compatible package manager
- Slack workspace with bot configured for Socket Mode
- Slack app with `app_mentions:read` scope

### Environment Configuration

Create `.env` file from `.env.example`:

```bash
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_APP_TOKEN=xapp-your-app-token
ANTHROPIC_API_KEY=sk-ant-your-key  # Optional, used by downstream agents
MCP_LOG_LEVEL=info  # debug | info | warn | error
```

**Stub Mode**: If tokens don't start with `xoxb-` and `xapp-`, server runs in stub mode (MCP tools available but Slack disabled).

### Development Mode

```bash
npm install
npm run dev  # Watches src/ and auto-restarts on changes
```

### Production Mode

```bash
npm run build  # Compiles to dist/
npm start      # Runs compiled dist/index.js
```

### Docker Build

The `Dockerfile.build` is designed for build-only scenarios where `dist/` is mounted into KADI broker:

```bash
docker build -f Dockerfile.build -t mcp-slack-client-builder .
```

### MCP Integration (via KADI Broker)

Add to `kadi-broker/mcp-upstreams.json`:

```json
{
  "id": "slack-client",
  "name": "Slack Event Listener",
  "type": "stdio",
  "prefix": "slack_client",
  "networks": ["slack"],
  "stdio": {
    "command": "node",
    "args": ["C:/p4/Personal/SD/MCP_Slack_Client/dist/index.js"],
    "env": {
      "SLACK_BOT_TOKEN": "xoxb-...",
      "SLACK_APP_TOKEN": "xapp-...",
      "MCP_LOG_LEVEL": "info"
    }
  }
}
```

---

## Testing Strategy

### Current State
- No automated test suite present
- Manual testing via Slack workspace interactions
- Configuration validation via Zod schemas

### Recommended Testing Approach

1. **Unit Tests**: Test `MentionQueue` FIFO behavior and overflow protection
2. **Integration Tests**: Mock Slack Bolt app events and verify queueing
3. **MCP Protocol Tests**: Validate tool schema compliance and error handling
4. **E2E Tests**: Verify full flow from Slack event to MCP response in test workspace

### Testing Tools (not yet configured)
- Jest or Vitest for unit/integration tests
- Mock Slack events library for `@slack/bolt` testing
- MCP SDK test utilities for protocol validation

---

## Coding Standards

### TypeScript Configuration
- **Target**: ES2022
- **Module System**: ESNext (native ES modules)
- **Strict Mode**: Enabled with all strict flags
- **Output**: `dist/` directory with source maps and declarations

### Code Organization Patterns

1. **Configuration Section**: Zod schema validation at top of file
2. **Type Definitions**: Interfaces and type aliases grouped
3. **Class-Based Architecture**: Manager classes for distinct responsibilities
4. **Error Handling**: Try-catch with console logging, graceful degradation

### Naming Conventions
- **Classes**: PascalCase (e.g., `SlackManager`, `MentionQueue`)
- **Interfaces**: PascalCase (e.g., `SlackMention`, `Config`)
- **Functions/Methods**: camelCase with descriptive verbs
- **Constants**: UPPER_SNAKE_CASE for environment keys

### Dependencies
- **Runtime**: `@modelcontextprotocol/sdk`, `@slack/bolt`, `zod`, `dotenv`
- **Dev**: `typescript`, `tsx`, `@types/node`

---

## AI Usage Guidelines

### When Working on This Codebase

1. **Configuration Changes**: Always update Zod schemas and `.env.example` in sync
2. **Slack Event Handling**: Ensure thread context (`thread_ts`) is preserved for conversations
3. **Queue Management**: Respect max size limits to prevent memory issues
4. **MCP Tool Schema**: Keep `inputSchema` in `ListToolsRequestSchema` aligned with Zod validators
5. **Error Handling**: Maintain graceful degradation (stub mode, error responses in tool results)

### Integration Points to Consider

- **KADI Broker**: This server is typically spawned as child process via stdio
- **MCP_Slack_Server**: Companion server for posting replies (separate repository)
- **Agent_TypeScript**: Downstream consumer that polls `get_slack_mentions` tool
- **Claude API**: Used by agents, not directly by this server

### Common Modification Scenarios

- **Add New Tool**: Register in `ListToolsRequestSchema` and `CallToolRequestSchema` handlers
- **Extend Mention Data**: Update `SlackMention` interface and event parsing logic
- **Add Persistence**: Replace `MentionQueue` with database-backed queue
- **Multi-Workspace Support**: Refactor `SlackManager` to manage multiple app instances

---

## Key Files Reference

| File Path | Purpose |
|-----------|---------|
| `src/index.ts` | Main server implementation (MCP + Slack integration) |
| `package.json` | Dependencies, scripts, module configuration |
| `tsconfig.json` | TypeScript compiler settings |
| `.env.example` | Environment variable template |
| `Dockerfile.build` | Docker build configuration (for KADI broker) |
| `start.sh` | Shell script entry point for production |
| `.gitignore` | Git ignore rules (node_modules, dist, .env) |
| `.dockerignore` | Docker context ignore rules |

---

## Related Documentation

- [Model Context Protocol Specification](https://modelcontextprotocol.io/)
- [Slack Bolt Framework](https://slack.dev/bolt-js/)
- [Slack Socket Mode Guide](https://api.slack.com/apis/connections/socket)
- KADI Broker Documentation (internal, see KADI repository)
- MCP_Slack_Server Repository (companion for posting replies)

---

**Last Updated**: 2025-11-24
**Project Status**: Production-ready, actively maintained
**License**: MIT
