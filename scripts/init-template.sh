#!/bin/bash
# Agent TypeScript Template Initialization Script
# This script helps you customize the template for your new agent

set -e  # Exit on error

echo "🚀 Agent TypeScript Template Initialization"
echo "==========================================="
echo ""

# Check if .env already exists
if [ -f .env ]; then
    read -p "⚠️  .env file already exists. Overwrite? (y/N): " overwrite
    if [[ ! $overwrite =~ ^[Yy]$ ]]; then
        echo "❌ Initialization cancelled."
        exit 1
    fi
fi

# Prompt for agent details
echo "📝 Please enter your agent configuration:"
echo ""

read -p "Agent Name (default: typescript-agent): " AGENT_NAME
AGENT_NAME=${AGENT_NAME:-typescript-agent}

read -p "Agent Version (default: 1.0.0): " AGENT_VERSION
AGENT_VERSION=${AGENT_VERSION:-1.0.0}

read -p "KĀDI Broker URL (default: ws://localhost:8080): " KADI_BROKER_URL
KADI_BROKER_URL=${KADI_BROKER_URL:-ws://localhost:8080}

read -p "Networks to join (default: global,text): " KADI_NETWORK
KADI_NETWORK=${KADI_NETWORK:-global,text}

read -p "Enable Slack Bot? (y/N): " ENABLE_SLACK
if [[ $ENABLE_SLACK =~ ^[Yy]$ ]]; then
    ENABLE_SLACK_BOT=true
    read -p "Anthropic API Key: " ANTHROPIC_API_KEY
else
    ENABLE_SLACK_BOT=false
    ANTHROPIC_API_KEY=""
fi

read -p "Enable Discord Bot? (y/N): " ENABLE_DISCORD
if [[ $ENABLE_DISCORD =~ ^[Yy]$ ]]; then
    ENABLE_DISCORD_BOT=true
    if [ -z "$ANTHROPIC_API_KEY" ]; then
        read -p "Anthropic API Key: " ANTHROPIC_API_KEY
    fi
else
    ENABLE_DISCORD_BOT=false
fi

# Create .env file from template
echo ""
echo "📄 Creating .env file..."

cp .env.example .env

# Update values in .env
if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS
    sed -i '' "s/^AGENT_NAME=.*/AGENT_NAME=$AGENT_NAME/" .env
    sed -i '' "s/^AGENT_VERSION=.*/AGENT_VERSION=$AGENT_VERSION/" .env
    sed -i '' "s|^KADI_BROKER_URL=.*|KADI_BROKER_URL=$KADI_BROKER_URL|" .env
    sed -i '' "s/^KADI_NETWORK=.*/KADI_NETWORK=$KADI_NETWORK/" .env
    sed -i '' "s/^ENABLE_SLACK_BOT=.*/ENABLE_SLACK_BOT=$ENABLE_SLACK_BOT/" .env
    sed -i '' "s/^ENABLE_DISCORD_BOT=.*/ENABLE_DISCORD_BOT=$ENABLE_DISCORD_BOT/" .env
    if [ -n "$ANTHROPIC_API_KEY" ]; then
        sed -i '' "s/^ANTHROPIC_API_KEY=.*/ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY/" .env
    fi
else
    # Linux/Windows Git Bash
    sed -i "s/^AGENT_NAME=.*/AGENT_NAME=$AGENT_NAME/" .env
    sed -i "s/^AGENT_VERSION=.*/AGENT_VERSION=$AGENT_VERSION/" .env
    sed -i "s|^KADI_BROKER_URL=.*|KADI_BROKER_URL=$KADI_BROKER_URL|" .env
    sed -i "s/^KADI_NETWORK=.*/KADI_NETWORK=$KADI_NETWORK/" .env
    sed -i "s/^ENABLE_SLACK_BOT=.*/ENABLE_SLACK_BOT=$ENABLE_SLACK_BOT/" .env
    sed -i "s/^ENABLE_DISCORD_BOT=.*/ENABLE_DISCORD_BOT=$ENABLE_DISCORD_BOT/" .env
    if [ -n "$ANTHROPIC_API_KEY" ]; then
        sed -i "s/^ANTHROPIC_API_KEY=.*/ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY/" .env
    fi
fi

echo "✅ .env file created successfully!"
echo ""

# Install dependencies
read -p "📦 Install dependencies now? (Y/n): " install_deps
if [[ ! $install_deps =~ ^[Nn]$ ]]; then
    echo ""
    echo "📦 Installing dependencies..."
    npm install
    echo "✅ Dependencies installed!"
fi

echo ""
echo "🎉 Initialization complete!"
echo ""
echo "📋 Next steps:"
echo "   1. Review your .env file"
echo "   2. Customize tools in src/tools/"
echo "   3. Run 'npm run dev' to start development"
echo ""
echo "📚 For more information, see TEMPLATE_USAGE.md"
