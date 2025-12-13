# SimpleMiner Autonomous Agents

TypeScript implementation of autonomous AI agents for the SimpleMiner voxel game.

## Overview

This module provides autonomous AI agent implementations that connect to SimpleMiner via KADI broker and execute behaviors like mining ore, building structures, and exploring the world.

## Architecture

```
src/agents/simpleminer/
├── index.ts           # Module exports
├── base-agent.ts      # Abstract base class with common functionality
├── miner-agent.ts     # Autonomous ore discovery and extraction
└── builder-agent.ts   # Automated structure construction
```

## Prerequisites

1. **SimpleMiner Game** running with KADI WebSocket integration enabled
2. **KADI Broker** running at `ws://localhost:8080/kadi`
3. **agent-producer** connected to the KADI broker

## Usage

### MinerAgent - Autonomous Mining

```typescript
import { KadiClient } from '@kadi.build/core';
import { MinerAgent } from './agents/simpleminer';

const client = new KadiClient({ /* config */ });
await client.connect();

const miner = new MinerAgent(client, {
  name: 'MinerBot',
  spawnPosition: { x: 0, y: 0, z: 70 },
  targetOres: ['diamond_ore', 'iron_ore', 'coal_ore'],
  visionRadius: 20,
  cycleDelayMs: 3000,
  verbose: true
});

// Start autonomous mining (runs until stopped)
await miner.start();

// To stop:
await miner.stop();
```

### BuilderAgent - Automated Construction

```typescript
import { KadiClient } from '@kadi.build/core';
import { BuilderAgent, MATERIALS } from './agents/simpleminer';

const client = new KadiClient({ /* config */ });
await client.connect();

const builder = new BuilderAgent(client, {
  name: 'BuilderBot',
  spawnPosition: { x: 10, y: 10, z: 70 },
  defaultMaterialId: MATERIALS['cobblestone'],
  placementDelayMs: 500
});

// Start builder (stays alive waiting for commands)
builder.start();

// Build a wall
await builder.buildWall(
  { x: 0, y: 0, z: 70 },
  { x: 10, y: 0, z: 75 },
  MATERIALS['stone']
);

// Build a floor
await builder.buildFloor(
  { x: 0, y: 0, z: 69 },
  { x: 10, y: 10, z: 69 },
  MATERIALS['oak_planks']
);

// Build a pillar
await builder.buildPillar(
  { x: 5, y: 5, z: 70 },
  10, // height
  MATERIALS['stone_brick']
);

// Stop when done
await builder.stop();
```

## Configuration

Add to your `.env` file:

```env
# Enable SimpleMiner agents
ENABLE_SIMPLEMINER_AGENTS=true

# Agent naming
SIMPLEMINER_AGENT_PREFIX=Bot

# Spawn position
SIMPLEMINER_SPAWN_X=0
SIMPLEMINER_SPAWN_Y=0
SIMPLEMINER_SPAWN_Z=70

# Miner settings
SIMPLEMINER_TARGET_ORES=diamond_ore,iron_ore,coal_ore,gold_ore
SIMPLEMINER_VISION_RADIUS=20
SIMPLEMINER_CYCLE_DELAY_MS=3000

# Builder settings
SIMPLEMINER_DEFAULT_MATERIAL_ID=4
SIMPLEMINER_PLACEMENT_DELAY_MS=500
```

## SimpleMiner Tools (via KADI)

The agents use these SimpleMiner tools through the KADI broker:

| Tool | Description |
|------|-------------|
| `simpleminer_spawn_agent` | Spawn AI agent in game world |
| `simpleminer_despawn_agent` | Remove agent from game |
| `simpleminer_list_agents` | List all active agents |
| `simpleminer_queue_command` | Queue command (MOVE, MINE, PLACE, CRAFT, WAIT) |
| `simpleminer_get_nearby_blocks` | Vision system - scan nearby blocks |
| `simpleminer_get_agent_inventory` | Query inventory contents |
| `simpleminer_get_agent_status` | Get position, current command, queue size |

## Command Types

| Command | Parameters | Description |
|---------|------------|-------------|
| `MOVE` | `x, y, z` | Move to world position |
| `MINE` | `x, y, z` | Break block at position |
| `PLACE` | `x, y, z, item_id` | Place block at position |
| `CRAFT` | `recipe_id` | Craft item using recipe |
| `WAIT` | `duration` | Pause for seconds |

## Available Materials

```typescript
const MATERIALS = {
  'stone': 1,
  'cobblestone': 4,
  'dirt': 3,
  'oak_planks': 5,
  'spruce_planks': 6,
  'birch_planks': 7,
  'jungle_planks': 8,
  'oak_log': 17,
  'spruce_log': 18,
  'glass': 20,
  'sandstone': 24,
  'wool': 35,
  'brick': 45,
  'stone_brick': 98
};
```

## Agent Behavior

### MinerAgent Loop

1. **Scan** - Get nearby blocks (vision radius)
2. **Filter** - Find target ore types
3. **Prioritize** - Select most valuable ore
4. **Move** - Navigate to ore position
5. **Mine** - Break ore block
6. **Wait** - Command execution delay
7. **Repeat** - Continue until stopped

### BuilderAgent Methods

- `buildWall(start, end, materialId)` - Construct wall between points
- `buildFloor(corner1, corner2, materialId)` - Build horizontal surface
- `buildPillar(base, height, materialId)` - Create vertical column
- `executeBlueprint(entries[])` - Execute custom build pattern

## Error Handling

Agents include:
- Graceful shutdown on errors
- Retry logic for transient failures
- Inventory validation before placement
- Command queue timeout handling

## Development

```bash
# Build TypeScript
npm run build

# Run with hot reload
npm run dev

# Type check
npm run type-check
```

## License

MIT
