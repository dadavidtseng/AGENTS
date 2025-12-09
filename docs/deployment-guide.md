# Deployment Guide

Complete guide for deploying the enhanced Template Agent TypeScript to production environments.

## Table of Contents

- [Deployment Overview](#deployment-overview)
- [Prerequisites](#prerequisites)
- [Local Development Setup](#local-development-setup)
- [Docker Deployment](#docker-deployment)
- [Digital Ocean Deployment](#digital-ocean-deployment)
- [ArcadeDB Setup](#arcadedb-setup)
- [Model Manager Gateway Deployment](#model-manager-gateway-deployment)
- [Environment Configuration](#environment-configuration)
- [Health Checks and Monitoring](#health-checks-and-monitoring)
- [Troubleshooting](#troubleshooting)
- [Production Checklist](#production-checklist)

## Deployment Overview

The system can be deployed in several configurations:

1. **Local Development**: All services running on localhost
2. **Docker Compose**: Containerized deployment with all dependencies
3. **Digital Ocean**: Cloud deployment with managed services
4. **Hybrid**: Local agent with cloud-based LLM providers and databases

### Architecture Components

| Component | Required | Optional Alternatives |
|-----------|----------|----------------------|
| Node.js Runtime | ✅ Required | - |
| Anthropic API | ✅ Required | - |
| Model Manager Gateway | ⭕ Optional | Use Anthropic only |
| ArcadeDB | ⭕ Optional | File-only memory |
| KADI Broker | ⭕ Optional | Standalone mode |
| Slack/Discord Bots | ⭕ Optional | CLI only |

## Prerequisites

### Required

- **Node.js**: 18.0 or higher
- **npm**: 9.0 or higher
- **TypeScript**: 5.3 or higher
- **Anthropic API Key**: Get from https://console.anthropic.com/

### Optional

- **Docker**: 24.0+ (for containerized deployment)
- **Docker Compose**: 2.0+ (for multi-container setup)
- **Digital Ocean Account**: For cloud deployment
- **ArcadeDB**: For long-term memory (can run in Docker)
- **KADI Broker**: For multi-agent coordination

## Local Development Setup

### Step 1: Clone and Install

```bash
# Clone repository
git clone <repository-url>
cd template-agent-typescript

# Install dependencies
npm install

# Build TypeScript
npm run build
```

### Step 2: Configure Environment

```bash
# Copy template
cp .env.template .env

# Edit configuration
nano .env
```

**Minimum configuration** (`.env`):
```env
# Agent Identity
AGENT_NAME=template-typescript-agent
AGENT_VERSION=0.0.1

# LLM Provider
ANTHROPIC_API_KEY=sk-ant-your-key-here

# Memory Storage
MEMORY_DATA_PATH=./data/memory

# Optional: Development settings
NODE_TLS_REJECT_UNAUTHORIZED=0
```

### Step 3: Run Development Server

```bash
# Start with hot-reload
npm run dev

# Expected output:
# 🚀 Starting template-typescript-agent v0.0.1
# ✅ Memory service initialized (file-only mode)
# ✅ Provider manager initialized (1 provider)
# 🎯 Agent ready
```

### Step 4: Verify Setup

```bash
# In another terminal, test basic functionality
npx tsx examples/basic-tool-call.ts

# Expected output:
# ✅ Connected to agent
# ✅ Tool call successful
# Result: { echo: "hello world", length: 11 }
```

## Docker Deployment

### Single Container (Agent Only)

**Dockerfile** (already included: `Dockerfile.production`):
```dockerfile
# Multi-stage build
FROM node:18-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:18-alpine
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
EXPOSE 3000
CMD ["npm", "start"]
```

**Build and run**:
```bash
# Build image
docker build -f Dockerfile.production -t template-agent:latest .

# Run container
docker run -d \
  --name template-agent \
  --env-file .env.production \
  -v $(pwd)/data:/app/data \
  -p 3000:3000 \
  template-agent:latest

# View logs
docker logs -f template-agent

# Stop container
docker stop template-agent && docker rm template-agent
```

### Multi-Container with Docker Compose

**Create `docker-compose.yml`**:
```yaml
version: '3.8'

networks:
  agent-net:
    driver: bridge

volumes:
  agent-data:
  arcadedb-data:

services:
  # Template Agent
  agent:
    build:
      context: .
      dockerfile: Dockerfile.production
    container_name: template-agent
    restart: unless-stopped
    networks:
      - agent-net
    volumes:
      - agent-data:/app/data
    env_file:
      - .env.production
    environment:
      - ARCADEDB_URL=http://arcadedb:2480
      - NODE_ENV=production
    depends_on:
      arcadedb:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "node", "-e", "process.exit(0)"]
      interval: 30s
      timeout: 10s
      retries: 3

  # ArcadeDB (Long-term Memory)
  arcadedb:
    image: arcadedata/arcadedb:latest
    container_name: arcadedb
    restart: unless-stopped
    networks:
      - agent-net
    ports:
      - "2480:2480"
      - "2424:2424"
    volumes:
      - arcadedb-data:/home/arcadedb/databases
    environment:
      - ARCADEDB_SERVER_DATABASE_DIRECTORY=/home/arcadedb/databases
      - ARCADEDB_SERVER_ROOT_PASSWORD=admin
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:2480/api/v1/ready"]
      interval: 10s
      timeout: 5s
      retries: 5
```

**Deploy with Docker Compose**:
```bash
# Start all services
docker-compose up -d

# View logs
docker-compose logs -f agent

# Check service health
docker-compose ps

# Stop all services
docker-compose down

# Stop and remove volumes (⚠️ data loss)
docker-compose down -v
```

## Digital Ocean Deployment

### Option 1: Manual Droplet Setup

**Step 1: Create Droplet**

```bash
# Using doctl CLI
doctl compute droplet create template-agent \
  --region sfo3 \
  --image docker-20-04 \
  --size s-2vcpu-2gb \
  --ssh-keys <your-ssh-key-id>

# Get droplet IP
doctl compute droplet list
```

**Step 2: Deploy via SSH**

```bash
# SSH into droplet
ssh root@<droplet-ip>

# Install dependencies
apt-get update
apt-get install -y git nodejs npm

# Clone and setup
git clone <repository-url> /app/template-agent
cd /app/template-agent
npm install
npm run build

# Configure environment
cp .env.template .env.production
nano .env.production

# Start with PM2
npm install -g pm2
pm2 start npm --name "template-agent" -- start
pm2 save
pm2 startup systemd
```

### Option 2: Programmatic Deployment with DeployService

**Step 1: Install deploy-ability**

```bash
cd template-agent-typescript
npm install @kadi.build/deploy-ability
```

**Step 2: Configure deployment**

```typescript
// deploy-script.ts
import { DeployService } from './src/deployment/deploy-service.js';

const deployService = new DeployService({
  dropletRegion: 'sfo3',                    // San Francisco
  dropletSize: 's-2vcpu-2gb',               // 2 vCPU, 2GB RAM
  containerImage: 'template-agent:latest',   // Your Docker image
  adminKey: process.env.ADMIN_KEY!,
  openaiKey: process.env.OPENAI_API_KEY     // Optional
});

async function deploy() {
  console.log('🚀 Starting deployment...');

  const result = await deployService.deployModelManager();

  if (result.success) {
    const { gatewayUrl, apiKey, deploymentId, registeredModels } = result.data;

    console.log('✅ Deployment successful!');
    console.log(`Gateway URL: ${gatewayUrl}`);
    console.log(`API Key: ${apiKey}`);
    console.log(`Deployment ID: ${deploymentId}`);
    console.log(`Models: ${registeredModels.join(', ')}`);

    // Update agent configuration
    await deployService.updateAgentConfig(gatewayUrl, apiKey);
    console.log('✅ Agent configuration updated');
  } else {
    console.error('❌ Deployment failed:', result.error);
  }
}

deploy().catch(console.error);
```

**Step 3: Execute deployment**

```bash
# Set environment variables
export ADMIN_KEY=your-admin-key
export OPENAI_API_KEY=sk-xxx  # Optional

# Run deployment
npx tsx deploy-script.ts

# Expected output:
# 🚀 Starting deployment...
# ⏳ Creating droplet... (30-60s)
# ⏳ Deploying container... (20-40s)
# ⏳ Generating API key... (1-2s)
# ⏳ Registering models... (2-5s)
# ✅ Deployment successful!
# Gateway URL: https://xxx-xxx-xxx-xxx.digitalocean.com
# API Key: kadi_live_xxx
# Deployment ID: droplet-12345678
# Models: gpt-4o, gpt-4o-mini, gpt-4-turbo
# ✅ Agent configuration updated
```

## ArcadeDB Setup

### Local Docker Setup

**Step 1: Run ArcadeDB container**

```bash
# Pull image
docker pull arcadedata/arcadedb:latest

# Run container
docker run -d \
  --name arcadedb \
  -p 2480:2480 \
  -p 2424:2424 \
  -v arcadedb-data:/home/arcadedb/databases \
  -e ARCADEDB_SERVER_ROOT_PASSWORD=admin \
  arcadedata/arcadedb:latest

# Verify running
docker logs arcadedb

# Access Web UI
open http://localhost:2480
# Login: root / admin
```

**Step 2: Create database**

```bash
# Using curl
curl -X POST http://localhost:2480/api/v1/command/agent \
  -u root:admin \
  -H "Content-Type: application/json" \
  -d '{"language": "sql", "command": "CREATE DATABASE agent"}'

# Or use Web UI: http://localhost:2480
# Click "Create Database" → Name: "agent" → Type: "graph"
```

**Step 3: Configure agent**

Add to `.env`:
```env
ARCADEDB_URL=http://localhost:2480
```

### Cloud-Hosted ArcadeDB

**Option 1: Digital Ocean Managed Database**

```bash
# Create database cluster
doctl databases create arcadedb-cluster \
  --engine pg \
  --region sfo3 \
  --size db-s-1vcpu-1gb

# Get connection string
doctl databases connection arcadedb-cluster

# Update .env
ARCADEDB_URL=postgresql://user:pass@host:port/dbname?sslmode=require
```

**Option 2: Self-Hosted on Droplet**

```bash
# SSH into droplet
ssh root@<droplet-ip>

# Run ArcadeDB
docker run -d \
  --name arcadedb \
  --restart unless-stopped \
  -p 2480:2480 \
  -v /data/arcadedb:/home/arcadedb/databases \
  -e ARCADEDB_SERVER_ROOT_PASSWORD=<strong-password> \
  arcadedata/arcadedb:latest

# Configure firewall
ufw allow 2480/tcp

# Update agent .env
ARCADEDB_URL=http://<droplet-ip>:2480
```

## Model Manager Gateway Deployment

### Automated Deployment

Use the DeployService (see Digital Ocean section above) for automated Model Manager Gateway deployment.

### Manual Deployment

**Step 1: Create Digital Ocean Droplet**

```bash
doctl compute droplet create model-manager \
  --region sfo3 \
  --image docker-20-04 \
  --size s-2vcpu-2gb \
  --ssh-keys <your-ssh-key-id>
```

**Step 2: Deploy Model Manager Container**

```bash
# SSH into droplet
ssh root@<droplet-ip>

# Pull image
docker pull model-manager-agent:0.0.8

# Run container
docker run -d \
  --name model-manager \
  --restart unless-stopped \
  -p 8080:8080 \
  -e ADMIN_KEY=<your-admin-key> \
  model-manager-agent:0.0.8

# Verify running
docker logs model-manager
```

**Step 3: Generate API Key**

```bash
# Generate key
curl -X POST http://<droplet-ip>:8080/admin/generate-key \
  -H "Authorization: Bearer <admin-key>" \
  -H "Content-Type: application/json"

# Response:
# {"api_key": "kadi_live_abc123xyz"}

# Save to .env
MODEL_MANAGER_API_KEY=kadi_live_abc123xyz
MODEL_MANAGER_BASE_URL=http://<droplet-ip>:8080
```

**Step 4: Register OpenAI Models**

```bash
# Register models
curl -X POST http://<droplet-ip>:8080/admin/register-models \
  -H "Authorization: Bearer <admin-key>" \
  -H "Content-Type: application/json" \
  -d '{"openai_api_key": "sk-xxx"}'

# Response:
# {"models": ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo"]}
```

## Environment Configuration

### Production Environment Variables

Create `.env.production`:

```env
# =============================================================================
# PRODUCTION CONFIGURATION
# =============================================================================

# Agent Identity
AGENT_NAME=template-typescript-agent
AGENT_VERSION=0.0.1
NODE_ENV=production

# LLM Providers (REQUIRED)
ANTHROPIC_API_KEY=sk-ant-your-production-key-here

# Model Manager Gateway (OPTIONAL)
MODEL_MANAGER_BASE_URL=https://your-model-manager.example.com
MODEL_MANAGER_API_KEY=kadi_live_your-production-key-here

# Memory Storage (REQUIRED)
MEMORY_DATA_PATH=/app/data/memory

# ArcadeDB (OPTIONAL - gracefully degrades if not available)
ARCADEDB_URL=http://arcadedb:2480

# Slack Bot (OPTIONAL)
ENABLE_SLACK_BOT=true
SLACK_BOT_USER_ID=U01234ABCD

# Discord Bot (OPTIONAL)
ENABLE_DISCORD_BOT=true
DISCORD_BOT_USER_ID=960573427859726356

# KADI Broker (OPTIONAL)
KADI_BROKER_URL=ws://kadi-broker:8080/kadi
KADI_NETWORK=global,text,slack,discord

# Digital Ocean (for deployment automation)
DIGITAL_OCEAN_TOKEN=dop_v1_your-production-token-here

# Security
NODE_TLS_REJECT_UNAUTHORIZED=1  # Always 1 in production!

# Performance
BOT_TOOL_TIMEOUT_MS=30000
BOT_POLL_INTERVAL_MS=5000

# Logging
LOG_LEVEL=info
LOG_FORMAT=json
```

### Secrets Management

**❌ DON'T**:
- Commit `.env` or `.env.production` to git
- Share API keys in plain text
- Store secrets in Docker images
- Use weak admin keys

**✅ DO**:
- Use environment variables for secrets
- Rotate API keys regularly
- Use strong, random admin keys (32+ characters)
- Store production secrets in secure vault (1Password, AWS Secrets Manager)
- Use `.env.template` for documentation only

**Best Practice**:
```bash
# Generate strong admin key
openssl rand -hex 32

# Store in secure vault
# Load secrets at runtime from environment
# Use Docker secrets or Kubernetes secrets in orchestrated environments
```

## Health Checks and Monitoring

### Application Health Checks

**Endpoint**: `GET /health` (if HTTP server enabled)

```bash
# Check agent health
curl http://localhost:3000/health

# Response:
{
  "status": "healthy",
  "version": "0.0.1",
  "uptime": 3600,
  "providers": {
    "anthropic": true,
    "model-manager": true
  },
  "memory": {
    "status": "healthy",
    "storage": "hybrid"  # or "file-only"
  }
}
```

### Provider Health

```bash
# Check provider health via logs
docker logs template-agent | grep "Provider health"

# Expected output:
# [INFO] Provider health check: anthropic=true, model-manager=true
```

### Memory Health

```bash
# Check memory system
docker logs template-agent | grep "Memory"

# Expected output:
# [INFO] Memory service initialized (hybrid mode)
# [INFO] ArcadeDB connection healthy
```

### Monitoring Dashboard (Optional)

**Using Prometheus + Grafana**:

```yaml
# prometheus.yml
scrape_configs:
  - job_name: 'template-agent'
    static_configs:
      - targets: ['agent:3000']
```

**Metrics to Monitor**:
- Provider response time (p50, p95, p99)
- Memory operations/second
- Error rate by error code
- Circuit breaker state changes
- API quota usage

## Troubleshooting

### Deployment Issues

**Problem**: Docker build fails

```bash
# Solution: Clear build cache
docker system prune -a
docker build --no-cache -f Dockerfile.production -t template-agent:latest .
```

**Problem**: Container starts but immediately exits

```bash
# Check logs
docker logs template-agent

# Common causes:
# 1. Missing environment variables → Check .env.production
# 2. Invalid API keys → Verify keys in Anthropic console
# 3. Port already in use → Change port mapping

# Fix:
docker run -d \
  --name template-agent \
  --env-file .env.production \
  -p 3001:3000 \  # Change port
  template-agent:latest
```

**Problem**: Cannot connect to ArcadeDB

```bash
# Check if ArcadeDB is running
docker ps | grep arcadedb

# Check network connectivity
docker exec template-agent ping arcadedb

# Verify URL in .env
ARCADEDB_URL=http://arcadedb:2480  # Use service name in Docker Compose
```

### Runtime Issues

**Problem**: "AUTH_FAILED" errors

```bash
# Solution: Verify API key
curl https://api.anthropic.com/v1/messages \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "content-type: application/json" \
  -d '{"model":"claude-3-haiku-20240307","max_tokens":1,"messages":[{"role":"user","content":"Hi"}]}'

# If fails, regenerate key from console.anthropic.com
```

**Problem**: "RATE_LIMIT" errors

```bash
# Solution 1: Enable fallback provider
MODEL_MANAGER_BASE_URL=https://your-gateway.com
MODEL_MANAGER_API_KEY=kadi_live_xxx

# Solution 2: Upgrade API tier
# Visit console.anthropic.com → Billing → Upgrade plan

# Solution 3: Implement rate limiting
# (Already built-in with retry backoff)
```

**Problem**: Memory not persisting

```bash
# Check volume mount
docker inspect template-agent | grep Mounts

# Verify permissions
docker exec template-agent ls -la /app/data/memory

# Fix permissions
docker exec template-agent chown -R node:node /app/data
```

### Network Issues

**Problem**: Cannot reach Model Manager Gateway

```bash
# Test connectivity
curl http://<gateway-url>/health

# Check firewall
ufw status

# Allow port
ufw allow 8080/tcp

# Verify URL in .env
echo $MODEL_MANAGER_BASE_URL
```

**Problem**: Slack/Discord bot not responding

```bash
# Check event subscription
docker logs template-agent | grep "Subscribing to"

# Expected:
# [INFO] Subscribing to Slack mention events: slack.app_mention.U01234ABCD

# Verify bot user ID
echo $SLACK_BOT_USER_ID

# Check KADI broker connection
docker logs template-agent | grep "KADI"
```

## Production Checklist

### Pre-Deployment

- [ ] Run full test suite: `npm test`
- [ ] Check test coverage: `npm run coverage` (target: >80%)
- [ ] Build production Docker image
- [ ] Test image locally with production environment
- [ ] Verify all API keys are valid
- [ ] Review security settings (TLS enabled, no development flags)
- [ ] Backup current production data (if applicable)
- [ ] Document rollback procedure

### Deployment

- [ ] Create production environment variables (`.env.production`)
- [ ] Store secrets in secure vault
- [ ] Deploy to staging environment first
- [ ] Run smoke tests on staging
- [ ] Deploy to production
- [ ] Verify health checks pass
- [ ] Monitor logs for errors (first 5 minutes)
- [ ] Test critical user flows (bot responses, memory persistence)

### Post-Deployment

- [ ] Monitor metrics dashboard (first hour)
- [ ] Check error rates and response times
- [ ] Verify provider failover works
- [ ] Test memory archival (after 20 messages)
- [ ] Confirm backups are running
- [ ] Update documentation with deployment notes
- [ ] Notify team of successful deployment
- [ ] Schedule post-deployment review (24-48 hours)

### Monitoring (Ongoing)

- [ ] Daily: Check error rates and provider health
- [ ] Weekly: Review performance metrics and costs
- [ ] Monthly: Rotate API keys and update dependencies
- [ ] Quarterly: Security audit and penetration testing

---

## Additional Resources

- [Architecture Documentation](./architecture.md) - Detailed system architecture
- [API Reference](./README.md#api-reference) - Complete API documentation
- [Troubleshooting Guide](./README.md#troubleshooting) - Common issues and solutions
- [ArcadeDB Documentation](https://docs.arcadedb.com/) - Database setup and administration
- [Digital Ocean Tutorials](https://www.digitalocean.com/community/tutorials) - Cloud deployment guides

---

**Need help?** Check the troubleshooting section or open an issue in the repository.
