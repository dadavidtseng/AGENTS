#!/bin/bash

# ============================================================================
# Deploy ArcadeDB Only to Production Droplet
# ============================================================================
# Purpose: Deploy only ArcadeDB for remote persistent memory storage
# Local agents can connect to this remote ArcadeDB instance
# ============================================================================

set -e  # Exit on error

echo "========================================="
echo "ArcadeDB Production Deployment"
echo "========================================="
echo ""

# Configuration
DROPLET_HOST="napoftheearth"
DEPLOY_DIR="/opt/arcadedb-production"
LOCAL_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "📋 Deployment Info:"
echo "  Target: $DROPLET_HOST"
echo "  Deploy Directory: $DEPLOY_DIR"
echo "  Service: ArcadeDB 24.11.1"
echo "  Memory: 256MB-512MB JVM heap"
echo ""

# Step 1: Create remote directory
echo "📁 Step 1: Creating remote directory..."
ssh "$DROPLET_HOST" "mkdir -p $DEPLOY_DIR"

# Step 2: Transfer deployment files
echo "📤 Step 2: Transferring deployment configuration..."
scp "$LOCAL_DIR/docker-compose.arcadedb-only.yml" "$DROPLET_HOST:$DEPLOY_DIR/docker-compose.yml"

# Step 3: Stop existing containers (if any)
echo "🛑 Step 3: Stopping existing containers..."
ssh "$DROPLET_HOST" "cd $DEPLOY_DIR && docker-compose down || true"

# Step 4: Pull latest ArcadeDB image
echo "📥 Step 4: Pulling ArcadeDB image..."
ssh "$DROPLET_HOST" "docker pull arcadedata/arcadedb:24.11.1"

# Step 5: Start ArcadeDB
echo "🚀 Step 5: Starting ArcadeDB..."
ssh "$DROPLET_HOST" "cd $DEPLOY_DIR && docker-compose up -d"

# Step 6: Wait for service to be healthy
echo "⏳ Step 6: Waiting for ArcadeDB to be healthy..."
sleep 15

# Step 7: Check service status
echo "🔍 Step 7: Checking service status..."
ssh "$DROPLET_HOST" "cd $DEPLOY_DIR && docker-compose ps"

# Step 8: Show logs
echo ""
echo "📋 Recent logs:"
ssh "$DROPLET_HOST" "cd $DEPLOY_DIR && docker-compose logs --tail=30"

echo ""
echo "========================================="
echo "✅ Deployment Complete!"
echo "========================================="
echo ""
echo "ArcadeDB Connection Details:"
echo "  HTTP API:  http://64.23.168.129:2480"
echo "  Binary:    64.23.168.129:2424"
echo "  Studio:    http://64.23.168.129:2480/"
echo "  Username:  root"
echo "  Password:  arcadedb"
echo ""
echo "To connect from local template-agent, update .env:"
echo "  ARCADEDB_URL=http://64.23.168.129:2480/memory-db"
echo "  ARCADEDB_ROOT_PASSWORD=arcadedb"
echo ""
echo "First-time setup - Create database (run once):"
echo "  curl -X POST http://64.23.168.129:2480/api/v1/server -u root:arcadedb \\"
echo "    -H 'Content-Type: application/json' \\"
echo "    -d '{\"command\":\"create database memory-db\"}'"
echo ""
echo "Useful commands:"
echo "  View logs:  ssh $DROPLET_HOST 'cd $DEPLOY_DIR && docker-compose logs -f'"
echo "  Stop:       ssh $DROPLET_HOST 'cd $DEPLOY_DIR && docker-compose down'"
echo "  Restart:    ssh $DROPLET_HOST 'cd $DEPLOY_DIR && docker-compose restart'"
echo "  Status:     ssh $DROPLET_HOST 'cd $DEPLOY_DIR && docker-compose ps'"
echo ""
