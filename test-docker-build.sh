#!/bin/bash
# ============================================================================
# AGENTS - Local Docker Build Test
# ============================================================================
# Tests Docker builds locally before deploying to DigitalOcean
#
# Usage:
#   bash test-docker-build.sh
# ============================================================================

set -e  # Exit on error

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${GREEN}======================================${NC}"
echo -e "${GREEN}KADI System - Local Build Test${NC}"
echo -e "${GREEN}======================================${NC}"
echo ""

# -----------------------------------------------------------------------------
# Step 1: Build MCP Server Distributions
# -----------------------------------------------------------------------------
echo -e "${YELLOW}[1/4] Building MCP server distributions...${NC}"

cd mcp-client-slack && npm run build && cd ..
cd mcp-server-slack && npm run build && cd ..
cd mcp-client-discord && npm run build && cd ..
cd mcp-server-discord && npm run build && cd ..

echo -e "${GREEN}✓ MCP servers built${NC}"
echo ""

# -----------------------------------------------------------------------------
# Step 2: Validate docker-compose Configuration
# -----------------------------------------------------------------------------
echo -e "${YELLOW}[2/4] Validating docker-compose configuration...${NC}"

docker-compose -f docker-compose.production.yml config > /dev/null

echo -e "${GREEN}✓ Docker Compose configuration valid${NC}"
echo ""

# -----------------------------------------------------------------------------
# Step 3: Build Docker Images
# -----------------------------------------------------------------------------
echo -e "${YELLOW}[3/4] Building Docker images...${NC}"

docker-compose -f docker-compose.production.yml build

echo -e "${GREEN}✓ Docker images built successfully${NC}"
echo ""

# -----------------------------------------------------------------------------
# Step 4: Verify Images
# -----------------------------------------------------------------------------
echo -e "${YELLOW}[4/4] Verifying built images...${NC}"

echo "Built images:"
docker images | grep -E "kadi|agent|mcp" || echo "No KADI images found"

echo ""
echo -e "${GREEN}======================================${NC}"
echo -e "${GREEN}Local Build Test Complete!${NC}"
echo -e "${GREEN}======================================${NC}"
echo ""
echo "Next steps:"
echo "  1. Create .env.production from .env.production.template"
echo "  2. Fill in your actual API keys and tokens"
echo "  3. Run deployment script: bash deploy-to-napoftheearth.sh"
echo ""
