# Core Application Module

[Root Directory](../CLAUDE.md) > **src**

## Changelog

**2025-11-24T18:36:22-0600** - Initial module documentation
- Documented single-file architecture
- Analyzed class structure and responsibilities
- Identified key dependencies and data flows

---

## Module Responsibility

This module implements the complete MCP Discord Client application in a single TypeScript file. It orchestrates Discord Gateway event listening, mention queue management, and MCP server protocol handling. The module acts as the bridge between Discord's real-time event stream and the KADI broker's tool invocation system.

## Entry and Startup

**Main Entry**: `src/index.ts`

**Startup Sequence**:
1. Load environment variables with `dotenv.config()`
2. Validate configuration against Zod schema
3. Instantiate `DiscordClientMCPServer` (creates MentionQueue + DiscordManager)
4. Start Discord Gateway client (login + WebSocket connection)
5. Initialize STDIO transport for MCP server
6. Connect MCP server to transport
7. Log ready state and begin listening

**Startup Logs**:
```
🚀 Starting MCP_Discord_Client...
📋 Configuration:
   - Log Level: info
   - Queue Max Size: 100
🔗 Discord Gateway connection initiated...
✅ Discord bot logged in as BotName#1234
✅ MCP_Discord_Client ready
🎧 Listening for Discord @mentions...
```

**Graceful Degradation**: If `DISCORD_TOKEN` appears to be a placeholder (length < 50 or contains "YOUR_"), the system runs in stub mode without connecting to Discord.

## External Interfaces

### MCP Tools

#### `get_discord_mentions`

**Purpose**: Retrieve and dequeue pending Discord @mentions for AI processing.

**Input Schema**:
```typescript
{
  limit?: number  // 1-50, default: 10
}
```

**Output Schema**:
```json
{
  "mentions": [
    {
      "id": "string",          // Discord message ID
      "user": "string",        // Discord user ID
      "username": "string",    // Display username
      "text": "string",        // Message with @bot mention removed
      "channel": "string",     // Channel ID
      "channelName": "string", // Channel name or "DM"
      "guild": "string",       // Guild ID or "DM"
      "ts": "ISO8601 string"   // Message timestamp
    }
  ],
  "count": number,               // Number of mentions retrieved
  "retrieved_at": "ISO8601 string"
}
```

**Behavior**:
- Removes retrieved mentions from queue (FIFO)
- Returns empty array if queue empty
- Validates limit parameter with Zod
- Handles errors gracefully with error JSON response

### Discord Event Subscriptions

**Gateway Intents Required**:
- `Guilds`: Guild membership and metadata
- `GuildMessages`: Message events in text channels
- `MessageContent`: Actual message text content
- `DirectMessages`: DM events

**Event Handlers**:
- `ready`: Captures bot user ID, logs successful connection
- `messageCreate`: Filters for @mentions, queues valid mentions
- `error`: Logs Discord client errors

## Key Dependencies and Configuration

### External Dependencies

**Core**:
- `@modelcontextprotocol/sdk`: MCP protocol server and types
  - `Server`: Main MCP server class
  - `StdioServerTransport`: STDIO communication layer
  - Request schemas for protocol handling

- `discord.js`: Discord API wrapper
  - `Client`: Gateway client with intent-based filtering
  - `GatewayIntentBits`: Intent flags for event subscriptions
  - `Message`: Message object type
  - `Partials`: Partial data handling (for DMs)

**Validation**:
- `zod`: Runtime schema validation
  - Config validation (env vars)
  - Tool input validation
  - Type inference for TypeScript

**Utilities**:
- `dotenv`: Environment variable loading from `.env` file

### Configuration Schema

**Environment Variables** (validated with Zod):

```typescript
{
  DISCORD_TOKEN: string (min 1 char, required)
  DISCORD_GUILD_ID?: string (optional, for guild-specific filtering)
  MCP_LOG_LEVEL: 'debug' | 'info' | 'warn' | 'error' (default: 'info')
}
```

**Hard-coded Constants**:
- Queue max size: 100 mentions
- Mention batch limit range: 1-50
- MCP server name: "mcp-discord-client"
- MCP server version: "1.0.0"

## Data Models

### Core Types

**DiscordMention** (Interface)
```typescript
{
  id: string           // Message ID (snowflake)
  user: string         // User ID (snowflake)
  username: string     // User's display name
  text: string         // Clean message text
  channel: string      // Channel ID (snowflake)
  channelName: string  // Readable channel name
  guild: string        // Guild ID or "DM"
  ts: string           // ISO 8601 timestamp
}
```

**Config** (Zod Inferred)
```typescript
{
  DISCORD_TOKEN: string
  DISCORD_GUILD_ID?: string
  MCP_LOG_LEVEL: 'debug' | 'info' | 'warn' | 'error'
}
```

### Class Architecture

**MentionQueue**
- **State**: Private array of DiscordMention objects
- **Methods**:
  - `add(mention)`: Append to queue, enforce max size
  - `getAndClear(limit)`: Extract and remove first N mentions
  - `size()`: Return current queue length
- **Behavior**: FIFO queue with overflow protection (drops oldest)

**DiscordManager**
- **State**: Discord Client instance, MentionQueue reference, bot user ID
- **Methods**:
  - `start()`: Login and connect to Gateway
  - `stop()`: Gracefully disconnect client
  - `handleMessage(message)`: Process messageCreate events
- **Responsibilities**: Event handling, mention extraction, queue population

**DiscordClientMCPServer**
- **State**: MCP Server, DiscordManager, MentionQueue, Config
- **Methods**:
  - `run()`: Start both Discord and MCP servers
  - `handleGetMentions(args)`: MCP tool handler
- **Responsibilities**: MCP protocol handling, component orchestration

## Testing and Quality

### Current Test Status

**No tests implemented.**

### Recommended Tests

**Unit Tests**:
```typescript
// MentionQueue
- add() should append mention to queue
- add() should drop oldest when exceeding maxSize
- getAndClear() should return FIFO ordered mentions
- getAndClear() should remove returned mentions from queue
- size() should accurately reflect queue length

// DiscordManager
- handleMessage() should ignore bot messages
- handleMessage() should only queue messages mentioning bot
- handleMessage() should strip bot mention from text
- handleMessage() should handle DMs correctly

// Config Validation
- should reject missing DISCORD_TOKEN
- should use default log level when not specified
- should accept valid log levels
```

**Integration Tests**:
```typescript
// MCP Protocol
- get_discord_mentions should return valid JSON
- get_discord_mentions should respect limit parameter
- get_discord_mentions should handle empty queue
- get_discord_mentions should validate limit range

// Discord Events
- messageCreate with mention should queue mention
- messageCreate without mention should be ignored
- ready event should capture bot user ID
```

**Manual Testing Checklist**:
- [ ] Bot successfully connects to Discord Gateway
- [ ] @mentions in text channels are queued
- [ ] @mentions in DMs are queued
- [ ] Bot ignores its own messages
- [ ] Queue overflow drops oldest mentions
- [ ] MCP tool returns correct JSON structure
- [ ] STDIO transport works with KADI broker

### Code Quality Tools

**Current Configuration**:
- TypeScript strict mode enabled
- No linter configured (ESLint recommended)
- No formatter configured (Prettier recommended)
- No pre-commit hooks

**Recommended Additions**:
```json
{
  "devDependencies": {
    "eslint": "^8.x",
    "@typescript-eslint/parser": "^6.x",
    "@typescript-eslint/eslint-plugin": "^6.x",
    "prettier": "^3.x",
    "husky": "^8.x",
    "lint-staged": "^14.x"
  }
}
```

## FAQ

### Why is Discord connection in stub mode?

The token validation checks for length > 50 and absence of "YOUR_" prefix. Ensure your `.env` file has a real Discord bot token, not the placeholder from `.env.example`.

### Why aren't mentions being queued?

Common causes:
1. Message Content Intent not enabled in Discord Developer Portal
2. Bot user ID not captured (check for "Discord bot logged in" log)
3. Messages are from bots (automatically ignored)
4. Bot not actually mentioned in message

### How do I test without KADI broker?

You can invoke the MCP server directly using STDIO:
```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node dist/index.js
```

However, the server expects MCP protocol handshake first. Use the MCP SDK's test utilities or connect via KADI broker.

### Can I use this with multiple Discord bots?

No, each instance manages one Discord client. To support multiple bots, run separate instances with different tokens and MCP server IDs.

### What happens if the queue fills up?

When the queue exceeds 100 mentions, the oldest mention is automatically dropped (FIFO eviction). Consider increasing `maxSize` if your bot receives high @mention volume.

### Why does the bot need Message Content Intent?

Discord requires explicit intent declaration for reading message content (not just metadata). This is a privileged intent that must be enabled in the Developer Portal under Bot settings.

## Related File List

**Source Files**:
- `src/index.ts` (409 lines) - Complete application implementation

**Configuration**:
- `tsconfig.json` - TypeScript compiler configuration
- `package.json` - Dependencies and npm scripts
- `.env.example` - Environment variable template
- `.dockerignore` - Docker build exclusions

**Build Artifacts** (Generated):
- `dist/index.js` - Compiled JavaScript output
- `dist/index.d.ts` - TypeScript declarations
- `dist/index.js.map` - Source map for debugging

**Infrastructure**:
- `Dockerfile.build` - Build-only Docker image for CI/CD
- `start.sh` - Shell script entry point for production

**Documentation**:
- `README.md` - User-facing setup and usage guide
- `CLAUDE.md` - Root-level AI context documentation
- `src/CLAUDE.md` - This file
