# src/ Module

[Root Directory](../CLAUDE.md) > **src**

---

## Module Responsibilities

The `src/` module contains the complete implementation of the MCP_Slack_Client server. It integrates three major concerns into a single cohesive TypeScript file:

1. **Slack Event Listening**: Real-time @mention event streaming via Socket Mode
2. **Mention Queue Management**: In-memory FIFO queue with overflow protection
3. **MCP Server Protocol**: Tool exposure via stdio transport for KADI broker integration

This module is the sole source code directory, following a single-file architecture pattern suitable for focused MCP servers.

---

## Entry and Startup

### Main Entry Point
**File**: `index.ts` (line 376-386)

```typescript
async function main(): Promise<void> {
  const server = new SlackClientMCPServer();
  await server.run();
}
```

### Initialization Sequence

1. **Configuration Loading** (line 50-62)
   - Validates environment variables via Zod schema
   - Throws early if required Slack tokens missing
   - Defaults `MCP_LOG_LEVEL` to 'info'

2. **Component Construction** (line 254-270)
   - Creates `MentionQueue` instance
   - Initializes `SlackManager` with config and queue
   - Sets up MCP `Server` with capabilities

3. **Server Startup** (line 354-369)
   - Starts Slack Socket Mode listener (if tokens valid)
   - Connects MCP server to stdio transport
   - Logs ready state and begins listening

### Graceful Degradation: Stub Mode

If `SLACK_BOT_TOKEN` or `SLACK_APP_TOKEN` don't match expected prefixes (`xoxb-`, `xapp-`), the server runs in **stub mode**:
- Slack connection disabled
- MCP tools remain available (return empty results)
- Useful for testing MCP integration without Slack workspace

---

## External Interfaces

### MCP Tool: `get_slack_mentions`

**Exposed via**: MCP Server `ListToolsRequestSchema` (line 280-300)

**Purpose**: Retrieve and clear pending Slack @mentions from the queue

**Input Schema**:
```json
{
  "limit": {
    "type": "number",
    "minimum": 1,
    "maximum": 50,
    "default": 10,
    "description": "Maximum number of mentions to retrieve"
  }
}
```

**Output Format** (line 322-330):
```json
{
  "mentions": [
    {
      "id": "1234567890.123456",
      "user": "U12345",
      "text": "What's the weather today?",
      "channel": "C12345",
      "thread_ts": "1234567890.123456",
      "ts": "1234567890.123456"
    }
  ],
  "count": 1,
  "retrieved_at": "2025-11-24T18:36:25.000Z"
}
```

**Error Handling** (line 334-347):
- Returns error message in result JSON
- Never throws exceptions to caller
- Empty mentions array on failure

### Slack Event Subscription

**Event Type**: `app_mention` (line 181-183)

**Handler Logic** (line 194-216):
1. Strips bot mention tags (`<@USER_ID>`) from text
2. Preserves thread context via `thread_ts`
3. Creates `SlackMention` object
4. Adds to queue (FIFO, max 100 items)

**Required Scopes**:
- `app_mentions:read` - Listen for @mentions

---

## Key Dependencies and Configuration

### Runtime Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `@modelcontextprotocol/sdk` | ^1.0.4 | MCP server implementation |
| `@slack/bolt` | ^4.1.0 | Slack Bolt framework (Socket Mode) |
| `zod` | ^3.24.1 | Runtime type validation |
| `dotenv` | ^16.4.7 | Environment variable loading |
| `@anthropic-ai/sdk` | ^0.32.1 | (Listed but unused in this server) |

### Development Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `typescript` | ^5.7.2 | TypeScript compiler |
| `tsx` | ^4.19.2 | TypeScript execution and watch mode |
| `@types/node` | ^22.10.2 | Node.js type definitions |

### Configuration Schema

**Defined at**: Line 41-46

```typescript
const ConfigSchema = z.object({
  SLACK_BOT_TOKEN: z.string().min(1, 'SLACK_BOT_TOKEN is required'),
  SLACK_APP_TOKEN: z.string().min(1, 'SLACK_APP_TOKEN is required'),
  ANTHROPIC_API_KEY: z.string().optional().default(''),
  MCP_LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});
```

**Validation Timing**: Synchronous at startup (line 51-61)

---

## Data Models

### `SlackMention` Interface (line 71-84)

Represents a parsed Slack @mention event.

```typescript
interface SlackMention {
  id: string;          // Unique mention ID (timestamp)
  user: string;        // User who mentioned the bot
  text: string;        // Message text (bot mention removed)
  channel: string;     // Channel where mention occurred
  thread_ts: string;   // Thread timestamp for replies
  ts: string;          // Event timestamp
}
```

**Sanitization**: Bot mention tags are removed via regex (line 197):
```typescript
const cleanText = event.text.replace(/<@[A-Z0-9]+>/g, '').trim();
```

### `Config` Type (line 48)

Inferred from Zod schema for type-safe configuration access.

---

## Class Architecture

### `MentionQueue` (line 106-139)

**Responsibility**: Thread-safe in-memory FIFO queue for mentions

**Key Methods**:
- `add(mention)`: Appends to queue, removes oldest if > 100 items
- `getAndClear(limit)`: Retrieves up to `limit` items and removes them
- `size()`: Returns current queue length

**Memory Safety**: Hard limit of 100 items prevents unbounded growth

### `SlackManager` (line 145-242)

**Responsibility**: Manages Slack Bolt app lifecycle and event routing

**Key Methods**:
- `constructor(config, mentionQueue)`: Initializes app, checks token validity
- `registerEventHandlers()`: Sets up `app_mention` listener
- `handleMention(event)`: Parses event and queues mention
- `start()`: Connects to Slack Socket Mode
- `stop()`: Gracefully disconnects

**State**: `enabled` flag controls whether Slack is active (stub mode support)

### `SlackClientMCPServer` (line 248-370)

**Responsibility**: Orchestrates MCP server and Slack listener

**Key Methods**:
- `constructor()`: Loads config, creates queue and Slack manager
- `registerHandlers()`: Sets up MCP tool handlers
- `handleGetMentions(args)`: Processes `get_slack_mentions` tool calls
- `run()`: Starts both Slack listener and MCP server

**Transport**: Uses `StdioServerTransport` for MCP communication (line 364)

---

## Testing and Quality

### Current Testing Status
- **No test files present**
- **Manual testing only**: Requires live Slack workspace
- **Type safety**: TypeScript strict mode enabled

### Recommended Test Coverage

1. **`MentionQueue` Unit Tests**
   - FIFO ordering verification
   - Overflow behavior (101st item removes 1st)
   - `getAndClear` atomicity

2. **`SlackManager` Integration Tests**
   - Mock `@slack/bolt` App events
   - Verify mention parsing and sanitization
   - Test stub mode activation

3. **MCP Protocol Tests**
   - Validate tool schema compliance
   - Test input validation (limit 1-50)
   - Verify error response format

4. **End-to-End Tests**
   - Simulate Slack event → queue → tool call flow
   - Verify thread context preservation

### Quality Tooling (not configured)
- No linter configuration (ESLint recommended)
- No formatter configuration (Prettier recommended)
- No pre-commit hooks

---

## FAQ

### Q: Why is `ANTHROPIC_API_KEY` in the config but unused?
**A**: The server doesn't directly call Claude API. It's included for convenience when running via KADI broker, which may pass it to downstream agents (Agent_TypeScript).

### Q: What happens if the queue fills beyond 100 items?
**A**: The oldest mention is automatically removed (`queue.shift()` at line 118). This prevents memory exhaustion but may lose unprocessed mentions.

### Q: Can this server handle multiple Slack workspaces?
**A**: No. It's designed for a single workspace. Multi-workspace support would require refactoring `SlackManager` to manage multiple `App` instances.

### Q: Why Socket Mode instead of HTTP webhooks?
**A**: Socket Mode eliminates the need for public HTTPS endpoints and webhook verification, simplifying deployment. Ideal for local/Docker environments.

### Q: How does the broker know to call `get_slack_mentions`?
**A**: Agent_TypeScript polls the tool periodically (e.g., every 10 seconds). The MCP server doesn't push events; it's a pull-based model.

### Q: What's the difference between `ts` and `thread_ts`?
**A**:
- `ts`: Timestamp of the specific message
- `thread_ts`: Timestamp of the thread's parent message (used for replies). If not in a thread, `thread_ts` equals `ts`.

---

## Related Files

### Primary Source
- `index.ts` - Complete server implementation (387 lines)

### Configuration
- `../tsconfig.json` - TypeScript compiler settings
- `../.env.example` - Environment variable template
- `../package.json` - Dependencies and scripts

### Deployment
- `../Dockerfile.build` - Docker build configuration
- `../start.sh` - Production entry script
- `../.dockerignore` - Docker context exclusions

---

## Changelog

### 2025-11-24 - Initial Documentation
- Documented complete module architecture
- Detailed MCP tool interface specification
- Identified testing gaps and recommendations

---

**Module Type**: TypeScript (ES Modules)
**Line Count**: 387
**External APIs**: Slack Socket Mode, MCP Stdio
**Deployment**: Standalone or via KADI broker stdio transport
