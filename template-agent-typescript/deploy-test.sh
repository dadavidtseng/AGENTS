#!/bin/bash

# ============================================================================
# template-agent-typescript - Test Deployment Script
# ============================================================================
# Deploys template-agent-typescript + ArcadeDB to Digital Ocean droplet
# ============================================================================

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}template-agent-typescript Deployment${NC}"
echo -e "${GREEN}========================================${NC}"

# Step 1: Build Docker image locally
echo -e "\n${YELLOW}Step 1: Building Docker image...${NC}"
docker-compose -f docker-compose.test.yml build

# Step 2: Save and transfer image to droplet
echo -e "\n${YELLOW}Step 2: Preparing deployment package...${NC}"
docker save template-agent-typescript:latest | gzip > /tmp/template-agent.tar.gz

# Step 3: Transfer files to droplet
echo -e "\n${YELLOW}Step 3: Transferring files to droplet...${NC}"
wsl scp /tmp/template-agent.tar.gz napoftheearth:/tmp/
wsl scp docker-compose.test.yml napoftheearth:~/template-agent/docker-compose.yml
wsl scp .env.production napoftheearth:~/template-agent/.env.production

# Step 4: Deploy on droplet
echo -e "\n${YELLOW}Step 4: Deploying on droplet...${NC}"
wsl ssh napoftheearth << 'ENDSSH'
  set -e

  # Create directory
  mkdir -p ~/template-agent
  cd ~/template-agent

  # Load Docker image
  echo "Loading Docker image..."
  docker load < /tmp/template-agent.tar.gz

  # Stop existing containers
  echo "Stopping existing containers..."
  docker-compose down || true

  # Start services
  echo "Starting services..."
  docker-compose up -d

  # Wait for services to be healthy
  echo "Waiting for services to be healthy..."
  sleep 10

  # Check status
  echo "Service status:"
  docker-compose ps

  # Show logs
  echo -e "\nRecent logs:"
  docker-compose logs --tail=20

  # Cleanup
  rm /tmp/template-agent.tar.gz
ENDSSH

# Step 5: Verify deployment
echo -e "\n${YELLOW}Step 5: Verifying deployment...${NC}"
wsl ssh napoftheearth "cd ~/template-agent && docker-compose ps"

echo -e "\n${GREEN}========================================${NC}"
echo -e "${GREEN}Deployment Complete!${NC}"
echo -e "${GREEN}========================================${NC}"
echo -e "\nTo view logs: ${YELLOW}wsl ssh napoftheearth 'cd ~/template-agent && docker-compose logs -f'${NC}"
echo -e "To stop: ${YELLOW}wsl ssh napoftheearth 'cd ~/template-agent && docker-compose down'${NC}"
