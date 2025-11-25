# MCP Slack Server

> **Model Context Protocol (MCP) server for Slack integration**
> Enables Claude Desktop and KADI agents to send messages to Slack channels via a stateless, tool-based interface.

## Changelog

- **2025-11-24**: Initial documentation generated via AI context initialization

---

## Project Vision

MCP Slack Server is a lightweight, stateless MCP server that provides Slack messaging capabilities for AI assistants. It bridges Claude Desktop and Agent_TypeScript with Slack's Web API, offering channel name resolution, thread support, and seamless integration with the KADI broker architecture.

**Core Principles:**
- Stateless design (no Socket Mode or event listening)
- Simple, focused tool interface (send messages, reply in threads)
- Automatic channel name-to-ID resolution
- Integration-ready for KADI multi-agent systems

---

## Architecture Overview

### System Architecture

```mermaid
graph TB
    subgraph "Client Layer"
        CD[Claude Desktop]
        AT[Agent_TypeScript]
    end

    subgraph "KADI Broker Layer"
        KB[KADI Broker<br/>MCP Upstream Manager]
    end

    subgraph "MCP Slack Server"
        MCP[MCP Server<br/>Stdio Transport]
        SC[SlackClient<br/>Channel Resolution]
        WA[Slack Web API<br/>@slack/web-api]
    end

    subgraph "Slack Platform"
        SL[Slack Workspace<br/>Channels & Threads]
    end

    CD -->|MCP Protocol| KB
    AT -->|MCP Protocol| KB
    KB -->|Stdio| MCP
    MCP --> SC
    SC --> WA
    WA -->|HTTPS| SL

    style MCP fill:#e1f5ff
    style SC fill:#fff3e0
    style KB fill:#f3e5f5
```

### Data Flow

```mermaid
sequenceDiagram
    participant Client as Claude Desktop
    participant Broker as KADI Broker
    participant MCP as MCP Server
    participant Slack as Slack Web API

    Client->>Broker: Invoke slack_send_message
    Broker->>MCP: Forward tool call (stdio)
    MCP->>MCP: Validate input (Zod schema)
    MCP->>MCP: Resolve #channel-name → C12345
    MCP->>Slack: POST chat.postMessage
    Slack-->>MCP: {ok: true, ts: "..."}
    MCP-->>Broker: Success response
    Broker-->>Client: Message sent confirmation
```

### Key Components

1. **SlackServerMCPServer** (Main server class)
   - MCP protocol handler
   - Tool registration and execution
   - Error handling and logging

2. **SlackClient** (Slack API wrapper)
   - Channel name resolution with caching
   - Message sending (standalone + threaded)
   - Slack Web API interaction

3. **Configuration Management**
   - Environment variable validation (Zod schemas)
   - Slack bot token authentication
   - Logging level control

---

## Module Structure

This is a single-module project with all code in `src/index.ts`. No sub-modules exist.

```mermaid
graph TD
    A["(Root) MCP_Slack_Server"] --> B["src/"];
    B --> C["index.ts<br/>(Main Entry)"];

    A --> D["Configuration"];
    D --> E[".env<br/>Environment"];
    D --> F["tsconfig.json<br/>TypeScript Config"];
    D --> G["package.json<br/>Dependencies"];

    A --> H["Build & Deploy"];
    H --> I["Dockerfile.build<br/>Build Container"];
    H --> J["start.sh<br/>Startup Script"];

    style C fill:#e8f5e9
    style E fill:#fff9c4
    style I fill:#e1f5ff
```

---

## Module Index

| Module Path | Language | Responsibility | Entry Point | Tests |
|------------|----------|----------------|-------------|-------|
| `src/` | TypeScript | Core MCP server implementation | `index.ts` | None |

---

## Running and Development

### Prerequisites

- Node.js 20+
- Slack Bot Token with required scopes:
  - `chat:write` - Send messages
  - `chat:write.public` - Send to public channels
  - `channels:read` - Resolve channel names
  - `groups:read` - Access private channels (optional)

### Environment Setup

1. **Create `.env` file:**

```env
SLACK_BOT_TOKEN=xoxb-your-bot-token-here
MCP_LOG_LEVEL=info
```

2. **Install dependencies:**

```bash
npm install
```

### Development Mode

Run with live reload:

```bash
npm run dev
```

Uses `tsx watch` for instant TypeScript recompilation.

### Production Build

```bash
npm run build    # Compile to dist/
npm start        # Run compiled JavaScript
```

### Integration with KADI Broker

Add to `kadi-broker/mcp-upstreams.json`:

```json
{
  "id": "slack-server",
  "name": "Slack Message Sender",
  "type": "stdio",
  "prefix": "slack",
  "networks": ["global", "slack"],
  "stdio": {
    "command": "node",
    "args": ["C:/p4/Personal/SD/MCP_Slack_Server/dist/index.js"],
    "env": {
      "SLACK_BOT_TOKEN": "xoxb-..."
    }
  }
}
```

### Docker Build

For production deployment in containerized environments:

```bash
docker build -f Dockerfile.build -t mcp-slack-server-builder .
docker run --rm -v $(pwd)/dist:/app/dist mcp-slack-server-builder
```

The `dist/` directory can then be mounted into KADI Broker container.

---

## Testing Strategy

**Current State:** No automated tests exist.

**Recommended Testing Approach:**

1. **Unit Tests** (Priority: High)
   - Channel name resolution logic
   - Zod schema validation
   - Error handling paths

2. **Integration Tests** (Priority: Medium)
   - Slack API mocking (e.g., `nock` or `msw`)
   - MCP protocol compliance testing
   - End-to-end tool invocation

3. **Manual Testing Checklist:**
   - [ ] Send message to public channel by name
   - [ ] Send message to channel by ID
   - [ ] Reply in existing thread
   - [ ] Handle invalid channel names
   - [ ] Handle missing Slack token
   - [ ] Verify error responses are JSON-serializable

**Suggested Test Framework:** Jest or Vitest (TypeScript-native)

---

## Coding Standards

### TypeScript Configuration

- **Target:** ES2022
- **Module System:** ESNext (pure ES modules)
- **Strict Mode:** Enabled
- **Unused Variable Checking:** Enforced
- **Source Maps:** Generated for debugging

### Code Style

1. **Validation:** All external inputs validated with Zod schemas
2. **Error Handling:** Structured try-catch with JSON error responses
3. **Logging:** Console-based with emoji indicators:
   - ✅ Success operations
   - ❌ Errors
   - 🚀 Startup events
   - 📋 Configuration display
4. **Type Safety:** No `any` types; explicit return types for public methods
5. **Documentation:** JSDoc comments for complex methods

### Dependency Management

- **Production Dependencies:**
  - `@modelcontextprotocol/sdk` - MCP protocol implementation
  - `@slack/web-api` - Official Slack client
  - `zod` - Runtime schema validation
  - `dotenv` - Environment variable loading

- **Dev Dependencies:**
  - `typescript` - Type checker and compiler
  - `tsx` - TypeScript execution and watch mode
  - `@types/node` - Node.js type definitions

---

## AI Usage Guidelines

### When Working with This Codebase

1. **DO:**
   - Validate all tool inputs with Zod schemas
   - Return structured JSON responses from tool handlers
   - Use async/await for all Slack API calls
   - Log all message sends with timestamps and channel IDs
   - Cache channel name-to-ID mappings to reduce API calls

2. **DON'T:**
   - Add Socket Mode or event listening (out of scope)
   - Store conversation state (stateless design)
   - Modify message content (pass-through only)
   - Expose Slack bot token in logs or responses
   - Use synchronous I/O operations

3. **Extension Points:**
   - Add new Zod schemas for tool validation
   - Implement additional Slack API methods (e.g., file uploads)
   - Add retry logic with exponential backoff
   - Implement rate limiting for API calls

4. **Integration Patterns:**
   - Always invoke via KADI Broker (not direct stdio)
   - Use tool name prefix `slack_` when registered
   - Return consistent JSON structure: `{success, message, ...}`
   - Handle thread context via `thread_ts` parameter

### Example AI Prompts

**Send a message:**
```
Send a message to #general saying "Build complete!"
```

**Reply in thread:**
```
Reply to the thread in #support with timestamp 1234567890.123456
saying "I've looked into this issue..."
```

**Resolve channel by name:**
```
What channel ID does #random map to?
```

---

## Tools Reference

### `send_message`

Send a message to a Slack channel or start a new thread.

**Input Schema:**
```typescript
{
  channel: string;   // "#general" or "C09T6RU41HP"
  text: string;      // Message content
  thread_ts?: string; // Optional: reply in thread
}
```

**Output:**
```json
{
  "success": true,
  "message": "Message sent successfully",
  "timestamp": "1234567890.123456",
  "channel": "C09T6RU41HP"
}
```

**Example Usage (from Agent_TypeScript):**
```typescript
await client.getBrokerProtocol().invokeTool({
  targetAgent: 'slack-server',
  toolName: 'slack_send_message',
  toolInput: {
    channel: '#general',
    text: 'Hello from Agent_TypeScript!'
  },
  timeout: 10000
});
```

---

### `send_reply`

Reply to an existing message in a thread.

**Input Schema:**
```typescript
{
  channel: string;   // "C09T6RU41HP"
  thread_ts: string; // "1234567890.123456"
  text: string;      // Reply content
}
```

**Output:**
```json
{
  "success": true,
  "message": "Reply sent successfully",
  "timestamp": "1234567890.654321",
  "channel": "C09T6RU41HP",
  "thread_ts": "1234567890.123456"
}
```

**Example Usage:**
```typescript
await client.getBrokerProtocol().invokeTool({
  targetAgent: 'slack-server',
  toolName: 'slack_send_reply',
  toolInput: {
    channel: 'C09T6RU41HP',
    thread_ts: '1234567890.123456',
    text: 'This is a threaded reply'
  },
  timeout: 10000
});
```

---

## Configuration Reference

### Environment Variables

| Variable | Required | Format | Description |
|----------|----------|--------|-------------|
| `SLACK_BOT_TOKEN` | Yes | `xoxb-...` | Slack bot user OAuth token |
| `MCP_LOG_LEVEL` | No | `debug\|info\|warn\|error` | Logging verbosity (default: `info`) |

### Slack Bot Setup

1. Create Slack app at https://api.slack.com/apps
2. Enable OAuth & Permissions
3. Add bot token scopes:
   - `chat:write`
   - `chat:write.public`
   - `channels:read`
   - `groups:read` (for private channels)
4. Install app to workspace
5. Copy Bot User OAuth Token to `.env`

---

## Troubleshooting

### Common Issues

**"Configuration validation failed"**
- Ensure `.env` file exists with valid `SLACK_BOT_TOKEN`
- Token must start with `xoxb-`

**"Channel '#channel-name' not found"**
- Bot may not have access to channel
- Channel name may be misspelled
- Try using channel ID directly instead

**"Failed to send message"**
- Verify bot has `chat:write` scope
- Check bot is invited to private channels
- Ensure Slack API is reachable (network/firewall)

**MCP server not responding**
- Check KADI Broker logs for stdio errors
- Verify Node.js path in `mcp-upstreams.json`
- Ensure `dist/index.js` exists (run `npm run build`)

---

## Related Projects

- **KADI Broker** - MCP upstream manager and routing layer
- **MCP_Slack_Client** - Companion server for reading Slack mentions/events
- **Agent_TypeScript** - Multi-agent framework using KADI broker

---

## File Structure

```
MCP_Slack_Server/
├── src/
│   └── index.ts              # Main server implementation
├── dist/                      # Compiled JavaScript (generated)
├── node_modules/              # Dependencies (generated)
├── .env                       # Environment config (git-ignored)
├── .env.example               # Environment template
├── .gitignore                 # Git ignore rules
├── package.json               # NPM package definition
├── tsconfig.json              # TypeScript compiler config
├── Dockerfile.build           # Build container definition
├── start.sh                   # Production startup script
├── README.md                  # User-facing documentation
└── CLAUDE.md                  # AI context (this file)
```

---

## License

MIT

---

## Contact & Support

This is a stateless MCP server - no persistent state or database required. For questions about:

- **MCP Protocol:** See https://modelcontextprotocol.io
- **Slack API:** See https://api.slack.com
- **KADI Integration:** Refer to KADI Broker documentation

**Logs Location:** `stdout` (captured by KADI Broker or parent process)
