# Requirements: Simple Multi-Agent Orchestration

**Spec Name:** `simple-multi-agents-orchestration`
**Created:** 2025-11-30
**Revision:** V4 (11 Complete Architectural Corrections)
**Status:** Draft - Pending Approval

---

## 1. Overview

### 1.1 Purpose

Enable **agent-producer** to act as an intelligent orchestrator that:
- Receives user requests from multiple channels (Slack, Discord, Claude Code, Claude Desktop)
- Breaks down work into structured tasks using **mcp-shrimp-task-manager** (accessed via KĀDI broker)
- Publishes task assignment events via KĀDI broker for worker agents to subscribe
- **Monitors execution via event subscription** (workers publish completion events)
- Coordinates with **shadow agents** that track and version every file operation
- Coordinates user verification and GitHub push
- Notifies worker agents to cleanup worktrees after successful completion

### 1.2 Background

Current multi-agent systems lack centralized orchestration with real-time monitoring and versioning. This specification introduces a comprehensive orchestration pattern that leverages:

- **mcp-shrimp-task-manager** (located at `C:\GitHub\mcp-shrimp-task-manager`) for centralized task/spec management
- **KĀDI broker** for event-driven agent communication
- **Multi-channel support** via Slack/Discord (event-driven via mcp-client-slack/discord) and Claude Code/Claude Desktop (tool-based via agent-producer MCP tools)
- **Shadow agents** for continuous file operation monitoring and versioning
- **Event-based status tracking** (no polling required)

### 1.3 Goals

- **G1:** Automate project decomposition from user requirements to executable tasks
- **G2:** Enable concurrent task execution with git worktree workspace isolation (managed by **worker agents**)
- **G3:** Distribute tasks via **KĀDI event publishing** (agents.*.tasks.assign)
- **G4:** Monitor execution via **event subscription** (agents.*.tasks.completed)
- **G5:** Version every file operation via **shadow agents** with separate remote repositories (enables rollback when agents make mistakes or user disagrees; allows worker agents to work uninterrupted)
- **G6:** Ensure quality through systematic verification before user review
- **G7:** Handle failures gracefully with automatic reassignment

---

## 2. User Stories

### Epic 1: Request Processing

**US-1.1:** As a **user**, I want to **submit feature requests via Slack, Discord, Claude Code, or Claude Desktop**, so that **I can use my preferred interface**.

- **EARS Criteria:**
  - **WHEN** user sends message via Slack or Discord: "Can you create a design document to make a cube spinning randomly and changes color gradually?"
  - **THEN** agent-producer receives event through kadi-broker from mcp-client-slack or mcp-client-discord
  - **AND** acknowledges receipt within 2 seconds
  - **WHEN** user calls `plan_task` tool via Claude Code or Claude Desktop
  - **THEN** agent-producer receives tool invocation through kadi-broker
  - **AND** starts task planning workflow

**US-1.2:** As a **user**, I want to **receive immediate acknowledgment of my request**, so that **I know the system is processing it**.

- **EARS Criteria:**
  - **WHEN** agent-producer receives user request
  - **THEN** responds with acknowledgment message in same channel
  - **AND** includes estimated planning time
  - **Example:** "Got it! Planning your spinning color cube project. This should take about 1-2 minutes..."

---

### Epic 2: Task Planning & Breakdown

**US-2.1:** As an **agent-producer**, I want to **call mcp-shrimp-task-manager to create project specifications**, so that **requirements are structured and traceable**.

- **EARS Criteria:**
  - **WHEN** user request is received
  - **THEN** calls mcp-shrimp-task-manager `shrimp__plan_task` via broker protocol
  - **AND** receives spec document with structured format
  - **AND** stores specName for future reference

**US-2.2:** As an **agent-producer**, I want to **analyze requirements to identify scope and complexity**, so that **I can estimate effort accurately**.

- **EARS Criteria:**
  - **WHEN** spec is created
  - **THEN** calls mcp-shrimp-task-manager `shrimp__analyze_task` with spec name
  - **AND** receives analysis including: complexity score, estimated duration, required capabilities, suggested agent types

**US-2.3:** As an **agent-producer**, I want to **split specifications into atomic tasks with dependencies**, so that **work can be distributed efficiently**.

- **EARS Criteria:**
  - **WHEN** analysis is complete
  - **THEN** calls mcp-shrimp-task-manager `shrimp__split_tasks` with spec name
  - **AND** receives task list where each task has: unique taskId, description, dependencies array, required capabilities (artist/designer/programmer), estimated duration
  - **AND** builds dependency graph for execution ordering

**US-2.4:** As a **user**, I want to **see the breakdown of tasks created from my request**, so that **I understand the implementation plan**.

- **EARS Criteria:**
  - **WHEN** tasks are created
  - **THEN** agent-producer posts summary to user's channel
  - **FORMAT:** "Created 5 tasks for your spinning color cube:\n- Task 1: Design document (agent-designer)\n- Task 2: 3D model creation (agent-artist)\n- Task 3: Animation implementation (agent-programmer)\n- Task 4: Color shader (agent-programmer)\n- Task 5: Integration tests (agent-programmer)\n\nAssigning to 3 agents now..."

---

### Epic 3: Task Distribution (Event-Driven)

**US-3.1:** As an **agent-producer**, I want to **publish task assignment events via KĀDI broker**, so that **worker agents can subscribe and receive work**.

- **EARS Criteria:**
  - **WHEN** tasks are created and ready for assignment
  - **THEN** publishes event to topic `agents.agent-artist.tasks.assign` for artist tasks
  - **AND** publishes event to topic `agents.agent-designer.tasks.assign` for designer tasks
  - **AND** publishes event to topic `agents.agent-programmer.tasks.assign` for programmer tasks
  - **PAYLOAD:** `{ taskId, description, basePlayground: "C:\\p4\\Personal\\SD\\agent-playground", baseBranch: "main", dependencies, assignedAt }`

**US-3.2:** As a **worker agent** (artist/designer/programmer), I want to **subscribe to my task assignment topic**, so that **I receive tasks automatically**.

- **EARS Criteria:**
  - **WHEN** worker agent starts up
  - **THEN** subscribes to topic `agents.{self-agentId}.tasks.assign`
  - **AND** listens for assignment events
  - **EXAMPLE:** agent-artist subscribes to `agents.agent-artist.tasks.assign`

**US-3.3:** As a **worker agent**, I want to **create my own git worktree** before executing tasks, so that **I have isolated workspace**.

- **EARS Criteria:**
  - **WHEN** task assignment event received
  - **THEN** calls mcp-server-git `git__worktree` tool with mode 'add'
  - **AND** creates worktree at dedicated path (e.g., `C:\\p4\\Personal\\SD\\agent-playground-artist`)
  - **AND** checks out new branch named `task-{taskId}`
  - **AND** executes task in isolated worktree

---

### Epic 4: Shadow Agent Monitoring (NEW)

**US-4.1:** As a **shadow agent**, I want to **monitor file operations from my assigned worker agent**, so that **I can version every change**.

- **EARS Criteria:**
  - **WHEN** shadow-agent-artist starts up
  - **THEN** subscribes to topics: `agents.agent-artist.file.created`, `agents.agent-artist.file.modified`, `agents.agent-artist.file.removed`, `agents.agent-artist.file.moved`
  - **AND** listens for file operation events from agent-artist

**US-4.2:** As a **shadow agent**, I want to **commit and push every file operation to my dedicated remote repository**, so that **we have complete version history**.

- **EARS Criteria:**
  - **WHEN** file operation event received (e.g., `agents.agent-artist.file.created`)
  - **THEN** executes git add for affected files
  - **AND** creates commit with message describing operation (e.g., "Created src/cube.obj")
  - **AND** pushes to shadow agent's dedicated remote repository
  - **EXAMPLE:** shadow-agent-artist pushes to `github.com/user/project-shadow-artist`

**US-4.3:** As a **worker agent**, I want to **publish file operation events** whenever I create, modify, remove, or move files, so that **shadow agent can track changes for rollback ability** (when agents do something wrong or user disagrees) **and allow uninterrupted work**.

- **EARS Criteria:**
  - **WHEN** worker agent creates a file
  - **THEN** publishes event to `agents.{self-agentId}.file.created` with payload `{ filePath, timestamp, taskId }`
  - **WHEN** worker agent modifies a file
  - **THEN** publishes event to `agents.{self-agentId}.file.modified` with payload `{ filePath, timestamp, taskId }`
  - **WHEN** worker agent removes a file
  - **THEN** publishes event to `agents.{self-agentId}.file.removed` with payload `{ filePath, timestamp, taskId }`
  - **WHEN** worker agent moves a file
  - **THEN** publishes event to `agents.{self-agentId}.file.moved` with payload `{ oldPath, newPath, timestamp, taskId }`

---

### Epic 5: Execution Monitoring (Event-Based)

**US-5.1:** As an **agent-producer**, I want to **subscribe to task completion events from worker agents**, so that **I know when tasks are done without polling**.

- **EARS Criteria:**
  - **WHEN** agent-producer starts orchestration
  - **THEN** subscribes to topics: `agents.agent-artist.tasks.completed`, `agents.agent-designer.tasks.completed`, `agents.agent-programmer.tasks.completed`
  - **AND** listens for completion events

**US-5.2:** As a **worker agent**, I want to **publish completion event after finishing a task**, so that **producer knows I'm done**.

- **EARS Criteria:**
  - **WHEN** task execution completes successfully
  - **THEN** calls mcp-shrimp-task-manager `shrimp__log_implementation` to record completion
  - **AND** publishes event to `agents.{self-agentId}.tasks.completed` with payload `{ taskId, success: true, completedAt, artifacts, filesModified, filesCreated }`

**US-5.3:** As an **agent-producer**, I want to **track completion of all assigned tasks**, so that **I know when to request user verification**.

- **EARS Criteria:**
  - **WHEN** completion event received
  - **THEN** updates internal task status map
  - **AND** checks if all tasks in dependency graph are completed
  - **IF** all tasks completed
  - **THEN** proceeds to user verification flow

---

### Epic 6: User Verification & Git Push

**US-6.1:** As an **agent-producer**, I want to **request user verification after all tasks complete**, so that **user can review work before merging**.

- **EARS Criteria:**
  - **WHEN** all tasks marked as completed
  - **THEN** sends message to user's channel
  - **FORMAT:** "All 5 tasks completed! Please review the changes:\n- Task 1: Design doc created (24 lines added)\n- Task 2: 3D model (cube.obj, 156KB)\n- Task 3: Animation logic (src/animation.ts, 89 lines)\n- Task 4: Color shader (src/shader.glsl, 45 lines)\n- Task 5: Tests (3 test suites, all passing)\n\nReply 'approve' to merge to main branch."

**US-6.2:** As a **user**, I want to **approve or reject the completed work**, so that **I have final control over merging**.

- **EARS Criteria:**
  - **WHEN** user replies "approve" or "looks good" or "merge"
  - **THEN** agent-producer proceeds with git push
  - **WHEN** user replies "reject" or "redo" or requests changes
  - **THEN** agent-producer creates new task assignments for revisions

**US-6.3:** As an **agent-producer**, I want to **push completed work to remote GitHub repository from base playground directory**, so that **changes are merged to main branch**.

- **EARS Criteria:**
  - **WHEN** user approves completed work
  - **THEN** calls mcp-server-git `git__push` tool with path `C:\\p4\\Personal\\SD\\agent-playground` (base directory, NOT worktrees)
  - **AND** pushes to remote 'origin' branch 'main'
  - **AND** confirms successful push

**US-6.4:** As an **agent-producer**, I want to **publish cleanup events to worker agents after successful push**, so that **they can remove their worktrees**.

- **EARS Criteria:**
  - **WHEN** git push succeeds
  - **THEN** publishes events to topics: `agents.agent-artist.tasks.cleanup`, `agents.agent-designer.tasks.cleanup`, `agents.agent-programmer.tasks.cleanup`
  - **PAYLOAD:** `{ taskIds, cleanupAt, reason: "merged_to_main" }`

**US-6.5:** As a **worker agent**, I want to **remove my git worktree after receiving cleanup event**, so that **I free up disk space**.

- **EARS Criteria:**
  - **WHEN** cleanup event received
  - **THEN** calls mcp-server-git `git__worktree` tool with mode 'remove'
  - **AND** removes own worktree (e.g., `C:\\p4\\Personal\\SD\\agent-playground-artist`)
  - **AND** logs cleanup success

---

### Epic 7: Error Handling & Recovery

**US-7.1:** As a **worker agent**, I want to **publish failure event if task execution fails**, so that **producer can handle errors**.

- **EARS Criteria:**
  - **WHEN** task execution fails (exception, timeout, validation failure)
  - **THEN** publishes event to `agents.{self-agentId}.tasks.failed` with payload `{ taskId, error, failedAt, attemptNumber }`
  - **AND** does NOT remove git worktree (preserve for debugging)

**US-7.2:** As an **agent-producer**, I want to **subscribe to task failure events**, so that **I can handle errors gracefully**.

- **EARS Criteria:**
  - **WHEN** agent-producer starts orchestration
  - **THEN** subscribes to topics: `agents.agent-artist.tasks.failed`, `agents.agent-designer.tasks.failed`, `agents.agent-programmer.tasks.failed`

**US-7.3:** As an **agent-producer**, I want to **notify user about failed tasks**, so that **they are aware of issues**.

- **EARS Criteria:**
  - **WHEN** failure event received
  - **THEN** sends message to user's channel
  - **FORMAT:** "⚠️ Task 3 failed: Animation implementation\nError: TypeError in animation loop\nWorktree preserved at: C:\\p4\\Personal\\SD\\agent-playground-programmer\nWould you like me to retry or assign to different agent?"

---

## 3. Functional Requirements

### FR-1: MCP Server Integration

**FR-1.1:** agent-producer MUST connect to mcp-shrimp-task-manager via KĀDI broker
- **Path:** `C:\GitHub\mcp-shrimp-task-manager\dist\index.js`
- **Prefix:** `shrimp`
- **Networks:** `['global']`

**FR-1.2:** agent-producer MUST call the following mcp-shrimp-task-manager tools:
- `shrimp__plan_task` - Create project specification
- `shrimp__analyze_task` - Analyze complexity and requirements
- `shrimp__split_tasks` - Split into atomic tasks
- `shrimp__list_tasks` - Query task status
- `shrimp__log_implementation` - NOT called by producer (workers call this)

**FR-1.3:** Worker agents MUST call mcp-shrimp-task-manager tools for logging:
- `shrimp__log_implementation` - Log task completion with artifacts

### FR-2: Git Worktree Management

**FR-2.1:** Worker agents MUST create their OWN git worktrees
- agent-artist creates: `C:\p4\Personal\SD\agent-playground-artist`
- agent-designer creates: `C:\p4\Personal\SD\agent-playground-designer`
- agent-programmer creates: `C:\p4\Personal\SD\agent-playground-programmer`

**FR-2.2:** Worker agents MUST create worktrees via mcp-server-git tool:
- Tool: `git__worktree`
- Mode: 'add'
- Base path: `C:\p4\Personal\SD\agent-playground`

**FR-2.3:** agent-producer MUST push from base playground directory:
- Path: `C:\p4\Personal\SD\agent-playground` (NOT from worktrees)
- Remote: 'origin'
- Branch: 'main'

**FR-2.4:** Worker agents MUST remove worktrees after cleanup event:
- Tool: `git__worktree`
- Mode: 'remove'
- Own worktree path only

### FR-3: Event Publishing & Subscription

**FR-3.1:** agent-producer MUST publish the following events:
- `agents.agent-artist.tasks.assign` - Task assignments for artist
- `agents.agent-designer.tasks.assign` - Task assignments for designer
- `agents.agent-programmer.tasks.assign` - Task assignments for programmer
- `agents.agent-artist.tasks.cleanup` - Cleanup requests for artist
- `agents.agent-designer.tasks.cleanup` - Cleanup requests for designer
- `agents.agent-programmer.tasks.cleanup` - Cleanup requests for programmer

**FR-3.2:** agent-producer MUST subscribe to the following events:
- `agents.agent-artist.tasks.completed` - Completion notifications from artist
- `agents.agent-designer.tasks.completed` - Completion notifications from designer
- `agents.agent-programmer.tasks.completed` - Completion notifications from programmer
- `agents.agent-artist.tasks.failed` - Failure notifications from artist
- `agents.agent-designer.tasks.failed` - Failure notifications from designer
- `agents.agent-programmer.tasks.failed` - Failure notifications from programmer

**FR-3.3:** Worker agents MUST publish the following events:
- `agents.{self-agentId}.tasks.completed` - After successful task completion
- `agents.{self-agentId}.tasks.failed` - After task failure
- `agents.{self-agentId}.file.created` - After creating a file
- `agents.{self-agentId}.file.modified` - After modifying a file
- `agents.{self-agentId}.file.removed` - After removing a file
- `agents.{self-agentId}.file.moved` - After moving a file

**FR-3.4:** Worker agents MUST subscribe to the following events:
- `agents.{self-agentId}.tasks.assign` - Task assignments from producer
- `agents.{self-agentId}.tasks.cleanup` - Cleanup requests from producer

**FR-3.5:** Shadow agents MUST publish the following events:
- `agents.{shadow-agentId}.commits.pushed` - After pushing to shadow remote repo

**FR-3.6:** Shadow agents MUST subscribe to the following events:
- `agents.{worker-agentId}.file.created` - File creation from assigned worker
- `agents.{worker-agentId}.file.modified` - File modification from assigned worker
- `agents.{worker-agentId}.file.removed` - File removal from assigned worker
- `agents.{worker-agentId}.file.moved` - File move from assigned worker


### FR-3.5: agent-producer MCP Tool Registration

**FR-3.5.1:** agent-producer MUST register as an MCP upstream server with kadi-broker
- Provide tools for Claude Code and Claude Desktop users
- Enable direct tool invocation through broker

**FR-3.5.2:** agent-producer MUST provide the following MCP tools:
- `plan_task(description: string)` - Initiate task planning from user request (similar to shrimp-task-manager's plan_task)
- `list_active_tasks()` - Show currently active tasks across all worker agents
- `get_task_status(taskId: string)` - Get detailed status of specific task
- `approve_completion()` - User approval for merging completed work

**FR-3.5.3:** Tool invocation workflow:
- **WHEN** user calls `plan_task` from Claude Code/Desktop
- **THEN** agent-producer receives tool invocation via kadi-broker
- **AND** initiates same workflow as Slack/Discord event-based requests
- **AND** returns acknowledgment to user's client

**FR-3.5.4:** Event-based vs Tool-based channels:
- **Slack/Discord**: Event-driven via mcp-client-slack and mcp-client-discord publishing events to broker
- **Claude Code/Desktop**: Tool-driven via agent-producer providing MCP tools to broker

### FR-4: Shadow Agent Operations

**FR-4.1:** Shadow agents MUST be created for each worker agent:
- shadow-agent-artist (monitors agent-artist)
- shadow-agent-designer (monitors agent-designer)
- shadow-agent-programmer (monitors agent-programmer)

**FR-4.2:** Shadow agents MUST have dedicated remote repositories:
- shadow-agent-artist remote: Separate GitHub repo (e.g., `github.com/user/project-shadow-artist`)
- shadow-agent-designer remote: Separate GitHub repo (e.g., `github.com/user/project-shadow-designer`)
- shadow-agent-programmer remote: Separate GitHub repo (e.g., `github.com/user/project-shadow-programmer`)

**FR-4.3:** Shadow agents MUST commit and push after EVERY file operation:
- On file.created event: git add + commit + push
- On file.modified event: git add + commit + push
- On file.removed event: git rm + commit + push
- On file.moved event: git mv + commit + push

**FR-4.4:** Shadow agent commit messages MUST describe the operation:
- Format: `[{operation}] {filePath} (task-{taskId})`
- Example: `[CREATE] src/cube.obj (task-42)`
- Example: `[MODIFY] src/animation.ts (task-43)`

---

## 4. Non-Functional Requirements

### NFR-1: Performance

**NFR-1.1:** Event-based monitoring eliminates polling overhead
- No periodic polling of task status (polling-free architecture)
- Worker agents publish completion events immediately
- agent-producer responds to events in real-time

**NFR-1.2:** Task assignment latency < 5 seconds
- Time from task creation to assignment event published

**NFR-1.3:** Shadow agent commit latency < 2 seconds per file operation
- Time from file operation event to remote push completion

**NFR-1.4:** User verification response time < 3 seconds
- Time from all-tasks-completed to user notification

### NFR-2: Reliability

**NFR-2.1:** Event delivery guaranteed by KĀDI broker
- At-least-once delivery semantics
- Event persistence for offline agents

**NFR-2.2:** Worktree isolation prevents conflicts
- Each worker agent has isolated filesystem
- No race conditions between agents

**NFR-2.3:** Shadow agents provide recovery mechanism
- Complete version history in separate repos
- Can reconstruct state from shadow repo if main repo fails

### NFR-3: Scalability

**NFR-3.1:** Support up to 10 concurrent worker agents per type
- 10 agent-artist instances
- 10 agent-designer instances
- 10 agent-programmer instances

**NFR-3.2:** Support up to 100 concurrent tasks
- Limited by mcp-shrimp-task-manager capacity

---

## 5. Technical Architecture

### 5.1 Agent Network Topology

```
Networks:
- global: All agents
- artist: agent-artist, shadow-agent-artist
- design: agent-designer, shadow-agent-designer
- programmer: agent-programmer, shadow-agent-programmer
- git: All agents (for git operations)
- slack: agent-producer (via slack-bot.ts)
- discord: agent-producer (via discord-bot.ts)
```

### 5.2 Event-Driven Communication Flow

```
User @mention
    ↓
mcp-client-slack/discord
    ↓ publishes: slack.app_mention.* / discord.mention.*
agent-producer (slack-bot.ts / discord-bot.ts)
    ↓ subscribes to mention events
    ↓ calls mcp-shrimp-task-manager tools
    ↓ PUBLISHES: agents.{worker}.tasks.assign
    ↓
Worker Agents
    ↓ subscribe to: agents.{self}.tasks.assign
    ↓ CREATE OWN git worktrees
    ↓ execute tasks
    ↓ PUBLISH file operation events
    ↓ PUBLISH: agents.{self}.tasks.completed
    ↓
Shadow Agents
    ↓ subscribe to: agents.{worker}.file.*
    ↓ git commit + push to shadow remote repo
    ↓
agent-producer
    ↓ subscribes to: agents.{worker}.tasks.completed
    ↓ checks if all tasks done
    ↓ requests user verification
    ↓ AFTER USER APPROVAL: git push from base playground
    ↓ PUBLISHES: agents.{worker}.tasks.cleanup
    ↓
Worker Agents
    ↓ subscribe to: agents.{self}.tasks.cleanup
    ↓ remove own git worktrees
```

### 5.3 agent-producer Architecture

**Existing Structure (NO BaseBot extension needed):**
- File: `C:\p4\Personal\SD\agent-producer\src\index.ts`
- Has: `slack-bot.ts` (extends BaseBot)
- Has: `discord-bot.ts` (extends BaseBot)
- Uses: `KadiClient` directly for orchestration logic

**Orchestration Logic (NEW):**
- Add orchestration methods to agent-producer
- Subscribe to task completion/failure events
- Publish task assignment/cleanup events
- Call mcp-shrimp-task-manager tools
- Manage user verification flow

### 5.4 Worker Agent Architecture

**Required Implementation:**
- Extend BaseBot from `@agents/shared`
- Subscribe to `agents.{self-agentId}.tasks.assign`
- Subscribe to `agents.{self-agentId}.tasks.cleanup`
- Publish `agents.{self-agentId}.tasks.completed`
- Publish `agents.{self-agentId}.tasks.failed`
- Publish `agents.{self-agentId}.file.*` events
- Create and manage own git worktrees

**Agent Names:**
- agent-artist (network: artist)
- agent-designer (network: design)
- agent-programmer (network: programmer)

### 5.5 Shadow Agent Architecture

**Required Implementation:**
- Extend BaseBot from `@agents/shared`
- Subscribe to `agents.{worker-agentId}.file.*`
- Execute git commit + push for every file operation
- Maintain connection to dedicated shadow remote repo

**Agent Names:**
- shadow-agent-artist (monitors agent-artist, network: artist)
- shadow-agent-designer (monitors agent-designer, network: design)
- shadow-agent-programmer (monitors agent-programmer, network: programmer)

**Remote Repositories:**
- shadow-agent-artist: `github.com/user/project-shadow-artist`
- shadow-agent-designer: `github.com/user/project-shadow-designer`
- shadow-agent-programmer: `github.com/user/project-shadow-programmer`

---

## 6. Data Models

### 6.1 Event Payloads

**TaskAssignmentEvent:**
```typescript
{
  taskId: string;
  description: string;
  basePlayground: "C:\\p4\\Personal\\SD\\agent-playground";
  baseBranch: "main";
  dependencies: string[];
  assignedAt: string; // ISO timestamp
}
```

**TaskCompletionEvent:**
```typescript
{
  taskId: string;
  success: true;
  completedAt: string; // ISO timestamp
  artifacts: {
    filesCreated: string[];
    filesModified: string[];
    linesAdded: number;
    linesRemoved: number;
  };
}
```

**TaskFailureEvent:**
```typescript
{
  taskId: string;
  error: string;
  failedAt: string; // ISO timestamp
  attemptNumber: number;
  worktreePath: string; // Preserved for debugging
}
```

**TaskCleanupEvent:**
```typescript
{
  taskIds: string[];
  cleanupAt: string; // ISO timestamp
  reason: "merged_to_main" | "task_failed" | "user_cancelled";
}
```

**FileOperationEvent:**
```typescript
{
  operation: "created" | "modified" | "removed" | "moved";
  filePath: string;
  oldPath?: string; // Only for "moved" operation
  newPath?: string; // Only for "moved" operation
  timestamp: string; // ISO timestamp
  taskId: string;
}
```

---

## 7. API Contracts

### 7.1 KĀDI Event Topics

**Published by agent-producer:**
- `agents.agent-artist.tasks.assign`
- `agents.agent-designer.tasks.assign`
- `agents.agent-programmer.tasks.assign`
- `agents.agent-artist.tasks.cleanup`
- `agents.agent-designer.tasks.cleanup`
- `agents.agent-programmer.tasks.cleanup`

**Published by worker agents:**
- `agents.agent-artist.tasks.completed`
- `agents.agent-designer.tasks.completed`
- `agents.agent-programmer.tasks.completed`
- `agents.agent-artist.tasks.failed`
- `agents.agent-designer.tasks.failed`
- `agents.agent-programmer.tasks.failed`
- `agents.agent-artist.file.created`
- `agents.agent-artist.file.modified`
- `agents.agent-artist.file.removed`
- `agents.agent-artist.file.moved`
- (Same pattern for agent-designer and agent-programmer)

**Published by shadow agents:**
- `agents.shadow-agent-artist.commits.pushed`
- `agents.shadow-agent-designer.commits.pushed`
- `agents.shadow-agent-programmer.commits.pushed`

### 7.2 MCP Tool Calls

**agent-producer calls mcp-shrimp-task-manager:**
```typescript
protocol.invokeTool({
  targetAgent: 'mcp-shrimp-task-manager',
  toolName: 'shrimp__plan_task',
  toolInput: { description: string },
  timeout: 30000
});

protocol.invokeTool({
  targetAgent: 'mcp-shrimp-task-manager',
  toolName: 'shrimp__analyze_task',
  toolInput: { specName: string },
  timeout: 30000
});

protocol.invokeTool({
  targetAgent: 'mcp-shrimp-task-manager',
  toolName: 'shrimp__split_tasks',
  toolInput: { specName: string, tasksRaw: string, updateMode: string },
  timeout: 30000
});
```

**Worker agents call mcp-shrimp-task-manager:**
```typescript
protocol.invokeTool({
  targetAgent: 'mcp-shrimp-task-manager',
  toolName: 'shrimp__log_implementation',
  toolInput: {
    specName: string,
    taskId: string,
    summary: string,
    filesModified: string[],
    filesCreated: string[],
    statistics: { linesAdded: number, linesRemoved: number },
    artifacts: object
  },
  timeout: 30000
});
```

**Worker agents call mcp-server-git for worktrees:**
```typescript
// Create worktree
protocol.invokeTool({
  targetAgent: 'mcp-server-git',
  toolName: 'git__worktree',
  toolInput: {
    path: 'C:\\p4\\Personal\\SD\\agent-playground',
    mode: 'add',
    worktreePath: 'C:\\p4\\Personal\\SD\\agent-playground-artist',
    branch: 'task-42',
    commitish: 'main'
  },
  timeout: 10000
});

// Remove worktree
protocol.invokeTool({
  targetAgent: 'mcp-server-git',
  toolName: 'git__worktree',
  toolInput: {
    path: 'C:\\p4\\Personal\\SD\\agent-playground',
    mode: 'remove',
    worktreePath: 'C:\\p4\\Personal\\SD\\agent-playground-artist',
    force: true
  },
  timeout: 10000
});
```

**agent-producer calls mcp-server-git for push:**
```typescript
protocol.invokeTool({
  targetAgent: 'mcp-server-git',
  toolName: 'git__push',
  toolInput: {
    path: 'C:\\p4\\Personal\\SD\\agent-playground', // Base directory
    remote: 'origin',
    branch: 'main'
  },
  timeout: 30000
});
```

---

## 8. Security Considerations

### SEC-1: Git Worktree Isolation

- Each worker agent operates in isolated worktree
- No file system conflicts between agents
- Failed tasks preserve worktree for debugging

### SEC-2: Shadow Repository Access

- Shadow agents require separate remote repository credentials
- Shadow repos have read-only access for non-shadow agents
- Shadow commits signed with shadow agent identity

### SEC-3: Event Authentication

- All events published through authenticated KĀDI broker
- Event source verified via broker authentication
- Shadow agents verify file operation events match expected worker

---

## 9. Testing Strategy

### Test Scenarios

**TS-1: End-to-End Task Orchestration**
1. User submits request via Slack
2. agent-producer creates spec and tasks
3. Tasks assigned to worker agents via events
4. Workers create own worktrees
5. Workers execute tasks and publish file events
6. Shadow agents commit every file operation
7. Workers publish completion events
8. agent-producer requests user verification
9. User approves
10. agent-producer pushes from base playground
11. Workers cleanup their worktrees

**TS-2: Shadow Agent Versioning**
1. Worker creates file → Shadow commits + pushes
2. Worker modifies file → Shadow commits + pushes
3. Worker removes file → Shadow commits + pushes
4. Worker moves file → Shadow commits + pushes
5. Verify shadow repo has complete history

**TS-3: Event-Based Monitoring**
1. Worker completes task → Publishes completion event
2. agent-producer receives event (NO polling)
3. Verify latency < 1 second

**TS-4: Failure Recovery**
1. Worker task fails → Publishes failure event
2. Worker preserves worktree
3. agent-producer notifies user
4. User can inspect worktree for debugging

---

## 10. Acceptance Criteria

**AC-1:** agent-producer MUST use event subscription (NOT polling) for task monitoring
**AC-2:** Worker agents MUST create and manage their OWN git worktrees
**AC-3:** Shadow agents MUST commit and push EVERY file operation to separate remote repos
**AC-4:** agent-producer MUST push from base playground directory (NOT from worktrees)
**AC-5:** Network names MUST be: artist, design, programmer (NOT development)
**AC-6:** MCP server path MUST be: C:\GitHub\mcp-shrimp-task-manager
**AC-7:** User verification MUST occur before git push
**AC-8:** Worker agents MUST publish file operation events for shadow monitoring
**AC-9:** Shadow agents MUST have dedicated remote repositories

---

## 11. Dependencies

- **mcp-shrimp-task-manager** at `C:\GitHub\mcp-shrimp-task-manager`
- **mcp-server-git** for worktree and push operations
- **mcp-client-slack** for Slack event listening
- **mcp-client-discord** for Discord event listening
- **KĀDI broker** for event-driven communication
- **agent-producer** with existing slack-bot.ts and discord-bot.ts
- **@agents/shared** BaseBot for worker and shadow agents

---

## 12. Open Questions

1. What are the GitHub repository URLs for the three shadow remote repos?
2. Should shadow agents require separate credentials or share with main repo?
3. What is the retention policy for shadow repositories (how long to keep history)?
4. Should there be a maximum file operation rate to prevent shadow agent overload?

---

**END OF REQUIREMENTS**
