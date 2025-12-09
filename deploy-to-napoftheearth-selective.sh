#!/bin/bash
# ============================================================================
# KADI System - SELECTIVE Deployment Script for napoftheearth Droplet
# ============================================================================
# Only syncs the 6 required projects (excludes Agent_Python, ProtogameJS3D, etc.)
#
# Projects deployed:
# - Agent_TypeScript
# - MCP_Slack_Client
# - MCP_Slack_Server
# - MCP_Discord_Client
# - MCP_Discord_Server
# - kadi (kadi-broker)
#
# Usage:
#   bash deploy-to-napoftheearth-selective.sh
# ============================================================================

set -e  # Exit on error

# Configuration
REMOTE_HOST="napoftheearth"
REMOTE_USER="root"
REMOTE_DIR="/root/kadi-system"
LOCAL_DIR="$(pwd)"

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}KADI Selective Deployment to napoftheearth${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""

# -----------------------------------------------------------------------------
# Step 1: Check Prerequisites
# -----------------------------------------------------------------------------
echo -e "${YELLOW}[1/7] Checking prerequisites...${NC}"

if [ ! -f ".env.production" ]; then
  echo -e "${RED}Error: .env.production not found!${NC}"
  echo "Please create .env.production from .env.production.template"
  exit 1
fi

if ! command -v rsync &> /dev/null; then
  echo -e "${YELLOW}Installing rsync...${NC}"
  # For Windows WSL
  if command -v apt-get &> /dev/null; then
    sudo apt-get update && sudo apt-get install -y rsync
  fi
fi

echo -e "${GREEN}✓ Prerequisites check passed${NC}"
echo ""

# -----------------------------------------------------------------------------
# Step 2: Build MCP Server Distributions Locally
# -----------------------------------------------------------------------------
echo -e "${YELLOW}[2/7] Building MCP server distributions locally...${NC}"

# Build kadi-core first (required by Agent_TypeScript)
cd "$LOCAL_DIR/kadi/kadi-core" && npm run build && cd "$LOCAL_DIR"

cd "$LOCAL_DIR/MCP_Slack_Client" && npm run build && cd "$LOCAL_DIR"
cd "$LOCAL_DIR/MCP_Slack_Server" && npm run build && cd "$LOCAL_DIR"
cd "$LOCAL_DIR/MCP_Discord_Client" && npm run build && cd "$LOCAL_DIR"
cd "$LOCAL_DIR/MCP_Discord_Server" && npm run build && cd "$LOCAL_DIR"

echo -e "${GREEN}✓ MCP servers built${NC}"
echo ""

# -----------------------------------------------------------------------------
# Step 3: Prepare Remote Server
# -----------------------------------------------------------------------------
echo -e "${YELLOW}[3/7] Preparing remote server...${NC}"

ssh "$REMOTE_USER@$REMOTE_HOST" << 'EOF'
  # Install Docker if not present
  if ! command -v docker &> /dev/null; then
    echo "Installing Docker..."
    curl -fsSL https://get.docker.com -o get-docker.sh
    sh get-docker.sh
    rm get-docker.sh
  fi

  # Install Docker Compose if not present
  if ! command -v docker-compose &> /dev/null; then
    echo "Installing Docker Compose..."
    curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
    chmod +x /usr/local/bin/docker-compose
  fi

  # Create deployment directory
  mkdir -p /root/kadi-system

  echo "✓ Remote server prepared"
EOF

echo -e "${GREEN}✓ Remote server ready${NC}"
echo ""

# -----------------------------------------------------------------------------
# Step 4: Sync Files with rsync (SELECTIVE - only required projects)
# -----------------------------------------------------------------------------
echo -e "${YELLOW}[4/7] Syncing files with rsync (selective sync)...${NC}"

# Create .rsyncignore patterns for file-level exclusions
cat > /tmp/rsync-exclude << 'RSYNC_EOF'
node_modules/
.git/
.claude/
.env
.env.*
!.env.production
*.log
.vscode/
.idea/
.DS_Store
*.swp
*.swo
coverage/
.nyc_output/
tmp/
temp/
.cache/
RSYNC_EOF

# Sync only the required directories
echo "Syncing Agent_TypeScript..."
rsync -avz --delete \
  --exclude-from=/tmp/rsync-exclude \
  -e "ssh" \
  "$LOCAL_DIR/Agent_TypeScript/" \
  "$REMOTE_USER@$REMOTE_HOST:$REMOTE_DIR/Agent_TypeScript/"

echo "Syncing MCP_Slack_Client..."
rsync -avz --delete \
  --exclude-from=/tmp/rsync-exclude \
  -e "ssh" \
  "$LOCAL_DIR/MCP_Slack_Client/" \
  "$REMOTE_USER@$REMOTE_HOST:$REMOTE_DIR/MCP_Slack_Client/"

echo "Syncing MCP_Slack_Server..."
rsync -avz --delete \
  --exclude-from=/tmp/rsync-exclude \
  -e "ssh" \
  "$LOCAL_DIR/MCP_Slack_Server/" \
  "$REMOTE_USER@$REMOTE_HOST:$REMOTE_DIR/MCP_Slack_Server/"

echo "Syncing MCP_Discord_Client..."
rsync -avz --delete \
  --exclude-from=/tmp/rsync-exclude \
  -e "ssh" \
  "$LOCAL_DIR/MCP_Discord_Client/" \
  "$REMOTE_USER@$REMOTE_HOST:$REMOTE_DIR/MCP_Discord_Client/"

echo "Syncing MCP_Discord_Server..."
rsync -avz --delete \
  --exclude-from=/tmp/rsync-exclude \
  -e "ssh" \
  "$LOCAL_DIR/MCP_Discord_Server/" \
  "$REMOTE_USER@$REMOTE_HOST:$REMOTE_DIR/MCP_Discord_Server/"

echo "Syncing kadi..."
rsync -avz --delete \
  --exclude-from=/tmp/rsync-exclude \
  -e "ssh" \
  "$LOCAL_DIR/kadi/" \
  "$REMOTE_USER@$REMOTE_HOST:$REMOTE_DIR/kadi/"

# Sync root-level deployment files
echo "Syncing deployment configuration files..."
rsync -avz \
  -e "ssh" \
  "$LOCAL_DIR/docker-compose.production.yml" \
  "$LOCAL_DIR/.env.production" \
  "$REMOTE_USER@$REMOTE_HOST:$REMOTE_DIR/"

# Copy production MCP config
scp "$LOCAL_DIR/kadi/kadi-broker/config/mcp-upstreams.production.json" \
    "$REMOTE_USER@$REMOTE_HOST:$REMOTE_DIR/kadi/kadi-broker/config/mcp-upstreams.json"

rm /tmp/rsync-exclude

echo -e "${GREEN}✓ Files synced (only required projects transferred!)${NC}"
echo ""

# -----------------------------------------------------------------------------
# Step 5: Build Docker Images on Remote Server
# -----------------------------------------------------------------------------
echo -e "${YELLOW}[5/7] Building Docker images and installing MCP dependencies on remote server...${NC}"
echo "This will take 8-12 minutes (npm installing dependencies on server)..."

ssh "$REMOTE_USER@$REMOTE_HOST" << EOF
  cd $REMOTE_DIR

  # Install MCP server dependencies
  echo "Installing MCP server dependencies..."
  cd $REMOTE_DIR/MCP_Slack_Client && npm ci --omit=dev
  cd $REMOTE_DIR/MCP_Slack_Server && npm ci --omit=dev
  cd $REMOTE_DIR/MCP_Discord_Client && npm ci --omit=dev
  cd $REMOTE_DIR/MCP_Discord_Server && npm ci --omit=dev

  # Build Docker images
  cd $REMOTE_DIR
  docker-compose -f docker-compose.production.yml build --no-cache
EOF

echo -e "${GREEN}✓ Docker images built${NC}"
echo ""

# -----------------------------------------------------------------------------
# Step 6: Stop Existing Services (if any)
# -----------------------------------------------------------------------------
echo -e "${YELLOW}[6/7] Stopping existing services...${NC}"

ssh "$REMOTE_USER@$REMOTE_HOST" << EOF
  cd $REMOTE_DIR
  docker-compose --env-file .env.production -f docker-compose.production.yml down || true
EOF

echo -e "${GREEN}✓ Existing services stopped${NC}"
echo ""

# -----------------------------------------------------------------------------
# Step 7: Start Services
# -----------------------------------------------------------------------------
echo -e "${YELLOW}[7/7] Starting KADI services...${NC}"

ssh "$REMOTE_USER@$REMOTE_HOST" << EOF
  cd $REMOTE_DIR
  docker-compose --env-file .env.production -f docker-compose.production.yml up -d

  echo ""
  echo "Waiting for services to be healthy..."
  sleep 10

  docker-compose --env-file .env.production -f docker-compose.production.yml ps
EOF

echo -e "${GREEN}✓ Services started${NC}"
echo ""

# -----------------------------------------------------------------------------
# Deployment Complete
# -----------------------------------------------------------------------------
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Deployment Complete!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "Services running on napoftheearth (64.23.168.129):"
echo "  - RabbitMQ Management: http://64.23.168.129:15672 (guest/guest)"
echo "  - KADI Broker: ws://64.23.168.129:8080/kadi"
echo "  - Broker Health: http://64.23.168.129:8080/health"
echo ""
echo "View logs:"
echo "  ssh napoftheearth 'cd /root/kadi-system && docker-compose -f docker-compose.production.yml logs -f'"
echo ""
echo "Projects deployed:"
echo "  ✓ Agent_TypeScript"
echo "  ✓ MCP_Slack_Client"
echo "  ✓ MCP_Slack_Server"
echo "  ✓ MCP_Discord_Client"
echo "  ✓ MCP_Discord_Server"
echo "  ✓ kadi-broker"
echo ""
echo "Projects excluded (as intended):"
echo "  ✗ Agent_Python"
echo "  ✗ ProtogameJS3D"
echo "  ✗ Other unrelated projects"
echo ""
