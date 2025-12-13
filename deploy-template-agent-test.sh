#!/bin/bash

# ============================================================================
# Deploy Template Agent TypeScript to Test Environment
# ============================================================================
# Target: napoftheearth DigitalOcean Droplet
# Services: template-agent-typescript + ArcadeDB
# ============================================================================

set -e  # Exit on error

echo "========================================="
echo "Template Agent Test Deployment"
echo "========================================="
echo ""

# Configuration
DROPLET_HOST="napoftheearth"
DEPLOY_DIR="/opt/agents/template-agent-test"
LOCAL_DIR="$(cd "$(dirname "$0")" && pwd)"
SOURCE_DIR="$(cd "$LOCAL_DIR/../template-agent-typescript" && pwd)"
AGENTS_LIB_DIR="$(cd "$LOCAL_DIR/../agents-library" && pwd)"

# Check if .env.test exists
if [ ! -f "$LOCAL_DIR/.env.test" ]; then
    echo "❌ Error: .env.test not found!"
    echo "Please copy .env.test.example to .env.test and fill in your values."
    exit 1
fi

# Check if source directory exists
if [ ! -d "$SOURCE_DIR" ]; then
    echo "❌ Error: template-agent-typescript source directory not found!"
    echo "Expected: $SOURCE_DIR"
    exit 1
fi

# Check if agents-library exists
if [ ! -d "$AGENTS_LIB_DIR" ]; then
    echo "❌ Error: agents-library directory not found!"
    echo "Expected: $AGENTS_LIB_DIR"
    exit 1
fi

echo "📋 Pre-deployment checklist:"
echo "  ✓ docker-compose.test.yml created"
echo "  ✓ .env.test configured"
echo "  ✓ Source code found at $SOURCE_DIR"
echo "  ✓ agents-library found at $AGENTS_LIB_DIR"
echo "  ✓ @kadi.build/core will be installed from npm"
echo ""

# Step 1: Create remote directories
echo "📁 Step 1: Creating remote directories..."
ssh "$DROPLET_HOST" "mkdir -p $DEPLOY_DIR/{template-agent-typescript,agents-library}"

# Step 2: Transfer source code
echo "📤 Step 2: Transferring source code..."
echo "  → Transferring template-agent-typescript..."
rsync -azP --delete \
  --exclude 'node_modules' \
  --exclude '.env' \
  --exclude '.git' \
  --exclude '*.log' \
  --exclude 'coverage' \
  "$SOURCE_DIR/" \
  "$DROPLET_HOST:$DEPLOY_DIR/template-agent-typescript/"

echo "  → Transferring agents-library..."
rsync -azP --delete \
  --exclude 'node_modules' \
  --exclude '.git' \
  --exclude '*.log' \
  "$AGENTS_LIB_DIR/" \
  "$DROPLET_HOST:$DEPLOY_DIR/agents-library/"

# Step 3: Transfer deployment files
echo "📤 Step 3: Transferring deployment configuration..."
scp "$LOCAL_DIR/docker-compose.test.yml" "$DROPLET_HOST:$DEPLOY_DIR/"
scp "$LOCAL_DIR/.env.test" "$DROPLET_HOST:$DEPLOY_DIR/"
scp "$LOCAL_DIR/Dockerfile.test" "$DROPLET_HOST:$DEPLOY_DIR/"

# Step 4: Stop existing containers (if any)
echo "🛑 Step 4: Stopping existing containers..."
ssh "$DROPLET_HOST" "cd $DEPLOY_DIR && docker-compose -f docker-compose.test.yml down || true"

# Step 5: Pull/build images
echo "🔨 Step 5: Building Docker image..."
ssh "$DROPLET_HOST" "cd $DEPLOY_DIR && docker-compose -f docker-compose.test.yml build --no-cache"

# Step 6: Start services
echo "🚀 Step 6: Starting services..."
ssh "$DROPLET_HOST" "cd $DEPLOY_DIR && docker-compose -f docker-compose.test.yml up -d"

# Step 7: Wait for services to be healthy
echo "⏳ Step 7: Waiting for services to be healthy..."
sleep 15

# Step 8: Check service status
echo "🔍 Step 8: Checking service status..."
ssh "$DROPLET_HOST" "cd $DEPLOY_DIR && docker-compose -f docker-compose.test.yml ps"

# Step 9: Show logs
echo ""
echo "📋 Recent logs:"
ssh "$DROPLET_HOST" "cd $DEPLOY_DIR && docker-compose -f docker-compose.test.yml logs --tail=50"

echo ""
echo "========================================="
echo "✅ Deployment Complete!"
echo "========================================="
echo ""
echo "Useful commands:"
echo "  View logs:    ssh $DROPLET_HOST 'cd $DEPLOY_DIR && docker-compose -f docker-compose.test.yml logs -f'"
echo "  Stop:         ssh $DROPLET_HOST 'cd $DEPLOY_DIR && docker-compose -f docker-compose.test.yml down'"
echo "  Restart:      ssh $DROPLET_HOST 'cd $DEPLOY_DIR && docker-compose -f docker-compose.test.yml restart'"
echo "  Status:       ssh $DROPLET_HOST 'cd $DEPLOY_DIR && docker-compose -f docker-compose.test.yml ps'"
echo ""
echo "ArcadeDB Studio: http://$(ssh $DROPLET_HOST 'hostname -I | awk "{print \$1}"'):2480/studio"
echo ""
