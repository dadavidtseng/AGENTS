# mcp-server-quest

Comprehensive quest orchestration system with KĀDI broker integration, replacing mcp-shrimp-task-manager with enhanced multi-channel approval workflow and document-driven development.

## Overview

mcp-server-quest is an MCP (Model Context Protocol) server that provides 15 tools for managing quests, tasks, agents, and approvals. It integrates with the KĀDI broker for event-driven multi-agent communication and supports approval workflows through Discord, Slack, and a web dashboard.

### Key Features

- **Quest Management**: Create, revise, and manage quests with automatic task splitting
- **Multi-Channel Approvals**: Discord, Slack, and Dashboard integration
- **Task Orchestration**: Assign tasks to agents with dependency validation
- **Real-time Dashboard**: WebSocket-based updates on port 8888
- **File-based Storage**: Git-versioned data in `.quest-data/`
- **KĀDI Integration**: All agent MCP calls routed through broker

## Installation

```bash
# Install dependencies
npm install

# Build the project
npm run build
```

## Quick Start

### Development Mode

```bash
npm run dev
```

The server will start in watch mode, automatically reloading on file changes.

### Production Mode

```bash
npm run build
npm start
```

### Dashboard Access

The dashboard will be available at `http://localhost:8888` after starting the server.

## Architecture

- **Node.js**: 18.0.0 or higher required
- **TypeScript**: 5.3+ with strict mode
- **MCP Protocol**: Standard tool invocation interface
- **Fastify**: High-performance web framework for dashboard
- **KĀDI Broker**: Event-driven agent communication
- **Anthropic SDK**: Claude API for document generation

## Project Structure

```
mcp-server-quest/
├── src/
│   ├── index.ts           # MCP server entry point
│   ├── tools/             # 15 MCP tool implementations
│   ├── models/            # Quest, Task, Agent, Approval models
│   ├── dashboard/         # Fastify server and WebSocket handlers
│   ├── prompts/           # Document generation prompts
│   └── utils/             # Shared utilities
├── .quest-data/           # Git-versioned quest data
└── tests/                 # Test files
```

## MCP Tools

### Quest Management
- `quest_create`: Create new quest
- `quest_revise`: Revise quest requirements
- `quest_request_approval`: Request multi-channel approval
- `quest_list`: List all quests
- `quest_detail`: Get quest details
- `quest_split_tasks`: Split quest into tasks

### Task Management
- `task_list`: List tasks
- `task_detail`: Get task details
- `task_update_status`: Update task status
- `task_log_result`: Log task result
- `task_verify`: Verify task completion

### Agent Management
- `agent_list`: List agents
- `agent_assign`: Assign agent to task
- `template_list`: List prompt templates
- `template_get`: Get template content

## Development

Built to replace mcp-shrimp-task-manager with:
- Enhanced approval workflow (Discord/Slack/Dashboard)
- Document-driven development (requirements.md, design.md)
- Improved task splitting with dependency validation
- Real-time dashboard updates via WebSocket

## License

MIT
