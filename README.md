<a id="readme-top"></a>

<!-- PROJECT SHIELDS -->
[![Contributors][contributors-shield]][contributors-url]
[![Forks][forks-shield]][forks-url]
[![Stargazers][stars-shield]][stars-url]
[![Issues][issues-shield]][issues-url]
[![Apache 2.0 License][license-shield]][license-url]
[![LinkedIn][linkedin-shield]][linkedin-url]

<!-- PROJECT TITLE -->
<div align="center">
  <h1>AGENTS</h1>
  <p>Autonomous Game Engineering Network with Task-based Synchronization</p>
</div>

<!-- TECH STACK BADGES -->
![C++](https://img.shields.io/badge/C%2B%2B-20-00599C?style=for-the-badge&logo=cplusplus&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![Python](https://img.shields.io/badge/Python-3776AB?style=for-the-badge&logo=python&logoColor=white)
![Rust](https://img.shields.io/badge/Rust-000000?style=for-the-badge&logo=rust&logoColor=white)
![Go](https://img.shields.io/badge/Go-00ADD8?style=for-the-badge&logo=go&logoColor=white)
![React](https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [How to Install](#how-to-install)
- [How to Use](#how-to-use)
- [Project Structure](#project-structure)
- [Future Roadmap](#future-roadmap)
- [Acknowledgements](#acknowledgements)
- [License](#license)
- [Contact](#contact)

---

## Overview

AGENTS is a distributed multi-agent orchestration platform that enables autonomous collaboration between specialized AI agents through the KADI broker protocol. The system uses a quest-based workflow where a human provides high-level direction (CEO-style), and an orchestrator agent decomposes goals into executable tasks, assigns them to specialized worker agents, and verifies completion through LLM-based evaluation with human approval gates.

The platform spans five languages (C++, TypeScript, Python, Rust, Go) and integrates with a custom C++ game engine (DaemonAgent) to demonstrate cross-language agent coordination in real-time interactive environments. Each worker agent operates in an isolated git worktree for conflict-free parallel execution, with shadow agents providing backup and automatic rollback capabilities.

This project is being developed as a Master's thesis at SMU Guildhall, exploring how autonomous agents can orchestrate complex software development workflows through structured tool-use, persistent memory, and multi-step reasoning.

## Features

- [Quest-Based Orchestration](#quest-based-orchestration)
- [KADI Broker Protocol](#kadi-broker-protocol)
- [Dual-Layer Memory System](#dual-layer-memory-system)
- [Cross-Language Agent Communication](#cross-language-agent-communication)
- [Real-Time Dashboard](#real-time-dashboard)

---

### Quest-Based Orchestration

The agent-producer acts as the central orchestrator, breaking high-level goals into executable tasks through a structured workflow:

1. Human creates a quest via Discord (e.g., "Create a simple login page")
2. agent-producer generates tasks using a 4-step decomposition workflow
3. Tasks are assigned to specialized worker agents (artist, programmer, designer)
4. Worker agents execute tasks in isolated git worktrees and commit artifacts
5. agent-producer verifies completion with LLM scoring (0-100)
6. Human approves tasks via Discord (score >= 80 required)
7. agent-producer merges branches and pushes to GitHub

Task status follows a state machine: `pending > assigned > in_progress > completed | failed`

### KADI Broker Protocol

The KADI Broker serves as the central hub that federates tools and abilities from multiple agents and MCP servers. It provides:

- **Tool Federation**: Unified registry of all tools/abilities across agents and MCP servers
- **Protocol Translation**: Bridges KADI protocol and MCP protocol seamlessly
- **Network Isolation**: Logical networks for multi-tenancy and access control
- **Discovery Service**: Dynamic tool discovery for agents joining the system

The architectural hierarchy follows: Tool (stateless function) > Ability (intelligent wrapper) > Agent (standalone application) > KADI Broker (infrastructure hub).

```
MCP Client (Claude Desktop, Cursor)
        |
        v  MCP Protocol
   KADI Broker [Tool Registry | Protocol Translator | Network Router]
        |
   +----+----+----+
   |    |    |    |
   v    v    v    v   KADI Protocol
 Agent Agent Agent MCP Server
```

### Dual-Layer Memory System

Agents maintain context through two memory layers:

- **Short-term memory**: Local JSON storage for active task context, conversation state, and immediate working data
- **Long-term memory**: ArcadeDB graph database for persistent agent context, task dependencies, relationship tracking, and cross-session knowledge

This enables agents to maintain continuity across tasks and sessions while keeping active operations fast.

### Cross-Language Agent Communication

The platform supports worker agents in five languages, each leveraging language-specific strengths:

| Language | Agent Role | Use Case |
|----------|-----------|----------|
| TypeScript | Primary worker agents | Task execution, file operations, git workflows |
| Python | Data processing agent | ML integration, data analysis, scientific computing |
| C++ | DaemonAgent (game engine) | Real-time entity manipulation, scene setup, input simulation |
| Rust | High-performance agent | CPU-intensive operations, system-level tasks |
| Go | Concurrent processing agent | Network services, parallel task execution |

All agents communicate through the KADI event bus using pub/sub messaging on the 'utility' network.

### Real-Time Dashboard

mcp-client-quest provides a React + Express web dashboard with:

- WebSocket-based real-time updates for quest/task status
- Visual quest and task management interface
- Agent status monitoring and health checks
- Slack and Discord notification pipeline integration

---

## How to Install

### Prerequisites

- Node.js (v20+)
- TypeScript (v5.7+)
- Git with worktree support
- ArcadeDB (for long-term memory)
- Discord bot token (for quest creation interface)

### Installation

```bash
git clone https://github.com/dadavidtseng/AGENTS.git
cd AGENTS

# Install dependencies for each component
cd mcp-server-quest && npm install
cd ../agent-producer && npm install
cd ../agent-worker && npm install
cd ../mcp-client-quest && npm install
```

## How to Use

```bash
# 1. Start the KADI broker
cd kadi-broker && npm start

# 2. Start the MCP quest server (34 tools for quest/task management)
cd mcp-server-quest && npm start

# 3. Start the agent producer (orchestrator)
cd agent-producer && npm start

# 4. Start worker agents with role configuration
cd agent-worker && npm start -- --role=programmer

# 5. Start the dashboard
cd mcp-client-quest && npm start

# 6. Create a quest via Discord
# Type in Discord: "Create a simple login page"
# The system handles decomposition, assignment, execution, and verification
```

## Project Structure

```
AGENTS/
+-- kadi-broker/          # Central message broker and MCP gateway
+-- mcp-server-quest/     # Quest and task management (34 MCP tools)
+-- agent-producer/       # Orchestrator agent (event-driven)
+-- agent-worker/         # Generic worker with role-based config
+-- shadow-agent-worker/  # Backup and monitoring agent
+-- mcp-client-quest/     # React + Express real-time dashboard
+-- mcp-client-discord/   # Discord bot interface
+-- mcp-client-slack/     # Slack bot interface
+-- DaemonAgent/          # C++ game engine agent integration
+-- agents-library/       # Shared utilities and base classes
+-- Docs/                 # Architecture and workflow documentation
+-- scripts/              # Setup and utility scripts
```

| Module | Description |
|--------|-------------|
| kadi-broker | Central hub: tool registry, protocol translation, network routing |
| mcp-server-quest | State management: quest CRUD, task lifecycle, LLM verification |
| agent-producer | Orchestration: task decomposition, assignment, git merge workflow |
| agent-worker | Execution: role-based task execution in isolated git worktrees |
| shadow-agent-worker | Reliability: backup snapshots, monitoring, automatic rollback |
| mcp-client-quest | Visibility: real-time dashboard with WebSocket updates |
| DaemonAgent | Game engine: C++/JavaScript cross-language command system |

## Future Roadmap

- [x] End-to-end quest workflow (create, assign, execute, verify, merge)
- [x] 34-tool MCP server for quest/task management
- [x] Discord and Slack notification pipelines
- [x] Shadow agent monitoring with automatic rollback
- [ ] Python worker agent for data processing and ML integration
- [ ] Agent factory with local and remote spawning
- [ ] Advanced agent communication (direct messaging, request/response)
- [ ] Context window management with conversation summarization
- [ ] Full DaemonAgent integration with generic command system

See the [open issues](https://github.com/dadavidtseng/AGENTS/issues) for a full list of proposed features and known issues.

## Acknowledgements

- SMU Guildhall graduate program for academic support and guidance
- Anthropic Claude SDK for LLM-powered agent reasoning
- Model Context Protocol (MCP) specification for standardized tool communication
- ArcadeDB for graph-based persistent memory

## License

Copyright 2026 Yu-Wei Tseng

Licensed under the [Apache License, Version 2.0](LICENSE).

## Contact

**Yu-Wei Tseng**
- Portfolio: [dadavidtseng.info](https://dadavidtseng.info)
- GitHub: [@dadavidtseng](https://github.com/dadavidtseng)
- LinkedIn: [dadavidtseng](https://www.linkedin.com/in/dadavidtseng/)
- Email: dadavidtseng@gmail.com

Project Link: [github.com/dadavidtseng/AGENTS](https://github.com/dadavidtseng/AGENTS)

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- REFERENCE-STYLE LINKS -->
[contributors-shield]: https://img.shields.io/github/contributors/dadavidtseng/AGENTS.svg?style=for-the-badge
[contributors-url]: https://github.com/dadavidtseng/AGENTS/graphs/contributors
[forks-shield]: https://img.shields.io/github/forks/dadavidtseng/AGENTS.svg?style=for-the-badge
[forks-url]: https://github.com/dadavidtseng/AGENTS/network/members
[stars-shield]: https://img.shields.io/github/stars/dadavidtseng/AGENTS.svg?style=for-the-badge
[stars-url]: https://github.com/dadavidtseng/AGENTS/stargazers
[issues-shield]: https://img.shields.io/github/issues/dadavidtseng/AGENTS.svg?style=for-the-badge
[issues-url]: https://github.com/dadavidtseng/AGENTS/issues
[license-shield]: https://img.shields.io/github/license/dadavidtseng/AGENTS.svg?style=for-the-badge
[license-url]: https://github.com/dadavidtseng/AGENTS/blob/main/LICENSE
[linkedin-shield]: https://img.shields.io/badge/-LinkedIn-black.svg?style=for-the-badge&logo=linkedin&colorB=555
[linkedin-url]: https://linkedin.com/in/dadavidtseng
