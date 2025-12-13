# ArcadeDB-Only Production Deployment

## Overview

This is a simplified deployment that deploys **only ArcadeDB** to the production droplet. Template-agent and other services can run locally and connect to this remote ArcadeDB instance for persistent memory storage.

## Architecture

```
┌─────────────────────────────────────────┐
│  Production Droplet (napoftheearth)     │
│  64.23.168.129                          │
│                                         │
│  ┌───────────────────────────────────┐ │
│  │   ArcadeDB 24.11.1                │ │
│  │   - Port 2480 (HTTP API)          │ │
│  │   - Port 2424 (Binary Protocol)   │ │
│  │   - Memory: 256MB-512MB           │ │
│  └───────────────────────────────────┘ │
└─────────────────────────────────────────┘
                    ▲
                    │ Network connection
                    │
┌─────────────────────────────────────────┐
│  Local Development Machine              │
│                                         │
│  ┌───────────────────────────────────┐ │
│  │   template-agent-typescript       │ │
│  │   - Connects to remote ArcadeDB   │ │
│  │   - Full development tools        │ │
│  │   - Hot reload with tsx watch     │ │
│  └───────────────────────────────────┘ │
└─────────────────────────────────────────┘
```

## Benefits of ArcadeDB-Only Deployment

1. **Simplified Deployment**: Only one service to manage on the droplet
2. **Local Development**: Full TypeScript development experience with hot reload
3. **Persistent Memory**: ArcadeDB stores agent memory remotely
4. **Resource Efficient**: Minimal resource usage on droplet (only database)
5. **Easy Debugging**: Run agent locally with full IDE support

## Deployment

### Prerequisites

- SSH access to napoftheearth droplet
- Docker and Docker Compose installed on droplet
- WSL configured on Windows (if deploying from Windows)

### Deploy ArcadeDB

```bash
wsl bash deploy-arcadedb-only.sh
```

### Verify Deployment

1. Check service status:
```bash
ssh napoftheearth 'cd /opt/arcadedb-production && docker-compose ps'
```

2. Access ArcadeDB Studio:
   - URL: http://64.23.168.129:2480/
   - Username: `root`
   - Password: `arcadedb`

## Local Template-Agent Configuration

### Update .env File

Create or update `template-agent-typescript/.env`:

```bash
# Agent Identity
AGENT_NAME=template-typescript-agent
AGENT_VERSION=0.0.1

# Claude AI
ANTHROPIC_API_KEY=sk-ant-api03-...

# KADI Infrastructure (if using)
KADI_BROKER_URL=ws://localhost:8080
KADI_NETWORKS=global,slack,discord

# Remote ArcadeDB Connection
ARCADEDB_URL=http://64.23.168.129:2480/memory-db
ARCADEDB_ROOT_PASSWORD=arcadedb

# Optional: Bot Configuration
ENABLE_SLACK_BOT=false
ENABLE_DISCORD_BOT=false
```

### Create Database (First-Time Setup)

Before running the agent, create the `memory-db` database:

```bash
curl -X POST http://64.23.168.129:2480/api/v1/server \
  -u root:arcadedb \
  -H "Content-Type: application/json" \
  -d '{"command":"create database memory-db"}'
```

Expected response:
```json
{"user":"root","version":"24.11.1","serverName":"ArcadeDB_0","result":"ok"}
```

### Run Local Agent

```bash
cd template-agent-typescript
npm run dev
```

The agent will:
- Run locally with hot reload
- Connect to remote ArcadeDB at 64.23.168.129:2480/memory-db
- Store all memory persistently in the cloud

## Connection Details

| Service | Endpoint | Description |
|---------|----------|-------------|
| HTTP API | http://64.23.168.129:2480 | REST API for database operations |
| Binary Protocol | 64.23.168.129:2424 | High-performance binary protocol |
| Studio UI | http://64.23.168.129:2480/ | Web-based database management |

### Credentials

- **Username**: `root`
- **Password**: `arcadedb`

## Management Commands

### View Logs
```bash
ssh napoftheearth 'cd /opt/arcadedb-production && docker-compose logs -f'
```

### Stop ArcadeDB
```bash
ssh napoftheearth 'cd /opt/arcadedb-production && docker-compose down'
```

### Restart ArcadeDB
```bash
ssh napoftheearth 'cd /opt/arcadedb-production && docker-compose restart'
```

### Check Status
```bash
ssh napoftheearth 'cd /opt/arcadedb-production && docker-compose ps'
```

## Resource Usage

- **Memory**: 256MB-512MB JVM heap
- **Storage**: Persistent volume (arcadedb-production-data)
- **CPU**: Minimal (only during database operations)
- **Ports**: 2480 (HTTP), 2424 (Binary)

## Data Persistence

All database data is stored in Docker volume:
- **Volume Name**: `arcadedb-production-data`
- **Location**: `/home/arcadedb/databases` (inside container)
- **Persistence**: Survives container restarts and updates

## Security Considerations

⚠️ **Important**: This deployment uses basic authentication with a simple password. For production use, consider:

1. Changing the default password
2. Restricting network access with firewall rules
3. Using HTTPS for encrypted connections
4. Implementing IP whitelisting

## Troubleshooting

### ArcadeDB Not Starting

1. Check logs:
```bash
ssh napoftheearth 'cd /opt/arcadedb-production && docker-compose logs'
```

2. Verify memory availability:
```bash
ssh napoftheearth 'free -h'
```

3. Check if ports are available:
```bash
ssh napoftheearth 'netstat -tulpn | grep -E "2480|2424"'
```

### Connection Issues from Local Agent

1. Verify droplet IP is accessible:
```bash
ping 64.23.168.129
```

2. Test HTTP API:
```bash
curl http://64.23.168.129:2480/api/v1/ready
```

3. Check firewall rules on droplet

## Comparison: Full Deployment vs ArcadeDB-Only

| Aspect | Full Deployment | ArcadeDB-Only |
|--------|----------------|---------------|
| Services on Droplet | ArcadeDB + template-agent | ArcadeDB only |
| Development Experience | Container-based | Local with hot reload |
| Resource Usage | Higher (2+ containers) | Lower (1 container) |
| Debugging | Container logs | Full IDE debugging |
| Deployment Complexity | Complex (multi-service) | Simple (single service) |
| TypeScript Compilation | Required for each deploy | Not needed (local dev) |

## Migration Path

If you later want to deploy template-agent to the droplet:

1. Use the existing `docker-compose.test.yml` and `Dockerfile.test`
2. Update `ARCADEDB_URL` to `http://arcadedb:2480` (internal Docker network)
3. Deploy both services with `deploy-template-agent-test.sh`

The ArcadeDB data will be preserved during migration.
