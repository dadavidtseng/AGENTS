# Agent TypeScript Template - Quick Start Guide

This repository serves as a template for creating TypeScript-based KĀDI agents with built-in resilience, bot integrations, and best practices.

## 📋 Table of Contents

1. [Quick Start](#quick-start)
2. [Customization](#customization)
3. [Adding Custom Tools](#adding-custom-tools)
4. [Bot Integration](#bot-integration)
5. [Configuration Reference](#configuration-reference)
6. [Deployment](#deployment)

---

## 🚀 Quick Start

### Prerequisites

- Node.js 18.0 or higher
- KĀDI broker running (default: `ws://localhost:8080`)
- Git (for cloning)

### Step 1: Clone and Initialize

```bash
# Clone this template
git clone <your-repo-url> my-agent
cd my-agent

# Run automated setup (optional - interactive)
chmod +x scripts/init-template.sh
./scripts/init-template.sh

# OR manually copy environment file
cp .env.example .env
```

### Step 2: Configure Your Agent

Edit `.env` and set:

```bash
# Required: Your agent's unique name
AGENT_NAME=my-custom-agent

# Required: Agent version
AGENT_VERSION=1.0.0

# Required: KĀDI broker URL
KADI_BROKER_URL=ws://localhost:8080

# Required: Networks to join (comma-separated)
KADI_NETWORK=global,text,custom-network

# Optional: Enable bot features
ENABLE_SLACK_BOT=false
ENABLE_DISCORD_BOT=false
```

### Step 3: Install Dependencies

```bash
npm install
```

### Step 4: Build and Run

```bash
# Development mode (hot-reload)
npm run dev

# Production build
npm run build
npm start
```

---

## 🎨 Customization

### Customize Agent Metadata

**File**: `src/index.ts`

The agent name and version are now configured via environment variables (`.env`):

```env
AGENT_NAME=my-custom-agent
AGENT_VERSION=2.0.0
```

Default values if not set:
- `AGENT_NAME`: `"typescript-agent"`
- `AGENT_VERSION`: `"1.0.0"`

### Customize Networks

**File**: `.env`

```env
# Join specific networks
KADI_NETWORK=global,my-network,special-tools

# Or use default
KADI_NETWORK=global,text
```

Networks determine which tools your agent can access via the KĀDI broker.

---

## 🔧 Adding Custom Tools

**⚠️ Important: Replace the echo placeholder tool with your own domain-specific tools.**

The template includes only a minimal `echo` tool as a starting point. This tool simply echoes back input text with its length - it's meant to be replaced with your actual business logic.

### Method 1: Using Tool Registry (Recommended)

**Step 1**: Create your tool file in `src/tools/`

```typescript
// src/tools/my-tool.ts
import { z } from 'zod';
import type { KadiClient } from '@kadi.build/core';

// Define input schema
export const myToolInputSchema = z.object({
  input: z.string().describe('Input parameter'),
});

// Define output schema
export const myToolOutputSchema = z.object({
  result: z.string().describe('Output result'),
});

// Register tool function
export function registerMyTool(client: KadiClient) {
  client.registerTool(
    {
      name: 'my_tool',
      description: 'Does something awesome',
      input: myToolInputSchema,
      output: myToolOutputSchema,
    },
    async (params) => {
      // Your tool logic here
      return {
        result: `Processed: ${params.input}`,
      };
    }
  );
}
```

**Step 2**: Add to tool registry

```typescript
// src/tools/index.ts
import { registerMyTool } from './my-tool.js';

export const toolRegistry = [
  registerMyTool,
  // Add more tools here
];
```

**Step 3**: Tools are automatically registered in `src/index.ts`

### Method 2: Direct Registration

**File**: `src/index.ts`

```typescript
// Add after existing tool registrations
client.registerTool({
  name: 'my_direct_tool',
  description: 'Directly registered tool',
  input: myInputSchema,
  output: myOutputSchema,
}, async (params) => {
  // Tool logic
  return { result: 'success' };
});
```

---

## 🤖 Bot Integration

### Slack Bot

**Step 1**: Enable in `.env`

```env
ENABLE_SLACK_BOT=true
ANTHROPIC_API_KEY=sk-ant-api03-...
```

**Step 2**: Configure bot behavior

```typescript
// src/slack-bot.ts
// Customize available tools in getAvailableTools()
```

**Features**:
- Polls for @mentions every 10 seconds
- Uses Claude API to process messages
- Executes KĀDI tools via broker
- Automatic retry with exponential backoff
- Circuit breaker for fault tolerance

### Discord Bot

**Step 1**: Enable in `.env`

```env
ENABLE_DISCORD_BOT=true
ANTHROPIC_API_KEY=sk-ant-api03-...
```

**Step 2**: Same features as Slack bot with Discord-specific integrations

### Customizing Bot Behavior

**Polling Interval** (src/index.ts):
```typescript
const slackBot = new SlackBot({
  client,
  anthropicApiKey: process.env.ANTHROPIC_API_KEY!,
  pollIntervalMs: 5000, // 5 seconds (change here)
});
```

**Available Tools** (src/slack-bot.ts or src/discord-bot.ts):
```typescript
private getAvailableTools(): Anthropic.Tool[] {
  return [
    // Add your custom tools here
    {
      name: 'my_custom_tool',
      description: 'My custom tool',
      input_schema: { /* ... */ },
    },
  ];
}
```

---

## ⚙️ Configuration Reference

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `AGENT_NAME` | No | `typescript-agent` | Unique agent identifier |
| `AGENT_VERSION` | No | `1.0.0` | Agent version string |
| `KADI_BROKER_URL` | Yes | `ws://localhost:8080` | WebSocket URL to KĀDI broker |
| `KADI_NETWORK` | Yes | `global,text` | Comma-separated network list |
| `ANTHROPIC_API_KEY` | No* | - | Claude API key (*required for bots) |
| `ENABLE_SLACK_BOT` | No | `true` if API key set | Enable Slack bot polling |
| `ENABLE_DISCORD_BOT` | No | `true` if API key set | Enable Discord bot polling |
| `GIT_BASE_DIR` | No | - | Base directory for Git operations |
| `GIT_USERNAME` | No | - | Git commit author name |
| `GIT_EMAIL` | No | - | Git commit author email |

### Resilience Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `BOT_MAX_RETRIES` | `3` | Maximum retry attempts for failed requests |
| `BOT_RETRY_BASE_DELAY_MS` | `1000` | Base delay for exponential backoff (1s, 2s, 4s) |
| `BOT_CIRCUIT_BREAKER_MAX_FAILURES` | `5` | Failures before circuit breaker opens |
| `BOT_CIRCUIT_BREAKER_RESET_MS` | `60000` | Circuit reset time (1 minute) |

---

## 📦 Project Structure

```
Agent_TypeScript/
├── src/
│   ├── index.ts              # Main entry point
│   ├── slack-bot.ts          # Slack bot with resilience
│   ├── discord-bot.ts        # Discord bot with resilience
│   ├── tools/                # Custom tools (create this)
│   │   ├── index.ts          # Tool registry
│   │   └── my-tool.ts        # Example tool
│   ├── types/
│   │   └── mcp.ts            # MCP type definitions
│   └── __tests__/            # Test files
├── scripts/
│   └── init-template.sh      # Template initialization script
├── .env                      # Your configuration (gitignored)
├── .env.template             # Template for .env
├── package.json              # Dependencies and scripts
├── tsconfig.json             # TypeScript configuration
├── TEMPLATE_USAGE.md         # This file
└── README.md                 # Project overview
```

---

## 🚀 Deployment

### Local Development

```bash
npm run dev
```

### Production

```bash
# Build
npm run build

# Run
npm start

# Or with PM2
pm2 start dist/index.js --name my-agent
```

### Docker (Optional)

```dockerfile
FROM node:18-alpine

WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY ../dist ./dist
COPY ../.env .env

CMD ["node", "dist/index.js"]
```

```bash
docker build -t my-agent .
docker run -d --name my-agent \
  -e KADI_BROKER_URL=ws://broker:8080 \
  my-agent
```

---

## 🧪 Testing

### Run Tests

```bash
npm test
```

### Test Coverage

```bash
npm test -- --coverage
```

### Add Tests

Create test files in `src/__tests__/`:

```typescript
// src/__tests__/my-tool.test.ts
import { describe, it, expect } from 'vitest';
import { myToolInputSchema } from '../tools/my-tool';

describe('my_tool', () => {
  it('should validate input', () => {
    const input = { input: 'test' };
    const result = myToolInputSchema.parse(input);
    expect(result).toEqual(input);
  });
});
```

---

## 📝 Best Practices

### 1. **Tool Naming**
- Use snake_case: `my_custom_tool`
- Prefix with category: `text_format`, `data_validate`

### 2. **Schema Descriptions**
- Always add `.describe()` to schema fields
- Be specific about input/output formats

### 3. **Error Handling**
- Use try/catch in tool handlers
- Return structured errors: `{ success: false, error: 'message' }`
- Log errors with emoji for visibility

### 4. **Event Publishing**
- Publish events for significant operations
- Use namespaced topics: `my-category.event-name`
- Include agent name in event payloads

### 5. **Type Safety**
- Use Zod for runtime validation
- Infer TypeScript types from schemas: `type Input = z.infer<typeof schema>`
- Enable strict TypeScript mode

---

## 🆘 Troubleshooting

### Agent won't connect to broker

```bash
# Check broker is running
curl http://localhost:8080/health

# Verify WebSocket URL in .env
KADI_BROKER_URL=ws://localhost:8080
```

### Bots not starting

```bash
# Check environment variables
echo $ANTHROPIC_API_KEY
echo $ENABLE_SLACK_BOT

# View bot startup logs
npm start | grep "bot"
```

### Tools not accessible

```bash
# Verify network configuration
KADI_NETWORK=global,text,your-network

# Check tool registration in logs
npm start | grep "Registering tool"
```

---

## 📚 Additional Resources

- [KĀDI Protocol Documentation](https://kadi.build)
- [Zod Schema Validation](https://zod.dev)
- [TypeScript Handbook](https://www.typescriptlang.org/docs)
- [Vitest Testing Framework](https://vitest.dev)

---

## 🤝 Contributing

When using this template:

1. Remove this section from your customized agent
2. Update README.md with your agent-specific documentation
3. Add your custom tools and logic
4. Test thoroughly before deploying

---

## 📄 License

[Your License Here]
