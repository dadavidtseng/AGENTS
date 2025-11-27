# TypeScript Agent Template for KĀDI Protocol

**Production-ready template for building TypeScript agents in the KĀDI multi-agent ecosystem.**

This template demonstrates broker-centralized architecture, type-safe tool definitions with Zod schemas, and integration with broker-provided tools (git, filesystem, etc.). Use it as a starting point for your own KĀDI agents.

## ✨ Features

- ✅ **Broker-Centralized Architecture** - No MCP spawning in agent code
- ✅ **Type-Safe Tool Definitions** - Zod schemas with automatic TypeScript inference
- ✅ **Comprehensive Documentation** - JSDoc comments and template patterns throughout
- ✅ **Production Examples** - Complete workflow examples including git integration
- ✅ **Template Setup Guide** - Step-by-step customization instructions
- ✅ **Ed25519 Authentication** - Cryptographic identity verification
- ✅ **Event-Driven Architecture** - Pub/sub system for cross-agent coordination
- ✅ **Slack Bot Integration** - Real-time @mention processing with Claude API (optional)
- ✅ **Cross-Language Compatible** - Works with Python, Go, Rust agents
- ✅ **Hot-Reload Development** - Fast iteration with `tsx watch`
- ✅ **Network Isolation** - Domain-specific tool visibility

## 🚀 Quick Start

### Prerequisites

- Node.js 18.0 or higher
- KĀDI broker running at `ws://localhost:8080`
- Access to `@kadi.build/core` package

### Installation

```bash
# Clone or copy this template
cp -r Agent_TypeScript my-custom-agent
cd my-custom-agent

# Install dependencies
npm install

# Configure environment
cp .env.template .env
# Edit .env with your configuration (broker URL, API keys, etc.)

# Run in development mode
npm run dev
```

### Customization

See **[TEMPLATE_SETUP.md](./TEMPLATE_SETUP.md)** for detailed customization guide.

## 📦 What's Included

### Example Tools

The template includes 5 text processing tools as examples:

| Tool | Description | Input | Output |
|------|-------------|-------|--------|
| `format_text` | Format text with styles (uppercase, lowercase, capitalize, title) | `{text, style}` | `{result, original_length, formatted_length}` |
| `validate_json` | Validate and parse JSON strings | `{json_string}` | `{valid, parsed?, error?}` |
| `count_words` | Count words, characters, and lines | `{text}` | `{words, characters, lines}` |
| `reverse_text` | Reverse character order | `{text}` | `{result, length}` |
| `trim_text` | Trim whitespace (both/start/end) | `{text, mode}` | `{result, removed_chars}` |

**Replace these with your own domain-specific tools** - see [TEMPLATE_SETUP.md](./TEMPLATE_SETUP.md#step-3-define-your-tool-schemas).

### Documentation

- **[README.md](./README.md)** - This file, project overview
- **[TEMPLATE_SETUP.md](./TEMPLATE_SETUP.md)** - Complete customization guide
- **[examples/](./examples/)** - Working examples with detailed comments
  - `basic-tool-call.ts` - Calling agent tools from another agent
  - `broker-tool-loading.ts` - Using broker's git tools
  - `autonomous-workflow.ts` - Complete multi-tool workflow
  - `README.md` - Examples documentation and troubleshooting
- **[CLAUDE.md](./CLAUDE.md)** - AI context for this project
- **[src/CLAUDE.md](./src/CLAUDE.md)** - Module-level documentation

### Source Code

- **[src/index.ts](./src/index.ts)** - Main agent implementation with comprehensive JSDoc comments
  - Template patterns marked with `// TEMPLATE PATTERN:`
  - Customization points marked with `// TODO: Replace...`
  - Production-ready error handling
  - Event publishing examples
  - Graceful shutdown handlers

## 📚 Usage

### Development

```bash
# Run with hot-reload
npm run dev

# Type check without compilation
npm run type-check

# Lint code
npm run lint

# Run tests
npm test
```

### Production

```bash
# Build TypeScript to JavaScript
npm run build

# Run compiled code
npm start
```

### Environment Configuration

Create `.env` file based on `.env.template`:

```bash
# WebSocket URL for KĀDI broker
KADI_BROKER_URL=ws://localhost:8080

# Networks to join (comma-separated)
# - global: All agents can see tools
# - text: Example domain (replace with yours)
# - git: Access to broker's git tools
# - slack: For Slack bot integration
KADI_NETWORK=global,text,git,slack

# Slack Bot (optional)
ENABLE_SLACK_BOT=true
SLACK_BOT_USER_ID=U01234ABCD  # Get from Slack app settings
ANTHROPIC_API_KEY=sk-ant-your-key-here
```

See `.env.template` for complete configuration options.

## 🤖 Slack Bot Integration (Optional)

### Overview

The template includes an optional Slack bot that:
- Subscribes to Slack @mention events via KĀDI event bus (real-time, <100ms latency)
- Processes mentions using Claude API with tool execution support
- Replies to Slack threads via MCP_Slack_Server
- Includes circuit breaker and retry logic for resilience

### 🔴 Breaking Changes (v2.0.0)

**What Changed:**
- ❌ **REMOVED**: Polling-based mention retrieval (`get_slack_mentions` tool)
- ✅ **ADDED**: Event-driven subscription (`slack.app_mention.{BOT_USER_ID}`)

**Migration Required:**
- Add `SLACK_BOT_USER_ID` to `.env`
- Remove `BOT_POLL_INTERVAL_MS` (no longer used)
- Event subscription is automatic - no code changes needed

### Setup

**Prerequisites:**
1. KĀDI broker running
2. MCP_Slack_Client running (publishes mention events)
3. MCP_Slack_Server running (handles replies)
4. Slack bot configured with required scopes

**Step 1: Configure Environment**

Add to `.env`:
```env
ENABLE_SLACK_BOT=true
SLACK_BOT_USER_ID=U01234ABCD  # Get from Slack app settings > OAuth & Permissions
ANTHROPIC_API_KEY=sk-ant-your-key-here
KADI_NETWORK=global,text,slack  # Must include 'slack' network
```

**Step 2: Start Agent**

```bash
npm run dev
```

Look for:
```
🤖 Starting Slack bot with event-driven architecture...
📡 Subscribing to Slack mention events on topic: slack.app_mention.U01234ABCD
✅ Successfully subscribed to Slack mention events
```

**Step 3: Test**

1. @mention your bot in Slack: `@YourBot what's the weather?`
2. Bot receives event in <100ms
3. Claude API processes message
4. Bot replies in thread

### Architecture

```
Slack @mention → MCP_Slack_Client → KĀDI Event Bus (slack.app_mention.U*)
                                              ↓
                                    Agent_TypeScript subscribes
                                              ↓
                                 Event validation (Zod schema)
                                              ↓
                                    Claude API + Tool Execution
                                              ↓
                                    MCP_Slack_Server (reply)
```

### Event Flow

1. **Event Published**: MCP_Slack_Client publishes `SlackMentionEvent` to topic `slack.app_mention.{BOT_USER_ID}`
2. **Event Received**: Agent_TypeScript subscriber receives event
3. **Validation**: Event validated with `SlackMentionEventSchema` (Zod)
4. **Circuit Breaker**: Check if processing should continue (handles outages gracefully)
5. **Processing**: Claude API called with user message and available tools
6. **Tool Execution**: Any tool calls executed via KĀDI broker
7. **Reply**: Final response sent to Slack via MCP_Slack_Server

### Resilience Features

- **Circuit Breaker**: Opens after 5 failures, auto-resets after 1 minute
- **Exponential Backoff**: Retries with 1s, 2s, 4s delays
- **Timeout Metrics**: Tracks success/failure rates
- **Schema Validation**: Ensures event integrity with Zod

### Migration from v1.x

**Old (Polling - v1.x):**
```typescript
// ❌ No longer works
setInterval(async () => {
  const result = await invokeTool({
    targetAgent: 'slack-client',
    toolName: 'slack_client_get_slack_mentions',
    toolInput: { limit: 5 },
    timeout: 10000
  });
}, 10000);
```

**New (Event Subscription - v2.0.0+):**
```typescript
// ✅ Automatic event subscription
// No code changes needed - configured via environment variables
// SlackBot class handles subscription internally
```

### Troubleshooting

**Bot not receiving mentions:**
1. Check `SLACK_BOT_USER_ID` matches your Slack app's bot user ID
2. Verify `KADI_NETWORK` includes `slack`
3. Confirm MCP_Slack_Client is running and publishing events
4. Check KĀDI broker logs for event routing

**Circuit breaker opening frequently:**
1. Check network connectivity to KĀDI broker
2. Verify MCP_Slack_Server is running
3. Review timeout settings (`BOT_TOOL_TIMEOUT_MS`)
4. Check Claude API rate limits

## 🔧 Architecture

### Broker-Centralized Design

```
┌─────────────────────────────────────────────────────┐
│                   KĀDI Broker                       │
│                                                     │
│  ┌─────────────────────────────────────────────┐   │
│  │  MCP Servers (spawned by broker)           │   │
│  │  • git-mcp-server (git network)            │   │
│  │  • filesystem-mcp-server (global network)  │   │
│  │  • discord-mcp-server (discord network)    │   │
│  └─────────────────────────────────────────────┘   │
│                                                     │
│  ┌─────────────────────────────────────────────┐   │
│  │  Tool Registry & Network Router            │   │
│  │  • Routes tools by network membership      │   │
│  │  • Validates tool invocations              │   │
│  │  • Publishes events to subscribers         │   │
│  └─────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
                     │
         ┌───────────┴───────────┐
         │                       │
    ┌────▼─────┐           ┌────▼─────┐
    │ Agent 1  │           │ Agent 2  │
    │ (Text)   │           │ (Custom) │
    │          │           │          │
    │ Registers│           │ Loads    │
    │ own tools│           │ broker's │
    │          │           │ tools    │
    └──────────┘           └──────────┘
```

**Key Principles**:
- ✅ Agents register their own tools with broker
- ✅ Agents can load broker's tools via `client.load()`
- ✅ No MCP server spawning in agent code
- ✅ Broker handles all tool routing and network isolation
- ✅ Clean separation of concerns

See [examples/broker-tool-loading.ts](./examples/broker-tool-loading.ts) for how to call broker's tools.

## 🎯 Template Usage Patterns

### Pattern 1: Define Tool Schemas

```typescript
import { z } from '@kadi.build/core';

// 1. Define input schema
const myToolInputSchema = z.object({
  param1: z.string().describe('Description for param1'),
  param2: z.number().describe('Description for param2')
});

// 2. Define output schema
const myToolOutputSchema = z.object({
  result: z.string().describe('The result'),
  metadata: z.object({
    timestamp: z.string()
  })
});

// 3. Infer TypeScript types
type MyToolInput = z.infer<typeof myToolInputSchema>;
type MyToolOutput = z.infer<typeof myToolOutputSchema>;
```

### Pattern 2: Register Tools

```typescript
client.registerTool({
  name: 'my_tool',
  description: 'Brief description',
  input: myToolInputSchema,
  output: myToolOutputSchema
}, async (params: MyToolInput): Promise<MyToolOutput> => {
  // Your business logic here
  const result = processData(params);

  // Publish event
  client.publishEvent('mydomain.processing', {
    operation: 'my_tool',
    agent: 'my-agent',
    timestamp: new Date().toISOString()
  });

  return result;
});
```

### Pattern 3: Load Broker's Tools

```typescript
// Load broker's git tools
const gitTools = await client.load('kadi-local', 'broker');

// Use git tools
const status = await gitTools.git_status({
  repo_path: '/path/to/repo'
});

const commit = await gitTools.git_commit({
  repo_path: '/path/to/repo',
  message: 'Automated commit',
  add_files: ['file1.txt', 'file2.txt']
});
```

See [TEMPLATE_SETUP.md](./TEMPLATE_SETUP.md) for comprehensive customization guide.

## 📖 Examples

### Calling Agent Tools

```typescript
import { KadiClient } from '@kadi.build/core';

const client = new KadiClient({
  name: 'example-caller',
  broker: 'ws://localhost:8080',
  networks: ['global', 'text']
});

await client.connect();

// Load this agent
const textProcessor = await client.load('typescript-agent', 'broker');

// Call tools
const formatted = await textProcessor.format_text({
  text: 'hello world',
  style: 'uppercase'
});
console.log(formatted.result); // "HELLO WORLD"
```

### Autonomous Workflow

```typescript
// 1. Process text with agent's tools
const trimmed = await textProcessor.trim_text({ text: '  hello  ', mode: 'both' });
const formatted = await textProcessor.format_text({ text: trimmed.result, style: 'uppercase' });

// 2. Get user approval
const approved = await getUserApproval(formatted.result);

// 3. Commit using broker's git tools
if (approved) {
  const gitTools = await client.load('kadi-local', 'broker');
  await gitTools.git_commit({
    repo_path: '/path/to/repo',
    message: 'chore: automated text processing',
    add_files: ['output.txt']
  });
}
```

See [examples/](./examples/) for complete working examples.

## 🧪 Testing

### Unit Tests

```bash
npm test
```

### Integration Tests

```bash
# Terminal 1: Start broker
cd kadi-broker && npm start

# Terminal 2: Start agent
npm run dev

# Terminal 3: Run examples
npx tsx examples/basic-tool-call.ts
npx tsx examples/broker-tool-loading.ts
npx tsx examples/autonomous-workflow.ts
```

## 🔍 Type Safety Example

One of the key advantages of TypeScript + Zod is automatic type inference:

```typescript
// Define schema once
const inputSchema = z.object({
  text: z.string(),
  count: z.number()
});

// Type automatically inferred!
type Input = z.infer<typeof inputSchema>;
// Equivalent to: { text: string; count: number }

// Tool handler has full type safety
client.registerTool({
  input: inputSchema,
  output: outputSchema
}, async (params: Input) => {
  // params.text is typed as string
  // params.count is typed as number
  // TypeScript catches errors at compile-time!
  return { result: params.text.repeat(params.count) };
});
```

## 🌐 Cross-Language Communication

### From Python

```python
from kadi import KadiClient

client = KadiClient({
    'name': 'python-client',
    'broker': 'ws://localhost:8080',
    'networks': ['global', 'text']
})

await client.connect()

# Load TypeScript agent
processor = await client.load('typescript-agent', 'broker')

# Call TypeScript tool from Python
result = await processor.format_text({'text': 'hello', 'style': 'uppercase'})
print(result['result'])  # "HELLO"
```

### From Another TypeScript Agent

```typescript
const textProcessor = await client.load('typescript-agent', 'broker');
const result = await textProcessor.count_words({ text: 'hello world' });
console.log(result.words); // 2
```

## 🛠️ Troubleshooting

### Connection Refused

**Problem**: `Error: connect ECONNREFUSED 127.0.0.1:8080`

**Solution**: Ensure KĀDI broker is running:
```bash
cd kadi-broker
npm start
```

### Tool Not Found

**Problem**: `Error: Tool not found: git_status`

**Solution**: Check broker's MCP configuration in `kadi-broker/config/mcp-upstreams.json`:
```json
{
  "id": "kadi-local",
  "enabled": true  // Must be true
}
```
Restart broker after changes.

### Network Not Accessible

**Problem**: `Error: Network 'git' not accessible`

**Solution**: Add network to agent configuration:
```typescript
networks: ['global', 'text', 'git']  // Add 'git'
```

See [examples/README.md#troubleshooting](./examples/README.md#troubleshooting) for more issues and solutions.

## 📁 Project Structure

```
Agent_TypeScript/
├── src/
│   ├── index.ts           # Main agent implementation (with JSDoc)
│   └── CLAUDE.md          # Module documentation
├── examples/              # Working examples
│   ├── basic-tool-call.ts
│   ├── broker-tool-loading.ts
│   ├── autonomous-workflow.ts
│   └── README.md
├── dist/                  # Compiled JavaScript (generated)
├── package.json           # Project metadata
├── tsconfig.json          # TypeScript configuration
├── .env.example           # Environment template
├── README.md              # This file
├── TEMPLATE_SETUP.md      # Customization guide
└── CLAUDE.md              # AI context
```

## 🤝 Contributing

This is a template project. To customize for your use case:

1. Read [TEMPLATE_SETUP.md](./TEMPLATE_SETUP.md)
2. Replace example tools with your domain-specific tools
3. Update documentation to match your agent's purpose
4. Test with examples and write your own tests

## 📄 License

MIT License - See package.json for details

## 🔗 Related Projects

- [KĀDI Protocol](https://gitlab.com/humin-game-lab/kadi)
- [KĀDI Broker](../kadi/kadi-broker)
- [KĀDI Core](../kadi-core)

## 🙏 Acknowledgments

Built for the **KĀDI (Knowledge Agent Development Infrastructure)** protocol, enabling seamless multi-language agent communication in distributed AI systems.

---

**Ready to build your own agent?** Start with [TEMPLATE_SETUP.md](./TEMPLATE_SETUP.md) 🚀
