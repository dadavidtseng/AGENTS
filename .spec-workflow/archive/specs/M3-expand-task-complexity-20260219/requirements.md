# M3 Requirements: Expand Task Type and Complexity + Dashboard Migration

## Introduction

M3 focuses on enabling **CEO-style orchestration** where humans provide high-level direction and agent-producer handles multi-agent coordination. This milestone includes core refactoring tasks (dashboard migration, generic worker/shadow agents, DaemonAgent command system) and comprehensive testing (10+ workflow scenarios, KĀDI abilities verification).

**Duration:** February 4-17, 2026 (14 days)
- **Week 1 (Feb 4-10):** Core refactoring tasks
- **Week 2 (Feb 11-17):** Testing and integration

**Value to Users:**
- Simplified interaction: Users provide high-level goals, agents handle implementation details
- Multi-agent collaboration: Multiple agents work in parallel without conflicts
- Visual management: Web dashboard for real-time quest/task monitoring
- Flexible agent roles: Generic worker agents support artist, programmer, designer roles
- Extensible game engine: DaemonAgent generic command system enables easy command addition

## Alignment with Product Vision

This milestone directly supports the core product principles outlined in product.md:

1. **CEO-Style Orchestration** (product.md): Users provide high-level direction, agents handle implementation details
   - M3 enables this through multi-agent workflow scenarios where humans act as CEOs

2. **Human-in-the-Loop by Default** (product.md): Real-time visibility and approval checkpoints
   - Dashboard migration to mcp-client-quest provides visual management interface

3. **Cross-Language Collaboration** (product.md): Agents in different languages work together
   - Generic worker/shadow agents prepare foundation for Python/Rust agents in M5

4. **Quest-Based Workflow** (product.md): Structured approach to breaking down complex goals
   - 10+ workflow scenarios validate quest-based task management

## Requirements

### Requirement 1: Dashboard Migration to mcp-client-quest

**User Story:** As a user, I want a dedicated web dashboard to visualize and manage quests/tasks in real-time, so that I can monitor agent progress and approve critical operations.

#### Acceptance Criteria

1. WHEN user accesses dashboard THEN system SHALL display React frontend with all quest/task information
2. WHEN user performs action (approve/reject) THEN system SHALL invoke KĀDI broker tools via Express backend
3. WHEN agent updates quest/task status THEN system SHALL push real-time updates via WebSocket
4. WHEN dashboard loads THEN system SHALL connect to KĀDI broker and fetch current state
5. IF KĀDI broker is offline THEN system SHALL display connection error and retry automatically
6. WHEN user approves task THEN system SHALL publish approval event to KĀDI broker
7. WHEN user rejects task THEN system SHALL publish rejection event with reason

**Technical Details:**
- Extract React frontend from `mcp-server-quest/src/dashboard/` to `mcp-client-quest/client/`
- Create Express backend in `mcp-client-quest/server/`
- Replace direct API calls with KĀDI broker tool invocation
- Implement WebSocket server for real-time updates
- Test all dashboard features (quest creation, task assignment, approval workflow)

**Architecture:**
```
User Browser → mcp-client-quest (React + Express)
                    ↓
              KĀDI Broker
                    ↓
    ┌───────────────┴───────────────┐
    ↓                               ↓
agent-producer              mcp-server-quest
(orchestration tools)       (quest/task tools)
```

**Priority:** CRITICAL (dashboard is the only connection between human and agent-producer)

**Estimated Duration:** 2 days

### Requirement 2: Refactor agent-artist → agent-worker

**User Story:** As a developer, I want a generic worker agent that supports multiple roles (artist, programmer, designer), so that I can easily add new agent types without duplicating code.

#### Acceptance Criteria

1. WHEN agent starts THEN system SHALL load role configuration from JSON file or environment variable
2. WHEN role is "artist" THEN system SHALL use artist-specific capabilities and event topics
3. WHEN role is "programmer" THEN system SHALL use programmer-specific capabilities and event topics
4. WHEN role is "designer" THEN system SHALL use designer-specific capabilities and event topics
5. IF role configuration is invalid THEN system SHALL fail with clear error message
6. WHEN agent receives task THEN system SHALL execute task according to role capabilities
7. WHEN agent completes task THEN system SHALL create git commit with role-specific format

**Role Configuration Schema:**
```json
{
  "role": "artist",
  "capabilities": ["file-creation", "image-generation", "creative-content"],
  "maxConcurrentTasks": 3,
  "worktreePath": "C:/GitHub/agent-playground-artist",
  "eventTopic": "artist.task.assigned",
  "commitFormat": "feat: create artwork for task {taskId}"
}
```

**Technical Details:**
- Create role configuration files: `config/roles/artist.json`, `programmer.json`, `designer.json`
- Implement role-based initialization in agent startup
- Support environment variable `AGENT_ROLE` or CLI argument `--role`
- Update `agents-library/WorkerAgentFactory` to support role configs
- Maintain backward compatibility with existing agent-artist

**Priority:** HIGH (foundation for multi-agent collaboration)

**Estimated Duration:** 2 days

### Requirement 3: Refactor shadow-agent-artist → shadow-agent-worker

**User Story:** As a system administrator, I want shadow agents to support all worker roles (artist, programmer, designer), so that I have backup and monitoring for all agent types.

#### Acceptance Criteria

1. WHEN shadow agent starts THEN system SHALL load shadow role configuration from JSON file
2. WHEN shadow role is "artist" THEN system SHALL monitor artist worker agent
3. WHEN shadow role is "programmer" THEN system SHALL monitor programmer worker agent
4. WHEN shadow role is "designer" THEN system SHALL monitor designer worker agent
5. IF worker agent fails THEN shadow agent SHALL trigger automatic rollback
6. WHEN shadow agent detects anomaly THEN system SHALL notify human via dashboard
7. WHEN shadow agent performs rollback THEN system SHALL restore previous git state

**Shadow Role Configuration Schema:**
```json
{
  "role": "artist",
  "workerWorktreePath": "C:/GitHub/agent-playground-artist",
  "shadowWorktreePath": "C:/GitHub/shadow-agent-playground-artist",
  "workerBranch": "agent-playground-artist",
  "shadowBranch": "shadow-agent-playground-artist"
}
```

**Technical Details:**
- Create shadow role configuration files mirroring worker roles
- Implement shadow role-based initialization
- Support all three roles (artist, programmer, designer)
- Test backup functionality for each role

**Priority:** MEDIUM (important for reliability but not blocking)

**Estimated Duration:** 1 day

### Requirement 4: DaemonAgent Generic Command System Refactoring

**User Story:** As a game developer, I want to define new game engine commands in JSON configuration files, so that I can extend DaemonAgent capabilities without modifying C++ code.

#### Acceptance Criteria

1. WHEN DaemonAgent starts THEN system SHALL load command definitions from JSON files
2. WHEN command is registered THEN system SHALL validate command parameters and handler
3. WHEN command is executed THEN system SHALL invoke registered handler with parameters
4. IF command parameters are invalid THEN system SHALL return validation error
5. WHEN command composition is requested THEN system SHALL execute commands in sequence
6. WHEN new command JSON is added THEN system SHALL dynamically load command without restart
7. WHEN command fails THEN system SHALL return error with clear message

**Command Definition Schema:**
```json
{
  "name": "spawn_entity",
  "parameters": [
    {"name": "type", "type": "string", "required": true},
    {"name": "position", "type": "vector3", "default": [0, 0, 0]},
    {"name": "color", "type": "color", "default": [1, 1, 1]}
  ],
  "handler": "EntitySpawnHandler"
}
```

**Command Registry Pattern:**
```cpp
// Command registration (C++)
CommandRegistry::Register("spawn_entity", new EntitySpawnHandler());

// Command execution
CommandRegistry::Execute("spawn_entity", {
  {"type", "cube"},
  {"position", {5, 0, 5}},
  {"color", {1, 0, 0}}
});
```

**Technical Details:**
- Refactor hardcoded commands in `CommandHandler.cpp` to registry pattern
- Implement `CommandRegistry` class with registration and execution methods
- Create JSON command definitions for existing commands
- Add command validation layer
- Support command composition (e.g., "spawn 3 cubes" = spawn + spawn + spawn)
- Preserve all existing functionality

**Benefits:**
- Easy to add new commands without code changes
- Commands can be defined by non-programmers (JSON)
- Better testability (mock command handlers)
- Supports command composition and macros
- Integrates better with KĀDI broker tool system

**Priority:** HIGH (foundational for M5 DaemonAgent integration)

**Estimated Duration:** 2 days

**Reference:** `C:\GitHub\DaemonAgent\.spec-workflow\specs\generic-command-system\requirements.md`

### Requirement 5: Multi-Agent Workflow Scenarios

**User Story:** As a user, I want to provide high-level goals and have agent-producer orchestrate multiple agents to execute tasks in parallel, so that I can focus on direction rather than implementation details.

#### Acceptance Criteria

1. WHEN user provides high-level goal THEN agent-producer SHALL break down into executable tasks
2. WHEN tasks are independent THEN agent-producer SHALL assign to multiple agents in parallel
3. WHEN tasks have dependencies THEN agent-producer SHALL execute in correct sequence
4. WHEN multiple agents modify related files THEN system SHALL detect and resolve conflicts
5. IF task fails THEN agent-producer SHALL retry or reassign to different agent
6. WHEN all tasks complete THEN agent-producer SHALL request human approval
7. WHEN human approves THEN agent-producer SHALL merge all branches and push to remote

**Scenario Categories (At Least 10 Scenarios):**

1. **Parallel Execution**: Multiple independent tasks executed simultaneously
   - Example: "Create 3 different UI components" → 3 agents work in parallel

2. **Sequential Dependencies**: Task B depends on Task A completion
   - Example: "Create API endpoint and test it" → API first, then test

3. **Cross-Role Collaboration**: Artist creates UI mockup, programmer implements it, designer reviews
   - Example: "Create login page" → artist (mockup) → programmer (code) → designer (review)

4. **Conflict Resolution**: Multiple agents modify related files
   - Example: "Update authentication module" → detect conflicts → resolve

5. **Error Recovery**: Task fails, agent-producer reassigns or retries
   - Example: Task fails due to LLM error → retry with different agent

6. **Complex Multi-Step**: Quest requires 5+ tasks across multiple roles
   - Example: "Create game scene with physics" → multiple tasks across roles

7. **Approval Workflow**: Human reviews and approves at checkpoints
   - Example: "Refactor module" → human approves design → agents execute

8. **Resource Constraints**: Limited agents, queue management
   - Example: 5 tasks but only 2 agents → queue and execute in order

9. **Priority Handling**: High-priority tasks interrupt normal flow
   - Example: Critical bug fix interrupts feature development

10. **Integration Testing**: Multiple components integrated and tested
    - Example: "Integrate payment system" → multiple agents test integration

**For Each Scenario, Document:**
- Human input (CEO-level direction)
- agent-producer orchestration logic
- Task breakdown and assignment
- Expected agent behavior
- Success criteria
- Edge cases and error handling

**Priority:** CRITICAL (validates CEO-style orchestration)

**Estimated Duration:** 2 days

### Requirement 6: KĀDI Abilities Verification

**User Story:** As a developer, I want comprehensive test coverage for all KĀDI abilities, so that I can trust that abilities work correctly in production.

#### Acceptance Criteria

1. WHEN test suite runs THEN system SHALL test all ability-file-management tools
2. WHEN test suite runs THEN system SHALL test all mcp-server-quest tools (34 tools)
3. WHEN test suite runs THEN system SHALL test all agent-producer orchestration tools
4. IF ability fails THEN test SHALL report clear error message with context
5. WHEN ability succeeds THEN test SHALL verify expected output
6. WHEN edge case is tested THEN system SHALL handle gracefully
7. WHEN test suite completes THEN system SHALL generate test report

**Test Coverage:**
- All ability-file-management tools (file operations)
- All mcp-server-quest tools (34 tools for quest/task management)
- All agent-producer orchestration tools (task assignment, verification)
- Error handling and edge cases (invalid input, network errors, timeouts)

**Deliverables:**
- Comprehensive test suite for each ability
- Test documentation with usage examples
- Ability usage patterns documented
- Known limitations documented

**Priority:** HIGH (ensures system reliability)

**Estimated Duration:** 1 day

## Non-Functional Requirements

### Code Architecture and Modularity

- **Single Responsibility Principle**: Each component (dashboard, worker agent, shadow agent, DaemonAgent) has a single, well-defined purpose
- **Modular Design**: Role configurations are isolated in JSON files, command definitions are isolated in JSON files
- **Dependency Management**: Dashboard depends on KĀDI broker, agents depend on role configs, DaemonAgent depends on command registry
- **Clear Interfaces**: KĀDI broker provides standardized tool invocation interface, role configs provide standardized agent initialization

### Performance

- **Dashboard Response Time**: Instant (under 100ms) for UI interactions
- **WebSocket Latency**: Real-time updates (under 500ms) for quest/task status changes
- **Agent Startup Time**: Less than 5 seconds for role-based initialization
- **Command Execution Time**: Less than 100ms for DaemonAgent command execution
- **Workflow Scenario Execution**: Complete within 5 minutes for simple scenarios (3-5 tasks)

### Security

- **API Key Management**: .env files for development, secret-ability planned for production
- **Agent Isolation**: Git worktrees provide file system isolation between agents
- **Human Approval**: All critical operations (git merge, push) require human approval via dashboard
- **Input Validation**: All command parameters validated before execution

### Reliability

- **Shadow Agent Monitoring**: Backup agents monitor primary agent execution for automatic rollback
- **Error Recovery**: Task failures trigger retry or reassignment
- **Graceful Degradation**: If KĀDI broker is offline, dashboard displays connection error and retries
- **Data Persistence**: All quest/task data persisted in ArcadeDB

### Usability

- **CEO-Style Orchestration**: Users provide high-level goals in natural language
- **Visual Management**: Dashboard provides clear visualization of quest/task progress
- **Real-Time Feedback**: WebSocket updates provide instant feedback on agent actions
- **Clear Error Messages**: All errors include context and suggested actions
- **Documentation**: Comprehensive README.md and CLAUDE.md for each component

### Maintainability

- **Generic Worker/Shadow Agents**: Role-based configuration eliminates code duplication
- **Generic Command System**: JSON command definitions enable easy extension
- **Comprehensive Tests**: Test suite ensures reliability and prevents regressions
- **Clear Documentation**: All components documented with usage examples and patterns

### Scalability

- **Multi-Agent Support**: System supports 3+ agents working in parallel (thesis demo: 20 instances)
- **Role Extensibility**: Easy to add new roles (e.g., tester, reviewer) via JSON configuration
- **Command Extensibility**: Easy to add new DaemonAgent commands via JSON definitions
- **Workflow Complexity**: System handles 10+ different workflow scenarios

## Dependencies

### Technical Dependencies

- **KĀDI Broker**: Dashboard and agents depend on KĀDI broker for communication
- **ArcadeDB**: Quest/task data storage (DigitalOcean: http://64.23.168.129:2480/)
- **Git Worktrees**: Agent isolation depends on git worktree functionality
- **Claude API**: Agent task execution depends on Claude API (Anthropic)
- **React 19.2.0**: Dashboard frontend framework
- **Express**: Dashboard backend framework
- **WebSocket (ws)**: Real-time updates

### Milestone Dependencies

- **M2 Completion**: M3 requires M2 end-to-end workflow to be complete
- **Steering Documents**: M3 requires product.md, tech.md, structure.md to be complete
- **M3 → M4**: Dashboard migration affects M4 documentation and demo
- **M3 → M5**: Generic worker/shadow agents prepare foundation for Python/Rust agents
- **M3 → M5**: DaemonAgent generic command system enables M5 full integration

### External Dependencies

- **Node.js 20.x+**: Runtime for TypeScript agents and dashboard
- **TypeScript 5.9.3**: Language for agents and dashboard
- **CMake**: Build system for DaemonAgent C++ code
- **V8 Runtime**: JavaScript runtime embedded in DaemonAgent

## Risks and Mitigation

### Risk 1: Dashboard Migration Complexity

**Risk:** Extracting React frontend from mcp-server-quest may break existing functionality

**Mitigation:**
- Incremental migration: Extract one component at a time
- Comprehensive testing after each extraction
- Keep mcp-server-quest dashboard as fallback during migration
- Test all dashboard features before removing old dashboard

### Risk 2: Role Configuration Complexity

**Risk:** Generic worker/shadow agents may be more complex than separate implementations

**Mitigation:**
- Start with simple role configuration schema
- Test each role independently before integration
- Maintain backward compatibility with agent-artist
- Document role configuration patterns clearly

### Risk 3: DaemonAgent Command System Refactoring

**Risk:** Refactoring hardcoded commands may introduce bugs or break existing functionality

**Mitigation:**
- Preserve all existing functionality (acceptance criteria)
- Write comprehensive tests for command system
- Migrate commands incrementally (one at a time)
- Keep old command system as fallback during migration

### Risk 4: Workflow Scenario Complexity

**Risk:** 10+ workflow scenarios may be too ambitious for 2 days

**Mitigation:**
- Prioritize scenarios: Start with simple parallel/sequential scenarios
- Document scenarios incrementally (don't wait until all are complete)
- Focus on quality over quantity (8 well-tested scenarios better than 10 untested)
- Carry over remaining scenarios to M4 if needed

### Risk 5: KĀDI Abilities Verification Time

**Risk:** Testing 34+ tools may take longer than 1 day

**Mitigation:**
- Prioritize critical abilities (quest/task management, file operations)
- Automate test execution where possible
- Document known limitations instead of fixing all edge cases
- Carry over remaining tests to M4 if needed

## Success Criteria

M3 is considered successful when:

1. ✅ **Dashboard Migration Complete**: mcp-client-quest operational with all features working
2. ✅ **Generic Worker/Shadow Agents Operational**: All three roles (artist, programmer, designer) tested
3. ✅ **DaemonAgent Generic Command System Refactored**: JSON command definitions working, all existing functionality preserved
4. ✅ **At Least 10 Workflow Scenarios Designed and Tested**: CEO-style orchestration validated
5. ✅ **All KĀDI Abilities Verified**: Comprehensive test suite passing
6. ✅ **Multi-Agent Collaboration Tested**: 3+ agents working in parallel without conflicts
7. ✅ **Documentation Complete**: README.md and CLAUDE.md updated for all components

## Out of Scope

The following are explicitly out of scope for M3:

- **Python/Rust Worker Agents**: Deferred to M5
- **MCP Client Refactoring**: Deferred to M5
- **Language-Specific Abilities**: Deferred to M5
- **Full DaemonAgent Integration**: Deferred to M5 (M3 only refactors command system)
- **Agent Factory Enhancement**: Deferred to M6
- **Context Window Management**: Deferred to M6
- **Comprehensive Documentation**: Deferred to M4 (M3 only updates component docs)
- **GDC Demo Materials**: Deferred to M4

## Appendix

### Related Documents

- **product.md**: Product vision, user stories, use cases
- **tech.md**: Technical architecture, design decisions
- **structure.md**: Project structure, component relationships
- **DEVELOPMENT-PLAN.md**: Detailed milestone plan (M2-M7)
- **DEVELOPMENT-PLAN-OUTLINE.md**: Quick reference guide

### Key Terminology

- **CEO-Style Orchestration**: Human provides high-level direction, agents handle details
- **Quest**: High-level goal broken down into tasks
- **Task**: Atomic unit of work assigned to an agent
- **Worktree**: Isolated git working directory for parallel execution
- **MCP**: Model Context Protocol (standard for AI agent tool use)
- **KĀDI**: Knowledge & Ability Deployment Infrastructure (message routing)
- **Shadow Agent**: Backup agent for monitoring and rollback
- **Role Configuration**: JSON file defining agent capabilities and behavior

### Timeline

**Week 1: Core Refactoring (Feb 4-10)**
- Day 1-2: Dashboard Migration to mcp-client-quest
- Day 3-4: Refactor agent-artist → agent-worker
- Day 5: Refactor shadow-agent-artist → shadow-agent-worker
- Day 6-7: DaemonAgent Generic Command System Refactoring

**Week 2: Testing and Integration (Feb 11-17)**
- Day 8-9: Multi-Agent Workflow Scenarios (at least 10)
- Day 10: KĀDI Abilities Verification
- Day 11-14: Buffer for testing, bug fixes, and documentation
