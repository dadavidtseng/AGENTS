# MCP_Discord_Client

Discord Event Listener with Claude-Powered Auto-Response via KADI Broker.

## Overview

MCP_Discord_Client is a TypeScript-based MCP server that listens for Discord @mentions and queues them for Agent_TypeScript to process. It uses Discord Gateway to receive real-time events.

## Architecture

```
Discord Channel → Gateway Event → Mention Queue → Agent_TypeScript → Claude API → MCP_Discord_Server → Discord Reply
```

### Components

- **Discord Gateway**: Real-time WebSocket connection for receiving events
- **Mention Queue**: In-memory queue (max 100) of unprocessed @mentions
- **MCP Server**: Exposes `get_discord_mentions` tool for KADI broker integration
- **Tool Registration**: Available to any KADI agent via broker

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Edit `.env` with your Discord bot token:

```env
DISCORD_TOKEN=your_discord_bot_token_here
DISCORD_GUILD_ID=your_discord_guild_id_here  # Optional
MCP_LOG_LEVEL=info
```

### 3. Get Discord Bot Token

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Create a new application
3. Go to "Bot" section
4. Click "Reset Token" and copy the token
5. Enable "Message Content Intent" in bot settings
6. Invite bot to your server with proper permissions (Send Messages, Read Messages, etc.)

### 4. Build

```bash
npm run build
```

### 5. Run

**Development mode (with hot-reload):**
```bash
npm run dev
```

**Production mode:**
```bash
npm start
```

## MCP Tools

### `get_discord_mentions`

Retrieve pending Discord @mentions from the queue.

**Input:**
- `limit` (optional): Maximum number of mentions to retrieve (1-50, default: 10)

**Output:**
```json
{
  "mentions": [
    {
      "id": "message_id",
      "user": "user_id",
      "username": "username",
      "text": "message text without @bot mention",
      "channel": "channel_id",
      "channelName": "channel_name",
      "guild": "guild_id",
      "ts": "ISO_timestamp"
    }
  ],
  "count": 1,
  "retrieved_at": "ISO_timestamp"
}
```

## Integration with KADI Broker

The MCP server is registered in `kadi-broker/config/mcp-upstreams.json`:

```json
{
  "id": "discord-client",
  "name": "Discord Event Listener (MCP_Discord_Client)",
  "type": "stdio",
  "prefix": "discord_client",
  "enabled": true,
  "stdio": {
    "command": "node",
    "args": ["C:\\p4\\Personal\\SD\\MCP_Discord_Client\\dist\\index.js"],
    "env": {
      "DISCORD_TOKEN": "your_token",
      "DISCORD_GUILD_ID": "your_guild_id"
    }
  },
  "networks": ["discord"]
}
```

## Usage with Agent_TypeScript

Agent_TypeScript polls this MCP server for new @mentions:

```typescript
// In Agent_TypeScript
const protocol = client.getBrokerProtocol();

const result = await protocol.invokeTool({
  targetAgent: 'discord-client',
  toolName: 'discord_client_get_discord_mentions',
  toolInput: { limit: 5 },
  timeout: 10000
});

const mentions = JSON.parse(result.content[0].text).mentions;
```

## Discord Bot Permissions

Required bot permissions:
- View Channels
- Send Messages
- Read Message History
- Add Reactions (optional)

Required Gateway Intents:
- Guilds
- Guild Messages
- Message Content

## Logging

The server logs to console with emoji indicators:

- 🚀 Startup messages
- 📬 Mention queued
- 📤 Mentions retrieved
- ✅ Success messages
- ❌ Error messages
- 💬 Received mention

## Troubleshooting

### "Discord client not ready after timeout"
- Check DISCORD_TOKEN is valid
- Verify bot has been invited to server
- Ensure internet connection is stable

### "Channel not found" errors
- Verify bot has access to the channel
- Check channel permissions

### Bot not responding to mentions
- Verify "Message Content Intent" is enabled
- Check bot has "Send Messages" permission
- Ensure bot is not muted or blocked

## License

MIT
