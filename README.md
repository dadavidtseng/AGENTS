# mcp-server-quest

Comprehensive quest orchestration system with KĀDI broker integration, replacing mcp-shrimp-task-manager with enhanced multi-channel approval workflow and document-driven development.

## Overview

mcp-server-quest is an MCP (Model Context Protocol) server that provides **26 tools** for managing quests, tasks, agents, and approvals. It integrates with the KĀDI broker for event-driven multi-agent communication and supports approval workflows through Discord, Slack, and a web dashboard.

### Key Features

- **Quest Management**: Create, revise, and manage quests with automatic task splitting
- **Two-Tier Approval**: Quest-level and task-level approval gates
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
│   ├── tools/             # 26 MCP tool implementations
│   ├── models/            # Quest, Task, Agent, Approval models
│   ├── dashboard/         # Fastify server and WebSocket handlers
│   ├── prompts/           # Document generation prompts
│   └── utils/             # Shared utilities
├── .quest-data/           # Git-versioned quest data
└── tests/                 # Test files
```

## MCP Tools (26 total)

### Agent Management (4)
- `quest_register_agent`: Register an agent with capabilities
- `quest_unregister_agent`: Remove an agent from the system
- `quest_list_agents`: List all registered agents
- `quest_agent_heartbeat`: Agent heartbeat for health monitoring

### Quest Lifecycle (6)
- `quest_create_quest`: Create a new quest with requirements and design
- `quest_query_quest`: Query quest info (detail="summary" for progress, detail="full" for complete data)
- `quest_list_quest`: List all quests with optional status filter and pagination
- `quest_update_quest`: Revise quest requirements and design
- `quest_archive_quest`: Archive a quest
- `quest_delete_quest`: Permanently delete a quest

### Task Management (11)
- `quest_split_task`: Split quest into implementation tasks
- `quest_assign_task`: Assign tasks to agents
- `quest_query_task`: Query tasks by ID (full details) or search/filter
- `quest_update_task`: Update task metadata and/or status (with agent authorization)
- `quest_delete_task`: Delete a task
- `quest_submit_task_result`: Submit task implementation result
- `quest_verify_task`: Verify task completion
- `quest_log_implementation`: Log implementation details
- `quest_plan_task`: Plan task implementation approach
- `quest_analyze_task`: Analyze task requirements
- `quest_reflect_task`: Reflect on task implementation

### Approval Workflow (4)
- `quest_request_quest_approval`: Request human approval for a quest plan
- `quest_request_task_approval`: Request human approval for a completed task
- `quest_submit_approval`: Submit approval decision (approve/reject/revise)
- `quest_query_approval`: Check approval status

### Workflow Guidance (1)
- `quest_workflow_guide`: Get quest workflow documentation and guidance

## Development

Built to replace mcp-shrimp-task-manager with:
- Enhanced approval workflow (Discord/Slack/Dashboard)
- Document-driven development (requirements.md, design.md)
- Improved task splitting with dependency validation
- Real-time dashboard updates via WebSocket

## License

MIT
