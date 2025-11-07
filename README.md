# TypeScript Calculator Agent

KĀDI calculator agent example for ProtogameJS3D demonstrating multi-language agent communication.

## Features

- ✅ **Ed25519 Authentication** - Cryptographic identity verification
- ✅ **Zod Schema Validation** - Type-safe tool definitions with 77% less code
- ✅ **Full Type Inference** - TypeScript types automatically derived from Zod schemas
- ✅ **Event-Driven Architecture** - Pub/sub system for agent coordination
- ✅ **WebSocket Communication** - Real-time bidirectional messaging
- ✅ **Cross-Language Compatible** - Works seamlessly with Python, Go, Rust agents
- ✅ **Hot-Reload Development** - Fast iteration with `tsx watch`

## Installation

### Prerequisites

- Node.js 18.0 or higher
- npm or pnpm
- KĀDI broker running (default: `ws://localhost:8080`)

### Install Dependencies

```bash
npm install
```

## Usage

### Basic Usage

```bash
npm start
```

### Development Mode (with hot-reload)

```bash
npm run dev
```

### Build for Production

```bash
npm run build
npm run start:prod
```

### With Custom Configuration

```bash
# Set broker URL
export KADI_BROKER_URL=ws://kadi.build:8080

# Set networks
export KADI_NETWORK=global,math,game

npm start
```

## Available Tools

The calculator agent provides four mathematical operations:

### 1. Addition
```json
{
  "tool": "add",
  "input": {
    "a": 5,
    "b": 3
  }
}
```
**Output**: `{ "result": 8 }`

### 2. Multiplication
```json
{
  "tool": "multiply",
  "input": {
    "a": 6,
    "b": 7
  }
}
```
**Output**: `{ "result": 42 }`

### 3. Subtraction
```json
{
  "tool": "subtract",
  "input": {
    "a": 10,
    "b": 3
  }
}
```
**Output**: `{ "result": 7 }`

### 4. Division
```json
{
  "tool": "divide",
  "input": {
    "a": 15,
    "b": 3
  }
}
```
**Output**: `{ "result": 5.0 }`

**Division by zero**:
```json
{
  "tool": "divide",
  "input": {
    "a": 10,
    "b": 0
  }
}
```
**Output**: `{ "result": 0.0, "error": "Division by zero is not allowed" }`

## Events

### Published Events

- **`math.calculation`** - Published after each successful calculation
  ```typescript
  {
    operation: 'add',
    operands: [5, 3],
    result: 8,
    agent: 'calculator-typescript'
  }
  ```

- **`math.error`** - Published when an error occurs
  ```typescript
  {
    operation: 'divide',
    error: 'Division by zero is not allowed',
    operands: [10, 0],
    agent: 'calculator-typescript'
  }
  ```

### Subscribed Events

The agent subscribes to all `math.*` events to monitor calculations across all agents in the network.

## Cross-Language Communication

### Invoking TypeScript Tools from Python

```python
# Python client calling TypeScript agent
from kadi import KadiClient

client = KadiClient({
    'name': 'python-client',
    'broker': 'ws://localhost:8765',
    'networks': ['global']
})

await client.connect()

# Load TypeScript calculator agent
calculator = await client.load('calculator', 'broker')

# Call TypeScript tool from Python
result = await calculator.add({'a': 5, 'b': 3})
print(result)  # { 'result': 8 }
```

### Invoking TypeScript Tools from Another TypeScript Agent

```typescript
import { KadiClient } from '@kadi.build/core';

const client = new KadiClient({
  name: 'typescript-client',
  broker: 'ws://localhost:8080',
  networks: ['global']
});

await client.connect();

// Load calculator agent
const calculator = await client.load('calculator', 'broker');

// Call tool
const result = await calculator.multiply({ a: 6, b: 7 });
console.log(result); // { result: 42 }
```

## Development

### Type Checking

```bash
npm run type-check
```

### Linting

```bash
npm run lint
```

### Running Tests

```bash
npm test
```

## Architecture

```
src/index.ts
├── Schemas (Zod Schemas with Type Inference)
│   ├── addInputSchema → AddInput type
│   ├── multiplyInputSchema → MultiplyInput type
│   ├── subtractInputSchema → SubtractInput type
│   └── divideInputSchema → DivideInput type
├── KĀDI Client Configuration
│   ├── Broker connection
│   ├── Network registration
│   └── Ed25519 authentication
├── Tool Registration
│   ├── client.registerTool() API
│   ├── Schema validation
│   └── Event publishing
├── Event Subscriptions
│   ├── math.calculation listener
│   └── math.error listener
└── Main Event Loop
    ├── Connect to broker
    ├── Register agent
    └── Serve indefinitely
```

## Type Safety

One of the key advantages of TypeScript + Zod is automatic type inference:

```typescript
// Define schema once
const addInputSchema = z.object({
  a: z.number(),
  b: z.number()
});

// Type automatically inferred!
type AddInput = z.infer<typeof addInputSchema>;
// Equivalent to: { a: number; b: number }

// Tool handler has full type safety
client.registerTool({
  input: addInputSchema,
  output: addOutputSchema
}, async (params: AddInput) => {
  // params.a and params.b are typed as numbers
  // TypeScript will catch errors at compile-time!
  const result = params.a + params.b;
  return { result };
});
```

## Integration with ProtogameJS3D

This agent demonstrates the multi-language agent architecture for ProtogameJS3D's AI-driven game development workflow:

1. **Planner Agent** (Python) - Orchestrates complex tasks
2. **Calculator Agent** (TypeScript) - Mathematical operations
3. **UI-UX-Designer Agent** (TypeScript) - Design generation
4. **Code Generator Agent** (TypeScript) - Code synthesis

All agents communicate via the KĀDI protocol regardless of implementation language.

## Troubleshooting

### Connection Refused

**Problem**: `Error: connect ECONNREFUSED 127.0.0.1:8080`

**Solution**: Ensure KĀDI broker is running:
```bash
# Start broker (from kadi-broker repository)
npm run dev
```

### Authentication Failed

**Problem**: `AuthenticationError: Invalid signature`

**Solution**: Check that Ed25519 keypair is correctly generated. The agent automatically generates keys on startup.

### Module Not Found

**Problem**: `Error: Cannot find module '@kadi.build/core'`

**Solution**: Install dependencies:
```bash
npm install
```

### TypeScript Errors

**Problem**: `TS2304: Cannot find name 'z'`

**Solution**: Ensure Zod is properly imported:
```typescript
import { KadiClient, z } from '@kadi.build/core';
```

## Related Documentation

- [Multi-Language Agents Planning Document](../../../.claude/plan/multi-language-agents.md)
- [KĀDI Protocol Documentation](https://gitlab.com/humin-game-lab/kadi)
- [ProtogameJS3D Main README](../../../README.md)

## License

This project is part of ProtogameJS3D research thesis.

---

**Built with KĀDI protocol** 🚀
