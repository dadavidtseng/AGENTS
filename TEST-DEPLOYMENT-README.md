# Template Agent TypeScript - Test Deployment

## Overview

This directory contains the deployment configuration for **template-agent-typescript** in a standalone test environment on the `napoftheearth` DigitalOcean Droplet.

## Deployment Architecture

```
┌─────────────────────────────────────────────┐
│ DigitalOcean Droplet: napoftheearth        │
│                                              │
│  ┌────────────────────────────────────────┐ │
│  │ Template Agent Test Environment        │ │
│  │                                          │ │
│  │  ┌──────────────┐   ┌───────────────┐ │ │
│  │  │  ArcadeDB    │   │ template-agent│ │ │
│  │  │  Port: 2480  │◄──│   (Enhanced)  │ │ │
│  │  │  Port: 2424  │   └───────────────┘ │ │
│  │  └──────────────┘                      │ │
│  │        │                                │ │
│  │        └─ Persistent Memory Storage    │ │
│  └────────────────────────────────────────┘ │
└─────────────────────────────────────────────┘
```

## Services

### 1. ArcadeDB (`arcadedb`)
- **Image**: `arcadedata/arcadedb:24.11.1`
- **Ports**:
  - `2480` - HTTP API / Studio UI
  - `2424` - Binary protocol
- **Purpose**: Graph database for persistent memory (conversations, preferences, knowledge)
- **Storage**: Persistent volume (`arcadedb-data`)

### 2. Template Agent TypeScript (`template-agent`)
- **Build**: From `../template-agent-typescript/Dockerfile.production`
- **Purpose**: Autonomous agent with multi-LLM support (Anthropic + Model Manager)
- **Features**:
  - Slack and Discord bot integration
  - Multi-tier memory (short-term JSON + long-term ArcadeDB)
  - Multi-LLM provider support (Claude, GPT, etc.)
  - Persistent conversation context
- **Storage**: Persistent volume (`agent-memory-data`)

## Files Created

### Core Deployment Files

1. **`docker-compose.test.yml`**
   - Docker Compose configuration for test environment
   - Deploys only template-agent + ArcadeDB (standalone)
   - Isolated network (`agent-test-net`)

2. **`.env.test`**
   - Environment variables for test deployment
   - Contains API keys and configuration
   - **⚠️ DO NOT COMMIT** - contains secrets

3. **`.env.test.example`**
   - Template for `.env.test`
   - Safe to commit to version control

4. **`deploy-template-agent-test.sh`**
   - Automated deployment script
   - SSH-based deployment to droplet
   - Includes health checks and status reporting

## Deployment Instructions

### Prerequisites

1. SSH access configured:
   ```bash
   wsl ssh napoftheearth
   ```

2. Docker and Docker Compose installed on the droplet

3. Environment variables configured in `.env.test`

### Deploy

```bash
# From C:\p4\Personal\SD\AGENTS directory
bash deploy-template-agent-test.sh
```

The script will:
1. Create remote directory `/opt/agents/template-agent-test`
2. Transfer configuration files
3. Stop existing containers (if any)
4. Build Docker image
5. Start services
6. Show service status and logs

### Manual Deployment (Alternative)

```bash
# SSH to droplet
wsl ssh napoftheearth

# Create deployment directory
mkdir -p /opt/agents/template-agent-test
cd /opt/agents/template-agent-test

# Transfer files (from local machine)
scp C:\p4\Personal\SD\AGENTS\docker-compose.test.yml napoftheearth:/opt/agents/template-agent-test/
scp C:\p4\Personal\SD\AGENTS\.env.test napoftheearth:/opt/agents/template-agent-test/

# On droplet: Start services
docker-compose -f docker-compose.test.yml up -d

# Check status
docker-compose -f docker-compose.test.yml ps

# View logs
docker-compose -f docker-compose.test.yml logs -f
```

## Post-Deployment Verification

### 1. Check Service Health

```bash
ssh napoftheearth 'cd /opt/agents/template-agent-test && docker-compose -f docker-compose.test.yml ps'
```

Expected output:
```
NAME                         STATUS          PORTS
template-agent-arcadedb     Up (healthy)    0.0.0.0:2424->2424/tcp, 0.0.0.0:2480->2480/tcp
template-agent-test         Up (healthy)
```

### 2. Test ArcadeDB

```bash
# Get droplet IP
ssh napoftheearth 'hostname -I | awk "{print \$1}"'

# Access ArcadeDB Studio at http://<droplet-ip>:2480/studio
# Default credentials: root / arcadedb
```

### 3. Test Bot Connections

Send test messages in Slack/Discord:
```
[claude-3-haiku] What is 2+2?
[gpt-4o-mini] Hello world
```

### 4. Test Memory Persistence

```bash
# Restart the agent
ssh napoftheearth 'cd /opt/agents/template-agent-test && docker-compose -f docker-compose.test.yml restart template-agent'

# Send a message in Slack/Discord
# Verify conversation context is restored
```

### 5. Check Logs

```bash
# View real-time logs
ssh napoftheearth 'cd /opt/agents/template-agent-test && docker-compose -f docker-compose.test.yml logs -f'

# View specific service logs
ssh napoftheearth 'cd /opt/agents/template-agent-test && docker-compose -f docker-compose.test.yml logs -f template-agent'
ssh napoftheearth 'cd /opt/agents/template-agent-test && docker-compose -f docker-compose.test.yml logs -f arcadedb'
```

## Management Commands

### View Status
```bash
ssh napoftheearth 'cd /opt/agents/template-agent-test && docker-compose -f docker-compose.test.yml ps'
```

### Stop Services
```bash
ssh napoftheearth 'cd /opt/agents/template-agent-test && docker-compose -f docker-compose.test.yml down'
```

### Restart Services
```bash
ssh napoftheearth 'cd /opt/agents/template-agent-test && docker-compose -f docker-compose.test.yml restart'
```

### Update and Redeploy
```bash
# Run deployment script again
bash deploy-template-agent-test.sh
```

### View Logs
```bash
ssh napoftheearth 'cd /opt/agents/template-agent-test && docker-compose -f docker-compose.test.yml logs -f'
```

### Clean Up (Remove All Data)
```bash
ssh napoftheearth 'cd /opt/agents/template-agent-test && docker-compose -f docker-compose.test.yml down -v'
```

## Troubleshooting

### Agent Fails to Start

1. Check logs:
   ```bash
   ssh napoftheearth 'cd /opt/agents/template-agent-test && docker-compose -f docker-compose.test.yml logs template-agent'
   ```

2. Verify environment variables:
   ```bash
   ssh napoftheearth 'cd /opt/agents/template-agent-test && cat .env.test'
   ```

3. Check if ArcadeDB is healthy:
   ```bash
   ssh napoftheearth 'cd /opt/agents/template-agent-test && docker-compose -f docker-compose.test.yml ps arcadedb'
   ```

### ArcadeDB Connection Issues

1. Test ArcadeDB health endpoint:
   ```bash
   ssh napoftheearth 'curl http://localhost:2480/api/v1/ready'
   ```

2. Check ArcadeDB logs:
   ```bash
   ssh napoftheearth 'cd /opt/agents/template-agent-test && docker-compose -f docker-compose.test.yml logs arcadedb'
   ```

### Bot Not Responding

1. Verify bot user IDs in `.env.test`:
   - `SLACK_BOT_USER_ID`
   - `DISCORD_BOT_USER_ID`

2. Check API keys:
   - `ANTHROPIC_API_KEY`
   - `MODEL_MANAGER_API_KEY`

3. Test with explicit model selection:
   ```
   [claude-3-haiku] test message
   ```

## Security Notes

1. **`.env.test` contains sensitive credentials** - never commit to version control
2. ArcadeDB is exposed on port 2480 - ensure droplet firewall is configured
3. Default ArcadeDB password should be changed in production

## Next Steps

After successful deployment:

1. ✅ Verify bot connections (Slack + Discord)
2. ✅ Test provider switching (`[claude-3-haiku]` vs `[gpt-4o-mini]`)
3. ✅ Test memory persistence (restart agent, verify context)
4. ✅ Monitor logs for errors
5. ✅ Test file operations (if implemented)
6. ✅ Performance testing under load

## Related Files

- Main production deployment: `docker-compose.production.yml`
- Dockerfile: `../template-agent-typescript/Dockerfile.production`
- Environment template: `.env.production.template`
