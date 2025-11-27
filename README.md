# MCP_Slack_Client

MCP Server that listens for Slack @mentions and publishes them as events to the KĀDI event bus for real-time processing by Agent_TypeScript.

## Overview

This server is part of the KĀDI Slack bot architecture. It:
1. Connects to Slack via Socket Mode to receive real-time @mention events
2. Validates and publishes events to KĀDI broker using topic-based routing
3. Enables event-driven architecture with <100ms latency
4. Works in conjunction with MCP_Slack_Server (for sending replies)

## Architecture

```
Slack @mention → Socket Mode → Event Validation → KĀDI Event Bus
                                                      ↓
                                    Topic: slack.app_mention.{BOT_USER_ID}
                                                      ↓
                                             Agent_TypeScript
                                                      ↓
                                          Claude API + Reply via MCP_Slack_Server
```

### Event-Driven Architecture

This server implements a **publish-subscribe pattern** using KĀDI's RabbitMQ infrastructure:

- **Publisher**: MCP_Slack_Client publishes `SlackMentionEvent` to topic `slack.app_mention.{BOT_USER_ID}`
- **Subscriber**: Agent_TypeScript subscribes to the same topic for real-time event delivery
- **Benefits**: Real-time processing (<100ms), no polling overhead, scalable architecture

## Installation

```bash
cd C:\p4\Personal\SD\MCP_Slack_Client
npm install
```

## Configuration

Create `.env` file:

```env
# Slack API Credentials
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_APP_TOKEN=xapp-your-app-token

# Anthropic Claude API (optional, not used in this server)
ANTHROPIC_API_KEY=sk-ant-your-key

# MCP Server Configuration
MCP_LOG_LEVEL=info

# KĀDI Broker Configuration (REQUIRED for event publishing)
KADI_BROKER_URL=ws://localhost:8080
SLACK_BOT_USER_ID=U01234ABCD
```

### Environment Variables

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `SLACK_BOT_TOKEN` | ✅ Yes | Slack bot user OAuth token | `xoxb-123...` |
| `SLACK_APP_TOKEN` | ✅ Yes | Slack app-level token for Socket Mode | `xapp-1-A...` |
| `KADI_BROKER_URL` | ✅ Yes | WebSocket URL for KĀDI broker | `ws://localhost:8080` |
| `SLACK_BOT_USER_ID` | ✅ Yes | Slack bot user ID for event topic routing | `U01234ABCD` |
| `MCP_LOG_LEVEL` | No | Logging level (debug, info, warn, error) | `info` |
| `ANTHROPIC_API_KEY` | No | Not used (kept for backward compatibility) | `sk-ant-...` |

### Required Slack Scopes

- `app_mentions:read` - Listen for @mentions
- `chat:write` - (handled by MCP_Slack_Server)

## Usage

### Development Mode
```bash
npm run dev
```

### Production Mode
```bash
npm run build
npm start
```

### As MCP Upstream (via KADI Broker)

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
      "ANTHROPIC_API_KEY": "sk-ant-..."
    }
  }
}
```

## 🔴 Breaking Changes

### Version 2.0.0 - Event-Driven Architecture

**What Changed:**
- ❌ **REMOVED**: `get_slack_mentions` MCP tool (polling-based)
- ✅ **ADDED**: Event publishing to KĀDI event bus (real-time)

**Impact:**
- Agents can no longer poll for mentions using `get_slack_mentions`
- Agents must subscribe to `slack.app_mention.{BOT_USER_ID}` events instead

**Migration Required:**
- Update Agent_TypeScript to use event subscription (see Migration Guide below)
- Add `KADI_BROKER_URL` and `SLACK_BOT_USER_ID` to environment configuration

---

## Event Topics

### `slack.app_mention.{BOT_USER_ID}`

Published when the bot is @mentioned in Slack.

**Event Payload (SlackMentionEvent):**
```typescript
{
  id: string;           // Unique mention ID (Slack event timestamp)
  user: string;         // Slack user ID who mentioned the bot
  text: string;         // Message text (with @bot mention removed)
  channel: string;      // Slack channel ID
  thread_ts: string;    // Thread timestamp for replies
  ts: string;           // Event timestamp from Slack
  bot_id: string;       // Slack bot user ID (routing identifier)
  timestamp: string;    // ISO 8601 datetime when event was published
}
```

**Example:**
```json
{
  "id": "1234567890.123456",
  "user": "U12345",
  "text": "What's the weather today?",
  "channel": "C12345",
  "thread_ts": "1234567890.123456",
  "ts": "1234567890.123456",
  "bot_id": "U01234ABCD",
  "timestamp": "2025-01-16T10:30:00.000Z"
}
```

---

## Integration with Agent_TypeScript

### Event Subscription (Current - v2.0.0+)

Agent_TypeScript subscribes to real-time events:

```typescript
import { SlackMentionEventSchema } from './types/slack-events.js';

// Subscribe to Slack mention events
client.subscribeToEvent(`slack.app_mention.${botUserId}`, async (event: unknown) => {
  // Validate event payload
  const validationResult = SlackMentionEventSchema.safeParse(event);

  if (!validationResult.success) {
    console.error('Invalid event:', validationResult.error);
    return;
  }

  const mention = validationResult.data;

  // Process mention with Claude API
  // Reply using MCP_Slack_Server tools
});
```

### Polling (Deprecated - v1.x)

⚠️ **No longer supported** - Update to event subscription:

```typescript
// ❌ OLD (v1.x) - No longer works
const result = await client.getBrokerProtocol().invokeTool({
  targetAgent: 'slack-client',
  toolName: 'slack_client_get_slack_mentions',
  toolInput: { limit: 5 },
  timeout: 10000
});
```

---

## Migration Guide

### Upgrading from v1.x to v2.0.0

**Step 1: Update Environment Variables**

Add to `.env`:
```env
KADI_BROKER_URL=ws://localhost:8080
SLACK_BOT_USER_ID=U01234ABCD  # Get from Slack app settings
```

**Step 2: Update Agent Code**

Remove polling logic:
```typescript
// ❌ Remove this
setInterval(async () => {
  const result = await invokeTool({
    targetAgent: 'slack-client',
    toolName: 'slack_client_get_slack_mentions',
    ...
  });
}, 10000);
```

Add event subscription:
```typescript
// ✅ Add this
import { SlackMentionEventSchema } from './types/slack-events.js';

client.subscribeToEvent(
  `slack.app_mention.${process.env.SLACK_BOT_USER_ID}`,
  async (event: unknown) => {
    const mention = SlackMentionEventSchema.parse(event);
    // Your existing processing logic
  }
);
```

**Step 3: Update Dependencies**

Install Zod for schema validation (if not already installed):
```bash
npm install zod
```

**Step 4: Test Event Flow**

1. Start KĀDI broker
2. Start MCP_Slack_Client (publisher)
3. Start Agent_TypeScript (subscriber)
4. Send test @mention in Slack
5. Verify event received in <100ms

## License

MIT
