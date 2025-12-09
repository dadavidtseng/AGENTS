# Requirements Document: Agent System Refactoring

## Introduction

This refactoring project aims to eliminate code duplication across the multi-agent orchestration system by extracting common patterns into reusable abstractions. Currently, agent-artist, shadow-agent-artist, and agent-producer contain 95-98% duplicated code that will be replicated across agent-designer, agent-programmer, and their shadow variants. This refactoring will create a modular, maintainable foundation that enables creating new agents with minimal boilerplate (5-10 lines instead of 800+ lines) while maintaining all existing functionality without breaking changes.

### Current State Analysis

**Facts from Codebase Examination:**

1. **Worker Agents** (agent-artist: 868 lines)
   - Hardcoded role-specific values: event topics, worktree paths, role names
   - Identical patterns: KĀDI client setup, task subscription, Claude API integration, file operations, git operations
   - Code location: C:\p4\Personal\SD\agent-artist\src\index.ts

2. **Shadow Agents** (shadow-agent-artist: 1,179 lines)
   - Hardcoded role-specific paths and event topics
   - Identical patterns: Filesystem watching (chokidar), git ref monitoring, backup logic, circuit breaker
   - Code location: C:\p4\Personal\SD\shadow-agent-artist\src\index.ts

3. **agent-producer Tools** (4 separate tool files)
   - Repetitive patterns: KĀDI protocol invocation, Option C orchestration, error handling, event publishing
   - Code location: C:\p4\Personal\SD\agent-producer\src\tools\

4. **agents-library Package** (Currently minimal)
   - Exports: BaseBot (13KB), KadiEventPublisher (11KB)
   - Location: C:\p4\Personal\SD\agents-library

### Value Proposition

**For Developers:**
- Reduce new agent implementation time from 800+ lines to 5-10 lines of configuration
- Fix bugs once instead of 6+ times across agent variants
- Add features globally without modifying individual agents

**For Maintainability:**
- Single source of truth for agent behavior
- Easier testing through isolated shared utilities
- Clear separation between configuration and implementation

**For System Quality:**
- Consistent error handling across all agents
- Standardized event patterns
- Uniform logging and metrics

## Alignment with Product Vision

This refactoring supports the KĀDI multi-agent orchestration architecture by:

- **Scalability**: Enables rapid addition of new agent roles (reviewer, tester, deployer) without code duplication
- **Reliability**: Centralizes resilience patterns (circuit breaker, retry logic) for consistent behavior
- **Maintainability**: Follows SOLID principles (especially Open/Closed and Single Responsibility)
- **Developer Experience**: Reduces cognitive load when creating or modifying agents

## Requirements

### Requirement 1: Worker Agent Factory

**User Story:** As a developer, I want to create new worker agents (artist/designer/programmer) with minimal configuration, so that I can add new agent roles without duplicating 800+ lines of code.

#### Acceptance Criteria

1. WHEN creating a new worker agent THEN the developer SHALL provide only: role name, worktree path, KĀDI broker network configuration, and optional role-specific customizations
1. WHEN the worker agent receives a task assignment event THEN it SHALL automatically subscribe to role.task.assigned events without hardcoded topic strings
1. WHEN the worker agent executes a task THEN it SHALL use Claude API integration, file operations, and git operations provided by the factory
1. WHEN the worker agent completes a task THEN it SHALL publish standardized events (role.task.completed, role.task.failed) without manual event construction
1. IF the worker agent encounters errors THEN it SHALL use shared error handling with circuit breaker and retry logic from BaseBot

**Technical Details:**
- Extract common logic from agent-artist/src/index.ts (868 lines) into agents-library
- Create WorkerAgentFactory or BaseWorkerAgent class
- Configuration interface: role (string), worktreePath (string), brokerUrl (string), networks (string array), claudeModel (optional string)
- Reuse existing BaseBot for resilience patterns

### Requirement 2: Shadow Agent Factory

**User Story:** As a developer, I want to create new shadow agents with minimal configuration, so that I can add backup/monitoring agents without duplicating filesystem watching and git mirroring logic.

#### Acceptance Criteria

1. WHEN creating a new shadow agent THEN the developer SHALL provide only: role name, worker worktree path, shadow worktree path, and branch names
1. WHEN files are created/modified/deleted in the worker worktree THEN the shadow agent SHALL automatically detect changes via filesystem watcher (chokidar)
1. WHEN the worker agent commits changes THEN the shadow agent SHALL automatically create mirror commits in the shadow worktree
1. WHEN shadow operations fail THEN the shadow agent SHALL use circuit breaker pattern to prevent cascading failures
1. WHEN shadow backups succeed THEN the shadow agent SHALL publish standardized events (shadow-role.backup.completed, shadow-role.backup.failed)

**Technical Details:**
- Extract common logic from shadow-agent-artist/src/index.ts (1,179 lines) into agents-library
- Create ShadowAgentFactory or BaseShadowAgent class
- Configuration interface: role (string), workerWorktreePath (string), shadowWorktreePath (string), workerBranch (string), shadowBranch (string), brokerUrl (string), networks (string array)
- Reuse chokidar patterns, git monitoring logic, circuit breaker from BaseBot

### Requirement 3: Producer Tool Utilities

**User Story:** As a developer maintaining agent-producer, I want shared utilities for common tool patterns, so that I can reduce boilerplate in tool implementations and ensure consistent error handling.

#### Acceptance Criteria

1. WHEN implementing a new agent-producer tool THEN the developer SHALL use shared utilities for KĀDI protocol invocation
1. WHEN a tool invokes shrimp-task-manager via KĀDI THEN it SHALL use consistent error handling and timeout management
1. WHEN a tool publishes events THEN it SHALL use standardized event construction with required fields (timestamp, agent name)
1. IF Option C orchestration is needed THEN the tool SHALL use shared Claude API orchestration helpers
1. WHEN tools encounter errors THEN they SHALL classify errors (transient vs permanent) using shared utilities

**Technical Details:**
- Extract patterns from agent-producer/src/tools/*.ts (4 files)
- Create utilities: invokeShrimTool(), orchestrateWithClaude(), publishToolEvent(), classifyToolError()
- Location: agents-library/producer-tool-utils.ts

### Requirement 4: Configuration-Driven Agent Instantiation

**User Story:** As a developer, I want to instantiate agents via configuration objects rather than code duplication, so that adding new agent roles requires only adding configuration entries.

#### Acceptance Criteria

1. WHEN defining a new agent THEN the developer SHALL create a configuration object with role-specific parameters
1. WHEN the system starts an agent THEN it SHALL instantiate the appropriate factory with the configuration object
1. WHEN configuration changes THEN the system SHALL support hot-reloading without code changes (optional enhancement)
1. IF an agent requires custom behavior THEN the system SHALL support strategy pattern overrides for specific operations
1. WHEN multiple agents share resources THEN they SHALL use dependency injection for shared services (KĀDI client, Claude API client)

**Technical Details:**
- Configuration schema: AgentConfig with type (worker or shadow), role (string), paths (PathConfig), optional behavior overrides
- Factory pattern for agent instantiation
- Strategy pattern for role-specific customizations

### Requirement 5: Backward Compatibility

**User Story:** As a system operator, I want the refactoring to maintain all existing functionality, so that the system continues operating without disruption during and after migration.

#### Acceptance Criteria

1. WHEN refactored agents start THEN they SHALL subscribe to the same KĀDI event topics as before
1. WHEN refactored agents process tasks THEN they SHALL publish events with identical structure and topics
1. WHEN refactored agents perform file operations THEN they SHALL create commits with the same message format
1. IF external systems depend on agent behavior THEN they SHALL experience zero breaking changes
1. WHEN migration is complete THEN all existing tests SHALL pass without modification

**Technical Details:**
- Event topic patterns must remain: role.task.assigned, role.task.completed, role.file.created (where role is the agent role)
- Commit message format: feat: create artwork for task TASKID (worker), Shadow: OPERATION FILENAME (shadow)
- Git worktree paths must match existing: C:/p4/Personal/SD/agent-playground-ROLE (where ROLE is the agent role)

## Non-Functional Requirements

### Code Architecture and Modularity

**SOLID Principles:**
- **Single Responsibility**: Each shared utility/factory has one clear purpose
- **Open/Closed**: New agent roles can be added without modifying shared code (configuration-driven)
- **Liskov Substitution**: All worker agents are interchangeable for the orchestrator
- **Interface Segregation**: Factories expose minimal, role-specific interfaces
- **Dependency Inversion**: Agents depend on abstractions (BaseBot, interfaces) not concrete implementations

**Design Patterns:**
- **Factory Pattern**: WorkerAgentFactory, ShadowAgentFactory for agent instantiation
- **Strategy Pattern**: Role-specific behavior overrides (e.g., custom filename determination for artists)
- **Template Method Pattern**: Shared workflow with customizable steps
- **Circuit Breaker Pattern**: Resilience for external calls (already in BaseBot)

**Module Structure:**

agents-library/
- index.ts (Public exports)
- base-bot.ts (Existing: Circuit breaker, retry logic)
- kadi-event-publisher.ts (Existing: Event publishing utilities)
- worker-agent-factory.ts (NEW: Worker agent instantiation)
- shadow-agent-factory.ts (NEW: Shadow agent instantiation)
- producer-tool-utils.ts (NEW: Agent-producer tool utilities)
- types/ (NEW: Shared TypeScript interfaces)
  - agent-config.ts
  - event-schemas.ts
  - tool-schemas.ts

### Performance

1. **Zero Overhead**: Factory pattern and shared utilities SHALL NOT introduce performance regression
2. **Memory Efficiency**: Shared code SHALL reduce total memory footprint by eliminating duplicated functions
3. **Startup Time**: Agent startup time SHALL remain under 3 seconds (same as current)

### Security

1. **Isolation**: Agents SHALL maintain separate git worktrees and KĀDI network isolation
2. **Credential Management**: Claude API keys and KĀDI broker credentials SHALL remain in environment variables
3. **Input Validation**: Shared utilities SHALL validate all configuration inputs using Zod schemas

### Reliability

1. **Error Recovery**: Circuit breaker SHALL remain functional (already in BaseBot)
2. **Event Ordering**: Shadow agents SHALL maintain correct event ordering for file operations
3. **Atomic Operations**: Git commits SHALL remain atomic (add + commit as single operation)

### Maintainability

1. **Test Coverage**: Shared utilities SHALL have greater than 80% test coverage
2. **Documentation**: Each factory and utility SHALL have JSDoc comments with usage examples
3. **Type Safety**: All shared code SHALL use strict TypeScript with no `any` types
4. **Logging**: Shared utilities SHALL use structured logging (JSON format) consistent with existing agents

### Migration Strategy

1. **Incremental Migration**: Refactor SHALL be implemented incrementally to minimize risk
2. **Rollback Plan**: Each migration step SHALL be reversible via git
3. **Testing**: Each migrated agent SHALL be tested independently before deploying
4. **Monitoring**: Migration SHALL include metrics to verify zero functionality regression

## Success Metrics

**Quantitative:**
- Reduce agent-designer implementation from 800+ lines to under 50 lines
- Reduce agent-programmer implementation from 800+ lines to under 50 lines
- Achieve greater than 80% test coverage for agents-library
- Zero breaking changes (all existing tests pass)

**Qualitative:**
- Developer can add new agent role in under 30 minutes
- Bug fixes apply to all agents automatically
- Code review time reduced due to less duplication
- Onboarding time for new developers reduced

## Out of Scope

1. **Bot Integration Refactoring**: Slack/Discord bot code remains in individual agents (already uses BaseBot)
1. **Agent-Producer Architecture Change**: agent-producer remains a separate process, tools remain separate files
1. **KĀDI Protocol Changes**: No changes to broker, event topics, or network isolation
1. **Worktree Management**: Git worktree creation/initialization remains manual
1. **Production Deployment**: This refactoring focuses on code structure, not deployment automation
