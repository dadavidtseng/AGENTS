#!/usr/bin/env python3
"""
Generate design.md for simple-multi-agents-orchestration spec
Uses absolute Windows paths to avoid file modification bugs
"""

output_path = r'C:\p4\Personal\SD\AGENTS\.spec-workflow\specs\simple-multi-agents-orchestration\design.md'

content = '''# Design Document: Simple Multi-Agent Orchestration

**Spec Name:** `simple-multi-agents-orchestration`
**Created:** 2025-11-30
**Status:** Draft - Pending Approval

---

## Overview

This design document specifies the technical architecture for an intelligent multi-agent orchestration system where **agent-producer** coordinates three specialized worker agents (agent-artist, agent-designer, agent-programmer) with shadow agents for version control and rollback capability.

**Key Design Principles:**
- Event-driven architecture via KĀDI broker for decoupled agent communication
- Multi-channel user input support with channel-specific interaction patterns
- Git worktree isolation for concurrent task execution
- Shadow agent pattern for continuous versioning and rollback capability
- BaseBot inheritance for resilience patterns (circuit breaker, retry logic)

---

## Steering Document Alignment

### Technical Standards (tech.md)

*Note: Steering documents not yet created. This section will be populated once steering documents are established.*

**Expected Alignment:**
- TypeScript for all agent implementations
- KĀDI broker for event-driven communication
- MCP (Model Context Protocol) for tool integration
- Zod for schema validation

### Project Structure (structure.md)

*Note: Steering documents not yet created. This section will be populated once steering documents are established.*

**Expected Structure:**
```
AGENTS/
├── agent-producer/          # Orchestrator agent
├── agent-artist/            # Worker agent (art/design)
├── agent-designer/          # Worker agent (documentation)
├── agent-programmer/        # Worker agent (code)
├── shadow-agent-artist/     # Shadow monitor for artist
├── shadow-agent-designer/   # Shadow monitor for designer
├── shadow-agent-programmer/ # Shadow monitor for programmer
└── shared/                  # Shared utilities (BaseBot)
```

---

## Code Reuse Analysis

### Existing Components to Leverage

1. **BaseBot (shared/base-bot.ts)**
   - **Purpose**: Abstract base class providing resilience patterns
   - **Reuse**: Worker agents and shadow agents will extend BaseBot
   - **Features**:
     - Circuit breaker (opens after 5 failures, resets after 60s)
     - Exponential backoff retry (1s, 2s, 4s up to 3 attempts)
     - Metrics tracking (total requests, success/timeout counts)
     - Tool invocation with fault tolerance (`invokeToolWithRetry`)

2. **KadiClient (@kadi.build/core)**
   - **Purpose**: KĀDI broker communication client
   - **Reuse**: All agents use KadiClient for event pub/sub and tool invocation
   - **Features**:
     - Event subscription (`subscribeToEvent`)
     - Event publishing (`publishEvent`)
     - Tool invocation via broker (`protocol.invokeTool`)
     - Network isolation support

3. **SlackBot and DiscordBot (agent-producer/src/bot/)**
   - **Purpose**: Existing bot integrations extending BaseBot
   - **Reuse**: agent-producer already has these; no duplication needed
   - **Features**:
     - Event subscription for mentions
     - Anthropic Claude integration
     - Message formatting and response handling

### Integration Points

1. **mcp-shrimp-task-manager (C:\\GitHub\\mcp-shrimp-task-manager)**
   - **Integration**: agent-producer calls via broker protocol
   - **Tools Used**:
     - `shrimp__plan_task` - Create project specifications
     - `shrimp__analyze_task` - Analyze complexity and scope
     - `shrimp__split_tasks` - Break into atomic tasks
     - `shrimp__list_tasks` - Query task status
     - `shrimp__log_implementation` - Record task completion
   - **Access Pattern**: `protocol.invokeTool({ targetAgent: 'mcp-shrimp-task-manager', toolName: 'shrimp__plan_task', ... })`

2. **mcp-server-git**
   - **Integration**: All agents use for git worktree management
   - **Tools Used**:
     - `git__worktree` (mode: 'add', 'remove', 'list')
     - `git__push` (for agent-producer GitHub push)
     - `git__commit` (for shadow agents)
   - **Access Pattern**: `protocol.invokeTool({ targetAgent: 'mcp-server-git', toolName: 'git__worktree', ... })`

3. **mcp-client-slack and mcp-client-discord**
   - **Integration**: Publish events that agent-producer subscribes to
   - **Event Topics**:
     - `slack.app_mention.{botUserId}` - Slack mentions
     - `discord.mention.{botUserId}` - Discord mentions
   - **Data Flow**: MCP client → KĀDI broker (event) → agent-producer (subscriber)

4. **KĀDI Broker**
   - **Integration**: Central message bus for all agent communication
   - **Configuration**: `kadi-broker/config/mcp-upstreams.json`
   - **Networks**: global, artist, design, programmer, git, slack, discord

---

## Architecture

### High-Level System Architecture

```mermaid
graph TB
    subgraph "User Channels"
        U1[Slack User]
        U2[Discord User]
        U3[Claude Code User]
        U4[Claude Desktop User]
    end

    subgraph "Input Layer"
        MCP_SLACK[mcp-client-slack]
        MCP_DISCORD[mcp-client-discord]
        PRODUCER_TOOLS[agent-producer<br/>MCP Tools]
    end

    subgraph "KĀDI Broker"
        BROKER[kadi-broker<br/>Event Bus + Tool Router]
    end

    subgraph "Orchestrator"
        PRODUCER[agent-producer<br/>Orchestration Logic]
    end

    subgraph "Task Management"
        SHRIMP[mcp-shrimp-task-manager<br/>Task Planning & Tracking]
    end

    subgraph "Worker Agents"
        ARTIST[agent-artist<br/>extends BaseBot]
        DESIGNER[agent-designer<br/>extends BaseBot]
        PROGRAMMER[agent-programmer<br/>extends BaseBot]
    end

    subgraph "Shadow Agents"
        S_ARTIST[shadow-agent-artist<br/>extends BaseBot]
        S_DESIGNER[shadow-agent-designer<br/>extends BaseBot]
        S_PROGRAMMER[shadow-agent-programmer<br/>extends BaseBot]
    end

    subgraph "Version Control"
        GIT_MAIN[Main Repo<br/>agent-playground]
        GIT_SHADOW_A[Shadow Repo<br/>artist]
        GIT_SHADOW_D[Shadow Repo<br/>designer]
        GIT_SHADOW_P[Shadow Repo<br/>programmer]
    end

    %% User to Input Layer
    U1 -->|@mention| MCP_SLACK
    U2 -->|@mention| MCP_DISCORD
    U3 -->|tool call| PRODUCER_TOOLS
    U4 -->|tool call| PRODUCER_TOOLS

    %% Input Layer to Broker
    MCP_SLACK -->|publish event| BROKER
    MCP_DISCORD -->|publish event| BROKER
    PRODUCER_TOOLS -->|register tools| BROKER

    %% Broker to Orchestrator
    BROKER <-->|events + tools| PRODUCER

    %% Orchestrator to Task Manager
    PRODUCER -->|tool invocation| SHRIMP

    %% Orchestrator to Workers
    PRODUCER -->|task events| ARTIST
    PRODUCER -->|task events| DESIGNER
    PRODUCER -->|task events| PROGRAMMER

    %% Workers to Shadows
    ARTIST -->|file events| S_ARTIST
    DESIGNER -->|file events| S_DESIGNER
    PROGRAMMER -->|file events| S_PROGRAMMER

    %% Version Control
    PRODUCER -->|git push| GIT_MAIN
    S_ARTIST -->|git push| GIT_SHADOW_A
    S_DESIGNER -->|git push| GIT_SHADOW_D
    S_PROGRAMMER -->|git push| GIT_SHADOW_P

    style BROKER fill:#e3f2fd
    style PRODUCER fill:#fff9c4
    style SHRIMP fill:#f3e5f5
    style ARTIST fill:#c8e6c9
    style DESIGNER fill:#c8e6c9
    style PROGRAMMER fill:#c8e6c9
```

### Modular Design Principles

1. **Single File Responsibility**
   - Each agent has clear orchestration/execution/monitoring role
   - Separation of concerns: producer (orchestration), workers (execution), shadows (versioning)

2. **Component Isolation**
   - Workers operate in isolated git worktrees (no file conflicts)
   - Shadow agents operate independently (passive monitoring)
   - Network isolation via KĀDI broker networks

3. **Service Layer Separation**
   - **Presentation Layer**: SlackBot/DiscordBot/MCP Tools (user interaction)
   - **Orchestration Layer**: agent-producer (workflow coordination)
   - **Execution Layer**: Worker agents (task implementation)
   - **Persistence Layer**: Shadow agents (version control)

4. **Utility Modularity**
   - BaseBot provides reusable resilience utilities
   - KadiClient provides reusable communication utilities
   - Shared types and interfaces in shared/ directory

---

## Channel-Specific Interaction Patterns

### Pattern 1: Event-Driven Channels (Slack/Discord)

**Architecture:**
```
User @mention → mcp-client-slack/discord → KĀDI broker (publish event)
→ agent-producer (subscribe event) → Process request → Respond to channel
```

**Interaction Flow:**

1. **User Input**
   - User sends `@bot Can you create a spinning cube app?` in Slack/Discord
   - Platform-specific bot API captures mention

2. **Event Publishing (by MCP clients)**
   - `mcp-client-slack` publishes event:
     ```json
     {
       "topic": "slack.app_mention.U12345",
       "data": {
         "channel": "C98765",
         "user": "U54321",
         "text": "Can you create a spinning cube app?",
         "ts": "1234567890.123456"
       }
     }
     ```

3. **Event Subscription (by agent-producer)**
   - agent-producer subscribes to `slack.app_mention.{botUserId}`
   - Receives event through KĀDI broker
   - Extracts user request from event data

4. **Acknowledgment**
   - agent-producer calls mcp-client-slack tool to send acknowledgment:
     ```typescript
     await protocol.invokeTool({
       targetAgent: 'mcp-client-slack',
       toolName: 'slack__post_message',
       toolInput: {
         channel: event.data.channel,
         text: 'Got it! Planning your spinning cube project. This should take 1-2 minutes...'
       }
     });
     ```

5. **Progress Updates**
   - Periodic status updates sent to same channel via mcp-client-slack/discord tools
   - User sees real-time progress in their conversation thread

6. **Completion Notification**
   - Final message with results and approval request:
     ```
     All 5 tasks completed! Please review the changes:
     - Task 1: Design doc created (24 lines added)
     - Task 2: 3D model (cube.obj, 156KB)
     ...
     Reply 'approve' to merge to main branch.
     ```

**Key Characteristics:**
- **Asynchronous**: Fire-and-forget event pattern
- **Conversational**: Multi-turn dialogue in chat interface
- **Contextual**: Thread-based conversation history
- **Notification-based**: Proactive status updates

---

### Pattern 2: Tool-Based Channels (Claude Code/Desktop)

**Architecture:**
```
User tool call → Claude client → KĀDI broker (tool invocation)
→ agent-producer MCP server → Process request → Return result
```

**Interaction Flow:**

1. **User Input**
   - User calls tool from Claude Code/Desktop:
     ```
     User: "Can you create a spinning cube app?"
     Claude: [Calls plan_task tool]
     ```

2. **Tool Registration (by agent-producer)**
   - agent-producer registers as MCP upstream with broker:
     ```json
     {
       "id": "agent-producer",
       "type": "stdio",
       "prefix": "producer",
       "tools": [
         { "name": "plan_task", "description": "..." },
         { "name": "list_active_tasks", "description": "..." },
         { "name": "get_task_status", "description": "..." },
         { "name": "approve_completion", "description": "..." }
       ]
     }
     ```

3. **Tool Invocation**
   - Claude client sends tool invocation to broker:
     ```json
     {
       "tool": "producer__plan_task",
       "input": {
         "description": "Create a spinning cube app with color animation"
       }
     }
     ```

4. **Synchronous Processing**
   - agent-producer receives tool call
   - Processes request (calls mcp-shrimp-task-manager, etc.)
   - Returns structured result:
     ```json
     {
       "specName": "spinning-cube-app",
       "taskCount": 5,
       "tasks": [
         { "id": "task-001", "description": "Design document", "assignedTo": "agent-designer" },
         ...
       ],
       "estimatedDuration": "2-3 hours",
       "status": "tasks_created"
     }
     ```

5. **User Review**
   - Claude displays structured result to user
   - User can call additional tools:
     - `list_active_tasks()` - See current progress
     - `get_task_status(taskId)` - Check specific task
     - `approve_completion()` - Approve completed work

6. **Completion Workflow**
   - User calls `approve_completion()` tool
   - agent-producer performs git push and cleanup
   - Returns confirmation:
     ```json
     {
       "status": "approved_and_merged",
       "branch": "main",
       "commitHash": "abc123def",
       "message": "All changes merged to main branch"
     }
     ```

**Key Characteristics:**
- **Synchronous**: Request-response pattern with immediate results
- **Structured**: JSON-based tool inputs/outputs
- **Transactional**: Each tool call is independent
- **Stateless**: Tool calls don't maintain conversation state

---

### Comparison Matrix

| Aspect | Slack/Discord (Event-Driven) | Claude Code/Desktop (Tool-Based) |
|--------|------------------------------|----------------------------------|
| **Communication** | Asynchronous events | Synchronous tool calls |
| **User Experience** | Conversational chat | Structured tool interface |
| **Progress Updates** | Proactive push notifications | User polls via tools |
| **State Management** | Conversation thread context | Stateless transactions |
| **Response Format** | Natural language messages | Structured JSON |
| **Approval Method** | Reply "approve" in chat | Call `approve_completion()` tool |
| **Multi-turn Interaction** | Native (thread-based) | Explicit (multiple tool calls) |
| **Error Handling** | Informative chat messages | JSON error objects |

---

## Components and Interfaces

### Component 1: agent-producer (Orchestrator)

**Purpose:** Central orchestrator coordinating all agents and managing workflow

**Implementation:**
- **File**: `agent-producer/src/index.ts` (existing structure)
- **Dependencies**: KadiClient, existing SlackBot/DiscordBot
- **Does NOT extend**: BaseBot (already has bot integrations)

**Interfaces (MCP Tools for Claude Code/Desktop):**

```typescript
interface ProducerTools {
  /**
   * Initiate task planning from user request
   * Similar to mcp-shrimp-task-manager's plan_task
   */
  plan_task(input: {
    description: string;
  }): Promise<{
    specName: string;
    taskCount: number;
    tasks: Array<{ id: string; description: string; assignedTo: string }>;
    estimatedDuration: string;
    status: string;
  }>;

  /**
   * Show currently active tasks across all worker agents
   */
  list_active_tasks(): Promise<{
    tasks: Array<{
      taskId: string;
      description: string;
      assignedTo: string;
      status: 'pending' | 'in_progress' | 'completed';
      progress: number;
    }>;
  }>;

  /**
   * Get detailed status of specific task
   */
  get_task_status(input: {
    taskId: string;
  }): Promise<{
    taskId: string;
    description: string;
    assignedTo: string;
    status: string;
    startedAt?: string;
    completedAt?: string;
    filesModified?: string[];
    filesCreated?: string[];
  }>;

  /**
   * User approval for merging completed work
   */
  approve_completion(): Promise<{
    status: 'approved_and_merged' | 'no_pending_work' | 'already_approved';
    branch?: string;
    commitHash?: string;
    message: string;
  }>;
}
```

**Event Subscriptions:**
- `slack.app_mention.{botUserId}` - Slack user mentions
- `discord.mention.{botUserId}` - Discord user mentions
- `agents.agent-artist.tasks.completed` - Artist completion
- `agents.agent-designer.tasks.completed` - Designer completion
- `agents.agent-programmer.tasks.completed` - Programmer completion
- `agents.agent-artist.tasks.failed` - Artist failures
- `agents.agent-designer.tasks.failed` - Designer failures
- `agents.agent-programmer.tasks.failed` - Programmer failures

**Event Publications:**
- `agents.agent-artist.tasks.assign` - Task assignments for artist
- `agents.agent-designer.tasks.assign` - Task assignments for designer
- `agents.agent-programmer.tasks.assign` - Task assignments for programmer
- `agents.agent-artist.tasks.cleanup` - Cleanup requests for artist
- `agents.agent-designer.tasks.cleanup` - Cleanup requests for designer
- `agents.agent-programmer.tasks.cleanup` - Cleanup requests for programmer

**Dependencies:**
- mcp-shrimp-task-manager (via broker)
- mcp-server-git (via broker)
- mcp-client-slack (via broker)
- mcp-client-discord (via broker)

**Reuses:**
- KadiClient for broker communication
- Existing SlackBot and DiscordBot (already extend BaseBot)

---

### Component 2: Worker Agents (agent-artist, agent-designer, agent-programmer)

**Purpose:** Execute assigned tasks in isolated git worktrees

**Implementation:**
- **Files**:
  - `agent-artist/src/index.ts`
  - `agent-designer/src/index.ts`
  - `agent-programmer/src/index.ts`
- **Extends**: BaseBot (for resilience patterns)
- **Networks**:
  - agent-artist: `['global', 'artist']`
  - agent-designer: `['global', 'design']`
  - agent-programmer: `['global', 'programmer']`

**Interfaces (Internal):**

```typescript
interface WorkerAgent extends BaseBot {
  /**
   * Handle task assignment event
   */
  handleTaskAssignment(event: {
    taskId: string;
    description: string;
    basePlayground: string;
    baseBranch: string;
    assignedAt: string;
  }): Promise<void>;

  /**
   * Handle cleanup event
   */
  handleCleanup(event: {
    taskId: string;
  }): Promise<void>;

  /**
   * Create own git worktree
   */
  createWorktree(params: {
    basePath: string;
    worktreePath: string;
    branch: string;
    commitish: string;
  }): Promise<void>;

  /**
   * Remove own git worktree
   */
  removeWorktree(params: {
    basePath: string;
    worktreePath: string;
  }): Promise<void>;

  /**
   * Execute task in isolated workspace
   */
  executeTask(params: {
    taskId: string;
    description: string;
    worktreePath: string;
  }): Promise<{
    success: boolean;
    filesModified: string[];
    filesCreated: string[];
    artifacts: any;
  }>;
}
```

**Event Subscriptions:**
- `agents.{self-agentId}.tasks.assign` - Task assignments
- `agents.{self-agentId}.tasks.cleanup` - Cleanup requests

**Event Publications:**
- `agents.{self-agentId}.tasks.completed` - Task completion
- `agents.{self-agentId}.tasks.failed` - Task failure
- `agents.{self-agentId}.file.created` - File creation
- `agents.{self-agentId}.file.modified` - File modification
- `agents.{self-agentId}.file.removed` - File removal
- `agents.{self-agentId}.file.moved` - File move

**Dependencies:**
- mcp-server-git (via broker with retry via BaseBot)
- mcp-shrimp-task-manager (via broker with retry via BaseBot)

**Reuses:**
- BaseBot.invokeToolWithRetry() for fault-tolerant tool calls
- BaseBot.checkCircuitBreaker() for failure detection
- BaseBot metrics tracking

---

### Component 3: Shadow Agents (shadow-agent-artist, shadow-agent-designer, shadow-agent-programmer)

**Purpose:** Monitor worker agents and commit/push every file operation to separate remote repositories for rollback capability

**Implementation:**
- **Files**:
  - `shadow-agent-artist/src/index.ts`
  - `shadow-agent-designer/src/index.ts`
  - `shadow-agent-programmer/src/index.ts`
- **Extends**: BaseBot (for resilience patterns)
- **Networks**:
  - shadow-agent-artist: `['global', 'artist']`
  - shadow-agent-designer: `['global', 'design']`
  - shadow-agent-programmer: `['global', 'programmer']`

**Interfaces (Internal):**

```typescript
interface ShadowAgent extends BaseBot {
  /**
   * Handle file operation event from worker agent
   */
  handleFileOperation(event: {
    operationType: 'created' | 'modified' | 'removed' | 'moved';
    filePath: string;
    oldPath?: string; // For move operations
    taskId: string;
    timestamp: string;
  }): Promise<void>;

  /**
   * Commit and push file change to shadow repository
   */
  commitAndPush(params: {
    operationType: string;
    filePath: string;
    taskId: string;
  }): Promise<{
    commitHash: string;
    pushed: boolean;
  }>;

  /**
   * Get shadow repository remote URL
   */
  getShadowRemote(): string;
}
```

**Event Subscriptions:**
- `agents.{monitored-worker}.file.created`
- `agents.{monitored-worker}.file.modified`
- `agents.{monitored-worker}.file.removed`
- `agents.{monitored-worker}.file.moved`

**Event Publications:**
- `agents.{self-agentId}.commits.pushed` - After pushing to shadow repo

**Dependencies:**
- mcp-server-git (via broker with retry via BaseBot)

**Reuses:**
- BaseBot.invokeToolWithRetry() for git operations
- BaseBot.checkCircuitBreaker() for failure detection

**Shadow Repository Configuration:**
```
shadow-agent-artist:
  - Local: C:\\p4\\Personal\\SD\\agent-playground-artist (shares with worker)
  - Remote: github.com/user/project-shadow-artist

shadow-agent-designer:
  - Local: C:\\p4\\Personal\\SD\\agent-playground-designer (shares with worker)
  - Remote: github.com/user/project-shadow-designer

shadow-agent-programmer:
  - Local: C:\\p4\\Personal\\SD\\agent-playground-programmer (shares with worker)
  - Remote: github.com/user/project-shadow-programmer
```

---

## Data Models

### TaskAssignmentEvent

```typescript
interface TaskAssignmentEvent {
  taskId: string;              // Unique task identifier (e.g., "task-001")
  description: string;         // Task description from mcp-shrimp-task-manager
  basePlayground: string;      // Base git directory (e.g., "C:\\p4\\Personal\\SD\\agent-playground")
  baseBranch: string;          // Branch to base worktree on (e.g., "main")
  assignedAt: string;          // ISO 8601 timestamp
  requiredCapabilities?: string[]; // Skills needed (optional)
  estimatedDuration?: string;  // Estimated time (optional)
}
```

### TaskCompletionEvent

```typescript
interface TaskCompletionEvent {
  taskId: string;              // Task identifier
  success: boolean;            // Whether task completed successfully
  completedAt: string;         // ISO 8601 timestamp
  artifacts: {
    apiEndpoints?: Array<{
      method: string;
      path: string;
      purpose: string;
      location: string;
    }>;
    components?: Array<{
      name: string;
      type: string;
      purpose: string;
      location: string;
    }>;
    functions?: Array<{
      name: string;
      signature: string;
      location: string;
    }>;
  };
  filesModified: string[];     // Paths of modified files
  filesCreated: string[];      // Paths of created files
}
```

### FileOperationEvent

```typescript
interface FileOperationEvent {
  operationType: 'created' | 'modified' | 'removed' | 'moved';
  filePath: string;            // Current file path
  oldPath?: string;            // Previous path (for move operations)
  taskId: string;              // Associated task
  timestamp: string;           // ISO 8601 timestamp
  agentId: string;             // Worker agent that performed operation
}
```

### CleanupEvent

```typescript
interface CleanupEvent {
  taskId: string;              // Task identifier
  worktreePath: string;        // Path to worktree to remove
  cleanupReason: 'completed' | 'failed' | 'user_cancelled';
  timestamp: string;           // ISO 8601 timestamp
}
```

### ProducerState (Internal)

```typescript
interface ProducerState {
  activeWorkflows: Map<string, {
    specName: string;
    tasks: Array<{
      taskId: string;
      assignedTo: string;
      status: 'pending' | 'in_progress' | 'completed' | 'failed';
    }>;
    pendingUserApproval: boolean;
    createdAt: string;
  }>;
  channelContexts: Map<string, {
    channelType: 'slack' | 'discord' | 'claude-code' | 'claude-desktop';
    channelId: string;
    userId: string;
    lastInteraction: string;
  }>;
}
```

---

## Error Handling

### Error Scenarios

#### Scenario 1: Worker Agent Failure During Task Execution

**Description:** Worker agent encounters unhandled exception or crashes during task execution

**Handling:**
1. Worker agent's circuit breaker opens after 5 consecutive failures
2. Worker publishes `agents.{agentId}.tasks.failed` event
3. agent-producer receives failure event
4. agent-producer logs failure to mcp-shrimp-task-manager
5. agent-producer attempts reassignment:
   - If < 3 retries: reassigns to same agent after circuit breaker reset (60s)
   - If >= 3 retries: marks task as failed, notifies user

**User Impact:**
- **Slack/Discord**: Receives error message: "Task task-001 failed after 3 attempts. Please review error logs."
- **Claude Code/Desktop**: `get_task_status(taskId)` returns status: "failed" with error details

#### Scenario 2: Git Worktree Creation Conflict

**Description:** Worker agent attempts to create worktree but path already exists

**Handling:**
1. Worker calls `git__worktree` with mode 'add'
2. Git returns error: "worktree already exists"
3. Worker's retry logic attempts 3 times with exponential backoff
4. If still failing after retries:
   - Worker attempts cleanup: `git__worktree` mode 'remove' with force=true
   - Retries creation after cleanup
5. If cleanup fails: publishes task failure event

**User Impact:**
- Usually transparent (automatic recovery)
- If persistent: "Could not allocate workspace for task. Manual cleanup required at C:\\p4\\Personal\\SD\\agent-playground-artist"

#### Scenario 3: Shadow Agent Push Failure

**Description:** Shadow agent cannot push to remote repository (network/auth issues)

**Handling:**
1. Shadow agent calls `git__push` via BaseBot.invokeToolWithRetry()
2. Retry logic attempts 3 times (1s, 2s, 4s delays)
3. If all retries fail:
   - Shadow agent logs error locally
   - Publishes `agents.{shadow-agentId}.push.failed` event
   - Continues monitoring (doesn't block worker agent)
4. Queues failed push for later retry (exponential backoff up to 10 minutes)

**User Impact:**
- Worker agent continues uninterrupted (shadow failure doesn't block)
- Rollback capability temporarily degraded
- User notified: "Shadow versioning temporarily unavailable for agent-artist. Work continues but rollback limited."

#### Scenario 4: User Approves Empty Completion

**Description:** User calls `approve_completion()` when no tasks are completed

**Handling:**
1. agent-producer checks ProducerState.activeWorkflows
2. Finds no workflows with pendingUserApproval=true
3. Returns structured response:
   ```json
   {
     "status": "no_pending_work",
     "message": "No completed tasks pending approval"
   }
   ```

**User Impact:**
- **Claude Code/Desktop**: Receives clear JSON response
- **Slack/Discord**: Receives message: "No completed tasks to approve. Current active tasks: 3 in progress."

#### Scenario 5: MCP Upstream Server Unavailable

**Description:** mcp-shrimp-task-manager or mcp-server-git is not responding

**Handling:**
1. agent-producer/worker calls tool via protocol.invokeTool()
2. BaseBot.invokeToolWithRetry() handles failure:
   - Attempts 3 retries with exponential backoff
   - Circuit breaker opens after 5 consecutive failures
3. If circuit open: returns error immediately without retry
4. If max retries exceeded: throws error with context

**User Impact:**
- **Slack/Discord**: "Task planning service temporarily unavailable. Please try again in 1 minute."
- **Claude Code/Desktop**: Tool call returns error object:
  ```json
  {
    "error": "Service unavailable",
    "retryAfter": 60,
    "message": "mcp-shrimp-task-manager not responding"
  }
  ```

#### Scenario 6: Invalid Task Assignment (Worker Capacity)

**Description:** agent-producer assigns task to worker already processing maximum tasks

**Handling:**
1. Worker maintains internal task queue (max 3 concurrent tasks)
2. If queue full: worker publishes `agents.{agentId}.capacity.exceeded` event
3. agent-producer receives capacity event
4. agent-producer queues task for later assignment
5. Retries assignment when worker publishes completion event

**User Impact:**
- Transparent queue management
- Slightly delayed task start: "Task queued for agent-artist (currently processing 3/3 tasks)"

---

## Testing Strategy

### Unit Testing

**BaseBot Resilience Patterns:**
- Circuit breaker behavior (open after 5 failures, reset after 60s)
- Retry logic with exponential backoff (1s, 2s, 4s)
- Metrics tracking accuracy

**Worker Agent Worktree Management:**
- Git worktree creation via mcp-server-git
- Git worktree cleanup after completion
- Conflict resolution when path already exists

**Shadow Agent Monitoring:**
- File event subscription and handling
- Git commit creation with correct messages
- Git push to shadow remote repositories

**agent-producer MCP Tools:**
- `plan_task` input validation and workflow initiation
- `list_active_tasks` state querying
- `get_task_status` task lookup
- `approve_completion` workflow validation and git push

### Integration Testing

**End-to-End Workflow (Event-Driven Channel):**
1. Simulate Slack mention event via mcp-client-slack
2. Verify agent-producer receives and processes event
3. Verify task planning via mcp-shrimp-task-manager
4. Verify task assignment events published
5. Verify worker agent receives and creates worktree
6. Verify worker agent executes task and publishes completion
7. Verify shadow agent monitors and commits changes
8. Verify agent-producer requests user approval via Slack
9. Verify git push to main repo after approval
10. Verify cleanup events and worktree removal

**End-to-End Workflow (Tool-Based Channel):**
1. Simulate `plan_task` tool call from Claude Code
2. Verify agent-producer processes and returns structured result
3. Verify task planning and assignment
4. Poll `list_active_tasks` during execution
5. Call `get_task_status` for specific task
6. Call `approve_completion` after all tasks done
7. Verify git push and cleanup

**Failure Recovery:**
- Worker agent crash during task execution → reassignment
- Git push failure → retry logic and circuit breaker
- Shadow agent unavailable → worker continues uninterrupted

### End-to-End Testing

**Scenario 1: Multi-Agent Collaboration (Slack)**
- User requests: "Create a todo app with React frontend and Express backend"
- Verify task distribution: agent-designer (docs), agent-programmer (backend), agent-artist (UI assets)
- Verify concurrent execution in separate worktrees
- Verify shadow agents track all changes independently
- Verify user approval flow in Slack
- Verify main repo merge and cleanup

**Scenario 2: Real-Time Progress Monitoring (Claude Code)**
- User calls `plan_task` with complex request
- Poll `list_active_tasks` every 10 seconds
- Verify progress updates reflect actual task execution
- Call `get_task_status` for detailed info
- Approve with `approve_completion` tool
- Verify structured responses throughout

**Scenario 3: Rollback After User Rejection**
- Complete tasks across multiple workers
- Shadow agents version all changes
- User rejects changes (simulated)
- Verify main repo unchanged
- Verify shadow repos contain complete history
- Verify ability to cherry-pick changes from shadow repos

**Scenario 4: Concurrent Multi-User Requests**
- Multiple users submit requests via different channels simultaneously
- Verify agent-producer maintains separate workflow contexts
- Verify no cross-contamination between workflows
- Verify correct channel routing for responses

---

## Implementation Notes

### MCP Upstream Registration for agent-producer

**Location:** `kadi-broker/config/mcp-upstreams.json`

**Configuration:**
```json
{
  "upstreams": [
    {
      "id": "agent-producer",
      "name": "agent-producer",
      "description": "Multi-agent orchestration with task planning and approval workflow",
      "type": "stdio",
      "prefix": "producer",
      "enabled": true,
      "stdio": {
        "command": "node",
        "args": ["C:\\\\p4\\\\Personal\\\\SD\\\\AGENTS\\\\agent-producer\\\\dist\\\\index.js"],
        "env": {
          "NODE_ENV": "production",
          "ENABLE_MCP_TOOLS": "true"
        }
      },
      "networks": ["global"],
      "retryPolicy": {
        "maxAttempts": 3,
        "initialBackoffMs": 1000,
        "maxBackoffMs": 10000,
        "backoffMultiplier": 2
      }
    }
  ]
}
```

### Git Worktree Paths

**Base Directory:** `C:\\p4\\Personal\\SD\\agent-playground`

**Worker Worktrees (created by workers):**
- `C:\\p4\\Personal\\SD\\agent-playground-artist`
- `C:\\p4\\Personal\\SD\\agent-playground-designer`
- `C:\\p4\\Personal\\SD\\agent-playground-programmer`

**Git Remote Repositories:**
- **Main repo**: agent-producer pushes after user approval
- **Shadow repos**: 3 separate repositories (one per shadow agent)
  - `github.com/user/project-shadow-artist`
  - `github.com/user/project-shadow-designer`
  - `github.com/user/project-shadow-programmer`

### Network Assignments

| Agent | Networks | Purpose |
|-------|----------|---------|
| agent-producer | global, git, slack, discord | Access to all services |
| agent-artist | global, artist | Isolated artist domain |
| agent-designer | global, design | Isolated design domain |
| agent-programmer | global, programmer | Isolated programmer domain |
| shadow-agent-artist | global, artist | Monitor artist |
| shadow-agent-designer | global, design | Monitor designer |
| shadow-agent-programmer | global, programmer | Monitor programmer |
| mcp-shrimp-task-manager | global | Task management |
| mcp-server-git | global, git | Git operations |
| mcp-client-slack | global, slack | Slack integration |
| mcp-client-discord | global, discord | Discord integration |

---

## Performance Considerations

1. **Concurrent Task Execution**
   - Git worktrees enable true parallel execution
   - No file conflicts between workers
   - Shadow agents operate asynchronously (no blocking)

2. **Event vs Tool Performance**
   - Event-driven (Slack/Discord): Lower latency, higher throughput
   - Tool-based (Claude Code/Desktop): Synchronous, user-initiated

3. **Circuit Breaker Benefits**
   - Prevents cascade failures
   - Fast-fail when services unavailable
   - Automatic recovery after cooldown

4. **Shadow Agent Overhead**
   - Minimal impact on worker performance (async commits)
   - Network bandwidth for git push to shadow remotes
   - Storage for duplicate repositories (worth it for rollback capability)

'''

# Write the file
with open(output_path, 'w', encoding='utf-8') as f:
    f.write(content)

print("[SUCCESS] Created comprehensive design.md")
print(f"Location: {output_path}")
print("")
print("Design Document Features:")
print("  - Channel-specific interaction patterns (Event-Driven vs Tool-Based)")
print("  - Detailed architecture with mermaid diagrams")
print("  - Component interfaces and data models")
print("  - Comprehensive error handling scenarios")
print("  - Testing strategy for all integration points")
print("  - Implementation notes with configuration examples")
