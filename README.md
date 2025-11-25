# MCP_Discord_Server

Discord Message Sending Service for Claude Desktop and KADI Agents.

## Overview

MCP_Discord_Server is a TypeScript-based MCP server that provides Discord message sending capabilities. It exposes tools for sending messages and replies via Discord REST API, making it accessible to Claude Desktop and any KADI agent through the broker.

## Architecture

```
Claude Desktop / KADI Agent → kadi-broker → MCP_Discord_Server → Discord REST API → Discord Channel
```

### Components

- **Discord REST Client**: Uses discord.js for Discord API integration
- **Channel Resolution**: Converts channel names to IDs automatically
- **MCP Server**: Exposes `send_message` and `send_reply` tools
- **Stateless Design**: No event listening, pure message sending

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
5. Invite bot to your server with proper permissions (Send Messages, Read Messages, etc.)

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

### `send_message`

Send a message to a Discord channel.

**Input:**
- `channel` (string): Channel ID or name (e.g., "general", "1234567890")
- `text` (string): Message text to send
- `message_id` (optional string): Message ID to reply to

**Output:**
```json
{
  "success": true,
  "message": "Message sent successfully",
  "messageId": "1234567890",
  "channelId": "9876543210"
}
```

### `send_reply`

Reply to a specific message in a Discord channel.

**Input:**
- `channel` (string): Channel ID where the message exists
- `message_id` (string): Message ID to reply to
- `text` (string): Reply message text

**Output:**
```json
{
  "success": true,
  "message": "Reply sent successfully",
  "messageId": "1234567891",
  "channelId": "9876543210",
  "replyTo": "1234567890"
}
```

## Integration with KADI Broker

The MCP server is registered in `kadi-broker/config/mcp-upstreams.json`:

```json
{
  "id": "discord-server",
  "name": "Discord Message Sender (MCP_Discord_Server)",
  "type": "stdio",
  "prefix": "discord_server",
  "enabled": true,
  "stdio": {
    "command": "node",
    "args": ["C:\\p4\\Personal\\SD\\MCP_Discord_Server\\dist\\index.js"],
    "env": {
      "DISCORD_TOKEN": "your_token",
      "DISCORD_GUILD_ID": "your_guild_id"
    }
  },
  "networks": ["discord"]
}
```

## Usage Examples

### From Agent_TypeScript

```typescript
const protocol = client.getBrokerProtocol();

const result = await protocol.invokeTool({
  targetAgent: 'discord-server',
  toolName: 'discord_server_send_message',
  toolInput: {
    channel: 'general',
    text: 'Hello from Agent_TypeScript!'
  },
  timeout: 10000
});
```

### From Claude Desktop

When configured in Claude Desktop's MCP settings, you can simply ask:

```
"Send a message to the Discord channel #general saying 'Hello world!'"
```

Claude will call the `send_message` tool automatically.

## Discord Bot Permissions

Required bot permissions:
- View Channels
- Send Messages
- Read Message History

Required Gateway Intents:
- Guilds
- Guild Messages

## Channel Name Resolution

The server automatically resolves channel names to IDs:

- `"general"` → `"1234567890"` (channel ID)
- `"#announcements"` → `"9876543210"` (strips # prefix)
- `"1234567890"` → `"1234567890"` (already an ID, passed through)

Channel cache is maintained in memory for fast resolution.

## Logging

The server logs to console with emoji indicators:

- 🚀 Startup messages
- ✅ Message sent successfully
- ❌ Error messages
- 📤 Awaiting requests

## Troubleshooting

### "Discord client not ready after timeout"
- Check DISCORD_TOKEN is valid
- Verify bot has been invited to server
- Ensure internet connection is stable

### "Channel not found" errors
- Verify bot has access to the channel
- Check channel name spelling
- Verify channel exists in the guild

### "Failed to send message" errors
- Check bot has "Send Messages" permission in the channel
- Verify bot is not muted or has role restrictions
- Check message content doesn't violate Discord ToS

## License

MIT
