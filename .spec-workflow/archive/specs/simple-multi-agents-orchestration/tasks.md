# Tasks Document

## Phase 1: Project Setup and Configuration

- [ ] 1.1 Initialize agent-producer project structure
  - File: C:\p4\Personal\SD\agent-producer/package.json, tsconfig.json, src/index.ts
  - Clone from template-agent-typescript to create KĀDI agent (NOT MCP server)
  - Customize with KadiClient for tool registration and event publishing
  - Set up project structure with SlackBot/DiscordBot from template
  - Purpose: Establish orchestrator KĀDI agent foundation
  - _Leverage: C:\p4\Personal\SD\template-agent-typescript, C:\p4\Personal\SD\AGENTS\shared\base-bot.ts_
  - _Requirements: 1.1, 1.2_
  - _Architecture: agent-producer is a KĀDI Agent that registers tools with broker, NOT an MCP server_
  - _Prompt: Role: TypeScript Developer specializing in KĀDI agent architecture | Task: Initialize agent-producer by cloning template-agent-typescript following requirements 1.1 and 1.2, setting up KĀDI agent structure with tool registration pattern | Restrictions: Must use KadiClient for tool registration (kadiClient.registerTool), NOT @modelcontextprotocol/sdk Server, customize SlackBot/DiscordBot from template, maintain TypeScript strict mode | Success: Project compiles without errors, KadiClient initializes correctly, tools registered with broker, proper dependency management with package.json_

- [ ] 1.2 Configure KĀDI broker MCP upstreams
  - File: C:\p4\Personal\SD\kadi\kadi-broker\config\mcp-upstreams.json
  - Register MCP server: mcp-shrimp-task-manager
  - Configure network assignments for each upstream
  - Purpose: Enable agent-producer to access task management and spec workflow tools
  - _Leverage: KĀDI broker documentation, existing MCP server configs_
  - _Requirements: 2.1.1, 2.1.2_
  - _Prompt: Role: DevOps Engineer with expertise in message broker configuration and MCP protocol | Task: Configure KĀDI broker to register mcp-shrimp-task-manager as upstream following requirements 2.1.1 and 2.1.2, assigning to appropriate networks (global, git, etc.) | Restrictions: Must follow KĀDI broker config schema, ensure network isolation is maintained, do not expose sensitive MCP tools to unauthorized networks | Success: MCP upstreams are registered and accessible, network assignments verified, agent-producer can invoke upstream tools_

- [ ] 2.1 Implement plan_task KĀDI tool
  - File: C:\p4\Personal\SD\agent-producer/src/tools/plan-task.ts
  - Register KĀDI tool via kadiClient.registerTool() for task planning
  - Tool handler forwards requests to mcp-shrimp-task-manager via kadiClient.load()
  - Add Zod schema validation for parameters
  - Purpose: Allow Slack/Discord/Claude Code users to create task plans via KĀDI broker
  - _Leverage: C:\p4\Personal\SD\template-agent-typescript tool registration pattern, C:\GitHub\mcp-shrimp-task-manager_
  - _Requirements: 2.1.1, 5.1_
  - _Prompt: Role: Full-stack Developer with expertise in KĀDI protocol and Zod validation | Task: Implement plan_task KĀDI tool following requirements 2.1.1 and 5.1, registering tool with kadiClient.registerTool() and forwarding to mcp-shrimp-task-manager via kadiClient.load() | Restrictions: Must validate all parameters with Zod before forwarding, handle upstream errors gracefully, return structured JSON responses, do not bypass validation | Success: Tool is registered with KĀDI broker, parameter validation works correctly, successful integration with upstream task manager via kadiClient.load(), proper error responses_

- [ ] 2.2 Implement list_active_tasks KĀDI tool
  - File: C:\p4\Personal\SD\agent-producer/src/tools/list-tasks.ts
  - Register KĀDI tool via kadiClient.registerTool() for listing tasks
  - Add filtering by status (pending, in_progress, completed)
  - Format response for different channels (Slack/Discord markdown vs Claude Code JSON)
  - Purpose: Allow users to query current task status
  - _Leverage: C:\GitHub\mcp-shrimp-task-manager\src\index.ts, design.md channel patterns_
  - _Requirements: 2.1.1, 5.2_
  - _Prompt: Role: API Developer specializing in data formatting and channel-specific responses | Task: Implement list_active_tasks MCP tool following requirements 2.1.1 and 5.2, creating handler that queries upstream and formats responses differently for event-driven channels (Slack/Discord) vs tool-based channels (Claude Code/Desktop) | Restrictions: Must detect channel type from request context, format Slack/Discord responses as conversational markdown, format Claude Code responses as structured JSON, handle empty task lists gracefully | Success: Tool returns properly formatted responses for each channel type, filtering works correctly, performance is acceptable for large task lists_

- [ ] 2.3 Implement get_task_status KĀDI tool
  - File: C:\p4\Personal\SD\agent-producer/src/tools/task-status.ts
  - Register KĀDI tool via kadiClient.registerTool() for detailed status retrieval
  - Include worker agent progress, file operations, error logs
  - Add real-time status updates via event subscriptions
  - Purpose: Provide detailed task execution visibility
  - _Leverage: KĀDI event subscriptions, mcp-shrimp-task-manager upstream_
  - _Requirements: 2.1.1, 5.3_
  - _Prompt: Role: Backend Developer with expertise in real-time data streaming and event-driven architectures | Task: Implement get_task_status MCP tool following requirements 2.1.1 and 5.3, creating handler that retrieves task details from upstream and subscribes to relevant KĀDI events for real-time updates | Restrictions: Must subscribe to task-specific events only (avoid global subscriptions), handle event unsubscription on completion, provide consistent status format across channels, do not block on event waits | Success: Tool provides comprehensive task status, real-time updates work correctly, proper cleanup of event subscriptions, good performance even with many concurrent status queries_

- [ ] 2.4 Implement approve_completion KĀDI tool
  - File: C:\p4\Personal\SD\agent-producer/src/tools/approve-completion.ts
  - Register KĀDI tool via kadiClient.registerTool() for approval workflow
  - Trigger git operations to main playground repo
  - Send approval notifications via KĀDI events
  - Purpose: Allow users to approve task completion and trigger final git push
  - _Leverage: git-worktree.ts utilities, KĀDI event publishing_
  - _Requirements: 2.1.1, 5.4, 3.2.2_
  - _Prompt: Role: Workflow Automation Engineer with expertise in approval processes and git operations | Task: Implement approve_completion MCP tool following requirements 2.1.1, 5.4, and 3.2.2, creating approval workflow that validates completion criteria, performs git operations to merge work to main playground repo, and publishes approval events | Restrictions: Must verify task completion before allowing approval, validate git state before pushing, use atomic git operations (rollback on failure), require explicit user confirmation, publish approval events only after successful git push | Success: Approval workflow prevents premature approvals, git operations are atomic and safe, proper event notifications sent, audit trail of approvals maintained_

## Phase 3: Worker Agent Implementation

- [ ] 3.1 Scaffold agent-artist project from template
  - File: Clone from C:\p4\Personal\SD\template-agent-typescript to C:\p4\Personal\SD\agent-artist
  - Customize package.json, update project name and description
  - Configure git worktree for agent-playground-artist
  - Leverage existing slack-bot.ts and discord-bot.ts from template
  - Purpose: Create artist agent foundation with pre-built channel integrations
  - _Leverage: C:\p4\Personal\SD\template-agent-typescript (slack-bot, discord-bot), C:\p4\Personal\SD\AGENTS\shared\base-bot.ts_
  - _Requirements: 1.1, 3.1.1_
  - _Prompt: Role: TypeScript Developer specializing in agent architectures and template customization | Task: Clone template-agent-typescript to create agent-artist following requirements 1.1 and 3.1.1, customizing project metadata, configuring git worktree for agent-playground-artist, and leveraging existing slack-bot/discord-bot implementations from template | Restrictions: Must reuse template's slack-bot and discord-bot (not rewrite), configure KĀDI client with artist network assignment, initialize git worktree at C:\p4\Personal\SD\agent-playground-artist, update all template placeholders with artist-specific values | Success: Project cloned and customized successfully, slack-bot/discord-bot configured for artist role, git worktree initialized correctly, KĀDI client connects to artist network, TypeScript compiles without errors_

- [ ] 3.2 Implement agent-artist task execution logic
  - File: C:\p4\Personal\SD\agent-artist/src/bot/slack-bot.ts, src/bot/discord-bot.ts
  - Customize slack-bot.ts and discord-bot.ts to handle artist tasks
  - Subscribe to KĀDI events for artist tasks (artist.task.assigned)
  - Implement file operations in agent-playground-artist worktree
  - Publish file operation events (artist.file.created, artist.file.modified)
  - Commit and push changes to agent-playground-artist remote
  - Purpose: Enable artist agent to execute assigned tasks via Slack/Discord channels
  - _Leverage: Template's existing slack-bot.ts and discord-bot.ts, BaseBot event patterns_
  - _Requirements: 3.1.1, 3.1.2, 4.1_
  - _Prompt: Role: Event-Driven Systems Developer with expertise in Slack/Discord bot customization and git workflows | Task: Customize slack-bot.ts and discord-bot.ts for agent-artist following requirements 3.1.1, 3.1.2, and 4.1, adding artist-specific task execution logic (subscribing to artist.task.assigned events, performing file operations in worktree, publishing file events, committing to agent-playground-artist repo) | Restrictions: Must preserve existing Slack/Discord channel interaction logic from template, add artist-specific logic to task execution methods, validate file paths are within worktree, publish events before/after operations, use atomic git commits, handle task interruption gracefully | Success: Slack and Discord bots handle artist tasks correctly, file operations work reliably in worktree, events published at correct times, git commits are atomic and attributed, existing channel interaction logic preserved_

- [ ] 3.3 Add error handling and retry logic to agent-artist
  - File: C:\p4\Personal\SD\agent-artist/src/bot/slack-bot.ts, src/bot/discord-bot.ts
  - Implement circuit breaker for repeated failures
  - Add exponential backoff retry for transient errors
  - Publish error events (artist.task.failed)
  - Purpose: Make artist agent resilient to failures
  - _Leverage: BaseBot circuit breaker and retry utilities_
  - _Requirements: 6.1, 6.2_
  - _Prompt: Role: Reliability Engineer with expertise in fault tolerance and error handling patterns | Task: Add comprehensive error handling to agent-artist following requirements 6.1 and 6.2, implementing circuit breaker pattern, exponential backoff retry, and error event publishing using BaseBot utilities | Restrictions: Must use BaseBot circuit breaker (not custom implementation), retry only transient errors (not validation errors), publish error events with detailed context, do not retry indefinitely (max 3 retries), fail fast on unrecoverable errors | Success: Circuit breaker prevents cascading failures, retry logic handles transient errors correctly, error events provide actionable information, agent degrades gracefully under failure conditions_

- [ ] 3.4 Scaffold agent-designer project from template
  - File: Clone from C:\p4\Personal\SD\template-agent-typescript to C:\p4\Personal\SD\agent-designer
  - Customize package.json for designer role
  - Configure git worktree for agent-playground-designer
  - Leverage existing slack-bot.ts and discord-bot.ts from template
  - Purpose: Create designer agent foundation with pre-built channel integrations
  - _Leverage: C:\p4\Personal\SD\template-agent-typescript, agent-artist customization patterns_
  - _Requirements: 1.1, 3.1.1_
  - _Prompt: Role: TypeScript Developer with expertise in template customization and consistency | Task: Clone template-agent-typescript to create agent-designer following requirements 1.1 and 3.1.1, mirroring agent-artist customization approach for designer role (documentation/design work), configuring git worktree for agent-playground-designer | Restrictions: Must follow agent-artist customization pattern, reuse template's slack-bot/discord-bot, configure KĀDI client for designer network, initialize worktree at C:\p4\Personal\SD\agent-playground-designer, maintain consistency with agent-artist setup | Success: Project cloned and customized consistently with agent-artist, slack-bot/discord-bot configured for designer role, git worktree initialized correctly, KĀDI client connects to designer network, TypeScript compiles_

- [ ] 3.5 Implement agent-designer task execution logic
  - File: C:\p4\Personal\SD\agent-designer/src/bot/slack-bot.ts, src/bot/discord-bot.ts
  - Customize slack-bot.ts and discord-bot.ts for designer tasks
  - Subscribe to designer.task.assigned events
  - Implement documentation/design file operations
  - Publish designer.file.* events
  - Commit and push to agent-playground-designer remote
  - Purpose: Enable designer agent to execute documentation tasks via Slack/Discord channels
  - _Leverage: agent-artist bot customization pattern, template's slack-bot.ts and discord-bot.ts_
  - _Requirements: 3.1.1, 3.1.2, 4.1_
  - _Prompt: Role: Software Engineer with expertise in documentation tooling and Slack/Discord bot customization | Task: Customize slack-bot.ts and discord-bot.ts for agent-designer following requirements 3.1.1, 3.1.2, and 4.1, adapting agent-artist bot customization patterns for documentation/design file operations (subscribing to designer.task.assigned events, handling markdown/diagrams, publishing designer.file.* events, committing to agent-playground-designer repo) | Restrictions: Must follow agent-artist bot customization pattern exactly, preserve existing Slack/Discord interaction logic, handle documentation-specific file types correctly, publish events at same granularity as artist, use atomic git operations, maintain pattern consistency | Success: Designer bots execute documentation tasks correctly, file operations handle markdown/diagrams properly, events published consistently, git commits work reliably, pattern consistency with agent-artist maintained_

- [ ] 3.6 Add error handling and retry logic to agent-designer
  - File: C:\p4\Personal\SD\agent-designer/src/bot/slack-bot.ts, src/bot/discord-bot.ts
  - Implement circuit breaker and retry logic
  - Publish designer.task.failed events
  - Purpose: Make designer agent resilient
  - _Leverage: BaseBot utilities, agent-artist error handling patterns_
  - _Requirements: 6.1, 6.2_
  - _Prompt: Role: Reliability Engineer focused on consistency and fault tolerance | Task: Add error handling to agent-designer following requirements 6.1 and 6.2, reusing agent-artist error handling patterns with BaseBot circuit breaker and retry logic for designer-specific error scenarios | Restrictions: Must mirror agent-artist error handling approach, use same circuit breaker configuration, publish error events with consistent format, handle documentation-specific errors (invalid markdown), do not duplicate error handling code | Success: Error handling matches agent-artist reliability, circuit breaker configured identically, error events are consistent across agents, documentation errors handled gracefully_

- [ ] 3.7 Scaffold agent-programmer project from template
  - File: Clone from C:\p4\Personal\SD\template-agent-typescript to C:\p4\Personal\SD\agent-programmer
  - Customize package.json for programmer role
  - Configure git worktree for agent-playground-programmer
  - Leverage existing slack-bot.ts and discord-bot.ts from template
  - Purpose: Create programmer agent foundation with pre-built channel integrations
  - _Leverage: C:\p4\Personal\SD\template-agent-typescript, agent-artist/designer customization patterns_
  - _Requirements: 1.1, 3.1.1_
  - _Prompt: Role: TypeScript Developer with focus on architectural consistency and template reuse | Task: Clone template-agent-typescript to create agent-programmer following requirements 1.1 and 3.1.1, maintaining consistency with agent-artist/designer customization patterns for programmer role (code implementation), configuring git worktree for agent-playground-programmer | Restrictions: Must maintain consistency with artist/designer setup, reuse template's slack-bot/discord-bot, configure KĀDI client for programmer network, initialize worktree at C:\p4\Personal\SD\agent-playground-programmer, follow established customization pattern | Success: Project cloned and customized consistently with artist/designer, slack-bot/discord-bot configured for programmer role, git worktree initialized correctly, KĀDI client connects to programmer network, TypeScript compiles_

- [ ] 3.8 Implement agent-programmer task execution logic
  - File: C:\p4\Personal\SD\agent-programmer/src/bot/slack-bot.ts, src/bot/discord-bot.ts
  - Customize slack-bot.ts and discord-bot.ts for programmer tasks
  - Subscribe to programmer.task.assigned events
  - Implement code file operations with syntax validation
  - Publish programmer.file.* events
  - Run code quality checks before committing
  - Commit and push to agent-playground-programmer remote
  - Purpose: Enable programmer agent to execute coding tasks with quality checks via Slack/Discord channels
  - _Leverage: agent-artist/designer bot customization patterns, code quality tools (ESLint, Prettier)_
  - _Requirements: 3.1.1, 3.1.2, 4.1_
  - _Prompt: Role: Software Engineer with expertise in code quality automation and Slack/Discord bot customization | Task: Customize slack-bot.ts and discord-bot.ts for agent-programmer following requirements 3.1.1, 3.1.2, and 4.1, adapting worker agent bot patterns for code file operations with pre-commit syntax validation and quality checks using ESLint/Prettier | Restrictions: Must follow artist/designer bot customization pattern exactly, preserve Slack/Discord interaction logic, validate code syntax before committing, run linting/formatting checks, publish events at consistent granularity, fail task on quality check failures, use atomic git operations | Success: Programmer bots execute coding tasks correctly, code quality checks run automatically, invalid code prevents commits, events published consistently, git commits include quality-checked code only, pattern consistency maintained_

- [ ] 3.9 Add error handling and retry logic to agent-programmer
  - File: C:\p4\Personal\SD\agent-programmer/src/bot/slack-bot.ts, src/bot/discord-bot.ts
  - Implement circuit breaker and retry logic
  - Handle code compilation/validation errors
  - Publish programmer.task.failed events
  - Purpose: Make programmer agent resilient with code-specific error handling
  - _Leverage: BaseBot utilities, agent-artist/designer error handling patterns_
  - _Requirements: 6.1, 6.2_
  - _Prompt: Role: Reliability Engineer with understanding of code compilation and validation errors | Task: Add error handling to agent-programmer following requirements 6.1 and 6.2, extending artist/designer error patterns with code-specific error handling (syntax errors, compilation failures) using BaseBot utilities | Restrictions: Must maintain consistency with other worker agents' error handling, distinguish between retryable errors (transient) and non-retryable errors (syntax), publish detailed error events with code context, use same circuit breaker config, do not retry validation errors | Success: Error handling consistent with other workers, code-specific errors handled appropriately, syntax errors reported clearly, circuit breaker prevents repeated compilation failures, error events actionable_

## Phase 4: Shadow Agent Implementation

- [ ] 4.1 Scaffold shadow-agent-artist project from template
  - File: Clone from C:\p4\Personal\SD\template-agent-typescript to C:\p4\Personal\SD\shadow-agent-artist
  - Customize package.json for shadow-artist monitoring role
  - Configure to use agent-playground-artist worktree (shared with agent-artist)
  - Add git remote for shadow-agent-playground-artist backup repository
  - Purpose: Create shadow monitoring agent for artist rollback capability
  - _Leverage: C:\p4\Personal\SD\template-agent-typescript, agent-artist patterns_
  - _Requirements: 1.1, 4.1, 4.2_
  - _Prompt: Role: TypeScript Developer specializing in monitoring systems and git multi-remote architecture | Task: Clone template-agent-typescript to create shadow-agent-artist following requirements 1.1, 4.1, and 4.2, customizing for passive monitoring role, configuring to use shared agent-playground-artist worktree (same as agent-artist), and adding shadow-agent-playground-artist as additional git remote for backup pushes | Restrictions: Must operate in READ-ONLY mode (never write files, only read and commit/push via git), subscribe only to artist.file.* events, configure shadow-agent-playground-artist as separate git remote (not replacing origin), do not interfere with agent-artist's git operations, share worktree at C:\p4\Personal\SD\agent-playground-artist | Success: Shadow agent cloned and customized successfully, uses shared worktree with agent-artist, shadow-agent-playground-artist remote configured correctly, READ-ONLY file operations enforced, KĀDI client connects to artist network, TypeScript compiles_

- [ ] 4.2 Implement shadow-agent-artist file monitoring with shared worktree
  - File: C:\p4\Personal\SD\shadow-agent-artist/src/bot/slack-bot.ts, src/bot/discord-bot.ts
  - Subscribe to artist.file.created, artist.file.modified, artist.file.deleted events
  - On each file event, create backup commit in shared agent-playground-artist worktree
  - Push backup commits to shadow-agent-playground-artist remote (separate from agent-artist's pushes)
  - Purpose: Provide continuous backup of artist work for rollback using shared worktree with different remote
  - _Leverage: KĀDI event subscriptions, git multi-remote utilities, agent-artist worktree_
  - _Requirements: 4.2, 4.3_
  - _Prompt: Role: Backup Systems Engineer with expertise in git multi-remote workflows and Slack/Discord bot customization | Task: Customize slack-bot.ts and discord-bot.ts for shadow-agent-artist following requirements 4.2 and 4.3, implementing passive monitoring logic (subscribing to artist.file.* events, creating backup commits in shared agent-playground-artist worktree, pushing to shadow-agent-playground-artist remote while agent-artist pushes same worktree to agent-playground-artist remote) | Restrictions: Must preserve Slack/Discord interaction logic from template, use shared worktree at C:\p4\Personal\SD\agent-playground-artist, create backup commits on every file event, push to shadow-agent-playground-artist remote only, coordinate with agent-artist's git operations (avoid conflicts), maintain chronological backup history | Success: Shadow bots receive all file events via Slack/Discord, backup commits created in shared worktree, pushes to shadow-agent-playground-artist remote successfully, no conflicts with agent-artist's pushes, rollback capability verified, Slack/Discord interaction preserved_

- [ ] 4.3 Add error handling for shadow-agent-artist
  - File: C:\p4\Personal\SD\shadow-agent-artist/src/bot/slack-bot.ts, src/bot/discord-bot.ts
  - Implement retry logic for backup failures
  - Handle git conflicts and merge issues
  - Publish shadow.artist.backup.failed events
  - Purpose: Ensure reliable backup even under failure conditions
  - _Leverage: BaseBot error utilities_
  - _Requirements: 6.1, 6.2_
  - _Prompt: Role: Reliability Engineer specializing in backup system resilience | Task: Add error handling to shadow-agent-artist following requirements 6.1 and 6.2, implementing retry logic for backup failures, handling git conflicts gracefully, and publishing failure events using BaseBot utilities | Restrictions: Must retry backup operations on transient failures, do not corrupt backup history on conflicts, publish detailed error events, maintain backup continuity even under partial failures, do not retry non-transient errors indefinitely | Success: Backup operations resilient to transient failures, git conflicts resolved automatically or reported clearly, error events provide actionable information, backup history integrity maintained_

- [ ] 4.4 Scaffold shadow-agent-designer project from template
  - File: Clone from C:\p4\Personal\SD\template-agent-typescript to C:\p4\Personal\SD\shadow-agent-designer
  - Customize package.json for shadow-designer monitoring role
  - Configure to use agent-playground-designer worktree (shared with agent-designer)
  - Add git remote for shadow-agent-playground-designer backup repository
  - Purpose: Create shadow monitoring agent for designer rollback
  - _Leverage: C:\p4\Personal\SD\template-agent-typescript, shadow-agent-artist patterns_
  - _Requirements: 1.1, 4.1, 4.2_
  - _Prompt: Role: TypeScript Developer with focus on architectural consistency and template reuse | Task: Clone template-agent-typescript to create shadow-agent-designer following requirements 1.1, 4.1, and 4.2, mirroring shadow-agent-artist setup for designer role, configuring shared agent-playground-designer worktree, and adding shadow-agent-playground-designer git remote | Restrictions: Must follow shadow-agent-artist pattern exactly (role-adapted), operate in READ-ONLY mode (no file writes), configure designer network, share worktree at C:\p4\Personal\SD\agent-playground-designer, add shadow-agent-playground-designer as separate git remote, maintain consistency with shadow-agent-artist setup | Success: Project cloned and customized consistently with shadow-agent-artist, uses shared worktree with agent-designer, shadow-agent-playground-designer remote configured correctly, READ-ONLY mode enforced, KĀDI client connects to designer network, TypeScript compiles_

- [ ] 4.5 Implement shadow-agent-designer file monitoring with shared worktree
  - File: C:\p4\Personal\SD\shadow-agent-designer/src/bot/slack-bot.ts, src/bot/discord-bot.ts
  - Subscribe to designer.file.* events
  - Create backup commits in shared agent-playground-designer worktree
  - Push backup commits to shadow-agent-playground-designer remote
  - Purpose: Provide continuous backup of designer work using shared worktree
  - _Leverage: shadow-agent-artist monitoring pattern, agent-designer worktree_
  - _Requirements: 4.2, 4.3_
  - _Prompt: Role: Backup Systems Engineer focused on consistency and Slack/Discord bot customization | Task: Customize slack-bot.ts and discord-bot.ts for shadow-agent-designer following requirements 4.2 and 4.3, mirroring shadow-agent-artist bot customization pattern for designer file events (creating backup commits in shared agent-playground-designer worktree, pushing to shadow-agent-playground-designer remote) | Restrictions: Must follow shadow-agent-artist bot customization pattern exactly, preserve Slack/Discord interaction logic, use shared worktree at C:\p4\Personal\SD\agent-playground-designer, create commits on every file event, push to shadow-agent-playground-designer remote only, coordinate with agent-designer's git operations | Success: Designer shadow bots match artist shadow behavior, backup commits created in shared worktree, pushes to shadow-agent-playground-designer remote successfully, no conflicts with agent-designer's pushes, pattern consistency across shadow agents_

- [ ] 4.6 Add error handling for shadow-agent-designer
  - File: C:\p4\Personal\SD\shadow-agent-designer/src/bot/slack-bot.ts, src/bot/discord-bot.ts
  - Implement retry logic and error handling
  - Publish shadow.designer.backup.failed events
  - Purpose: Ensure reliable designer backup
  - _Leverage: shadow-agent-artist error handling pattern_
  - _Requirements: 6.1, 6.2_
  - _Prompt: Role: Reliability Engineer maintaining consistency across shadow agents | Task: Add error handling to shadow-agent-designer following requirements 6.1 and 6.2, reusing shadow-agent-artist error handling patterns for designer-specific backup failures | Restrictions: Must maintain error handling consistency with shadow-agent-artist, use identical retry configuration, publish events in same format, handle designer-specific errors (documentation file corruption), do not diverge from established pattern | Success: Error handling matches shadow-agent-artist, backup resilience consistent, error events uniform across shadow agents, designer-specific errors handled appropriately_

- [ ] 4.7 Scaffold shadow-agent-programmer project from template
  - File: Clone from C:\p4\Personal\SD\template-agent-typescript to C:\p4\Personal\SD\shadow-agent-programmer
  - Customize package.json for shadow-programmer monitoring role
  - Configure to use agent-playground-programmer worktree (shared with agent-programmer)
  - Add git remote for shadow-agent-playground-programmer backup repository
  - Purpose: Create shadow monitoring agent for programmer rollback
  - _Leverage: C:\p4\Personal\SD\template-agent-typescript, shadow-agent-artist/designer patterns_
  - _Requirements: 1.1, 4.1, 4.2_
  - _Prompt: Role: TypeScript Developer ensuring architectural consistency across all shadow agents | Task: Clone template-agent-typescript to create shadow-agent-programmer following requirements 1.1, 4.1, and 4.2, maintaining consistency with shadow-agent-artist/designer setup for programmer role, configuring shared agent-playground-programmer worktree, and adding shadow-agent-playground-programmer git remote | Restrictions: Must maintain consistency with other shadow agents, operate in READ-ONLY mode (no file writes), configure programmer network, share worktree at C:\p4\Personal\SD\agent-playground-programmer, add shadow-agent-playground-programmer as separate git remote, follow established shadow agent pattern | Success: Project cloned and customized consistently with other shadows, uses shared worktree with agent-programmer, shadow-agent-playground-programmer remote configured correctly, READ-ONLY mode enforced, KĀDI client connects to programmer network, TypeScript compiles_

- [ ] 4.8 Implement shadow-agent-programmer file monitoring with shared worktree
  - File: C:\p4\Personal\SD\shadow-agent-programmer/src/bot/slack-bot.ts, src/bot/discord-bot.ts
  - Subscribe to programmer.file.* events
  - Create backup commits in shared agent-playground-programmer worktree
  - Push backup commits to shadow-agent-playground-programmer remote
  - Purpose: Provide continuous backup of programmer work using shared worktree
  - _Leverage: shadow-agent-artist/designer monitoring patterns, agent-programmer worktree_
  - _Requirements: 4.2, 4.3_
  - _Prompt: Role: Backup Systems Engineer with expertise in code versioning and Slack/Discord bot customization | Task: Customize slack-bot.ts and discord-bot.ts for shadow-agent-programmer following requirements 4.2 and 4.3, maintaining consistency with other shadow agent bot customizations for programmer file events (creating backup commits in shared agent-playground-programmer worktree, pushing to shadow-agent-playground-programmer remote) | Restrictions: Must follow established shadow bot customization pattern exactly, preserve Slack/Discord interaction logic, use shared worktree at C:\p4\Personal\SD\agent-playground-programmer, create commits on every file event, push to shadow-agent-playground-programmer remote only, coordinate with agent-programmer's git operations | Success: Programmer shadow bots match other shadows exactly, backup commits created in shared worktree, pushes to shadow-agent-playground-programmer remote successfully, no conflicts with agent-programmer's pushes, code files backed up correctly, pattern consistency across all shadow agents_

- [ ] 4.9 Add error handling for shadow-agent-programmer
  - File: C:\p4\Personal\SD\shadow-agent-programmer/src/bot/slack-bot.ts, src/bot/discord-bot.ts
  - Implement retry logic and error handling
  - Publish shadow.programmer.backup.failed events
  - Purpose: Ensure reliable programmer backup
  - _Leverage: shadow-agent-artist/designer error handling patterns_
  - _Requirements: 6.1, 6.2_
  - _Prompt: Role: Reliability Engineer ensuring uniform resilience across all shadow agents | Task: Add error handling to shadow-agent-programmer following requirements 6.1 and 6.2, maintaining consistency with other shadow agents' error handling patterns for backup failures | Restrictions: Must mirror other shadow agents' error handling, use identical retry configuration, publish events in consistent format, handle code-specific errors (binary files, large files), maintain pattern uniformity | Success: Error handling consistent with other shadows, backup resilience uniform, error events follow standard format, code-specific errors handled appropriately, pattern consistency maintained_

## Phase 5: Integration and Testing

- [ ] 5.1 Create end-to-end workflow test (Slack/Discord channel)
  - File: C:\p4\Personal\SD\AGENTS\tests\e2e\slack-discord-workflow.test.ts
  - Simulate Slack/Discord user interaction
  - Test event-driven task assignment and execution
  - Verify shadow backup operations
  - Test final approval and merge to main playground
  - Purpose: Validate complete workflow for event-driven channels
  - _Leverage: KĀDI test utilities, worker/shadow agent implementations_
  - _Requirements: All (end-to-end validation)_
  - _Prompt: Role: QA Automation Engineer with expertise in E2E testing and event-driven systems | Task: Create comprehensive end-to-end test for Slack/Discord workflow covering all requirements, simulating user interaction via KĀDI events, verifying task execution, shadow backups, and final approval/merge process | Restrictions: Must test real event flows (not mocked events), verify shadow backups in actual git repos, test approval workflow completely, ensure test cleanup (worktrees, git repos), use isolated test environment | Success: E2E test covers complete Slack/Discord user journey, all agent interactions verified, shadow backups validated, approval and merge work correctly, test is reliable and repeatable, proper cleanup on success/failure_

- [ ] 5.2 Create end-to-end workflow test (Claude Code/Desktop channel)
  - File: C:\p4\Personal\SD\AGENTS\tests\e2e\claude-code-workflow.test.ts
  - Simulate Claude Code/Desktop MCP tool invocations
  - Test tool-based task planning and status queries
  - Verify structured JSON responses
  - Test approval workflow via tools
  - Purpose: Validate complete workflow for tool-based channels
  - _Leverage: MCP tool implementations, worker/shadow agent logic_
  - _Requirements: All (end-to-end validation)_
  - _Prompt: Role: QA Automation Engineer specializing in MCP protocol and tool-based testing | Task: Create comprehensive end-to-end test for Claude Code/Desktop workflow covering all requirements, invoking MCP tools directly, verifying task planning/execution via tools, validating JSON responses, and testing approval via approve_completion tool | Restrictions: Must test real MCP tool invocations (not mocked), verify JSON response schemas with Zod, test synchronous request-response pattern, ensure proper error responses, validate tool-based approval workflow | Success: E2E test covers complete Claude Code user journey, all MCP tools verified, JSON responses validated, approval workflow works via tools, test reliable and isolated_

- [ ] 5.3 Create integration test for shadow backup rollback
  - File: C:\p4\Personal\SD\AGENTS\tests\integration\shadow-rollback.test.ts
  - Simulate worker agent file operations
  - Verify shadow agent backup commits
  - Test rollback from shadow-agent-playground-* repos
  - Validate restored state matches original
  - Purpose: Ensure shadow agents provide reliable rollback capability
  - _Leverage: Shadow agent implementations, git utilities_
  - _Requirements: 4.1, 4.2, 4.3_
  - _Prompt: Role: QA Engineer with expertise in backup/restore testing and git workflows | Task: Create integration test for shadow backup rollback following requirements 4.1, 4.2, and 4.3, simulating worker file operations, verifying shadow backups, performing rollback from shadow repos, and validating state restoration | Restrictions: Must test actual git operations (not mocked), verify backup chronology matches worker operations, test rollback at different points in time, validate file content integrity after restore, clean up test repos | Success: Test verifies shadow backups work correctly, rollback restores exact state, backup chronology preserved, file integrity validated, test is reliable and repeatable_

- [ ] 5.4 Create integration test for git worktree isolation
  - File: C:\p4\Personal\SD\AGENTS\tests\integration\worktree-isolation.test.ts
  - Test concurrent agent execution in separate worktrees
  - Verify worktree isolation (no cross-contamination)
  - Test worktree cleanup on task completion
  - Validate orphaned worktree detection and cleanup
  - Purpose: Ensure git worktrees provide proper isolation for concurrent agents
  - _Leverage: git-worktree.ts utilities, worker agent patterns_
  - _Requirements: 3.2.1_
  - _Prompt: Role: Integration Test Engineer with expertise in git internals and concurrency testing | Task: Create integration test for git worktree isolation following requirement 3.2.1, testing concurrent agent execution, verifying no cross-contamination between worktrees, validating cleanup, and detecting orphaned worktrees | Restrictions: Must test real concurrent execution (not sequential), verify file system isolation, test cleanup on success and failure, detect and clean orphaned worktrees, ensure no git state corruption | Success: Test validates worktree isolation, concurrent execution works safely, cleanup verified, orphaned worktree detection works, no git corruption occurs_

- [ ] 5.5 Create unit tests for MCP tools
  - File: C:\p4\Personal\SD\AGENTS\tests\unit\mcp-tools.test.ts
  - Test parameter validation with Zod schemas
  - Test error handling for invalid inputs
  - Mock upstream MCP server responses
  - Verify channel-specific response formatting
  - Purpose: Ensure MCP tools work correctly in isolation
  - _Leverage: MCP tool implementations (plan-task.ts, list-tasks.ts, task-status.ts, approve-completion.ts)_
  - _Requirements: 2.1.1, 5.1, 5.2, 5.3, 5.4_
  - _Prompt: Role: Unit Test Developer with expertise in Zod validation and MCP protocol testing | Task: Create comprehensive unit tests for all MCP tools following requirements 2.1.1, 5.1-5.4, testing parameter validation, error handling, mocked upstream responses, and channel-specific formatting | Restrictions: Must test validation before business logic, mock all upstream dependencies, test both success and error scenarios, verify response format for each channel type, ensure test isolation | Success: All MCP tools have comprehensive unit tests, validation tested thoroughly, error scenarios covered, channel-specific formatting verified, tests run independently_

- [ ] 5.6 Create unit tests for BaseBot utilities
  - File: C:\p4\Personal\SD\AGENTS\tests\unit\base-bot.test.ts
  - Test circuit breaker behavior
  - Test retry logic with exponential backoff
  - Test metrics tracking
  - Purpose: Ensure BaseBot utilities work correctly
  - _Leverage: C:\p4\Personal\SD\AGENTS\shared\base-bot.ts_
  - _Requirements: 6.1, 6.2_
  - _Prompt: Role: Unit Test Developer specializing in reliability patterns and fault tolerance testing | Task: Create comprehensive unit tests for BaseBot utilities following requirements 6.1 and 6.2, testing circuit breaker behavior, retry logic with exponential backoff, and metrics tracking | Restrictions: Must test circuit breaker state transitions, verify exponential backoff timing, validate metrics accuracy, test edge cases (immediate failures, slow recovery), ensure test isolation | Success: BaseBot utilities fully tested, circuit breaker behavior verified, retry logic validated, metrics tracking accurate, edge cases covered_

- [ ] 5.7 Document deployment and operational procedures
  - File: C:\p4\Personal\SD\AGENTS\docs\deployment.md, C:\p4\Personal\SD\AGENTS\docs\operations.md
  - Document environment setup and configuration
  - Create deployment checklist
  - Document monitoring and alerting procedures
  - Create troubleshooting guide
  - Purpose: Provide clear guidance for deployment and operations
  - _Leverage: Implementation details from all components_
  - _Requirements: All_
  - _Prompt: Role: Technical Writer with DevOps expertise and operational documentation experience | Task: Create comprehensive deployment and operations documentation covering all requirements, documenting environment setup, configuration, deployment steps, monitoring, and troubleshooting procedures | Restrictions: Must include specific configuration values, provide step-by-step deployment instructions, document all monitoring metrics, include common issues and solutions, maintain accuracy with implementation | Success: Documentation is complete and accurate, deployment checklist covers all steps, troubleshooting guide addresses common issues, monitoring procedures clearly defined, documentation validated by performing actual deployment_

