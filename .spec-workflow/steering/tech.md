# Technology Stack

## Project Type

**AGENTS** is a **distributed multi-agent orchestration platform** consisting of:
- Multiple autonomous agents (TypeScript, Python, C++)
- MCP servers for tool/capability provision
- MCP clients for user interaction (Discord, Slack, Web Dashboard)
- KĀDI broker for cross-language message routing
- Git-based workspace isolation for parallel execution

**Deployment Model**: Hybrid local (Windows desktop) and remote (Ubuntu DigitalOcean Droplet)

## Core Technologies

### Primary Language(s)

**TypeScript** (v5.9.3)
- **Runtime**: Node.js 20.x+
- **Language-specific tools**: npm (package manager), tsx (development execution), tsc (compiler)
- **Use Cases**: Agent orchestration, worker agents, shadow agents, MCP servers/clients, common libraries

**Python** (v3.11+)
- **Runtime**: CPython
- **Language-specific tools**: pip (package manager), venv (virtual environment)
- **Use Cases**: Python worker agents, data processing, ML integration (planned)

**C++** (C++17 standard)
- **Compiler**: MSVC (Windows), GCC/Clang (Linux)
- **Language-specific tools**: CMake (build system)
- **Use Cases**: DaemonAgent (game engine agent), Engine (game engine core)

**JavaScript** (ES2020+)
- **Runtime**: V8 (embedded in DaemonAgent)
- **Use Cases**: DaemonAgent scripting language, game logic

**Rationale**: TypeScript chosen because Claude and LLMs have strong TypeScript support, making it the "native language" for LLM-based agents. Type safety and rich ecosystem also contribute to reliability.

### Key Dependencies/Libraries

**TypeScript Agents:**
- **@anthropic-ai/sdk** (^0.32.1): Claude API client for LLM interactions
- **@modelcontextprotocol/sdk** (^1.0.4): MCP protocol implementation
- **zod** (^3.24.1): Runtime type validation and schema definition
- **discord.js** (^14.17.3): Discord API client for mcp-client-discord
- **@slack/web-api** (^7.11.0): Slack API client for mcp-client-slack
- **simple-git** (^3.27.0): Git operations for mcp-server-git

**Dashboard (mcp-client-quest):**
- **react** (^19.2.0): UI framework
- **react-router-dom** (^7.12.0): Client-side routing
- **tailwindcss** (^4.1.18): Utility-first CSS framework
- **vite** (^7.2.4): Build tool and dev server
- **express** (^4.21.2): Backend web server
- **ws**: WebSocket library for real-time updates

**Python Agents:**
- **anthropic**: Claude API client
- **python-dotenv**: Environment variable management

**DaemonAgent (C++):**
- **V8**: JavaScript runtime for scripting
- **Custom Engine**: Game engine framework

**KĀDI Infrastructure:**
- **RabbitMQ**: Message broker for cross-language communication
- **TypeScript**: KĀDI broker and core implementation (developed by lab colleague)

### Application Architecture

**Distributed Event-Driven Microservices Architecture**

**Key Patterns:**
1. **Quest-Based Workflow Orchestration**: User input → agent-producer → Quest/Task breakdown → Multi-agent execution → Verification → Merge
2. **Git Worktree Isolation**: Each agent works in isolated git worktree to prevent merge conflicts
3. **Shadow Agent Pattern**: Backup agents monitor primary agent execution for automatic rollback
4. **MCP Protocol**: Standardized tool invocation between agents and servers
5. **KĀDI Message Routing**: All inter-agent communication via KĀDI broker (RabbitMQ)
6. **Human-in-the-Loop**: Critical operations require human approval via dashboard

**Component Interaction Flow:**
```
User (Discord/Slack/Dashboard)
    ↓
MCP Clients (mcp-client-discord, mcp-client-slack, mcp-client-quest)
    ↓
KĀDI Broker (RabbitMQ) - Cross-Language Message Routing
    ↓
agent-producer (Orchestration Layer)
    ↓
Execution Layer (agent-worker, shadow-agent-worker, DaemonAgent)
    ↓
MCP Servers (mcp-server-quest, mcp-server-git, abilities)
    ↓
Storage (ArcadeDB, Git Repositories, File System)
```

**Rationale**: Git worktrees provide file modification isolation for multiple agents without Docker overhead or separate repositories. KĀDI enables cross-language communication and distributed deployment.

### Data Storage

**Primary Storage:**
- **ArcadeDB**: Graph database for quest/task storage, agent relationships, long-term memory
  - Location: DigitalOcean remote (http://64.23.168.129:2480/)
  - Use: Quest workflow, task dependencies, agent history
- **Git Repositories**: Code storage, version control, worktree isolation
  - Main: agent-playground
  - Worktrees: agent-playground-artist, shadow-agent-playground-artist
  - Monorepo: AGENTS (all projects as git submodules)
- **File System**: Configuration files, logs, temporary data

**Data Formats:**
- **JSON**: Configuration, API responses, task definitions
- **Markdown**: Documentation, task descriptions
- **.env**: Environment variables and secrets

### External Integrations

**APIs:**
- **Claude API (Anthropic)**: LLM-based agent reasoning and code generation
  - Models: Claude 3.5 Sonnet, Claude Opus
  - SDK: @anthropic-ai/sdk (TypeScript), anthropic (Python)
- **Discord API**: User interaction via Discord bot (discord.js ^14.17.3)
- **Slack API**: User interaction via Slack bot (@slack/web-api ^7.11.0)
- **GitHub API**: Repository operations, PR management (simple-git ^3.27.0)

**Protocols:**
- **HTTP/REST**: API calls to Claude, Discord, Slack, GitHub
- **WebSocket**: Real-time dashboard updates (mcp-client-quest)
- **MCP Protocol**: Agent-server communication (@modelcontextprotocol/sdk)
- **KĀDI Protocol**: Cross-language agent messaging (custom protocol over RabbitMQ)

**Authentication:**
- **API Keys**: Claude API, Discord bot token, Slack token, GitHub token
- **Environment Variables**: .env files (development), secret-ability (planned for production)

### Monitoring & Dashboard Technologies

**Dashboard Framework:**
- **React** (v19.2.0): UI framework with component reusability
- **Vite** (v7.2.4): Build tool with hot module replacement
- **Tailwind CSS** (v4.1.18): Utility-first CSS for rapid UI development

**Real-time Communication:**
- **WebSocket (ws)**: Real-time updates for quest/task progress, agent status

**State Management:**
- **React Context API**: Built-in state management (no external library)

**Key Metrics Displayed:**
- Quest status (active, pending approval, completed)
- Task progress (assigned agent, execution status, verification results)
- Agent health (online/offline, current workload)
- Git status (branch status, merge conflicts, commit history)
- Approval queue (tasks awaiting human review)

**Rationale**: React chosen for component reusability and excellent real-time update support. Vite provides fast development experience. Tailwind CSS enables rapid UI development.

## Development Environment

### Build & Development Tools

**TypeScript Projects:**
- **Build System**: TypeScript compiler (tsc)
- **Package Management**: npm
- **Development workflow**: tsx for hot reload during development
- **Scripts**: `npm run dev` (development), `npm run build` (production), `npm start` (run)

**Dashboard (mcp-client-quest):**
- **Build System**: Vite (^7.2.4)
- **Package Management**: npm
- **Development workflow**: Vite dev server with HMR (Hot Module Replacement)
- **Scripts**: `npm run dev` (http://localhost:5173), `npm run build`, `npm run preview`

**Python Projects:**
- **Build System**: setuptools (planned)
- **Package Management**: pip
- **Development workflow**: venv for virtual environment

**C++ Projects (DaemonAgent):**
- **Build System**: CMake
- **Package Management**: vcpkg (planned)
- **Development workflow**: Visual Studio (Windows), VS Code (cross-platform)

### Code Quality Tools

**Static Analysis:**
- **TypeScript**: ESLint (^9.39.1) with typescript-eslint (^8.46.4)
- **Python**: Pylint, mypy (planned)
- **C++**: clang-tidy (planned)

**Formatting:**
- **TypeScript**: Prettier (planned, not yet configured)
- **Python**: Black (planned)
- **C++**: clang-format (planned)

**Testing Framework:**
- **TypeScript**: Jest or Vitest (planned, not yet implemented)
- **Python**: pytest (planned)
- **C++**: Google Test (planned)

**Documentation:**
- **TypeScript**: TypeDoc (planned)
- **Python**: Sphinx (planned)
- **C++**: Doxygen (planned)

**Note**: Code quality tools are planned but not fully implemented yet. This is part of M7 cleanup tasks.

### Version Control & Collaboration

**VCS**: Git

**Branching Strategy:**
- **Development**: `main` (stable), `feature/*` (features), `bugfix/*` (fixes)
- **Agent Worktrees**: `agent/*` (worker branches), `shadow/*` (shadow branches)

**Workflow:**
1. agent-producer creates quest and tasks
2. agent-producer creates worktree branch for each agent
3. Agents work in isolated worktrees (no conflicts)
4. Human approves via dashboard
5. agent-producer merges to main and pushes

**Code Review Process:**
- **Manual Review**: Human approval via mcp-client-quest dashboard
- **LLM-Based Verification**: agent-producer verifies task completion using Claude
- **Shadow Agent Monitoring**: shadow-agent-worker monitors primary agent execution

### Dashboard Development

**Live Reload:**
- **Vite HMR**: Hot module replacement for instant updates during development
- **Port**: Default 5173 (configurable)

**Multi-Instance Support:**
- **Planned**: Support for running multiple dashboard instances simultaneously
- **Current**: Single instance for thesis defense demo

## Deployment & Distribution

**Target Platform(s):**
- **Local Development**: Windows 10/11 (desktop)
- **Remote Deployment**: Ubuntu 20.04+ (DigitalOcean Droplet)

**Distribution Method:**
- **Development**: Clone repository, install dependencies, configure .env
- **Production**: TBD (Docker containers planned for post-thesis)

**Installation Requirements:**
- **Windows**: Node.js 20.x+, Python 3.11+, Visual Studio (for DaemonAgent), Git
- **Ubuntu**: Node.js 20.x+, Python 3.11+, GCC/Clang, Git
- **Minimum**: 4 cores, 8 GB RAM, 20 GB disk
- **Recommended**: 8+ cores, 32 GB RAM, 50 GB SSD (for 20+ concurrent agents)

**Update Mechanism:**
- **Development**: Git pull, npm install
- **Production**: TBD (CI/CD pipeline planned for post-thesis)

## Technical Requirements & Constraints

### Performance Requirements

- **Agent Response Time**: Less than 5 seconds for task assignment
- **Dashboard Response Time**: Instant (under 100ms) without latency
- **Git Operations**: Less than 10 seconds for merge operations
- **Concurrent Agents**: 100 agents (long-term goal), 20 instances (thesis defense demo)

### Compatibility Requirements

**Platform Support:**
- **Windows**: 10/11 (local development and desktop)
- **Linux**: Ubuntu 20.04+ (DigitalOcean Droplet)
- **macOS**: Not officially supported (may work, untested)

**Dependency Versions:**
- **Node.js**: 20.x or higher
- **Python**: 3.11 or higher
- **TypeScript**: 5.9.3
- **React**: 19.2.0
- **C++ Compiler**: MSVC 2019+ (Windows), GCC 9+ or Clang 10+ (Linux)

### Security & Compliance

**Security Requirements:**
- **API Key Management**: .env files (development), secret-ability (planned for production)
- **Agent Isolation**: Git worktrees for file system isolation, separate processes
- **Code Execution Safety**: Human approval before execution, shadow agents for monitoring

**Threat Model:**
- **LLM-Generated Code**: Potential for malicious code generation (mitigated by human approval)
- **API Key Exposure**: Risk of key leakage (mitigated by .env gitignore, secret-ability)
- **Agent Compromise**: Risk of agent misbehavior (mitigated by shadow agents, rollback)

### Scalability & Reliability

**Expected Load (Thesis Defense Demo):**
- **Concurrent Agents**: 20 instances (agents + MCP servers + MCP clients)
- **Quest Complexity**: Simple quest (e.g., "Create a scene with 3 bouncing balls and a player camera with physics collision")
- **Stretch Goal**: Increase instances and quest/task complexity if time permits

**Long-Term Scalability (Post-Thesis):**
- **Concurrent Agents**: 100+ agents
- **Quests per Day**: 100+ quests
- **Dashboard Users**: Single user (multi-user as stretch goal)

**Reliability Requirements:**
- **Shadow Agents**: Backup agents for redundancy
- **Automatic Retry**: Retry failed tasks (planned)
- **Rollback**: Git-based rollback for failed tasks
- **Health Monitoring**: Agent heartbeat and status tracking (planned in M6)

## Technical Decisions & Rationale

### Decision Log

1. **TypeScript for Agents**
   - **Why**: Claude and LLMs have strong TypeScript support (LLM "native language")
   - **Alternatives**: Python (less type-safe), JavaScript (no type safety)
   - **Trade-offs**: Accepted compilation step for type safety benefits

2. **KĀDI for Message Routing**
   - **Why**: Cross-language support, distributed architecture, MCP compatibility
   - **Alternatives**: Direct HTTP calls (no pub/sub), Redis (limited cross-language)
   - **Trade-offs**: Dependency on lab colleague's project, RabbitMQ complexity
   - **Note**: KĀDI uses RabbitMQ (rationale unknown, likely for reliability and message persistence)

3. **Git Worktrees for Isolation**
   - **Why**: File modification isolation without Docker overhead or separate repositories
   - **Alternatives**: Docker containers (heavy), separate repos (merge overhead), shared workspace (conflicts)
   - **Trade-offs**: Git complexity, disk space for multiple worktrees

4. **React for Dashboard**
   - **Why**: Component reusability, rich ecosystem, excellent WebSocket support
   - **Alternatives**: Vue (smaller ecosystem), vanilla JS (no framework benefits)
   - **Trade-offs**: React bundle size, learning curve

5. **ArcadeDB for Storage**
   - **Why**: Graph database for agent relationships, already deployed on DigitalOcean
   - **Alternatives**: PostgreSQL (relational, not graph), MongoDB (document, not graph)
   - **Trade-offs**: Less mature than PostgreSQL, smaller community

## Known Limitations

**No Technical Limitations Identified**

The primary constraint is **development timeline**, not technical feasibility. All planned features are technically achievable within the thesis timeline (M2-M7, Feb-May 2026).

**Development Timeline Concerns:**

1. **mcp-client-quest Polish**
   - **Impact**: Dashboard is the only connection between human and agent-producer
   - **Mitigation**: Prioritize dashboard UX in M3-M4, allocate buffer time for polish

2. **Agent-Factory Implementation**
   - **Impact**: Need to implement earlier to support 100+ concurrent agents
   - **Mitigation**: Re-evaluate milestone priorities after M3, possibly move from M6 to M5

3. **Language-Specific Agents**
   - **Impact**: May not have time for all planned languages (Python, Rust, Go, Java)
   - **Mitigation**: Prioritize Python + TypeScript, defer Rust/Go if needed

4. **Code Quality and Testing**
   - **Impact**: Limited time for comprehensive testing and code quality tools
   - **Mitigation**: Allocate M7 for cleanup, testing, and refactoring

**Stretch Goals (Out of Scope for Thesis):**
- Multi-user support (single user for thesis)
- Cloud deployment (local + DigitalOcean for thesis)
- Advanced analytics (basic metrics for thesis)
- Mobile app (web dashboard for thesis)
