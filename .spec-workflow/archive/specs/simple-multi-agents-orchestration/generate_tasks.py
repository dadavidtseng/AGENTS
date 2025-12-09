#!/usr/bin/env python3
"""
Generate tasks.md from design.md
Converts architectural design into atomic implementation tasks
Uses absolute Windows paths to avoid file modification bugs
"""

output_path = r'C:\p4\Personal\SD\AGENTS\.spec-workflow\specs\simple-multi-agents-orchestration\tasks.md'

tasks_content = '''# Tasks Document

## Phase 1: Project Setup and Configuration

- [ ] 1.1 Initialize agent-producer project structure
  - File: C:\\p4\\Personal\\SD\\agent-producer/package.json, tsconfig.json, src/index.ts
  - Create TypeScript project with MCP server dependencies
  - Set up project structure following BaseBot pattern
  - Purpose: Establish orchestrator agent foundation
  - _Leverage: C:\\p4\\Personal\\SD\\AGENTS\\shared\\base-bot.ts, C:\\GitHub\\mcp-shrimp-task-manager\\src\\index.ts_
  - _Requirements: 1.1, 1.2_
  - _Prompt: Role: TypeScript Developer specializing in MCP server architecture | Task: Initialize agent-producer TypeScript project following requirements 1.1 and 1.2, setting up MCP server structure using patterns from mcp-shrimp-task-manager and BaseBot architecture from shared/base-bot.ts | Restrictions: Must use @modelcontextprotocol/sdk for MCP server, do not duplicate BaseBot code (import from shared), maintain TypeScript strict mode | Success: Project compiles without errors, MCP server initializes correctly, proper dependency management with package.json_

- [ ] 1.2 Configure KĀDI broker MCP upstreams
  - File: kadi-broker config (location TBD based on KĀDI broker documentation)
  - Register MCP servers: mcp-shrimp-task-manager, mcp-spec-workflow
  - Configure network assignments for each upstream
  - Purpose: Enable agent-producer to access task management and spec workflow tools
  - _Leverage: KĀDI broker documentation, existing MCP server configs_
  - _Requirements: 2.1.1, 2.1.2_
  - _Prompt: Role: DevOps Engineer with expertise in message broker configuration and MCP protocol | Task: Configure KĀDI broker to register mcp-shrimp-task-manager and mcp-spec-workflow as upstreams following requirements 2.1.1 and 2.1.2, assigning to appropriate networks (global, git, etc.) | Restrictions: Must follow KĀDI broker config schema, ensure network isolation is maintained, do not expose sensitive MCP tools to unauthorized networks | Success: MCP upstreams are registered and accessible, network assignments verified, agent-producer can invoke upstream tools_

- [ ] 1.3 Set up git worktree management utilities
  - File: C:\\p4\\Personal\\SD\\agent-producer/src/utils/git-worktree.ts
  - Implement worktree creation/cleanup functions
  - Add path validation and error handling
  - Purpose: Provide isolated working directories for concurrent agent execution
  - _Leverage: C:\\p4\\Personal\\SD\\AGENTS\\shared\\base-bot.ts error handling patterns_
  - _Requirements: 3.2.1_
  - _Prompt: Role: Git Expert and TypeScript Developer | Task: Implement git worktree management utilities following requirement 3.2.1, providing functions to create/cleanup worktrees with proper path validation and error handling using BaseBot error patterns | Restrictions: Must validate all paths are absolute Windows paths, ensure worktree cleanup on failure, do not leave orphaned worktrees, handle concurrent worktree operations safely | Success: Worktrees can be created and cleaned up reliably, proper error handling for edge cases (existing worktrees, invalid paths), unit tests pass_

## Phase 2: agent-producer MCP Tools

- [ ] 2.1 Implement plan_task MCP tool
  - File: C:\\p4\\Personal\\SD\\agent-producer/src/tools/plan-task.ts
  - Create MCP tool handler for task planning
  - Integrate with mcp-shrimp-task-manager upstream
  - Add Zod schema validation for parameters
  - Purpose: Allow Slack/Discord/Claude Code users to create task plans
  - _Leverage: C:\\GitHub\\mcp-shrimp-task-manager\\src\\index.ts MCP tool pattern_
  - _Requirements: 2.1.1, 5.1_
  - _Prompt: Role: Full-stack Developer with expertise in MCP protocol and Zod validation | Task: Implement plan_task MCP tool following requirements 2.1.1 and 5.1, creating tool handler that validates input with Zod schemas and forwards to mcp-shrimp-task-manager upstream | Restrictions: Must validate all parameters with Zod before forwarding, handle upstream errors gracefully, return structured JSON responses, do not bypass validation | Success: Tool is registered in MCP server, parameter validation works correctly, successful integration with upstream task manager, proper error responses_

- [ ] 2.2 Implement list_active_tasks MCP tool
  - File: C:\\p4\\Personal\\SD\\agent-producer/src/tools/list-tasks.ts
  - Create MCP tool handler for listing tasks
  - Add filtering by status (pending, in_progress, completed)
  - Format response for different channels (Slack/Discord markdown vs Claude Code JSON)
  - Purpose: Allow users to query current task status
  - _Leverage: C:\\GitHub\\mcp-shrimp-task-manager\\src\\index.ts, design.md channel patterns_
  - _Requirements: 2.1.1, 5.2_
  - _Prompt: Role: API Developer specializing in data formatting and channel-specific responses | Task: Implement list_active_tasks MCP tool following requirements 2.1.1 and 5.2, creating handler that queries upstream and formats responses differently for event-driven channels (Slack/Discord) vs tool-based channels (Claude Code/Desktop) | Restrictions: Must detect channel type from request context, format Slack/Discord responses as conversational markdown, format Claude Code responses as structured JSON, handle empty task lists gracefully | Success: Tool returns properly formatted responses for each channel type, filtering works correctly, performance is acceptable for large task lists_

- [ ] 2.3 Implement get_task_status MCP tool
  - File: C:\\p4\\Personal\\SD\\agent-producer/src/tools/task-status.ts
  - Create detailed status retrieval for specific tasks
  - Include worker agent progress, file operations, error logs
  - Add real-time status updates via event subscriptions
  - Purpose: Provide detailed task execution visibility
  - _Leverage: KĀDI event subscriptions, mcp-shrimp-task-manager upstream_
  - _Requirements: 2.1.1, 5.3_
  - _Prompt: Role: Backend Developer with expertise in real-time data streaming and event-driven architectures | Task: Implement get_task_status MCP tool following requirements 2.1.1 and 5.3, creating handler that retrieves task details from upstream and subscribes to relevant KĀDI events for real-time updates | Restrictions: Must subscribe to task-specific events only (avoid global subscriptions), handle event unsubscription on completion, provide consistent status format across channels, do not block on event waits | Success: Tool provides comprehensive task status, real-time updates work correctly, proper cleanup of event subscriptions, good performance even with many concurrent status queries_

- [ ] 2.4 Implement approve_completion MCP tool
  - File: C:\\p4\\Personal\\SD\\agent-producer/src/tools/approve-completion.ts
  - Create approval workflow with validation
  - Trigger git operations to main playground repo
  - Send approval notifications via KĀDI events
  - Purpose: Allow users to approve task completion and trigger final git push
  - _Leverage: git-worktree.ts utilities, KĀDI event publishing_
  - _Requirements: 2.1.1, 5.4, 3.2.2_
  - _Prompt: Role: Workflow Automation Engineer with expertise in approval processes and git operations | Task: Implement approve_completion MCP tool following requirements 2.1.1, 5.4, and 3.2.2, creating approval workflow that validates completion criteria, performs git operations to merge work to main playground repo, and publishes approval events | Restrictions: Must verify task completion before allowing approval, validate git state before pushing, use atomic git operations (rollback on failure), require explicit user confirmation, publish approval events only after successful git push | Success: Approval workflow prevents premature approvals, git operations are atomic and safe, proper event notifications sent, audit trail of approvals maintained_

## Phase 3: Worker Agent Implementation

- [ ] 3.1 Scaffold agent-artist project
  - File: C:\\p4\\Personal\\SD\\agent-artist/package.json, tsconfig.json, src/index.ts, src/artist-bot.ts
  - Create TypeScript project extending BaseBot
  - Set up KĀDI client connection
  - Initialize git worktree for agent-playground-artist
  - Purpose: Create artist agent foundation
  - _Leverage: C:\\p4\\Personal\\SD\\AGENTS\\shared\\base-bot.ts_
  - _Requirements: 1.1, 3.1.1_
  - _Prompt: Role: TypeScript Developer specializing in agent architectures and OOP inheritance | Task: Scaffold agent-artist project following requirements 1.1 and 3.1.1, creating TypeScript project that extends BaseBot with KĀDI client integration and git worktree initialization for agent-playground-artist | Restrictions: Must extend BaseBot (not copy), initialize KĀDI client with artist network assignment, use git worktree utilities from agent-producer pattern, do not hard-code paths (use environment variables) | Success: Project structure is clean and follows BaseBot pattern, KĀDI client connects successfully, git worktree initialized at C:\\p4\\Personal\\SD\\agent-playground-artist, TypeScript compiles without errors_

- [ ] 3.2 Implement agent-artist task execution logic
  - File: C:\\p4\\Personal\\SD\\agent-artist/src/artist-bot.ts
  - Subscribe to KĀDI events for artist tasks (artist.task.assigned)
  - Implement file operations in agent-playground-artist worktree
  - Publish file operation events (artist.file.created, artist.file.modified)
  - Commit and push changes to agent-playground-artist remote
  - Purpose: Enable artist agent to execute assigned tasks
  - _Leverage: BaseBot event subscription pattern, KĀDI event publishing_
  - _Requirements: 3.1.1, 3.1.2, 4.1_
  - _Prompt: Role: Event-Driven Systems Developer with expertise in pub/sub patterns and git workflows | Task: Implement task execution logic for agent-artist following requirements 3.1.1, 3.1.2, and 4.1, subscribing to task assignment events, performing file operations in worktree, publishing operation events, and committing to agent-playground-artist repo | Restrictions: Must use BaseBot event subscription methods, validate all file paths are within worktree, publish events before and after each operation, use atomic git commits, handle task interruption gracefully | Success: Agent responds to task assignments correctly, file operations work reliably, events published at correct times, git commits are atomic and properly attributed, task status updated correctly_

- [ ] 3.3 Add error handling and retry logic to agent-artist
  - File: C:\\p4\\Personal\\SD\\agent-artist/src/artist-bot.ts
  - Implement circuit breaker for repeated failures
  - Add exponential backoff retry for transient errors
  - Publish error events (artist.task.failed)
  - Purpose: Make artist agent resilient to failures
  - _Leverage: BaseBot circuit breaker and retry utilities_
  - _Requirements: 6.1, 6.2_
  - _Prompt: Role: Reliability Engineer with expertise in fault tolerance and error handling patterns | Task: Add comprehensive error handling to agent-artist following requirements 6.1 and 6.2, implementing circuit breaker pattern, exponential backoff retry, and error event publishing using BaseBot utilities | Restrictions: Must use BaseBot circuit breaker (not custom implementation), retry only transient errors (not validation errors), publish error events with detailed context, do not retry indefinitely (max 3 retries), fail fast on unrecoverable errors | Success: Circuit breaker prevents cascading failures, retry logic handles transient errors correctly, error events provide actionable information, agent degrades gracefully under failure conditions_

- [ ] 3.4 Scaffold agent-designer project
  - File: C:\\p4\\Personal\\SD\\agent-designer/package.json, tsconfig.json, src/index.ts, src/designer-bot.ts
  - Create TypeScript project extending BaseBot
  - Set up KĀDI client connection (designer network)
  - Initialize git worktree for agent-playground-designer
  - Purpose: Create designer agent foundation
  - _Leverage: C:\\p4\\Personal\\SD\\AGENTS\\shared\\base-bot.ts, agent-artist patterns_
  - _Requirements: 1.1, 3.1.1_
  - _Prompt: Role: TypeScript Developer with expertise in code reuse and architectural patterns | Task: Scaffold agent-designer project following requirements 1.1 and 3.1.1, mirroring agent-artist structure but for designer role (documentation/design work), extending BaseBot with designer network KĀDI client and agent-playground-designer worktree | Restrictions: Must reuse patterns from agent-artist (not copy-paste), configure for designer network in KĀDI, initialize worktree at C:\\p4\\Personal\\SD\\agent-playground-designer, use environment variables for configuration | Success: Project structure matches agent-artist pattern, KĀDI client connects to designer network, git worktree initialized correctly, code reuse is evident (shared utilities), TypeScript compiles_

- [ ] 3.5 Implement agent-designer task execution logic
  - File: C:\\p4\\Personal\\SD\\agent-designer/src/designer-bot.ts
  - Subscribe to designer.task.assigned events
  - Implement documentation/design file operations
  - Publish designer.file.* events
  - Commit and push to agent-playground-designer remote
  - Purpose: Enable designer agent to execute documentation tasks
  - _Leverage: agent-artist task execution pattern, BaseBot event utilities_
  - _Requirements: 3.1.1, 3.1.2, 4.1_
  - _Prompt: Role: Software Engineer with expertise in documentation tooling and event-driven systems | Task: Implement task execution logic for agent-designer following requirements 3.1.1, 3.1.2, and 4.1, adapting agent-artist patterns for documentation/design file operations, subscribing to designer events, and committing to agent-playground-designer repo | Restrictions: Must follow agent-artist event subscription pattern, handle documentation-specific file types (markdown, diagrams), publish events at same granularity as artist, use atomic git operations, maintain task status consistency | Success: Designer agent executes documentation tasks correctly, file operations handle markdown/diagrams properly, events published consistently, git commits work reliably, pattern consistency with agent-artist_

- [ ] 3.6 Add error handling and retry logic to agent-designer
  - File: C:\\p4\\Personal\\SD\\agent-designer/src/designer-bot.ts
  - Implement circuit breaker and retry logic
  - Publish designer.task.failed events
  - Purpose: Make designer agent resilient
  - _Leverage: BaseBot utilities, agent-artist error handling patterns_
  - _Requirements: 6.1, 6.2_
  - _Prompt: Role: Reliability Engineer focused on consistency and fault tolerance | Task: Add error handling to agent-designer following requirements 6.1 and 6.2, reusing agent-artist error handling patterns with BaseBot circuit breaker and retry logic for designer-specific error scenarios | Restrictions: Must mirror agent-artist error handling approach, use same circuit breaker configuration, publish error events with consistent format, handle documentation-specific errors (invalid markdown), do not duplicate error handling code | Success: Error handling matches agent-artist reliability, circuit breaker configured identically, error events are consistent across agents, documentation errors handled gracefully_

- [ ] 3.7 Scaffold agent-programmer project
  - File: C:\\p4\\Personal\\SD\\agent-programmer/package.json, tsconfig.json, src/index.ts, src/programmer-bot.ts
  - Create TypeScript project extending BaseBot
  - Set up KĀDI client connection (programmer network)
  - Initialize git worktree for agent-playground-programmer
  - Purpose: Create programmer agent foundation
  - _Leverage: C:\\p4\\Personal\\SD\\AGENTS\\shared\\base-bot.ts, agent-artist/designer patterns_
  - _Requirements: 1.1, 3.1.1_
  - _Prompt: Role: TypeScript Developer with focus on architectural consistency | Task: Scaffold agent-programmer project following requirements 1.1 and 3.1.1, following established pattern from agent-artist/designer for programmer role (code implementation), extending BaseBot with programmer network and agent-playground-programmer worktree | Restrictions: Must maintain architectural consistency with other worker agents, configure for programmer network, initialize worktree at C:\\p4\\Personal\\SD\\agent-playground-programmer, reuse utilities from other agents | Success: Project structure consistent with artist/designer, KĀDI client connects to programmer network, git worktree initialized, code follows established patterns, TypeScript compiles_

- [ ] 3.8 Implement agent-programmer task execution logic
  - File: C:\\p4\\Personal\\SD\\agent-programmer/src/programmer-bot.ts
  - Subscribe to programmer.task.assigned events
  - Implement code file operations with syntax validation
  - Publish programmer.file.* events
  - Run code quality checks before committing
  - Commit and push to agent-playground-programmer remote
  - Purpose: Enable programmer agent to execute coding tasks with quality checks
  - _Leverage: agent-artist/designer task execution patterns, code quality tools (ESLint, Prettier)_
  - _Requirements: 3.1.1, 3.1.2, 4.1_
  - _Prompt: Role: Software Engineer with expertise in code quality automation and CI/CD | Task: Implement task execution logic for agent-programmer following requirements 3.1.1, 3.1.2, and 4.1, adapting worker agent patterns for code file operations with pre-commit syntax validation and quality checks using ESLint/Prettier | Restrictions: Must follow artist/designer event pattern, validate code syntax before committing, run linting and formatting checks, publish events at consistent granularity, fail task on quality check failures, use atomic git operations | Success: Programmer agent executes coding tasks correctly, code quality checks run automatically, invalid code prevents commits, events published consistently, git commits include quality-checked code only_

- [ ] 3.9 Add error handling and retry logic to agent-programmer
  - File: C:\\p4\\Personal\\SD\\agent-programmer/src/programmer-bot.ts
  - Implement circuit breaker and retry logic
  - Handle code compilation/validation errors
  - Publish programmer.task.failed events
  - Purpose: Make programmer agent resilient with code-specific error handling
  - _Leverage: BaseBot utilities, agent-artist/designer error handling patterns_
  - _Requirements: 6.1, 6.2_
  - _Prompt: Role: Reliability Engineer with understanding of code compilation and validation errors | Task: Add error handling to agent-programmer following requirements 6.1 and 6.2, extending artist/designer error patterns with code-specific error handling (syntax errors, compilation failures) using BaseBot utilities | Restrictions: Must maintain consistency with other worker agents' error handling, distinguish between retryable errors (transient) and non-retryable errors (syntax), publish detailed error events with code context, use same circuit breaker config, do not retry validation errors | Success: Error handling consistent with other workers, code-specific errors handled appropriately, syntax errors reported clearly, circuit breaker prevents repeated compilation failures, error events actionable_

## Phase 4: Shadow Agent Implementation

- [ ] 4.1 Scaffold shadow-agent-artist project
  - File: C:\\p4\\Personal\\SD\\shadow-agent-artist/package.json, tsconfig.json, src/index.ts, src/shadow-artist-bot.ts
  - Create TypeScript project extending BaseBot (READ-ONLY monitoring mode)
  - Set up KĀDI client connection (artist network, monitoring)
  - Configure git remote: shadow-agent-playground-artist
  - Purpose: Create shadow monitoring agent for artist rollback capability
  - _Leverage: C:\\p4\\Personal\\SD\\AGENTS\\shared\\base-bot.ts, worker agent patterns_
  - _Requirements: 1.1, 4.1, 4.2_
  - _Prompt: Role: TypeScript Developer specializing in monitoring systems and git architecture | Task: Scaffold shadow-agent-artist project following requirements 1.1, 4.1, and 4.2, creating passive monitoring agent that extends BaseBot, subscribes to artist file events without writing to worktree, and configures git remote to shadow-agent-playground-artist for backup pushes | Restrictions: Must operate in READ-ONLY mode (never write to agent-playground-artist), subscribe only to artist.file.* events, configure separate git remote (not origin), do not interfere with worker agent operations, initialize in shadow mode (no task execution) | Success: Shadow agent connects to KĀDI artist network, subscribes to file events correctly, git remote points to shadow-agent-playground-artist, READ-ONLY mode enforced, TypeScript compiles_

- [ ] 4.2 Implement shadow-agent-artist file monitoring
  - File: C:\\p4\\Personal\\SD\\shadow-agent-artist/src/shadow-artist-bot.ts
  - Subscribe to artist.file.created, artist.file.modified, artist.file.deleted events
  - Read file state from agent-playground-artist worktree (READ-ONLY)
  - Create backup commits to shadow-agent-playground-artist
  - Push continuously to shadow remote
  - Purpose: Provide continuous backup of artist work for rollback
  - _Leverage: KĀDI event subscriptions, git utilities_
  - _Requirements: 4.2, 4.3_
  - _Prompt: Role: Backup Systems Engineer with expertise in event-driven monitoring and git workflows | Task: Implement file monitoring for shadow-agent-artist following requirements 4.2 and 4.3, subscribing to all artist file events, reading file state from agent-playground-artist worktree (READ-ONLY), creating backup commits, and pushing continuously to shadow-agent-playground-artist remote | Restrictions: Must never write to agent-playground-artist worktree (READ-ONLY), commit on every file event (not batched), push immediately after commit, handle file deletion events correctly, maintain chronological backup history, do not interfere with worker agent's git operations | Success: Shadow agent receives all file events, backup commits created for each operation, pushes to shadow remote reliably, READ-ONLY guarantee maintained, rollback capability verified by restoring from shadow repo_

- [ ] 4.3 Add error handling for shadow-agent-artist
  - File: C:\\p4\\Personal\\SD\\shadow-agent-artist/src/shadow-artist-bot.ts
  - Implement retry logic for backup failures
  - Handle git conflicts and merge issues
  - Publish shadow.artist.backup.failed events
  - Purpose: Ensure reliable backup even under failure conditions
  - _Leverage: BaseBot error utilities_
  - _Requirements: 6.1, 6.2_
  - _Prompt: Role: Reliability Engineer specializing in backup system resilience | Task: Add error handling to shadow-agent-artist following requirements 6.1 and 6.2, implementing retry logic for backup failures, handling git conflicts gracefully, and publishing failure events using BaseBot utilities | Restrictions: Must retry backup operations on transient failures, do not corrupt backup history on conflicts, publish detailed error events, maintain backup continuity even under partial failures, do not retry non-transient errors indefinitely | Success: Backup operations resilient to transient failures, git conflicts resolved automatically or reported clearly, error events provide actionable information, backup history integrity maintained_

- [ ] 4.4 Scaffold shadow-agent-designer project
  - File: C:\\p4\\Personal\\SD\\shadow-agent-designer/package.json, tsconfig.json, src/index.ts, src/shadow-designer-bot.ts
  - Create TypeScript project extending BaseBot (READ-ONLY monitoring)
  - Set up KĀDI client connection (designer network, monitoring)
  - Configure git remote: shadow-agent-playground-designer
  - Purpose: Create shadow monitoring agent for designer rollback
  - _Leverage: shadow-agent-artist patterns_
  - _Requirements: 1.1, 4.1, 4.2_
  - _Prompt: Role: TypeScript Developer with focus on architectural consistency and monitoring patterns | Task: Scaffold shadow-agent-designer project following requirements 1.1, 4.1, and 4.2, mirroring shadow-agent-artist structure for designer role, extending BaseBot in READ-ONLY mode, connecting to designer network, and configuring shadow-agent-playground-designer remote | Restrictions: Must follow shadow-agent-artist pattern exactly (role-adapted), operate in READ-ONLY mode, configure designer network, set git remote to shadow-agent-playground-designer, do not interfere with agent-designer operations | Success: Project structure matches shadow-agent-artist, KĀDI client connects to designer network, git remote configured correctly, READ-ONLY mode enforced, pattern consistency maintained_

- [ ] 4.5 Implement shadow-agent-designer file monitoring
  - File: C:\\p4\\Personal\\SD\\shadow-agent-designer/src/shadow-designer-bot.ts
  - Subscribe to designer.file.* events
  - Read from agent-playground-designer worktree (READ-ONLY)
  - Create backup commits to shadow-agent-playground-designer
  - Purpose: Provide continuous backup of designer work
  - _Leverage: shadow-agent-artist monitoring pattern_
  - _Requirements: 4.2, 4.3_
  - _Prompt: Role: Backup Systems Engineer focused on consistency and pattern reuse | Task: Implement file monitoring for shadow-agent-designer following requirements 4.2 and 4.3, adapting shadow-agent-artist monitoring pattern for designer file events, reading from agent-playground-designer worktree, and backing up to shadow-agent-playground-designer remote | Restrictions: Must mirror shadow-agent-artist monitoring logic, maintain READ-ONLY guarantee, commit on every file event, push immediately, handle designer-specific file types correctly, maintain backup chronology | Success: Designer shadow agent matches artist shadow behavior, backup operations work reliably, READ-ONLY mode maintained, pattern consistency across shadow agents_

- [ ] 4.6 Add error handling for shadow-agent-designer
  - File: C:\\p4\\Personal\\SD\\shadow-agent-designer/src/shadow-designer-bot.ts
  - Implement retry logic and error handling
  - Publish shadow.designer.backup.failed events
  - Purpose: Ensure reliable designer backup
  - _Leverage: shadow-agent-artist error handling pattern_
  - _Requirements: 6.1, 6.2_
  - _Prompt: Role: Reliability Engineer maintaining consistency across shadow agents | Task: Add error handling to shadow-agent-designer following requirements 6.1 and 6.2, reusing shadow-agent-artist error handling patterns for designer-specific backup failures | Restrictions: Must maintain error handling consistency with shadow-agent-artist, use identical retry configuration, publish events in same format, handle designer-specific errors (documentation file corruption), do not diverge from established pattern | Success: Error handling matches shadow-agent-artist, backup resilience consistent, error events uniform across shadow agents, designer-specific errors handled appropriately_

- [ ] 4.7 Scaffold shadow-agent-programmer project
  - File: C:\\p4\\Personal\\SD\\shadow-agent-programmer/package.json, tsconfig.json, src/index.ts, src/shadow-programmer-bot.ts
  - Create TypeScript project extending BaseBot (READ-ONLY monitoring)
  - Set up KĀDI client connection (programmer network, monitoring)
  - Configure git remote: shadow-agent-playground-programmer
  - Purpose: Create shadow monitoring agent for programmer rollback
  - _Leverage: shadow-agent-artist/designer patterns_
  - _Requirements: 1.1, 4.1, 4.2_
  - _Prompt: Role: TypeScript Developer ensuring architectural consistency across all shadow agents | Task: Scaffold shadow-agent-programmer project following requirements 1.1, 4.1, and 4.2, following established shadow agent pattern for programmer role, extending BaseBot in READ-ONLY mode, connecting to programmer network, and configuring shadow-agent-playground-programmer remote | Restrictions: Must maintain consistency with other shadow agents, operate in READ-ONLY mode, configure programmer network, set git remote to shadow-agent-playground-programmer, reuse shadow agent utilities | Success: Project structure consistent with other shadows, KĀDI client connects to programmer network, git remote configured correctly, READ-ONLY mode enforced, architectural consistency maintained_

- [ ] 4.8 Implement shadow-agent-programmer file monitoring
  - File: C:\\p4\\Personal\\SD\\shadow-agent-programmer/src/shadow-programmer-bot.ts
  - Subscribe to programmer.file.* events
  - Read from agent-playground-programmer worktree (READ-ONLY)
  - Create backup commits to shadow-agent-playground-programmer
  - Purpose: Provide continuous backup of programmer work
  - _Leverage: shadow-agent-artist/designer monitoring patterns_
  - _Requirements: 4.2, 4.3_
  - _Prompt: Role: Backup Systems Engineer with expertise in code backup and versioning | Task: Implement file monitoring for shadow-agent-programmer following requirements 4.2 and 4.3, adapting shadow agent monitoring pattern for programmer file events, reading from agent-playground-programmer worktree, and backing up to shadow-agent-programmer remote | Restrictions: Must follow established shadow monitoring pattern, maintain READ-ONLY guarantee, commit on every file event, push immediately, handle code file backups correctly (preserve syntax), maintain chronological backup history | Success: Programmer shadow agent matches other shadows, backup operations reliable, READ-ONLY mode guaranteed, code files backed up correctly with syntax preservation_

- [ ] 4.9 Add error handling for shadow-agent-programmer
  - File: C:\\p4\\Personal\\SD\\shadow-agent-programmer/src/shadow-programmer-bot.ts
  - Implement retry logic and error handling
  - Publish shadow.programmer.backup.failed events
  - Purpose: Ensure reliable programmer backup
  - _Leverage: shadow-agent-artist/designer error handling patterns_
  - _Requirements: 6.1, 6.2_
  - _Prompt: Role: Reliability Engineer ensuring uniform resilience across all shadow agents | Task: Add error handling to shadow-agent-programmer following requirements 6.1 and 6.2, maintaining consistency with other shadow agents' error handling patterns for backup failures | Restrictions: Must mirror other shadow agents' error handling, use identical retry configuration, publish events in consistent format, handle code-specific errors (binary files, large files), maintain pattern uniformity | Success: Error handling consistent with other shadows, backup resilience uniform, error events follow standard format, code-specific errors handled appropriately, pattern consistency maintained_

## Phase 5: Integration and Testing

- [ ] 5.1 Create end-to-end workflow test (Slack/Discord channel)
  - File: C:\\p4\\Personal\\SD\\AGENTS\\tests\\e2e\\slack-discord-workflow.test.ts
  - Simulate Slack/Discord user interaction
  - Test event-driven task assignment and execution
  - Verify shadow backup operations
  - Test final approval and merge to main playground
  - Purpose: Validate complete workflow for event-driven channels
  - _Leverage: KĀDI test utilities, worker/shadow agent implementations_
  - _Requirements: All (end-to-end validation)_
  - _Prompt: Role: QA Automation Engineer with expertise in E2E testing and event-driven systems | Task: Create comprehensive end-to-end test for Slack/Discord workflow covering all requirements, simulating user interaction via KĀDI events, verifying task execution, shadow backups, and final approval/merge process | Restrictions: Must test real event flows (not mocked events), verify shadow backups in actual git repos, test approval workflow completely, ensure test cleanup (worktrees, git repos), use isolated test environment | Success: E2E test covers complete Slack/Discord user journey, all agent interactions verified, shadow backups validated, approval and merge work correctly, test is reliable and repeatable, proper cleanup on success/failure_

- [ ] 5.2 Create end-to-end workflow test (Claude Code/Desktop channel)
  - File: C:\\p4\\Personal\\SD\\AGENTS\\tests\\e2e\\claude-code-workflow.test.ts
  - Simulate Claude Code/Desktop MCP tool invocations
  - Test tool-based task planning and status queries
  - Verify structured JSON responses
  - Test approval workflow via tools
  - Purpose: Validate complete workflow for tool-based channels
  - _Leverage: MCP tool implementations, worker/shadow agent logic_
  - _Requirements: All (end-to-end validation)_
  - _Prompt: Role: QA Automation Engineer specializing in MCP protocol and tool-based testing | Task: Create comprehensive end-to-end test for Claude Code/Desktop workflow covering all requirements, invoking MCP tools directly, verifying task planning/execution via tools, validating JSON responses, and testing approval via approve_completion tool | Restrictions: Must test real MCP tool invocations (not mocked), verify JSON response schemas with Zod, test synchronous request-response pattern, ensure proper error responses, validate tool-based approval workflow | Success: E2E test covers complete Claude Code user journey, all MCP tools verified, JSON responses validated, approval workflow works via tools, test reliable and isolated_

- [ ] 5.3 Create integration test for shadow backup rollback
  - File: C:\\p4\\Personal\\SD\\AGENTS\\tests\\integration\\shadow-rollback.test.ts
  - Simulate worker agent file operations
  - Verify shadow agent backup commits
  - Test rollback from shadow-agent-playground-* repos
  - Validate restored state matches original
  - Purpose: Ensure shadow agents provide reliable rollback capability
  - _Leverage: Shadow agent implementations, git utilities_
  - _Requirements: 4.1, 4.2, 4.3_
  - _Prompt: Role: QA Engineer with expertise in backup/restore testing and git workflows | Task: Create integration test for shadow backup rollback following requirements 4.1, 4.2, and 4.3, simulating worker file operations, verifying shadow backups, performing rollback from shadow repos, and validating state restoration | Restrictions: Must test actual git operations (not mocked), verify backup chronology matches worker operations, test rollback at different points in time, validate file content integrity after restore, clean up test repos | Success: Test verifies shadow backups work correctly, rollback restores exact state, backup chronology preserved, file integrity validated, test is reliable and repeatable_

- [ ] 5.4 Create integration test for git worktree isolation
  - File: C:\\p4\\Personal\\SD\\AGENTS\\tests\\integration\\worktree-isolation.test.ts
  - Test concurrent agent execution in separate worktrees
  - Verify worktree isolation (no cross-contamination)
  - Test worktree cleanup on task completion
  - Validate orphaned worktree detection and cleanup
  - Purpose: Ensure git worktrees provide proper isolation for concurrent agents
  - _Leverage: git-worktree.ts utilities, worker agent patterns_
  - _Requirements: 3.2.1_
  - _Prompt: Role: Integration Test Engineer with expertise in git internals and concurrency testing | Task: Create integration test for git worktree isolation following requirement 3.2.1, testing concurrent agent execution, verifying no cross-contamination between worktrees, validating cleanup, and detecting orphaned worktrees | Restrictions: Must test real concurrent execution (not sequential), verify file system isolation, test cleanup on success and failure, detect and clean orphaned worktrees, ensure no git state corruption | Success: Test validates worktree isolation, concurrent execution works safely, cleanup verified, orphaned worktree detection works, no git corruption occurs_

- [ ] 5.5 Create unit tests for MCP tools
  - File: C:\\p4\\Personal\\SD\\AGENTS\\tests\\unit\\mcp-tools.test.ts
  - Test parameter validation with Zod schemas
  - Test error handling for invalid inputs
  - Mock upstream MCP server responses
  - Verify channel-specific response formatting
  - Purpose: Ensure MCP tools work correctly in isolation
  - _Leverage: MCP tool implementations (plan-task.ts, list-tasks.ts, task-status.ts, approve-completion.ts)_
  - _Requirements: 2.1.1, 5.1, 5.2, 5.3, 5.4_
  - _Prompt: Role: Unit Test Developer with expertise in Zod validation and MCP protocol testing | Task: Create comprehensive unit tests for all MCP tools following requirements 2.1.1, 5.1-5.4, testing parameter validation, error handling, mocked upstream responses, and channel-specific formatting | Restrictions: Must test validation before business logic, mock all upstream dependencies, test both success and error scenarios, verify response format for each channel type, ensure test isolation | Success: All MCP tools have comprehensive unit tests, validation tested thoroughly, error scenarios covered, channel-specific formatting verified, tests run independently_

- [ ] 5.6 Create unit tests for BaseBot utilities
  - File: C:\\p4\\Personal\\SD\\AGENTS\\tests\\unit\\base-bot.test.ts
  - Test circuit breaker behavior
  - Test retry logic with exponential backoff
  - Test metrics tracking
  - Purpose: Ensure BaseBot utilities work correctly
  - _Leverage: C:\\p4\\Personal\\SD\\AGENTS\\shared\\base-bot.ts_
  - _Requirements: 6.1, 6.2_
  - _Prompt: Role: Unit Test Developer specializing in reliability patterns and fault tolerance testing | Task: Create comprehensive unit tests for BaseBot utilities following requirements 6.1 and 6.2, testing circuit breaker behavior, retry logic with exponential backoff, and metrics tracking | Restrictions: Must test circuit breaker state transitions, verify exponential backoff timing, validate metrics accuracy, test edge cases (immediate failures, slow recovery), ensure test isolation | Success: BaseBot utilities fully tested, circuit breaker behavior verified, retry logic validated, metrics tracking accurate, edge cases covered_

- [ ] 5.7 Document deployment and operational procedures
  - File: C:\\p4\\Personal\\SD\\AGENTS\\docs\\deployment.md, C:\\p4\\Personal\\SD\\AGENTS\\docs\\operations.md
  - Document environment setup and configuration
  - Create deployment checklist
  - Document monitoring and alerting procedures
  - Create troubleshooting guide
  - Purpose: Provide clear guidance for deployment and operations
  - _Leverage: Implementation details from all components_
  - _Requirements: All_
  - _Prompt: Role: Technical Writer with DevOps expertise and operational documentation experience | Task: Create comprehensive deployment and operations documentation covering all requirements, documenting environment setup, configuration, deployment steps, monitoring, and troubleshooting procedures | Restrictions: Must include specific configuration values, provide step-by-step deployment instructions, document all monitoring metrics, include common issues and solutions, maintain accuracy with implementation | Success: Documentation is complete and accurate, deployment checklist covers all steps, troubleshooting guide addresses common issues, monitoring procedures clearly defined, documentation validated by performing actual deployment_

'''

# Write tasks.md
with open(output_path, 'w', encoding='utf-8') as f:
    f.write(tasks_content)

print("[SUCCESS] Generated tasks.md")
print(f"Location: {output_path}")
print("")
print("Task Breakdown Summary:")
print("  Phase 1: Project Setup and Configuration (3 tasks)")
print("  Phase 2: agent-producer MCP Tools (4 tasks)")
print("  Phase 3: Worker Agent Implementation (9 tasks)")
print("  Phase 4: Shadow Agent Implementation (9 tasks)")
print("  Phase 5: Integration and Testing (7 tasks)")
print("")
print("Total: 32 atomic implementation tasks")
print("")
print("Key Features:")
print("  - Each task follows atomic task pattern from template")
print("  - All tasks include _Prompt field with Role/Task/Restrictions/Success")
print("  - Dependencies tracked via task ordering")
print("  - Leverages existing code (BaseBot, MCP server patterns)")
print("  - Follows repository architecture (agent code vs playground separation)")
