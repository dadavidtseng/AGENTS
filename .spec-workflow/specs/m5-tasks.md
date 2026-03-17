# M5 Tasks Document — Cross-Language Agent, Ability, MCP Server

## Milestone Overview

| Milestone | Focus | Tasks | Est. Hours |
|-----------|-------|-------|------------|
| M5 | Cross-Language Agents, MCP Client Refactoring, Language-Specific Abilities, DaemonAgent Integration | 18 | 52.0 - 78.0 |

## Task Groups

| Group | Tasks | Focus | Est. Hours |
|-------|-------|-------|------------|
| Python Worker Agent | 5.1 - 5.5 | Create Python agent-worker with role configs, KĀDI integration | 14.0 - 21.0 |
| MCP Client Refactoring | 5.6 - 5.9 | Refactor mcp-client-discord and mcp-client-slack to proper MCP clients | 10.0 - 15.0 |
| Language-Specific Abilities | 5.10 - 5.13 | Python abilities (data analysis, ML), cross-language testing | 10.0 - 15.0 |
| DaemonAgent Integration | 5.14 - 5.17 | Full agent lifecycle, game task types, quest workflow integration | 14.0 - 21.0 |
| Buffer and Completion | 5.18 | Completion report | 4.0 - 6.0 |

---

- [ ] 5.1. Create agent-worker-python project structure
  - File: C:\GitHub\AGENTS\agent-worker-python\setup.py
  - Initialize Python project using template-agent-python patterns
  - Set up project structure with role configuration support matching TypeScript agent-worker
  - Time Estimate: [2.0, 3.0] hours
  - Purpose: Establish Python worker agent foundation
  - _Leverage: C:\GitHub\AGENTS\template-agent-python\, C:\GitHub\AGENTS\agent-worker\ (TypeScript reference)_
  - _Requirements: M3 agent-worker operational_
  - _Prompt: Implement the task for spec M5-cross-language-agent, first run spec-workflow-guide to get the workflow guide then implement the task: Role: Python Developer with expertise in project setup | Task: Create agent-worker-python project structure using template-agent-python patterns, with role configuration support matching TypeScript agent-worker design | Restrictions: Must follow template-agent-python patterns, support same role config JSON schema as TypeScript version, include requirements.txt/pyproject.toml | Success: Project structure created, dependencies defined, role config loading works_

- [ ] 5.2. Implement Python KĀDI client integration
  - File: C:\GitHub\AGENTS\agent-worker-python\src\kadi_client.py
  - Implement KĀDI broker client in Python for event publishing and subscription
  - Support same generic event naming pattern as TypeScript version (task.completed with agentId/agentRole in payload)
  - Time Estimate: [3.0, 5.0] hours
  - Purpose: Enable Python agent to communicate via KĀDI broker
  - _Leverage: C:\GitHub\AGENTS\kadi-core\ (protocol reference), agents-library kadi-event-publisher.ts_
  - _Requirements: M3 KĀDI event naming migration complete_
  - _Prompt: Implement the task for spec M5-cross-language-agent, first run spec-workflow-guide to get the workflow guide then implement the task: Role: Python Developer with expertise in message broker integration | Task: Implement KĀDI broker client in Python supporting event publishing and subscription with generic event naming pattern (task.completed with agentId/agentRole in payload) | Restrictions: Must use same event naming as TypeScript version, support RabbitMQ topic exchange, handle connection failures with reconnection | Success: Python KĀDI client connects to broker, publishes and subscribes to events, compatible with TypeScript agents_

- [ ] 5.3. Implement Python role-based agent core
  - File: C:\GitHub\AGENTS\agent-worker-python\src\agent_core.py
  - Implement AgentCore class in Python with role-based initialization
  - Support same role configuration JSON schema as TypeScript version
  - Time Estimate: [4.0, 6.0] hours
  - Purpose: Enable Python agent with role-based capabilities
  - _Leverage: C:\GitHub\AGENTS\agent-worker\src\core\AgentCore.ts (TypeScript reference)_
  - _Requirements: 5.1, 5.2 completed_
  - _Prompt: Implement the task for spec M5-cross-language-agent, first run spec-workflow-guide to get the workflow guide then implement the task: Role: Python Developer with expertise in agent architecture | Task: Implement AgentCore class in Python with role-based initialization, supporting same role configuration JSON schema as TypeScript version, including task execution, git operations, and KĀDI event publishing | Restrictions: Must be compatible with TypeScript agent-worker role configs, support AGENT_ROLE environment variable, handle initialization errors gracefully | Success: Python AgentCore initializes with role config, executes tasks, publishes events, compatible with agent-producer orchestration_

- [ ] 5.4. Test cross-language communication via KĀDI broker
  - File: C:\GitHub\AGENTS\agent-worker-python\tests\
  - Test Python agent-worker communicating with TypeScript agent-producer and other TypeScript agents via KĀDI broker
  - Verify event format compatibility and task assignment/completion flow
  - Time Estimate: [2.0, 3.0] hours
  - Purpose: Validate cross-language agent communication
  - _Leverage: M3 workflow scenarios_
  - _Requirements: 5.3 completed_
  - _Prompt: Implement the task for spec M5-cross-language-agent, first run spec-workflow-guide to get the workflow guide then implement the task: Role: QA Engineer with expertise in integration testing | Task: Test Python agent-worker communicating with TypeScript agent-producer via KĀDI broker, verifying event format compatibility, task assignment, execution, and completion flow | Restrictions: Must test with real TypeScript agent-producer, verify events are compatible, test multiple scenarios | Success: Python agent receives tasks from TypeScript agent-producer, executes them, publishes completion events, agent-producer processes them correctly_

- [ ] 5.5. Document agent-worker-python
  - File: C:\GitHub\AGENTS\agent-worker-python\README.md
  - Create README.md and CLAUDE.md for agent-worker-python
  - Document setup, role configuration, KĀDI integration, and usage examples
  - Time Estimate: [1.0, 2.0] hours
  - Purpose: Document Python worker agent
  - _Leverage: structure.md documentation patterns_
  - _Requirements: 5.3 completed_
  - _Prompt: Implement the task for spec M5-cross-language-agent, first run spec-workflow-guide to get the workflow guide then implement the task: Role: Technical Writer with expertise in Python documentation | Task: Create README.md and CLAUDE.md for agent-worker-python documenting setup, role configuration, KĀDI integration, and usage examples | Restrictions: Must follow structure.md patterns, include Python-specific setup instructions | Success: Documentation is clear, setup instructions work, examples are accurate_

- [ ] 5.6. Analyze current mcp-client-discord implementation
  - File: C:\GitHub\AGENTS\mcp-client-discord\
  - Analyze current mcp-client-discord implementation to understand KĀDI client wrapper usage
  - Document current architecture, identify what needs to change for proper MCP client implementation
  - Time Estimate: [2.0, 3.0] hours
  - Purpose: Understand current state before refactoring
  - _Leverage: C:\GitHub\AGENTS\mcp-client-discord\ source code_
  - _Requirements: None_
  - _Prompt: Implement the task for spec M5-cross-language-agent, first run spec-workflow-guide to get the workflow guide then implement the task: Role: Systems Analyst with expertise in code analysis | Task: Analyze current mcp-client-discord implementation, documenting current architecture, KĀDI client wrapper usage, and identifying what needs to change for proper MCP client implementation | Restrictions: Must document all current functionality, identify breaking changes, propose migration path | Success: Analysis document complete, current architecture documented, migration path proposed_

- [ ] 5.7. Design proper MCP client architecture
  - File: C:\GitHub\AGENTS\.spec-workflow\specs\M3-expand-task-complexity\mcp-client-design.md
  - Design proper MCP client architecture for Discord and Slack clients
  - Define how MCP protocol communication replaces KĀDI client wrapper while maintaining KĀDI broker compatibility
  - Time Estimate: [2.0, 3.0] hours
  - Purpose: Design MCP client refactoring approach
  - _Leverage: @modelcontextprotocol/sdk, analysis from task 5.6_
  - _Requirements: 5.6 completed_
  - _Prompt: Implement the task for spec M5-cross-language-agent, first run spec-workflow-guide to get the workflow guide then implement the task: Role: Software Architect with expertise in MCP protocol | Task: Design proper MCP client architecture for Discord and Slack clients, defining how MCP protocol communication replaces KĀDI client wrapper while maintaining KĀDI broker compatibility | Restrictions: Must maintain backward compatibility, support all existing functionality, use @modelcontextprotocol/sdk | Success: Architecture design document complete, migration path clear, backward compatibility maintained_

- [ ] 5.8. Refactor mcp-client-discord to proper MCP client
  - File: C:\GitHub\AGENTS\mcp-client-discord\src\
  - Refactor mcp-client-discord from KĀDI client wrapper to proper MCP client implementation
  - Maintain all existing Discord bot functionality
  - Time Estimate: [3.0, 5.0] hours
  - Purpose: Implement proper MCP client for Discord
  - _Leverage: MCP client architecture from task 5.7_
  - _Requirements: 5.7 completed_
  - _Prompt: Implement the task for spec M5-cross-language-agent, first run spec-workflow-guide to get the workflow guide then implement the task: Role: Backend Developer with expertise in MCP protocol | Task: Refactor mcp-client-discord from KĀDI client wrapper to proper MCP client implementation using @modelcontextprotocol/sdk, maintaining all existing Discord bot functionality | Restrictions: Must preserve all existing functionality, use proper MCP protocol, maintain KĀDI broker compatibility | Success: Discord bot works with proper MCP client, all functionality preserved, MCP protocol used correctly_

- [ ] 5.9. Refactor mcp-client-slack to proper MCP client
  - File: C:\GitHub\AGENTS\mcp-client-slack\src\
  - Refactor mcp-client-slack from KĀDI client wrapper to proper MCP client implementation
  - Maintain all existing Slack bot functionality
  - Time Estimate: [3.0, 4.0] hours
  - Purpose: Implement proper MCP client for Slack
  - _Leverage: MCP client architecture from task 5.7, mcp-client-discord refactoring patterns from task 5.8_
  - _Requirements: 5.7 completed_
  - _Prompt: Implement the task for spec M5-cross-language-agent, first run spec-workflow-guide to get the workflow guide then implement the task: Role: Backend Developer with expertise in MCP protocol | Task: Refactor mcp-client-slack from KĀDI client wrapper to proper MCP client implementation, following same patterns as mcp-client-discord refactoring | Restrictions: Must preserve all existing functionality, use proper MCP protocol, follow same patterns as Discord refactoring | Success: Slack bot works with proper MCP client, all functionality preserved_

- [ ] 5.10. Create ability-data-analysis (Python)
  - File: C:\GitHub\ability-data-analysis\
  - Create Python-based KĀDI ability for data analysis using Pandas and NumPy
  - Register tools for data loading, transformation, aggregation, and visualization
  - Time Estimate: [3.0, 4.0] hours
  - Purpose: Leverage Python strengths for data analysis
  - _Leverage: C:\GitHub\ability-file-management\ (ability pattern reference)_
  - _Requirements: 5.2 Python KĀDI client working_
  - _Prompt: Implement the task for spec M5-cross-language-agent, first run spec-workflow-guide to get the workflow guide then implement the task: Role: Python Developer with expertise in data analysis | Task: Create ability-data-analysis KĀDI ability using Pandas and NumPy, registering tools for data loading, transformation, aggregation, and basic visualization | Restrictions: Must follow ability-file-management patterns for KĀDI registration, include error handling, document all tools | Success: Ability registered with KĀDI broker, all tools work correctly, data analysis operations functional_

- [ ] 5.11. Create ability-ml-integration (Python)
  - File: C:\GitHub\ability-ml-integration\
  - Create Python-based KĀDI ability for ML integration using scikit-learn
  - Register tools for model training, prediction, evaluation, and data preprocessing
  - Time Estimate: [3.0, 5.0] hours
  - Purpose: Leverage Python strengths for ML
  - _Leverage: C:\GitHub\ability-file-management\ (ability pattern reference)_
  - _Requirements: 5.2 Python KĀDI client working_
  - _Prompt: Implement the task for spec M5-cross-language-agent, first run spec-workflow-guide to get the workflow guide then implement the task: Role: Python Developer with expertise in machine learning | Task: Create ability-ml-integration KĀDI ability using scikit-learn, registering tools for model training, prediction, evaluation, and data preprocessing | Restrictions: Must follow ability patterns, include error handling, support common ML workflows | Success: Ability registered with KĀDI broker, ML tools work correctly, model training and prediction functional_

- [ ] 5.12. Test language-specific abilities with agent-worker-python
  - File: C:\GitHub\AGENTS\agent-worker-python\tests\
  - Test ability-data-analysis and ability-ml-integration with Python agent-worker
  - Verify abilities are invocable through KĀDI broker and produce correct results
  - Time Estimate: [2.0, 3.0] hours
  - Purpose: Validate Python abilities work end-to-end
  - _Leverage: Tasks 5.10, 5.11_
  - _Requirements: 5.10, 5.11 completed_
  - _Prompt: Implement the task for spec M5-cross-language-agent, first run spec-workflow-guide to get the workflow guide then implement the task: Role: QA Engineer with expertise in integration testing | Task: Test ability-data-analysis and ability-ml-integration with Python agent-worker, verifying abilities are invocable through KĀDI broker and produce correct results | Restrictions: Must test all registered tools, verify KĀDI broker integration, test error handling | Success: All Python abilities work correctly with agent-worker-python, results are accurate_

- [ ] 5.13. Test cross-language ability invocation
  - File: C:\GitHub\AGENTS\agent-producer\src\workflows\
  - Test TypeScript agent-producer orchestrating Python agent-worker to use Python-specific abilities
  - Verify cross-language workflow: TypeScript producer → Python worker → Python ability → result back to producer
  - Time Estimate: [2.0, 3.0] hours
  - Purpose: Validate cross-language ability invocation
  - _Leverage: M3 workflow scenarios adapted for cross-language_
  - _Requirements: 5.4, 5.12 completed_
  - _Prompt: Implement the task for spec M5-cross-language-agent, first run spec-workflow-guide to get the workflow guide then implement the task: Role: Integration Engineer with expertise in cross-language systems | Task: Test TypeScript agent-producer orchestrating Python agent-worker to use Python-specific abilities, verifying complete cross-language workflow | Restrictions: Must test real cross-language communication, verify data serialization works, test error propagation | Success: Cross-language workflow works end-to-end, TypeScript producer orchestrates Python worker correctly_

- [ ] 5.14. Implement DaemonAgent full agent lifecycle
  - File: C:\GitHub\DaemonAgent\Code\Game\
  - Implement full agent lifecycle in DaemonAgent: registration with KĀDI broker, heartbeat, task reception, execution, result reporting, and graceful shutdown
  - Time Estimate: [4.0, 6.0] hours
  - Purpose: Enable DaemonAgent as a KĀDI agent
  - _Leverage: C:\GitHub\DaemonAgent\.spec-workflow\specs\generic-command-system\, M3 task 3.25 results_
  - _Requirements: M3 task 3.25 (generic command system) completed_
  - _Prompt: Implement the task for spec M5-cross-language-agent, first run spec-workflow-guide to get the workflow guide then implement the task: Role: C++ Developer with expertise in game engine and agent integration | Task: Implement full agent lifecycle in DaemonAgent including registration with KĀDI broker, heartbeat, task reception via generic command system, execution, result reporting, and graceful shutdown | Restrictions: Must use generic command system from M3, maintain 60 FPS performance, handle V8 thread safety | Success: DaemonAgent registers as KĀDI agent, receives and executes tasks, reports results, maintains performance_

- [ ] 5.15. Define game development task types
  - File: C:\GitHub\DaemonAgent\Code\Game\Gameplay\TaskTypes\
  - Define game development task types: Entity Creation, Entity Manipulation, Script Modification, Input Simulation, Scene Setup, Behavior Testing
  - Register each as a generic command handler
  - Time Estimate: [3.0, 5.0] hours
  - Purpose: Enable game-specific task execution
  - _Leverage: Generic command system from M3_
  - _Requirements: 5.14 completed_
  - _Prompt: Implement the task for spec M5-cross-language-agent, first run spec-workflow-guide to get the workflow guide then implement the task: Role: C++ Developer with expertise in game engine task systems | Task: Define game development task types (Entity Creation, Entity Manipulation, Script Modification, Input Simulation, Scene Setup, Behavior Testing) and register each as a generic command handler | Restrictions: Must use generic command registry, maintain thread safety, support V8 payload format | Success: All task types defined and registered, each executes correctly via generic command system_

- [ ] 5.16. Integrate DaemonAgent with quest workflow
  - File: C:\GitHub\AGENTS\agent-producer\src\handlers\
  - Integrate DaemonAgent as a task executor in agent-producer quest workflow
  - Enable agent-producer to assign game development tasks to DaemonAgent
  - Time Estimate: [3.0, 5.0] hours
  - Purpose: Enable game development in multi-agent workflow
  - _Leverage: agent-producer orchestration, DaemonAgent agent lifecycle_
  - _Requirements: 5.14, 5.15 completed_
  - _Prompt: Implement the task for spec M5-cross-language-agent, first run spec-workflow-guide to get the workflow guide then implement the task: Role: Integration Engineer with expertise in multi-agent systems | Task: Integrate DaemonAgent as a task executor in agent-producer quest workflow, enabling agent-producer to assign game development tasks to DaemonAgent via KĀDI broker | Restrictions: Must use existing orchestration patterns, handle DaemonAgent-specific task types, support mixed workflows (TypeScript + C++ agents) | Success: agent-producer assigns game tasks to DaemonAgent, DaemonAgent executes and reports results, mixed workflows work_

- [ ] 5.17. Test DaemonAgent integration end-to-end
  - File: C:\GitHub\AGENTS\agent-producer\src\workflows\
  - Test complete DaemonAgent integration: quest creation → game task assignment → DaemonAgent execution → result verification
  - Time Estimate: [2.0, 3.0] hours
  - Purpose: Validate DaemonAgent integration
  - _Leverage: Tasks 5.14-5.16_
  - _Requirements: 5.16 completed_
  - _Prompt: Implement the task for spec M5-cross-language-agent, first run spec-workflow-guide to get the workflow guide then implement the task: Role: QA Engineer with expertise in game engine testing | Task: Test complete DaemonAgent integration end-to-end, from quest creation through game task assignment to DaemonAgent execution and result verification | Restrictions: Must test all game task types, verify KĀDI event flow, test error handling | Success: End-to-end workflow works, all game task types execute correctly, results verified_

- [ ] 5.18. Create M5 completion report
  - File: C:\GitHub\AGENTS\.spec-workflow\specs\M3-expand-task-complexity\m5-completion-report.md
  - Create comprehensive M5 completion report documenting cross-language agents, MCP client refactoring, abilities, and DaemonAgent integration
  - Time Estimate: [0.5, 1.0] hours
  - Purpose: Document M5 milestone completion
  - _Leverage: All M5 task results_
  - _Requirements: All M5 tasks completed_
  - _Prompt: Implement the task for spec M5-cross-language-agent, first run spec-workflow-guide to get the workflow guide then implement the task: Role: Project Manager with expertise in milestone reporting | Task: Create comprehensive M5 completion report documenting cross-language agent status, MCP client refactoring results, language-specific abilities, and DaemonAgent integration | Restrictions: Must cover all task groups, include metrics, document known issues | Success: Report is comprehensive, all areas covered, M6 prerequisites documented_
