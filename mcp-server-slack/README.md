# MCP_Slack_Server

MCP Server that provides Slack message sending capabilities for Claude Desktop and KADI agents.

## Overview

This server is part of the KADI Slack bot architecture. It:
1. Provides stateless message sending tools
2. Resolves channel names to IDs automatically
3. Supports both direct messages and thread replies
4. Works with Claude Desktop and Agent_TypeScript via KADI broker

## Architecture

```
Claude Desktop / Agent_TypeScript
              ↓
      KADI Broker (MCP Upstream)
              ↓
    MCP_Slack_Server (this project)
              ↓
      Slack Web API
              ↓
         Slack Channel
```

## Installation

```bash
cd C:\p4\Personal\SD\MCP_Slack_Server
npm install
```

## Configuration

Create `.env` file:

```env
SLACK_BOT_TOKEN=xoxb-your-bot-token
MCP_LOG_LEVEL=info
```

### Required Slack Scopes

- `chat:write` - Send messages to channels
- `chat:write.public` - Send messages to public channels without joining
- `channels:read` - List and resolve channel names
- `groups:read` - Access private channels (if needed)

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

## Tools

### `send_message`

Send a message to a Slack channel.

**Input:**
```json
{
  "channel": "#general",  // or "C09T6RU41HP"
  "text": "Hello from Claude!",
  "thread_ts": "1234567890.123456"  // optional
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

### `send_reply`

Reply to a message in a thread.

**Input:**
```json
{
  "channel": "C09T6RU41HP",
  "thread_ts": "1234567890.123456",
  "text": "This is a threaded reply"
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

## Integration Examples

### From Claude Desktop

```
Send a message to #general saying "Hello team!"
```

### From Agent_TypeScript

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

### Reply to Slack Mention

```typescript
// After getting mention from MCP_Slack_Client
const mention = mentions[0];

await client.getBrokerProtocol().invokeTool({
  targetAgent: 'slack-server',
  toolName: 'slack_send_reply',
  toolInput: {
    channel: mention.channel,
    thread_ts: mention.thread_ts,
    text: claudeResponse
  },
  timeout: 10000
});
```

## License

MIT
