# Project Structure

## Project Organization

### Repository Structure

**AGENTS** uses a **monorepo with git submodules** architecture:

```
C:\GitHub\AGENTS\                    # Main monorepo
├── agent-producer\                  # Git submodule
├── agent-worker\                    # Git submodule (formerly agent-artist)
├── shadow-agent-worker\             # Git submodule (formerly shadow-agent-artist)
├── DaemonAgent\                     # Git submodule (C++ game engine)
├── mcp-server-quest\                # Git submodule
├── mcp-server-git\                  # Git submodule
├── mcp-client-discord\              # Git submodule
├── mcp-client-slack\                # Git submodule
├── mcp-client-quest\                # Git submodule (dashboard)
├── ability-file-management\         # Git submodule
├── kadi\                            # Git submodule (KĀDI broker)
├── template-agent-typescript\       # Git submodule
├── template-agent-python\           # Git submodule
└── .spec-workflow\                  # Spec-workflow documentation
```

**Rationale**: Git submodules allow independent development and versioning of each component while maintaining a unified project structure. Each submodule is a separate git repository that can be developed, tested, and deployed independently.

### Component Categories

Components are organized into 5 categories:

1. **Orchestration Layer**
   - `agent-producer`: Quest/task orchestration, human-in-the-loop workflow
   - Purpose: Break down high-level goals into tasks, assign to agents, verify completion

2. **Execution Layer**
   - `agent-worker`: Generic worker agent with role configurations (artist, programmer, designer)
   - `shadow-agent-worker`: Backup agent for monitoring and rollback
   - `DaemonAgent`: C++ game engine agent with JavaScript scripting
   - Purpose: Execute assigned tasks in isolated git worktrees

3. **MCP Servers (Tool Providers)**
   - `mcp-server-quest`: Quest/task management (34 tools)
   - `mcp-server-git`: Git operations (planned)
   - Purpose: Provide capabilities to agents via MCP protocol

4. **MCP Clients (User Interfaces)**
   - `mcp-client-discord`: Discord bot for user interaction
   - `mcp-client-slack`: Slack bot for user interaction
   - `mcp-client-quest`: Web dashboard for quest/task management
   - Purpose: Enable human interaction with agent-producer

5. **Infrastructure**
   - `kadi`: KĀDI broker for message routing and cross-language communication
   - `ability-file-management`: File operation abilities
   - `template-agent-typescript`: TypeScript agent template
   - `template-agent-python`: Python agent template
   - Purpose: Shared infrastructure and templates

### Workspace Isolation

**Git Worktree Pattern** for parallel agent execution:

```
C:\GitHub\agent-playground\          # Main repository
C:\GitHub\agent-playground-artist\   # Worker agent worktree
C:\GitHub\agent-playground-shadow\   # Shadow agent worktree
```

**How it works:**
1. agent-producer creates quest and tasks
2. agent-producer creates worktree branch for each agent (e.g., `agent/artist-task-123`)
3. Agents work in isolated worktrees (no file conflicts)
4. Human approves via mcp-client-quest dashboard
5. agent-producer merges all branches to main and pushes

**Rationale**: Git worktrees provide file modification isolation without Docker overhead or separate repositories. Each agent has its own working directory but shares the same git history.

## Naming Conventions

### Project Naming

**Pattern**: `{category}-{name}`

**Categories:**
- `agent-*`: Agent implementations (orchestration or execution)
- `mcp-server-*`: MCP servers (tool providers)
- `mcp-client-*`: MCP clients (user interfaces)
- `ability-*`: Reusable abilities (capabilities)
- `template-agent-*`: Agent templates for different languages

**Examples:**
- `agent-producer` (orchestration agent)
- `agent-worker` (generic worker agent)
- `shadow-agent-worker` (backup agent)
- `mcp-server-quest` (quest management server)
- `mcp-client-quest` (dashboard client)
- `ability-file-management` (file operation abilities)
- `template-agent-typescript` (TypeScript agent template)

**Special Cases:**
- `DaemonAgent`: C++ game engine agent (no prefix due to legacy naming)
- `kadi`: KĀDI broker infrastructure (no prefix, developed by lab colleague)

### File Naming

**TypeScript/JavaScript:**
- Source files: `camelCase.ts` or `PascalCase.ts` (for classes)
- Configuration: `kebab-case.json` or `camelCase.json`
- Examples: `questManager.ts`, `QuestService.ts`, `package.json`

**Python:**
- Source files: `snake_case.py`
- Configuration: `snake_case.json` or `kebab-case.json`
- Examples: `quest_manager.py`, `config.json`

**C++:**
- Header files: `PascalCase.h`
- Source files: `PascalCase.cpp`
- Examples: `DaemonAgent.h`, `ScriptEngine.cpp`

**Documentation:**
- Markdown: `UPPERCASE.md` or `kebab-case.md`
- Examples: `README.md`, `CLAUDE.md`, `product.md`

### Branch Naming

**Pattern**: `{type}/{description}`

**Types:**
- `main`: Stable branch (default)
- `feature/*`: New features (e.g., `feature/quest-workflow`)
- `bugfix/*`: Bug fixes (e.g., `bugfix/task-assignment`)
- `agent/*`: Worker agent branches (e.g., `agent/artist-task-123`)
- `shadow/*`: Shadow agent branches (e.g., `shadow/artist-task-123`)

**Examples:**
- `main` (stable branch)
- `feature/dashboard-migration` (new feature)
- `bugfix/git-merge-conflict` (bug fix)
- `agent/artist-task-123` (worker agent branch)
- `shadow/artist-task-123` (shadow agent branch)

**Rationale**: Clear branch naming enables automatic branch management and cleanup. Agent branches are automatically created and merged by agent-producer.

### Variable and Function Naming

**TypeScript/JavaScript:**
- Variables: `camelCase`
- Functions: `camelCase`
- Classes: `PascalCase`
- Constants: `UPPER_SNAKE_CASE`
- Interfaces: `PascalCase` (with `I` prefix optional)

**Python:**
- Variables: `snake_case`
- Functions: `snake_case`
- Classes: `PascalCase`
- Constants: `UPPER_SNAKE_CASE`

**C++:**
- Variables: `camelCase`
- Functions: `PascalCase`
- Classes: `PascalCase`
- Constants: `UPPER_SNAKE_CASE`

## Directory Structure

### Standard Project Structure (TypeScript)

```
project-name/
├── src/                    # Source code
│   ├── index.ts           # Entry point
│   ├── services/          # Business logic
│   ├── models/            # Data models
│   ├── utils/             # Utility functions
│   └── types/             # TypeScript type definitions
├── dist/                   # Compiled output (gitignored)
├── node_modules/           # Dependencies (gitignored)
├── tests/                  # Test files (planned)
├── .env                    # Environment variables (gitignored)
├── .env.example            # Environment variable template
├── .gitignore              # Git ignore rules
├── package.json            # Node.js dependencies
├── tsconfig.json           # TypeScript configuration
├── README.md               # Project overview
└── CLAUDE.md               # Claude-specific context
```

### Standard Project Structure (Python)

```
project-name/
├── src/                    # Source code
│   ├── __init__.py        # Package initialization
│   ├── main.py            # Entry point
│   ├── services/          # Business logic
│   ├── models/            # Data models
│   └── utils/             # Utility functions
├── venv/                   # Virtual environment (gitignored)
├── tests/                  # Test files (planned)
├── .env                    # Environment variables (gitignored)
├── .env.example            # Environment variable template
├── .gitignore              # Git ignore rules
├── requirements.txt        # Python dependencies
├── README.md               # Project overview
└── CLAUDE.md               # Claude-specific context
```

### Standard Project Structure (C++)

```
DaemonAgent/
├── src/                    # Source code
│   ├── main.cpp           # Entry point
│   ├── core/              # Core engine
│   ├── scripting/         # V8 JavaScript runtime
│   └── utils/             # Utility functions
├── include/                # Header files
│   └── DaemonAgent/       # Public headers
├── build/                  # Build output (gitignored)
├── tests/                  # Test files (planned)
├── CMakeLists.txt          # CMake configuration
├── README.md               # Project overview
└── CLAUDE.md               # Claude-specific context
```

### Dashboard Project Structure (React + Vite)

```
mcp-client-quest/
├── client/                 # React frontend
│   ├── src/
│   │   ├── components/    # React components
│   │   ├── pages/         # Page components
│   │   ├── hooks/         # Custom React hooks
│   │   ├── utils/         # Utility functions
│   │   ├── App.tsx        # Root component
│   │   └── main.tsx       # Entry point
│   ├── public/            # Static assets
│   ├── index.html         # HTML template
│   ├── package.json       # Frontend dependencies
│   ├── vite.config.ts     # Vite configuration
│   └── tsconfig.json      # TypeScript configuration
├── server/                 # Express backend
│   ├── src/
│   │   ├── index.ts       # Entry point
│   │   ├── routes/        # API routes
│   │   └── websocket.ts   # WebSocket server
│   ├── package.json       # Backend dependencies
│   └── tsconfig.json      # TypeScript configuration
├── README.md               # Project overview
└── CLAUDE.md               # Claude-specific context
```

### Spec-Workflow Structure

```
.spec-workflow/
├── steering/               # High-level steering documents
│   ├── product.md         # Product vision and features
│   ├── tech.md            # Technical architecture
│   ├── structure.md       # Project structure (this file)
│   └── deployment.md      # Deployment guide (planned)
├── specs/                  # Milestone-specific specs
│   ├── {milestone-name}/
│   │   ├── requirements.md # Detailed requirements
│   │   ├── design.md      # Technical design
│   │   └── tasks.md       # Granular task breakdown
│   └── ...
├── templates/              # Document templates
│   ├── product-template.md
│   ├── tech-template.md
│   ├── structure-template.md
│   ├── requirements-template.md
│   ├── design-template.md
│   └── tasks-template.md
└── approvals/              # Approval records (planned)
```

## Component Relationships

### High-Level Architecture

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

### Component Interaction Patterns

**1. Quest Creation Flow**
```
User → mcp-client-quest → KĀDI → agent-producer
    → mcp-server-quest (createQuest)
    → ArcadeDB (store quest)
```

**2. Task Assignment Flow**
```
agent-producer → mcp-server-quest (createTask)
    → ArcadeDB (store task)
    → KĀDI (publish task.assigned event)
    → agent-worker (listen for task.assigned)
```

**3. Task Execution Flow**
```
agent-worker → mcp-server-git (createWorktree)
    → Git (create worktree branch)
    → agent-worker (execute task with Claude API)
    → ability-file-management (file operations)
    → Git (commit changes)
    → KĀDI (publish task.completed event)
```

**4. Human Approval Flow**
```
agent-producer → mcp-server-quest (requestApproval)
    → ArcadeDB (store approval request)
    → KĀDI (publish approval.requested event)
    → mcp-client-quest (display approval UI)
    → User (approve/reject)
    → KĀDI (publish approval.responded event)
    → agent-producer (process approval)
```

**5. Git Merge Flow**
```
agent-producer → mcp-server-git (mergeWorktree)
    → Git (merge agent branch to main)
    → Git (push to remote)
    → mcp-server-quest (updateQuestStatus)
    → ArcadeDB (mark quest as completed)
```

### Dependency Graph

**Core Dependencies:**
- All agents depend on: `@anthropic-ai/sdk`, `@modelcontextprotocol/sdk`
- All MCP clients depend on: `kadi` (KĀDI broker)
- All MCP servers depend on: `@modelcontextprotocol/sdk`
- Dashboard depends on: `react`, `vite`, `tailwindcss`, `express`, `ws`

**Runtime Dependencies:**
- agent-producer depends on: mcp-server-quest, KĀDI broker
- agent-worker depends on: mcp-server-quest, mcp-server-git, abilities, KĀDI broker
- shadow-agent-worker depends on: mcp-server-quest, KĀDI broker
- DaemonAgent depends on: V8 runtime, Engine (game engine core)
- mcp-client-quest depends on: KĀDI broker, Express backend

**Data Dependencies:**
- All components depend on: ArcadeDB (quest/task storage)
- All agents depend on: Git repositories (code storage)
- All components depend on: .env files (configuration)

## Development Workflow

### Git Workflow

**Branching Strategy:**
1. `main`: Stable branch (always deployable)
2. `feature/*`: New features (merged to main via PR)
3. `bugfix/*`: Bug fixes (merged to main via PR)
4. `agent/*`: Worker agent branches (auto-created by agent-producer)
5. `shadow/*`: Shadow agent branches (auto-created by agent-producer)

**Workflow Steps:**
1. Create feature branch from main: `git checkout -b feature/new-feature`
2. Develop and commit changes: `git commit -m "feat: add new feature"`
3. Push to remote: `git push origin feature/new-feature`
4. Create pull request (manual or via gh CLI)
5. Code review and approval
6. Merge to main: `git merge feature/new-feature`
7. Delete feature branch: `git branch -d feature/new-feature`

**Agent Workflow (Automated):**
1. agent-producer creates quest and tasks
2. agent-producer creates worktree branch: `agent/artist-task-123`
3. agent-worker works in isolated worktree
4. agent-worker commits changes to worktree branch
5. Human approves via mcp-client-quest dashboard
6. agent-producer merges worktree branch to main
7. agent-producer pushes to remote
8. agent-producer deletes worktree branch

### Code Review Process

**Manual Review (Human Developers):**
1. Create pull request with clear description
2. Request review from team members
3. Address review comments
4. Obtain approval
5. Merge to main

**LLM-Based Verification (Agent Tasks):**
1. agent-producer verifies task completion using Claude API
2. agent-producer checks if task meets acceptance criteria
3. agent-producer requests human approval via dashboard
4. Human reviews changes in mcp-client-quest
5. Human approves or rejects
6. agent-producer merges or rolls back

**Shadow Agent Monitoring:**
1. shadow-agent-worker monitors primary agent execution
2. shadow-agent-worker detects failures or anomalies
3. shadow-agent-worker triggers automatic rollback if needed
4. shadow-agent-worker notifies human via dashboard

### Testing Strategy

**Current State (Thesis Phase):**
- Manual testing via end-to-end workflow scenarios
- LLM-based verification by agent-producer
- Shadow agent monitoring for redundancy

**Planned (Post-Thesis):**
- Unit tests: Jest or Vitest (TypeScript), pytest (Python), Google Test (C++)
- Integration tests: Test agent-to-agent communication via KĀDI
- End-to-end tests: Test complete quest workflow from user input to git push
- Performance tests: Test 100+ concurrent agents

### Deployment Workflow

**Local Development (Windows):**
1. Clone repository: `git clone https://github.com/user/AGENTS.git`
2. Initialize submodules: `git submodule update --init --recursive`
3. Install dependencies: `npm install` (each project)
4. Configure .env files (copy from .env.example)
5. Start KĀDI broker: `npm start` (in kadi/)
6. Start agent-producer: `npm start` (in agent-producer/)
7. Start dashboard: `npm run dev` (in mcp-client-quest/)

**Remote Deployment (Ubuntu DigitalOcean):**
1. SSH to droplet: `ssh user@64.23.168.129`
2. Clone repository: `git clone https://github.com/user/AGENTS.git`
3. Initialize submodules: `git submodule update --init --recursive`
4. Install dependencies: `npm install` (each project)
5. Configure .env files (use secret-ability for production)
6. Start KĀDI broker: `npm start` (in kadi/)
7. Start agent-producer: `npm start` (in agent-producer/)
8. Start dashboard: `npm run build && npm start` (in mcp-client-quest/)

**Planned (Post-Thesis):**
- Docker containers for each component
- Docker Compose for orchestration
- CI/CD pipeline (GitHub Actions)
- Automated deployment to DigitalOcean

### Documentation Workflow

**Project-Level Documentation:**
- `README.md`: Overview, quick start, architecture, usage
- `CLAUDE.md`: Claude-specific context, key files, common tasks, patterns

**Spec-Workflow Documentation:**
- `steering/*.md`: High-level steering documents (product, tech, structure, deployment)
- `specs/{milestone}/*.md`: Milestone-specific specs (requirements, design, tasks)

**Documentation Updates:**
1. Update documentation as code changes
2. Review documentation before milestone completion
3. Ensure consistency across all documentation
4. Update CLAUDE.md when adding new patterns or conventions

**Documentation Review:**
- Before M3: Create spec-workflow steering documents
- Before M4: Update project-level documentation
- Before M7: Comprehensive documentation review and updates
- Before thesis defense: Final documentation polish

---

## Appendix

### Related Documents
- **product.md**: Product vision, user stories, use cases
- **tech.md**: Technical architecture, design decisions
- **DEVELOPMENT-PLAN.md**: Detailed milestone plan (M2-M7)
- **DEVELOPMENT-PLAN-OUTLINE.md**: Quick reference guide

### Key Patterns

**1. Git Worktree Isolation Pattern**
- Each agent works in isolated git worktree
- Prevents merge conflicts during parallel execution
- Automatic branch creation and cleanup

**2. Shadow Agent Pattern**
- Backup agent monitors primary agent execution
- Automatic rollback capability if tasks fail
- Continuous health monitoring

**3. Quest-Based Workflow Pattern**
- 4-step workflow: Create → Assign → Execute → Verify
- Human approval at critical checkpoints
- Iterative refinement before execution

**4. MCP Tool Invocation Pattern**
- Standardized tool invocation between agents and servers
- Type-safe tool definitions with Zod schemas
- Automatic tool discovery and registration

**5. KĀDI Message Routing Pattern**
- All inter-agent communication via KĀDI broker
- Pub/sub messaging for event-driven architecture
- Cross-language communication support

**6. Human-in-the-Loop Pattern**
- All critical operations require human approval
- Real-time visibility into agent progress
- Ability to intervene and correct at any stage

### Glossary
- **Quest**: High-level goal broken down into tasks
- **Task**: Atomic unit of work assigned to an agent
- **Worktree**: Isolated git working directory for parallel execution
- **MCP**: Model Context Protocol (standard for AI agent tool use)
- **KĀDI**: Knowledge & Ability Deployment Infrastructure (message routing)
- **Shadow Agent**: Backup agent for monitoring and rollback
- **CEO-Style Orchestration**: Human provides high-level direction, agents handle details
