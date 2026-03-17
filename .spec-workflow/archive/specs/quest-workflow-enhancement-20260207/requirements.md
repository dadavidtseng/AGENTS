# Requirements Document

## Introduction

The Quest Workflow Enhancement integrates agent-producer, worker agents (agent-artist, agent-designer, agent-programmer), shadow agents, mcp-server-quest, and mcp-server-git into a cohesive multi-agent orchestration system. This enhancement enables Discord-driven quest creation, task management, automated task execution by specialized agents, and git operations through KĀDI event-driven architecture.

**Purpose**: Enable human users to create quests via Discord bot, have AI agents automatically break down and execute tasks, with real-time monitoring and git integration.

**Value**: Streamlines the development workflow by automating task decomposition, assignment, execution, and version control through natural language commands in Discord.

## Reference Projects

Implementation SHALL reference the following codebases for patterns, architecture, and integration:

### Core References
- **C:\GitHub-Reference\mcp-shrimp-task-manager** - Four-step task generation workflow (plan → analyze → reflect → split)
- **C:\GitHub-Reference\servers** - MCP server implementations and patterns
- **C:\GitHub-Reference\spec-workflow-mcp** - Specification workflow management
- **C:\GitHub\ability-file-management** - File management capabilities

### Agent Projects
- **C:\GitHub\agent-artist** - Worker agent for creative tasks
- **C:\GitHub\agent-producer** - Orchestrator agent with Discord bot
- **C:\GitHub\agents-library** - Shared agent factories and utilities
- **C:\GitHub\shadow-agent-artist** - Shadow agent for backup and monitoring
- **C:\GitHub\template-agent-typescript** - Agent template and patterns

### Playground Projects
- **C:\GitHub\agent-playground** - Main repository for agent work
- **C:\GitHub\agent-playground-artist** - Artist agent worktree
- **C:\GitHub\shadow-agent-playground-artist** - Shadow agent worktree

### MCP Servers
- **C:\GitHub\mcp-server-quest** - Quest and task management server
- **C:\GitHub\mcp-server-git** - Git operations server
- **C:\GitHub\mcp-server-discord** - Discord integration server
- **C:\GitHub\mcp-client-discord** - Discord client implementation

## Alignment with Product Vision

This feature aligns with the KĀDI multi-agent ecosystem vision by:
- Enabling seamless collaboration between orchestrator (agent-producer) and worker agents
- Leveraging KĀDI broker for event-driven communication across agent networks
- Integrating mcp-server-quest for structured quest/task management
- Providing human-in-the-loop control through Discord bot interface
- Automating git operations for version control and deployment

## Requirements

### Requirement 1: Quest Creation via Discord

**User Story:** As a developer, I want to create a quest by describing my goal in Discord, so that the system can generate requirements and design documents automatically.

#### Acceptance Criteria

1. WHEN user sends message "I want to create a placeholder.txt at C:\GitHub\agent-playground-artist" to agent-producer Discord bot THEN agent-producer SHALL use its LLM provider service to generate requirements.md and design.md documents
2. WHEN requirements and design documents are generated THEN agent-producer SHALL call mcp-server-quest's `quest_create` tool via KĀDI broker with the generated documents
3. WHEN quest is created THEN mcp-server-quest SHALL store quest with status='pending_approval' and return questId
4. WHEN quest creation succeeds THEN agent-producer SHALL notify user via Discord with quest details and approval instructions

### Requirement 2: Quest Approval Workflow

**User Story:** As a developer, I want to approve quests through dashboard or Discord, so that I can review and control what gets implemented.

#### Acceptance Criteria

1. WHEN user approves quest in mcp-server-quest dashboard THEN user SHALL tell agent-producer "I approved quest {questName}" via Discord
2. WHEN user claims quest approval THEN agent-producer SHALL call `quest_get_status` tool via KĀDI broker to verify actual approval status
3. IF quest status is not 'approved' THEN agent-producer SHALL notify user "Quest is not approved in dashboard, please approve first"
4. WHEN user says "I approve quest {questName}" directly in Discord THEN agent-producer SHALL call `quest_submit_approval` tool via KĀDI broker to mark quest as approved
5. WHEN quest is verified as approved THEN agent-producer SHALL proceed to task creation phase

### Requirement 3: Task Generation and Planning (Four-Step Workflow)

**User Story:** As a developer, I want the system to automatically break down quests into executable tasks using a structured four-step workflow, so that task planning is thorough and well-analyzed.

#### Acceptance Criteria

1. **Step 1: Plan Task** - WHEN user says "Create tasks for quest {questName}" THEN agent-producer SHALL call `quest_plan_task` tool via KĀDI broker with questId and description
2. **Step 1: Plan Task** - WHEN `quest_plan_task` is called THEN mcp-server-quest SHALL return structured prompt containing quest requirements, design documents, existing task examples, task breakdown guidelines, and verification criteria templates (similar to mcp-shrimp-task-manager's planTask)
3. **Step 2: Analyze Task** - WHEN agent-producer receives plan prompt THEN agent-producer SHALL use its LLM provider service to analyze task requirements and call `quest_analyze_task` tool with summary and initialConcept
4. **Step 2: Analyze Task** - WHEN `quest_analyze_task` is called THEN mcp-server-quest SHALL return analysis guidance prompt for deeper technical analysis
5. **Step 3: Reflect Task** - WHEN agent-producer completes analysis THEN agent-producer SHALL call `quest_reflect_task` tool with summary and analysis to critically review the solution
6. **Step 3: Reflect Task** - WHEN `quest_reflect_task` is called THEN mcp-server-quest SHALL return reflection guidance prompt to identify optimization opportunities and ensure best practices
7. **Step 4: Split Tasks** - WHEN agent-producer completes reflection THEN agent-producer SHALL use LLM to generate tasks array with fields: name, description, implementationGuide, verificationCriteria, dependencies, relatedFiles
8. **Step 4: Split Tasks** - WHEN tasks are generated THEN agent-producer SHALL call `quest_split_tasks` tool via KĀDI broker with questId, tasks array, and globalAnalysisResult
9. WHEN tasks are created THEN mcp-server-quest SHALL validate task dependencies and return created task IDs
10. WHEN task creation succeeds THEN agent-producer SHALL notify user via Discord with task count and dependency graph

**Note**: This four-step workflow (plan → analyze → reflect → split) mirrors mcp-shrimp-task-manager's approach and ensures thorough task planning with multiple review cycles.

### Requirement 4: Task Assignment to Worker Agents

**User Story:** As a developer, I want to assign tasks to specific worker agents (artist, designer, programmer), so that specialized agents handle appropriate work.

#### Acceptance Criteria

1. WHEN user says "Assign tasks to agent-artist" THEN agent-producer SHALL call `quest_assign_tasks` tool via KĀDI broker with questId, agentId='agent-artist', and taskIds array
2. WHEN `quest_assign_tasks` is called THEN mcp-server-quest SHALL assign only tasks with no unresolved dependencies (ready tasks)
3. WHEN tasks are assigned THEN mcp-server-quest SHALL return list of assigned task IDs and count of blocked tasks
4. WHEN assignment succeeds THEN agent-producer SHALL notify user via Discord: "Assigned {count} tasks to agent-artist, {blocked} tasks blocked by dependencies"

### Requirement 5: Task Execution by Worker Agents

**User Story:** As a developer, I want worker agents to automatically execute assigned tasks, so that implementation happens without manual coding.

#### Acceptance Criteria

1. WHEN user says "Start implementing tasks" THEN agent-producer SHALL publish `task.assigned` events to 'utility' network via KĀDI broker for ALL assigned tasks
2. WHEN `task.assigned` event is published THEN event payload SHALL include: taskId, questId, role, description, requirements, timestamp, assignedBy
3. WHEN agent-artist receives `task.assigned` event THEN agent-artist SHALL call `quest_get_task_details` tool via KĀDI broker to fetch full task information including implementationGuide, verificationCriteria, dependencies, relatedFiles
4. WHEN agent-artist has full task details THEN agent-artist SHALL use available tools (filesystem, git) and Claude API to implement the task
5. WHEN agent-artist completes file operations THEN agent-artist SHALL commit changes to agent-playground-artist worktree with commit message following format: "feat: create artwork for task {taskId}"
6. WHEN agent-artist commits THEN shadow-agent-artist SHALL detect file changes and sync to shadow-agent-playground-artist worktree for backup
7. WHEN task implementation is complete THEN agent-artist SHALL publish `task.completed` event to 'utility' network with payload: taskId, questId, role, status='completed', filesCreated, filesModified, commitSha, timestamp, agent
8. WHEN agent-producer receives `task.completed` event THEN agent-producer SHALL call `quest_verify_task` tool via KĀDI broker with taskId, summary, and score to verify task completion
9. WHEN task verification succeeds THEN agent-producer SHALL call `quest_submit_task_result` tool via KĀDI broker with taskId and result details
10. WHEN task result is submitted THEN agent-producer SHALL notify user via Discord: "Task {taskName} completed and verified successfully"

### Requirement 6: Task Failure Handling

**User Story:** As a developer, I want to be notified immediately when tasks fail, so that I can provide guidance or fix issues.

#### Acceptance Criteria

1. WHEN agent-artist fails to complete task THEN agent-artist SHALL publish `task.failed` event to 'utility' network with payload: taskId, questId, role, error, errorDetails, timestamp, agent
2. WHEN agent-producer receives `task.failed` event THEN agent-producer SHALL notify user via Discord: "Task {taskName} failed: {error}"
3. WHEN user receives failure notification THEN user SHALL provide guidance: "retry", "skip", or "abort"
4. WHEN user says "retry" THEN agent-producer SHALL republish `task.assigned` event for the failed task
5. WHEN user says "skip" THEN agent-producer SHALL mark task as skipped in mcp-server-quest
6. WHEN user says "abort" THEN agent-producer SHALL stop all task execution and notify user

### Requirement 7: Git Operations and Push Workflow

**User Story:** As a developer, I want commits from multiple worker agents to be merged and pushed to GitHub, so that work is version controlled and deployed.

#### Acceptance Criteria

1. WHEN all quest tasks are completed OR user says "push to GitHub" THEN agent-producer SHALL ask user via Discord: "Ready to push {N} commits from {M} agents to GitHub? (yes/no)"
2. WHEN user confirms "yes" THEN agent-producer SHALL call `git_merge` tool via KĀDI broker for each worker agent branch with parameters: path='C:/GitHub/agent-playground', branch='agent-playground-{role}', message='feat: complete quest {questName} - {role} tasks', noFastForward=true
3. WHEN all branches are merged THEN agent-producer SHALL call `git_push` tool via KĀDI broker with parameters: path='C:/GitHub/agent-playground', branch='main', remote='origin'
4. WHEN push succeeds THEN agent-producer SHALL notify user via Discord with push result: remote, branch, pushedRefs, commitSha
5. IF merge or push fails THEN agent-producer SHALL notify user with error details and wait for manual intervention

### Requirement 8: Agent Registration and Heartbeat

**User Story:** As a system administrator, I want to track which agents are online and healthy, so that I can monitor system status.

#### Acceptance Criteria

1. WHEN agent-producer starts THEN agent-producer SHALL call `quest_register_agent` tool via KĀDI broker with agentId, role='producer', capabilities=['quest-creation', 'task-assignment', 'git-operations'], status='online'
2. WHEN agent-artist starts THEN agent-artist SHALL call `quest_register_agent` tool via KĀDI broker with agentId, role='artist', capabilities=['file-creation', 'image-generation'], status='online'
3. WHEN any agent is registered THEN mcp-server-quest SHALL store agent information and display in dashboard
4. WHEN agent is running THEN agent SHALL send heartbeat every 30 seconds via `quest_agent_heartbeat` tool
5. IF agent fails to send heartbeat for 90 seconds THEN mcp-server-quest SHALL mark agent as 'offline'
6. WHEN agent stops THEN agent SHALL call `quest_unregister_agent` tool to gracefully disconnect

### Requirement 9: Event Schema Standardization

**User Story:** As a system architect, I want consistent event schemas across all agents, so that event handling is predictable and maintainable.

#### Acceptance Criteria

1. WHEN any agent publishes `task.assigned` event THEN event SHALL conform to schema: {taskId: string, questId: string, role: string, description: string, requirements: string, timestamp: string, assignedBy: string}
2. WHEN any agent publishes `task.completed` event THEN event SHALL conform to schema: {taskId: string, questId: string, role: string, status: 'completed', filesCreated: string[], filesModified: string[], commitSha: string, timestamp: string, agent: string}
3. WHEN any agent publishes `task.failed` event THEN event SHALL conform to schema: {taskId: string, questId: string, role: string, error: string, errorDetails?: any, timestamp: string, agent: string}
4. WHEN events are published THEN events SHALL be published to 'utility' network via KĀDI broker
5. WHEN events are received THEN events SHALL include networkId field to identify source network

### Requirement 10: Tool Access via KĀDI Broker

**User Story:** As a worker agent, I want to access mcp-server-quest, mcp-server-filesystem, and mcp-server-git tools through KĀDI broker, so that I can perform operations without direct connections.

#### Acceptance Criteria

1. WHEN agent-artist needs to read task details THEN agent-artist SHALL call `quest_get_task_details` tool via `client.invokeRemote('quest_get_task_details', {taskId})` through KĀDI broker
2. WHEN agent-artist needs to read files THEN agent-artist SHALL call filesystem tools via KĀDI broker (if mcp-server-filesystem is available)
3. WHEN agent-artist needs to commit changes THEN agent-artist SHALL use direct git operations in its worktree (current behavior)
4. WHEN agent-producer needs to merge branches THEN agent-producer SHALL call `git_merge` tool via `client.invokeRemote('git_merge', {path, branch, message})` through KĀDI broker
5. WHEN tool calls fail THEN agents SHALL receive error responses with error codes and messages

## Non-Functional Requirements

### Code Architecture and Modularity
- **Single Responsibility Principle**: Each agent (producer, artist, designer, programmer) has a single, well-defined role
- **Modular Design**: Worker agents use WorkerAgentFactory, shadow agents use ShadowAgentFactory for consistent patterns
- **Dependency Management**: Agents communicate only through KĀDI events and tool calls, no direct dependencies
- **Clear Interfaces**: Event schemas and tool interfaces are explicitly defined and validated with Zod schemas

### Performance
- **Event Latency**: Events published via KĀDI broker SHALL be delivered within 100ms under normal load
- **Tool Invocation**: Remote tool calls via KĀDI broker SHALL complete within 30 seconds (configurable timeout)
- **Task Execution**: Worker agents SHALL process tasks sequentially with no parallel execution (for now)
- **Git Operations**: Merge and push operations SHALL complete within 60 seconds for repositories under 1GB

### Security
- **Network Isolation**: Agents SHALL only communicate through authorized KĀDI networks ('utility' for inter-agent communication)
- **Tool Authorization**: mcp-server-git tools SHALL require 'tool:git:write' permission for destructive operations
- **Worktree Isolation**: Each worker agent SHALL only access its designated worktree directory
- **Event Validation**: All events SHALL be validated against Zod schemas before processing

### Reliability
- **Event Delivery**: KĀDI broker SHALL guarantee at-least-once delivery for events via RabbitMQ
- **Graceful Degradation**: If mcp-server-quest is unavailable, agent-producer SHALL notify user and queue operations
- **Error Recovery**: Failed tasks SHALL be retryable without data loss
- **Backup**: Shadow agents SHALL maintain backup commits in separate worktrees for rollback capability

### Usability
- **Natural Language**: Users SHALL interact with agent-producer using natural language commands in Discord
- **Clear Feedback**: agent-producer SHALL provide clear status updates and error messages in Discord
- **Dashboard Visibility**: mcp-server-quest dashboard SHALL display real-time quest, task, and agent status
- **Approval Workflow**: Users SHALL have multiple approval methods (dashboard or Discord) for flexibility
