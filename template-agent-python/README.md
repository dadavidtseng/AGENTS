# Python Calculator Agent

KĀDI calculator agent example for ProtogameJS3D demonstrating multi-language agent communication.

## Features

- ✅ **Ed25519 Authentication** - Cryptographic identity verification
- ✅ **Pydantic Schema Validation** - Type-safe tool definitions
- ✅ **Event-Driven Architecture** - Pub/sub system for agent coordination
- ✅ **WebSocket Communication** - Real-time bidirectional messaging
- ✅ **Cross-Language Compatible** - Works seamlessly with TypeScript, Go, Rust agents

## Installation

### Prerequisites

- Python 3.10 or higher
- KĀDI broker running (default: `ws://localhost:8765`)

### Install Dependencies

```bash
pip install -e .
```

Or with development dependencies:

```bash
pip install -e .[dev]
```

## Usage

### Basic Usage

```bash
python agent.py
```

### With Custom Configuration

```bash
# Set broker URL
export KADI_BROKER_URL=ws://kadi.build:8080

# Set networks
export KADI_NETWORK=global,math,game

python agent.py
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
**Output**: `{ "result": 5.0, "error": null }`

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
  ```json
  {
    "operation": "add",
    "operands": [5, 3],
    "result": 8,
    "agent": "calculator-python"
  }
  ```

- **`math.error`** - Published when an error occurs
  ```json
  {
    "operation": "divide",
    "error": "Division by zero is not allowed",
    "operands": [10, 0],
    "agent": "calculator-python"
  }
  ```

### Subscribed Events

The agent subscribes to all `math.*` events to monitor calculations across all agents in the network.

## Cross-Language Communication

### Invoking Python Tools from TypeScript

```typescript
// TypeScript client calling Python agent
import { KadiClient } from '@kadi.build/core';

const client = new KadiClient({
  name: 'typescript-client',
  broker: 'ws://localhost:8080',
  networks: ['global']
});

await client.connect();

// Load Python calculator agent
const calculator = await client.load('calculator', 'broker');

// Call Python tool from TypeScript
const result = await calculator.add({ a: 5, b: 3 });
console.log(result); // { result: 8 }
```

### Invoking Python Tools from Another Python Agent

```python
from kadi import KadiClient

client = KadiClient({
    'name': 'python-client',
    'broker': 'ws://localhost:8765',
    'networks': ['global']
})

await client.connect()

# Load calculator agent
calculator = await client.load('calculator', 'broker')

# Call tool
result = await calculator.multiply({'a': 6, 'b': 7})
print(result)  # { 'result': 42 }
```

## Development

### Running Tests

```bash
pytest
```

### Type Checking

```bash
mypy agent.py
```

### Code Formatting

```bash
black agent.py
```

## Architecture

```
agent.py
├── Schemas (Pydantic Models)
│   ├── AddInput, AddOutput
│   ├── MultiplyInput, MultiplyOutput
│   ├── SubtractInput, SubtractOutput
│   └── DivideInput, DivideOutput
├── KĀDI Client Configuration
│   ├── Broker connection
│   ├── Network registration
│   └── Ed25519 authentication
├── Tool Registration
│   ├── @client.tool() decorator
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

## Integration with ProtogameJS3D

This agent demonstrates the multi-language agent architecture for ProtogameJS3D's AI-driven game development workflow:

1. **Planner Agent** (Python) - Orchestrates complex tasks
2. **Calculator Agent** (Python) - Mathematical operations
3. **UI-UX-Designer Agent** (TypeScript) - Design generation
4. **Code Generator Agent** (TypeScript) - Code synthesis

All agents communicate via the KĀDI protocol regardless of implementation language.

## Troubleshooting

### Connection Refused

**Problem**: `ConnectionRefusedError: [Errno 111] Connect call failed`

**Solution**: Ensure KĀDI broker is running:
```bash
# Start broker (from kadi-broker repository)
npm run dev
```

### Authentication Failed

**Problem**: `AuthenticationError: Invalid signature`

**Solution**: Check that Ed25519 keypair is correctly generated. The agent automatically generates keys on startup.

### Module Not Found

**Problem**: `ModuleNotFoundError: No module named 'kadi'`

**Solution**: Install dependencies:
```bash
pip install -e .
```

## Related Documentation

- [Multi-Language Agents Planning Document](../../../.claude/plan/multi-language-agents.md)
- [KĀDI Protocol Documentation](https://gitlab.com/humin-game-lab/kadi)
- [ProtogameJS3D Main README](../../../README.md)

## License

This project is part of ProtogameJS3D research thesis.

---

**Built with KĀDI protocol** 🚀

## Quick Start

<!-- TODO: Add Quick Start content -->

## Configuration

<!-- TODO: Add Configuration content -->
