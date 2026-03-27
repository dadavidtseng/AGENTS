# ability-backup

> KADI ability — backup/restore orchestrator for ArcadeDB via broker tools. Supports co-located and distributed topologies.

## Quick Start

```bash
cd ability-backup
npm install
kadi install
kadi run start
```

## Tools

| Tool | Description |
|------|-------------|
| *(Run `kadi run start` and check broker for registered tools)* | |

## Configuration

### agent.json

| Field | Value |
|-------|-------|
| **Version** | 0.1.0 |
| **Type** | ability |
| **Entrypoint** | `dist/index.js` |

### Abilities

- `secret-ability` ^0.9.3

### Brokers

- **local**: `ws://localhost:8080/kadi`

## Architecture

<!-- TODO: Add Architecture content -->

## Development

```bash
npm install
npm run build
kadi run start
```
