# Tasks Document

## Phase 1: Core Infrastructure (mcp-server-quest Foundation)

- [x] 1.1. Verify existing quest data models
  - File: C:\GitHub\mcp-server-quest\src\models\questModel.ts, taskModel.ts, agentModel.ts, approvalModel.ts
  - Review existing models against requirements to ensure data models match design.md specifications
  - Verify Quest model has all required fields (id, name, description, requirements, design, status, timestamps)
  - Verify Task model supports dependencies, analysis, reflection
  - Verify Agent model tracks capabilities, workload, heartbeat
  - Verify Approval model implements state machine (approved/revision_requested/rejected)
  - Purpose: Ensure data models match design.md specifications
  - _Leverage: Existing model files in mcp-server-quest_
  - _Requirements: Design.md data model specifications_
  - _Prompt: Role: Backend Developer with TypeScript and Zod expertise | Task: Verify existing quest data models in mcp-server-quest match design.md specifications, checking all required fields, Zod schemas, and file-based storage | Restrictions: Do not modify existing models, only verify compliance | Success: All required fields present, Zod schemas validate correctly, file-based storage works, models match design specifications_

- [x] 1.2. Create missing questPlanTask tool
  - File: C:\GitHub\mcp-server-quest\src\tools\questPlanTask.ts
  - Implement quest_plan_task tool (Step 1 of four-step workflow: plan → analyze → reflect → split)
  - Input: questId, description
  - Returns: Structured prompt with quest requirements, design, task breakdown guidelines
  - Similar pattern to questAnalyzeTask, questReflectTask, questSplitTasks
  - Purpose: Complete four-step workflow by adding missing planning step
  - _Leverage: C:\GitHub\mcp-server-quest\src\tools\questAnalyzeTask.ts as template_
  - _Requirements: Requirement 3 (Task Generation and Planning)_
  - _Prompt: Role: MCP Tool Developer with TypeScript expertise | Task: Create questPlanTask.ts tool following the pattern of questAnalyzeTask.ts to implement Step 1 of the four-step workflow (plan → analyze → reflect → split) | Restrictions: Must follow existing tool patterns, return structured prompt format, integrate with quest workflow | Success: Tool returns comprehensive planning prompt, integrates seamlessly with workflow, follows existing code patterns_

- [x] 1.3. Fix and verify four-step workflow tools
  - File: C:\GitHub\mcp-server-quest\src\tools\questAnalyzeTask.ts, questReflectTask.ts, questSplitTasks.ts
  - Fix questAnalyzeTask to work with concepts (remove questId/taskId requirements, accept summary + initialConcept)
  - Fix questReflectTask to work with concepts (remove questId/taskId requirements, accept summary + analysis)
  - Fix questSplitTasks to accept globalAnalysisResult parameter and store in task.analysis field
  - Update quest_plan_task prompt to mandate calling all workflow steps in order
  - Verify workflow executes completely: plan → analyze → reflect → split
  - Verify tasks are created with analysis/reflection data attached
  - Purpose: Fix workflow design issues to match mcp-shrimp-task-manager reference implementation
  - _Leverage: C:\GitHub-Reference\mcp-shrimp-task-manager as reference implementation_
  - _Requirements: Requirement 3 (Task Generation and Planning)_
  - _Prompt: Role: MCP Tool Developer with TypeScript expertise | Task: Fix four-step workflow tools to match mcp-shrimp-task-manager pattern where analyze/reflect work with concepts before tasks exist, split_tasks accepts globalAnalysisResult, and quest_plan_task mandates calling all steps | Restrictions: Must maintain MCP protocol compliance, follow existing code patterns, ensure backward compatibility where possible | Success: Workflow executes completely (plan → analyze → reflect → split), tasks created with analysis attached, no validation errors, matches reference implementation behavior_

- [ ] 1.4. Verify quest CRUD tools
  - File: C:\GitHub\mcp-server-quest\src\tools\questCreate.ts, questGetStatus.ts, questSubmitApproval.ts
  - Verify questCreate creates quest with requirements/design, sets status='draft'
  - Verify questGetStatus returns quest status and task summary
  - Verify questSubmitApproval updates quest status to 'approved'
  - Purpose: Ensure quest lifecycle management works
  - _Leverage: Existing CRUD tools in mcp-server-quest_
  - _Requirements: Requirement 1 (Quest Creation), Requirement 2 (Quest Approval)_
  - _Prompt: Role: QA Engineer with MCP tool testing expertise | Task: Verify quest CRUD tools (questCreate, questGetStatus, questSubmitApproval) work correctly, checking quest creation with requirements/design, status transitions, and approval workflow | Restrictions: Do not modify tools, only verify functionality | Success: Quest creation works, status transitions valid, approval workflow functional, all CRUD operations complete successfully_

- [ ] 1.5. Verify task management tools
  - File: C:\GitHub\mcp-server-quest\src\tools\questAssignTasks.ts, questGetTaskDetails.ts, questVerifyTask.ts, questSubmitTaskResult.ts
  - Verify questAssignTasks only assigns ready tasks (no unresolved dependencies)
  - Verify questGetTaskDetails returns full task info including implementationGuide
  - Verify questVerifyTask validates task completion
  - Verify questSubmitTaskResult records completion with artifacts
  - Purpose: Ensure task execution tracking works
  - _Leverage: Existing task management tools in mcp-server-quest_
  - _Requirements: Requirement 4 (Task Assignment), Requirement 5 (Task Execution)_
  - _Prompt: Role: QA Engineer with task management system expertise | Task: Verify task management tools (questAssignTasks, questGetTaskDetails, questVerifyTask, questSubmitTaskResult) work correctly, checking dependency resolution, task details completeness, verification logic, and artifact recording | Restrictions: Do not modify tools, only verify functionality | Success: Task assignment respects dependencies, task details complete, verification works, artifacts recorded properly_

- [ ] 1.6. Verify agent registration system
  - File: C:\GitHub\mcp-server-quest\src\models\agentModel.ts, src\tools\questRegisterAgent.ts, questAgentHeartbeat.ts, questUnregisterAgent.ts
  - Verify questRegisterAgent registers agent with capabilities, sets status='available'
  - Verify questAgentHeartbeat updates lastSeen timestamp (30s interval)
  - Verify questUnregisterAgent gracefully removes agent
  - Verify offline detection marks agents offline after 90 seconds without heartbeat
  - Purpose: Track agent availability and health
  - _Leverage: Existing agent management tools in mcp-server-quest_
  - _Requirements: Requirement 8 (Agent Registration and Heartbeat)_
  - _Prompt: Role: Systems Engineer with agent lifecycle management expertise | Task: Verify agent registration system (questRegisterAgent, questAgentHeartbeat, questUnregisterAgent) works correctly, checking registration, heartbeat updates, graceful shutdown, and offline detection | Restrictions: Do not modify tools, only verify functionality | Success: Agents register correctly, heartbeats update reliably, offline detection works within 90 seconds, graceful shutdown functional_

- [ ] 1.7. Verify dashboard functionality
  - File: C:\GitHub\mcp-server-quest\src\dashboard\*
  - Test dashboard features: quest list page, quest detail page, agent monitor page, approval interface, WebSocket updates
  - Verify quest list page displays all quests
  - Verify quest detail page shows tasks and dependencies
  - Verify agent monitor page shows agent status
  - Verify approval interface works
  - Verify WebSocket updates work in real-time
  - Purpose: Ensure UI for monitoring and approving quests works
  - _Leverage: Existing dashboard in mcp-server-quest_
  - _Requirements: Requirement 2 (Quest Approval Workflow), Dashboard requirements_
  - _Prompt: Role: Frontend QA Engineer with dashboard testing expertise | Task: Verify dashboard functionality including quest list, quest details, agent monitor, approval interface, and WebSocket real-time updates | Restrictions: Do not modify dashboard code, only verify functionality | Success: Dashboard displays data correctly, real-time updates work, approval workflow functional, all pages render properly_

- [ ] 1.8. Verify conflicting tools don't interfere
  - File: C:\GitHub\mcp-server-quest\src\tools\*
  - Review additional tools not in requirements: questRevise, questList, questCreateFromTemplate, questWorkflowGuide, questResearchMode, questLogImplementation, questQueryTasks, questClearCompleted, questDeleteQuest, questDeleteTask
  - Verify no conflicts with implementation
  - Document extra tools and their purpose
  - Purpose: Ensure extra tools don't conflict with implementation
  - _Leverage: All tools in mcp-server-quest_
  - _Requirements: All requirements (integration check)_
  - _Prompt: Role: Integration Engineer with system architecture expertise | Task: Review all additional tools in mcp-server-quest not explicitly mentioned in requirements to ensure they don't conflict with the implementation and document their purpose | Restrictions: Do not remove or modify tools, only verify compatibility | Success: No conflicts found, extra tools documented, integration verified, all tools work harmoniously_

## Phase 2: agent-producer Enhancement (Orchestrator)

- [ ] 2.1. Create handlers directory structure
  - File: C:\GitHub\agent-producer\src\handlers\ (new directory)
  - Create handlers/ folder for event and message handlers
  - Separate handlers (orchestration logic) from tools (LLM function calling)
  - Purpose: Organize agent-producer code with clear separation of concerns
  - _Leverage: Existing agent-producer structure_
  - _Requirements: Code organization best practices_
  - _Prompt: Role: Software Architect with code organization expertise | Task: Create handlers/ directory in agent-producer to separate orchestration logic from LLM function calling tools, establishing clear separation of concerns | Restrictions: Do not modify existing code, only create directory structure | Success: Directory created, pattern established, separation of concerns clear_

- [ ] 2.2. Implement quest creation handler
  - File: C:\GitHub\agent-producer\src\handlers\quest-creation.ts
  - Parse Discord messages for quest creation requests
  - Detect quest creation intent from natural language
  - Use LLM to generate requirements.md and design.md
  - Call quest_create tool via KĀDI broker (client.invokeRemote())
  - Send Discord notification with quest details
  - Purpose: Enable Discord-driven quest creation
  - _Leverage: agents-library ProviderManager, ProducerToolUtils.invokeShrimTool, src/bot/discord-bot.ts_
  - _Requirements: Requirement 1 (Quest Creation via Discord)_
  - _Prompt: Role: Discord Bot Developer with LLM integration expertise | Task: Implement quest creation handler that parses Discord messages, uses LLM to generate requirements/design documents, calls quest_create via KĀDI broker, and sends confirmation | Restrictions: Must use existing ProviderManager and ProducerToolUtils, follow Discord bot patterns | Success: Quest creation works from Discord, documents well-generated, user receives confirmation, integration with KĀDI broker functional_

- [ ] 2.3. Implement quest approval handler
  - File: C:\GitHub\agent-producer\src\handlers\quest-approval.ts
  - Handle "I approved quest {name}" - verify via quest_get_status
  - Handle "I approve quest {name}" - directly approve via quest_submit_approval
  - Send appropriate Discord responses
  - Purpose: Enable quest approval workflow from Discord
  - _Leverage: ProducerToolUtils for remote tool calls_
  - _Requirements: Requirement 2 (Quest Approval Workflow)_
  - _Prompt: Role: Discord Bot Developer with workflow automation expertise | Task: Implement quest approval handler that processes approval messages, verifies quest status, directly approves quests, and sends Discord responses | Restrictions: Must use ProducerToolUtils for remote calls, handle both verification and direct approval | Success: Approval verification works, direct approval succeeds, user receives feedback, workflow complete_

- [ ] 2.4. Implement four-step workflow executor
  - File: C:\GitHub\agent-producer\src\handlers\task-generation.ts
  - Execute plan → analyze → reflect → split workflow
  - Handle "Create tasks for quest {name}" messages
  - Call quest_plan_task → LLM analysis → quest_analyze_task
  - Call quest_reflect_task → LLM reflection
  - Call quest_split_tasks with final task array
  - Send Discord notification with task count and dependencies
  - Purpose: Automate task generation using structured workflow
  - _Leverage: Anthropic SDK, ProducerToolUtils, ProviderManager_
  - _Requirements: Requirement 3 (Task Generation and Planning)_
  - _Prompt: Role: Workflow Automation Engineer with LLM orchestration expertise | Task: Implement four-step workflow executor (plan → analyze → reflect → split) that coordinates LLM calls with quest tools and sends task summary to Discord | Restrictions: Must execute all four steps in order, use existing providers and tools | Success: Workflow executes all steps, tasks well-analyzed, user receives summary, dependencies validated_

- [ ] 2.5. Implement task assignment handler
  - File: C:\GitHub\agent-producer\src\handlers\task-assignment.ts
  - Handle "Assign tasks to {agentId}" messages
  - Call quest_assign_tasks tool via KĀDI broker
  - Send Discord notification with assigned/blocked counts
  - Purpose: Enable task assignment to worker agents
  - _Leverage: ProducerToolUtils for remote tool calls_
  - _Requirements: Requirement 4 (Task Assignment to Worker Agents)_
  - _Prompt: Role: Task Management Developer with agent coordination expertise | Task: Implement task assignment handler that processes assignment requests, calls quest_assign_tasks via KĀDI broker, and reports assigned/blocked task counts | Restrictions: Must use ProducerToolUtils, respect task dependencies | Success: Tasks assigned correctly, user receives counts, blocked tasks reported, dependencies respected_

- [ ] 2.6. Implement task execution trigger
  - File: C:\GitHub\agent-producer\src\handlers\task-execution.ts
  - Handle "Start implementing tasks" messages
  - Publish task.assigned events to 'utility' network for all assigned tasks
  - Include full payload (taskId, questId, role, description, requirements, timestamp, assignedBy)
  - Purpose: Trigger worker agents to start task execution
  - _Leverage: KadiClient.publish(), existing event publishing patterns_
  - _Requirements: Requirement 5 (Task Execution by Worker Agents)_
  - _Prompt: Role: Event-Driven Architecture Developer with KĀDI expertise | Task: Implement task execution trigger that publishes task.assigned events to utility network with complete payload for worker agents | Restrictions: Must use KadiClient.publish(), include all required payload fields, follow event schema | Success: Events published correctly, all assigned tasks receive events, payload matches schema, worker agents triggered_

- [ ] 2.7. Implement task completion event handler
  - File: C:\GitHub\agent-producer\src\handlers\task-completion.ts
  - Subscribe to task.completed events from 'utility' network
  - Call quest_verify_task tool with task result
  - Call quest_submit_task_result tool to record completion
  - Send Discord notification for each completed task
  - Purpose: Handle task completion from worker agents
  - _Leverage: KĀDI event subscription (client.subscribe()), ProducerToolUtils_
  - _Requirements: Requirement 5 (Task Execution by Worker Agents)_
  - _Prompt: Role: Event Handler Developer with task verification expertise | Task: Implement task completion event handler that subscribes to task.completed events, verifies results, records completion, and notifies Discord | Restrictions: Must use KĀDI subscription, verify before recording, send notifications | Success: Completed tasks verified, recorded correctly, user receives notifications, event handling reliable_

- [ ] 2.8. Implement task failure event handler
  - File: C:\GitHub\agent-producer\src\handlers\task-failure.ts
  - Subscribe to task.failed events from 'utility' network
  - Send Discord notification with error details
  - Handle user responses: "retry", "skip", "abort"
  - Republish task.assigned for retry, mark skipped, or stop execution
  - Purpose: Handle task failures with user guidance
  - _Leverage: KĀDI event subscription, KadiEventPublisher_
  - _Requirements: Requirement 6 (Task Failure Handling)_
  - _Prompt: Role: Error Handling Developer with user interaction expertise | Task: Implement task failure event handler that subscribes to task.failed events, notifies user with error details, processes user commands (retry/skip/abort), and takes appropriate action | Restrictions: Must handle all three user commands, republish for retry, maintain task state | Success: Failures reported clearly, user commands processed, task state reflects action, retry mechanism works_

- [ ] 2.9. Implement git merge and push workflow
  - File: C:\GitHub\agent-producer\src\handlers\git-operations.ts
  - Handle "push to GitHub" messages
  - Ask user for confirmation with commit counts
  - Call git_merge tool via KĀDI broker for each worker branch
  - Call git_push tool to push merged changes
  - Send Discord notification with push results
  - Purpose: Coordinate git operations across multiple agents
  - _Leverage: ProducerToolUtils for remote git tool calls_
  - _Requirements: Requirement 7 (Git Operations and Push Workflow)_
  - _Prompt: Role: Git Workflow Developer with multi-agent coordination expertise | Task: Implement git merge and push workflow that coordinates merging worker branches, pushes to remote, and reports results with user confirmation | Restrictions: Must ask for confirmation, handle merge conflicts, report results clearly | Success: Branches merge correctly, push succeeds, user receives results, conflicts reported, confirmation required_

- [ ] 2.10. Integrate all handlers into agent-producer
  - File: C:\GitHub\agent-producer\src\index.ts
  - Import all handler modules
  - Register Discord message handlers
  - Set up KĀDI event subscriptions
  - Initialize LLM provider and remote tool clients
  - Add graceful shutdown handling
  - Purpose: Complete agent-producer integration
  - _Leverage: Existing Discord bot in src/bot/discord-bot.ts, agents-library BaseBot patterns_
  - _Requirements: All agent-producer requirements_
  - _Prompt: Role: Integration Engineer with bot architecture expertise | Task: Integrate all handlers into agent-producer by importing modules, registering Discord handlers, setting up KĀDI subscriptions, initializing providers, and adding graceful shutdown | Restrictions: Must follow existing bot patterns, ensure all handlers registered, proper initialization order | Success: Bot starts correctly, all handlers registered, events subscribed, shutdown graceful, integration complete_

## Phase 3: Worker Agent Implementation

- [ ] 3.1. Enhance agent-artist with task execution
  - File: C:\GitHub\agent-artist\src\index.ts
  - Verify and enhance task execution capabilities
  - Add quest_get_task_details remote tool call for full task info
  - Ensure implementationGuide and verificationCriteria are used
  - Verify event payload matches schema
  - Purpose: Enable agent-artist to execute assigned tasks
  - _Leverage: agents-library WorkerAgentFactory (already used), existing implementation_
  - _Requirements: Requirement 5 (Task Execution by Worker Agents)_
  - _Prompt: Role: Worker Agent Developer with task execution expertise | Task: Enhance agent-artist task execution by adding quest_get_task_details call, using implementationGuide and verificationCriteria, and verifying event payload schema | Restrictions: Must use WorkerAgentFactory, follow existing patterns, maintain event schema | Success: Agent executes tasks correctly, files created/modified, commits well-formed, events published, implementation guide followed_

- [ ] 3.2. Implement agent registration and heartbeat in agent-artist
  - File: C:\GitHub\agent-artist\src\index.ts
  - Call quest_register_agent on startup with capabilities
  - Send quest_agent_heartbeat every 30 seconds
  - Call quest_unregister_agent on shutdown
  - Purpose: Register agent-artist with mcp-server-quest
  - _Leverage: ProducerToolUtils for remote tool calls, existing graceful shutdown handlers_
  - _Requirements: Requirement 8 (Agent Registration and Heartbeat)_
  - _Prompt: Role: Agent Lifecycle Developer with registration system expertise | Task: Implement agent registration lifecycle in agent-artist including startup registration, 30-second heartbeat interval, and graceful shutdown unregistration | Restrictions: Must use ProducerToolUtils, maintain 30s heartbeat interval, handle shutdown gracefully | Success: Agent registers on startup, heartbeats sent reliably every 30 seconds, unregistration on shutdown, lifecycle complete_

- [ ] 3.3. Verify shadow-agent-artist functionality
  - File: C:\GitHub\shadow-agent-artist\src\index.ts
  - Verify shadow agent watches C:\GitHub\agent-playground-artist for file changes
  - Verify syncs changes to C:\GitHub\shadow-agent-playground-artist
  - Verify creates backup commits
  - Verify handles sync failures with retry
  - Verify publishes shadow-artist.backup.completed events
  - Purpose: Maintain backup of agent-artist work
  - _Leverage: agents-library ShadowAgentFactory, existing shadow agent patterns_
  - _Requirements: Requirement 5 (Task Execution - shadow backup)_
  - _Prompt: Role: Backup System Developer with file synchronization expertise | Task: Verify shadow-agent-artist functionality including file watching, sync to backup directory, backup commits, retry logic, and event publishing | Restrictions: Do not modify shadow agent, only verify functionality | Success: File changes detected, synced to backup, failures retried, backup commits created, events published_

## Phase 4: Git Integration Verification

- [ ] 4.1. Verify git-merge tool implementation
  - File: C:\GitHub\mcp-server-git\src\mcp-server\tools\definitions\git-merge.tool.ts
  - Verify tool supports required parameters: path, branch, message, noFastForward, strategy, abort
  - Verify output includes: success, conflicts, conflictedFiles, mergedFiles, message
  - Purpose: Ensure git-merge tool works for our use case
  - _Leverage: Existing git-merge tool in mcp-server-git_
  - _Requirements: Requirement 7 (Git Operations and Push Workflow)_
  - _Prompt: Role: Git Tool QA Engineer with merge workflow expertise | Task: Verify git-merge tool supports all required parameters and returns complete output including conflict detection and merged files | Restrictions: Do not modify tool, only verify functionality | Success: Tool supports all needed parameters, conflict detection works, output complete, merge operations functional_

- [ ] 4.2. Verify git-push tool implementation
  - File: C:\GitHub\mcp-server-git\src\mcp-server\tools\definitions\git-push.tool.ts
  - Verify tool supports required parameters: path, branch, remote, force, forceWithLease, setUpstream
  - Verify output includes: success, remote, branch, pushedRefs, rejectedRefs
  - Purpose: Ensure git-push tool works for our use case
  - _Leverage: Existing git-push tool in mcp-server-git_
  - _Requirements: Requirement 7 (Git Operations and Push Workflow)_
  - _Prompt: Role: Git Tool QA Engineer with push workflow expertise | Task: Verify git-push tool supports all required parameters and returns complete output including pushed and rejected refs | Restrictions: Do not modify tool, only verify functionality | Success: Tool supports all needed parameters, push results complete, errors reported, push operations functional_

- [ ] 4.3. Test git operations end-to-end
  - Test Scenario: Worker agent commits to agent-playground-artist branch → Agent-producer merges branch to main → Agent-producer pushes to remote
  - Verify merge succeeds for clean branches
  - Verify conflicts detected and reported
  - Verify push succeeds with valid credentials
  - Verify commit SHAs tracked correctly
  - Purpose: Validate git operations work in real workflow
  - _Leverage: git-merge and git-push tools_
  - _Requirements: Requirement 7 (Git Operations and Push Workflow)_
  - _Prompt: Role: Integration Test Engineer with git workflow expertise | Task: Test complete git workflow end-to-end including worker commits, merge to main, and push to remote, verifying success cases and conflict handling | Restrictions: Use test repository, do not affect production code | Success: Merge and push work correctly, conflicts handled, errors reported clearly, workflow complete_

## Phase 5: Testing, Integration, and Documentation

- [ ] 5.1. Manual test: Complete quest workflow
  - Test Scenario: Create quest via Discord → approve → generate tasks → assign → execute → push
  - Verify quest creation with LLM-generated requirements/design
  - Verify approval workflow (dashboard and Discord)
  - Verify four-step task generation (plan → analyze → reflect → split)
  - Verify task assignment respecting dependencies
  - Verify agent execution with file creation and git commits
  - Verify git merge and push operations
  - Document Discord conversation logs, screenshots, issues found
  - Purpose: Validate end-to-end quest workflow
  - _Leverage: Manual Testing via Discord Bot section from design.md_
  - _Requirements: All requirements (integration test)_
  - _Prompt: Role: QA Test Engineer with end-to-end testing expertise | Task: Execute complete quest workflow from creation to push, documenting all steps, verifying all requirements, and capturing issues | Restrictions: Test in controlled environment, document everything, do not skip steps | Success: Complete workflow executes successfully, all requirements met, comprehensive documentation, issues logged_

- [ ] 5.2. Manual test: Error handling scenarios
  - Test Scenarios: Task failure with retry, Git merge conflict, Offline agent assignment, LLM rate limit
  - Verify error messages are clear
  - Verify recovery mechanisms work
  - Verify user guidance is helpful
  - Document error scenarios, recovery steps, user experience
  - Purpose: Validate error handling and recovery
  - _Leverage: Error Handling section from design.md_
  - _Requirements: Requirement 6 (Task Failure Handling), Error scenarios from design.md_
  - _Prompt: Role: Error Handling QA Engineer with recovery testing expertise | Task: Test all error scenarios including task failures, merge conflicts, offline agents, and rate limits, verifying error messages, recovery mechanisms, and user guidance | Restrictions: Test all scenarios, document recovery steps, verify user experience | Success: All error scenarios handled gracefully, recovery works, error messages clear, user guidance helpful_

- [ ] 5.3. Manual test: Multi-agent collaboration
  - Test Scenario: Create quest with tasks for multiple agents → assign to different agents → verify independent execution → merge all branches
  - Verify agents work independently
  - Verify no conflicts between agents
  - Verify all commits merge cleanly
  - Document multi-agent coordination, git merge results
  - Purpose: Validate multi-agent coordination
  - _Leverage: Manual Testing via Discord Bot section from design.md_
  - _Requirements: Requirement 4 (Task Assignment), Requirement 7 (Git Operations)_
  - _Prompt: Role: Multi-Agent System QA Engineer with coordination testing expertise | Task: Test multi-agent collaboration by assigning tasks to different agents, verifying independent execution, and merging all branches | Restrictions: Use multiple agent instances, verify independence, test merge scenarios | Success: Multiple agents execute independently, commits merge without conflicts, coordination seamless, no interference_

- [ ] 5.4. Manual test: Agent registration and heartbeat
  - Test Scenario: Start agents → verify registration → monitor heartbeats → stop agents → verify offline detection
  - Verify agents appear online in dashboard
  - Verify heartbeats update every 30 seconds
  - Verify offline detection after 90 seconds
  - Document agent status transitions, timing accuracy
  - Purpose: Validate agent health monitoring
  - _Leverage: Manual Testing via Discord Bot section from design.md_
  - _Requirements: Requirement 8 (Agent Registration and Heartbeat)_
  - _Prompt: Role: Agent Monitoring QA Engineer with health check testing expertise | Task: Test agent registration and heartbeat system by starting agents, monitoring heartbeats, stopping agents, and verifying offline detection timing | Restrictions: Monitor timing accurately, verify dashboard updates, test multiple agents | Success: Registration works, heartbeats reliable every 30 seconds, offline detection within 90 seconds, status accurate in dashboard_

- [ ] 5.5. Manual test: Dashboard functionality
  - Test Scenario: Monitor dashboard during quest workflow → verify real-time updates → test approval interface
  - Verify dashboard shows accurate data
  - Verify updates in real-time via WebSocket
  - Verify approval interface works
  - Document dashboard UI/UX, update latency, issues
  - Purpose: Validate dashboard usability and accuracy
  - _Leverage: Manual Testing via Discord Bot section from design.md_
  - _Requirements: Requirement 2 (Quest Approval Workflow), Dashboard requirements_
  - _Prompt: Role: UI/UX QA Engineer with dashboard testing expertise | Task: Test dashboard functionality during quest workflow, verifying data accuracy, real-time WebSocket updates, and approval interface usability | Restrictions: Test all dashboard pages, measure update latency, document UX issues | Success: Dashboard displays accurate data, updates timely via WebSocket, approval interface intuitive, no UI bugs_

- [ ] 5.6. Performance testing and optimization
  - Test Scenarios: Large quest with 20+ tasks, Multiple concurrent quests, Rapid task execution
  - Measure event latency, tool invocation time, LLM response time, git operation duration
  - Identify bottlenecks, implement caching if needed, tune configurations
  - Purpose: Ensure system performs within acceptable limits
  - _Leverage: Performance Considerations from design.md_
  - _Requirements: Non-functional requirements (Performance)_
  - _Prompt: Role: Performance Engineer with system optimization expertise | Task: Conduct performance testing with large quests, concurrent operations, and rapid execution, measuring latencies and identifying bottlenecks for optimization | Restrictions: Test realistic scenarios, measure all metrics, document findings | Success: System meets performance targets, bottlenecks identified and addressed, metrics documented, optimizations implemented_

- [ ] 5.7. Security review and hardening
  - Review Discord bot token security, Claude API key management, Git authentication, KĀDI broker security
  - Verify secrets in environment variables, no hardcoded credentials, proper access controls
  - Add rate limiting, input validation, error message sanitization
  - Purpose: Ensure system security
  - _Leverage: Security Considerations from design.md_
  - _Requirements: Non-functional requirements (Security)_
  - _Prompt: Role: Security Engineer with application security expertise | Task: Conduct security review of Discord bot, API keys, git authentication, and KĀDI broker, implementing rate limiting, input validation, and error sanitization | Restrictions: Follow security best practices, no hardcoded secrets, implement all security measures | Success: No hardcoded secrets, proper access controls, rate limiting implemented, input validation comprehensive, error messages sanitized_

- [ ] 5.8. Create system documentation
  - Documents: Setup guide, Configuration reference, Troubleshooting guide, Architecture overview
  - Include installation steps, environment variables, KĀDI setup, worktree configuration, common issues
  - Purpose: Enable system deployment and maintenance
  - _Leverage: Implementation Notes from design.md_
  - _Requirements: All requirements (documentation)_
  - _Prompt: Role: Technical Writer with system documentation expertise | Task: Create comprehensive system documentation including setup guide, configuration reference, troubleshooting guide, and architecture overview | Restrictions: Document all components, include examples, cover common issues | Success: Documentation complete and accurate, setup guide works for new users, troubleshooting covers common issues, architecture clearly explained_

- [ ] 5.9. Create user guide for Discord bot
  - Document all Discord commands, workflow examples, error handling, best practices
  - Include command syntax, example conversations, tips for effective quest creation
  - Purpose: Help users interact with the system effectively
  - _Leverage: Manual Testing scenarios from design.md_
  - _Requirements: All user-facing requirements_
  - _Prompt: Role: Technical Writer with user documentation expertise | Task: Create comprehensive user guide for Discord bot including all commands, workflow examples, error handling, and best practices | Restrictions: Use clear language, include examples, cover all commands | Success: User guide comprehensive and easy to follow, examples realistic, best practices actionable, all commands documented_

- [ ] 5.10. Final integration verification
  - Verify all components integrated, all requirements met, all tests pass
  - Check no critical bugs, performance acceptable, security adequate
  - Document final system state, known limitations, future enhancements
  - Purpose: Confirm system readiness for production use
  - _Leverage: All previous tasks_
  - _Requirements: All requirements_
  - _Prompt: Role: Integration Lead with system verification expertise | Task: Conduct final integration verification ensuring all components work together, all requirements met, all tests pass, and system is production-ready | Restrictions: Verify everything, document limitations, ensure quality standards | Success: All requirements met, all tests pass, system production-ready, documentation complete, known limitations documented_

## Task Dependencies

**Phase 1 Dependencies:**
- Task 1.1 must complete before 1.2-1.8 (data models needed)
- Task 1.2 must complete before 1.3-1.4 (questPlanTask needs quest CRUD)
- Tasks 1.1-1.8 can be verified in parallel after 1.1

**Phase 2 Dependencies:**
- Phase 2 requires Phase 1 completion (mcp-server-quest must be functional)
- Task 2.1 must complete first (create handlers/ directory)
- Tasks 2.2-2.9 can be developed in parallel after 2.1
- Task 2.10 requires all other Phase 2 tasks to complete

**Phase 3 Dependencies:**
- Phase 3 requires Phase 1 and Phase 2 completion
- Tasks 3.1-3.3 can be done in parallel

**Phase 4 Dependencies:**
- Phase 4 can be done in parallel with Phase 3
- Tasks 4.1-4.3 should be done sequentially

**Phase 5 Dependencies:**
- Phase 5 requires all previous phases to complete
- Tasks 5.1-5.5 are manual tests that should be executed sequentially
- Tasks 5.6-5.10 can be executed in parallel after manual tests complete

## Notes

- **Priority:** Focus on Phase 1 and Phase 2 first to establish core functionality
- **Testing:** Manual testing via Discord bot is the primary validation method
- **Verification Tasks:** Many tasks are now "verify" rather than "implement" since code exists
- **Documentation:** Tasks 5.8 and 5.9 should be updated continuously throughout implementation
- **Performance:** Task 5.6 may reveal need for additional optimization tasks
- **Security:** Task 5.7 is critical and should not be skipped
- **File Structure:** One tool per file for mcp-server-quest, separate handlers/ for agent-producer
- **Git Tools:** Already implemented in mcp-server-git, just need verification
- **KĀDI Integration:** Already configured in mcp-upstreams.json, no setup needed

## Summary of Changes from Original

1. **Format:** Converted to template format with checkboxes `- [ ]` for dashboard tracking
2. **Structure:** Changed from `### headers` to flat list items with proper indentation
3. **Fields:** Added `_Prompt:` field with Role | Task | Restrictions | Success format
4. **Phase 1:** Changed from "implement" to "verify" for existing tools, added task to create missing questPlanTask
5. **Phase 2:** Added task 2.1 to create handlers/ directory, updated file paths
6. **Phase 3:** Removed tasks 3.4 and 3.5 (agent-designer, agent-programmer)
7. **Phase 4:** Changed to verification tasks, removed KĀDI integration task, corrected file paths
8. **Phase 5:** No changes to task content, reformatted to match template
9. **Overall:** Updated based on codebase exploration, corrected file paths, focused on gaps rather than reimplementation
