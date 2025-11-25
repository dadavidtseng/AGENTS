# MCP_Slack_Client

MCP Server that listens for Slack @mentions and queues them for processing by Agent_TypeScript through the KADI broker.

## Overview

This server is part of the KADI Slack bot architecture. It:
1. Connects to Slack via Socket Mode to receive real-time @mention events
2. Queues mentions in memory for retrieval
3. Exposes `get_slack_mentions` MCP tool for Agent_TypeScript to poll
4. Works in conjunction with MCP_Slack_Server (for sending replies)

## Architecture

```
Slack @mention → Socket Mode → Mention Queue → MCP Tool (get_slack_mentions)
                                                      ↓
                                              KADI Broker
                                                      ↓
                                             Agent_TypeScript
                                                      ↓
                                          Claude API + Reply via MCP_Slack_Server
```

## Installation

```bash
cd C:\p4\Personal\SD\MCP_Slack_Client
npm install
```

## Configuration

Create `.env` file:

```env
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_APP_TOKEN=xapp-your-app-token
ANTHROPIC_API_KEY=sk-ant-your-key
MCP_LOG_LEVEL=info
```

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

## Tools

### `get_slack_mentions`

Retrieve pending Slack @mentions from the queue.

**Input:**
```json
{
  "limit": 10  // Max mentions to retrieve (1-50)
}
```

**Output:**
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
  "retrieved_at": "2025-01-16T10:30:00.000Z"
}
```

## Integration with Agent_TypeScript

Agent_TypeScript should poll this tool periodically (e.g., every 10 seconds):

```typescript
const result = await client.getBrokerProtocol().invokeTool({
  targetAgent: 'slack-client',
  toolName: 'slack_client_get_slack_mentions',
  toolInput: { limit: 5 },
  timeout: 10000
});

const { mentions } = JSON.parse(result.result);
// Process each mention with Claude API
// Reply using MCP_Slack_Server tools
```

## License

MIT
