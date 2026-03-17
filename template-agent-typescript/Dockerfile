# Simple Dockerfile for local development
# Build from within template-agent-typescript directory
FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build

# Create data directory
RUN mkdir -p /app/data

# Start agent
CMD ["node", "dist/index.js"]
