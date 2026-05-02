# M6 Tasks Document — DaemonAgent Enhancement, Memory System, Voice Integration, Directives, Spec Dashboard

## Milestone Overview

| Milestone | Focus | Tasks | Est. Hours |
|-----------|-------|-------|------------|
| M6 | DaemonAgent tools, memory enhancement, voice integration, directives, spec dashboard | 73 | 120 - 180 |

## Task Groups

| Group | Tasks | Focus | Est. Hours |
|-------|-------|-------|------------|
| DaemonAgent Enhancement | 1.1 - 1.4 | New tools, versioning, mcp-server-blender, role discovery | 30 - 45 |
| Enhanced Memory System | 2.1 - 2.9 | Fact reconciliation, entity dedup, soft-delete, chunking, reranking, reflect, temporal decay, graph explorer | 40 - 60 |
| Voice Integration | 3.1 - 3.2 | Publish ability-voice, listen-think-speak loop | 10 - 15 |
| Agent Directive System | 4.1 | DIRECTIVE.ts loader and per-agent directives | 10 - 15 |
| Spec Dashboard | 5.1 - 5.3 | Spec viewer/editor, approval workflow, spec-quest integration | 30 - 45 |

---

## Group 1: DaemonAgent Enhancement and Role Tooling

- [x] 1.1.1. Implement `validate_script` GenericCommand in DaemonAgent
  - File: C:\GitHub\DaemonAgent\Code\Game\KADI\GenericCommands\ValidateScript.cpp
  - Implement C++ GenericCommand that receives JS source string, parses via V8 without execution, returns syntax errors
  - Time Estimate: [3.0, 4.0] hours
  - Purpose: Enable agent-worker-programmer to check JS syntax before deploying scripts
  - _Leverage: C:\GitHub\DaemonAgent\Code\Game\KADI\GenericCommands\ (existing GenericCommand pattern), C:\GitHub\DaemonAgent\Code\Game\Scripting\ (V8 integration)_
  - _Requirements: 1.1 AC1_
  - _Prompt: Implement the task for spec M6, first run spec-workflow-guide to get the workflow guide then implement the task: Role: C++ Developer with expertise in V8 embedding and game engine architecture | Task: Create ValidateScript GenericCommand in DaemonAgent that receives a JS source string, parses it via V8's ScriptCompiler without executing, and returns any syntax errors with line/column numbers. Follow the existing GenericCommand pattern in the KADI directory | Restrictions: Do NOT execute the script — parse only. Follow existing GenericCommand registration pattern. Handle V8 isolate lifecycle correctly. Return structured JSON with valid boolean and errors array | Success: validate_script command registered, V8 parses JS without execution, syntax errors returned with line/column info, no crashes on malformed input_

- [x] 1.1.2. Implement `run_script_test` GenericCommand in DaemonAgent
  - File: C:\GitHub\DaemonAgent\Code\Game\KADI\GenericCommands\RunScriptTest.cpp
  - Execute script in sandboxed V8 context with 10s timeout, capture console output and exceptions
  - Time Estimate: [3.0, 5.0] hours
  - Purpose: Enable agent-worker-programmer to runtime-test scripts before QA handoff
  - _Leverage: C:\GitHub\DaemonAgent\Code\Game\KADI\GenericCommands\ (existing pattern), C:\GitHub\DaemonAgent\Code\Game\Scripting\ (V8 context management)_
  - _Requirements: 1.1 AC2_
  - _Prompt: Implement the task for spec M6, first run spec-workflow-guide to get the workflow guide then implement the task: Role: C++ Developer with V8 sandboxing expertise | Task: Create RunScriptTest GenericCommand that loads a script by path, executes it in a sandboxed V8 context with a 10-second timeout, captures all console.log output and any thrown exceptions, and returns success/failure with output and errors | Restrictions: Must sandbox execution (no access to game state mutations during test). Enforce 10s timeout via V8 TerminateExecution. Capture console output by intercepting console.log binding. Return structured JSON | Success: Scripts execute in sandbox, console output captured, exceptions caught, timeout enforced, no impact on running game state_

- [x] 1.1.3. Implement `get_entity_list` GenericCommand in DaemonAgent
  - File: C:\GitHub\DaemonAgent\Code\Game\KADI\GenericCommands\GetEntityList.cpp
  - Enumerate all active GameObjects with name, type, and position
  - Time Estimate: [2.0, 3.0] hours
  - Purpose: Give agent-worker-programmer visibility into the game scene
  - _Leverage: C:\GitHub\DaemonAgent\Code\Game\KADI\GenericCommands\ (existing pattern), C:\GitHub\DaemonAgent\Code\Game\Objects\ (GameObject hierarchy)_
  - _Requirements: 1.1 AC3_
  - _Prompt: Implement the task for spec M6, first run spec-workflow-guide to get the workflow guide then implement the task: Role: C++ Game Engine Developer | Task: Create GetEntityList GenericCommand that iterates all active GameObjects in the scene and returns their name, type (Prop, Camera, Light, etc.), and world position as a JSON array | Restrictions: Read-only operation — do not modify any game state. Handle empty scenes gracefully. Keep response size reasonable (limit to 1000 entities max) | Success: Returns complete entity list with name/type/position, handles empty scenes, no performance impact on game loop_

- [x] 1.1.4. Implement `get_engine_metrics` GenericCommand in DaemonAgent
  - File: C:\GitHub\DaemonAgent\Code\Game\KADI\GenericCommands\GetEngineMetrics.cpp
  - Return current FPS, entity count, and memory usage
  - Time Estimate: [1.5, 2.0] hours
  - Purpose: Enable agent-worker-programmer to monitor engine performance
  - _Leverage: C:\GitHub\DaemonAgent\Code\Game\KADI\GenericCommands\ (existing pattern), C:\GitHub\Engine\Code\Engine\ (performance counters)_
  - _Requirements: 1.1 AC4_
  - _Prompt: Implement the task for spec M6, first run spec-workflow-guide to get the workflow guide then implement the task: Role: C++ Engine Developer | Task: Create GetEngineMetrics GenericCommand that returns current FPS (from frame timer), active entity count, and process memory usage in MB as JSON | Restrictions: Read-only, no side effects. Use existing engine performance counters where available. Memory usage via Windows API (GetProcessMemoryInfo) | Success: Returns fps, entityCount, memoryUsageMB as JSON, values are accurate, no performance overhead_

- [x] 1.1.5. Implement `list_scripts` GenericCommand in DaemonAgent
  - File: C:\GitHub\DaemonAgent\Code\Game\KADI\GenericCommands\ListScripts.cpp
  - Return all loaded scripts with file path, name, and active status
  - Time Estimate: [1.5, 2.0] hours
  - Purpose: Let agent-worker-programmer see what scripts are loaded in the engine
  - _Leverage: C:\GitHub\DaemonAgent\Code\Game\KADI\GenericCommands\ (existing pattern), C:\GitHub\DaemonAgent\Code\Game\Scripting\ (script registry)_
  - _Requirements: 1.1 AC5_
  - _Prompt: Implement the task for spec M6, first run spec-workflow-guide to get the workflow guide then implement the task: Role: C++ Developer | Task: Create ListScripts GenericCommand that queries the V8 script registry and returns all loaded scripts with their file path, display name, and active/inactive status as a JSON array | Restrictions: Read-only. Handle case where no scripts are loaded. Include both KADI tool scripts and user scripts | Success: Returns complete script list with path/name/active status, handles empty registry_

- [x] 1.1.6. Register KADI JS tool wrappers for new GenericCommands
  - File: C:\GitHub\DaemonAgent\Run\Data\Scripts\kadi\DevelopmentTools.js
  - Add JS tool registrations for validate_script, run_script_test, get_entity_list, get_engine_metrics, list_scripts
  - Time Estimate: [2.0, 3.0] hours
  - Purpose: Expose new GenericCommands as KADI tools discoverable on the broker
  - _Leverage: C:\GitHub\DaemonAgent\Run\Data\Scripts\kadi\DevelopmentTools.js (existing tool registration pattern), C:\GitHub\DaemonAgent\Run\Data\Scripts\kadi\GameControlTools.js_
  - _Requirements: 1.1 AC1-5_
  - _Prompt: Implement the task for spec M6, first run spec-workflow-guide to get the workflow guide then implement the task: Role: JavaScript Developer with KADI tool registration expertise | Task: Add KADI tool registrations in DevelopmentTools.js for the 5 new GenericCommands (validate_script, run_script_test, get_entity_list, get_engine_metrics, list_scripts). Follow the existing registration pattern used by create_script, capture_screenshot, etc. Define Zod-style parameter schemas and descriptions | Restrictions: Follow exact existing registration pattern. Tool names must match GenericCommand names. Include proper parameter schemas and descriptions for broker discovery | Success: All 5 tools registered, discoverable on broker, parameter schemas defined, invoke calls route to correct GenericCommands_

- [x] 1.1.7. ~~Move build lifecycle tools from agent-builder to DaemonAgent~~ SKIPPED — agent-builder stays as external process manager
  - File: C:\GitHub\DaemonAgent\Run\Data\Scripts\kadi\BuildTools.js (new)
  - Register rebuild_game, restart_game, shutdown_game as KADI tools in DaemonAgent
  - Port logic from agent-builder's rebuild-game.ts, restart-game.ts, shutdown-game.ts
  - Time Estimate: [3.0, 4.0] hours
  - Purpose: Retire agent-builder by moving build lifecycle tools to DaemonAgent itself
  - _Leverage: C:\GitHub\AGENTS\agent-builder\src\tools\ (existing tool implementations), C:\GitHub\DaemonAgent\Run\Data\Scripts\kadi\ (registration pattern)_
  - _Requirements: 1.1 AC6-8_
  - _Prompt: Implement the task for spec M6, first run spec-workflow-guide to get the workflow guide then implement the task: Role: Full-stack Developer with build automation expertise | Task: Create BuildTools.js in DaemonAgent's KADI scripts directory. Register rebuild_game (shutdown, MSBuild, relaunch, wait for reconnect), restart_game (shutdown, relaunch), and shutdown_game (terminate process) as KADI tools. Port the logic from agent-builder's TypeScript implementations to JS GenericCommand calls. rebuild_game should accept config parameter (Debug/Release) | Restrictions: Must handle MSBuild path from config. Must wait for KADI reconnect after relaunch. Shutdown must be graceful (allow save). Do not break existing DaemonAgent tool registrations | Success: All 3 build tools registered, rebuild triggers MSBuild and relaunches, restart relaunches without build, shutdown terminates cleanly_

- [x] 1.1.8. End-to-end test: agent-worker-programmer invokes all new tools via broker
  - Verify all 8 new tools (validate_script, run_script_test, get_entity_list, get_engine_metrics, list_scripts, rebuild_game, restart_game, shutdown_game) are callable from DigitalOcean via broker
  - Time Estimate: [2.0, 3.0] hours
  - Purpose: Confirm cross-machine tool invocation works for the full DaemonAgent toolset
  - _Leverage: C:\GitHub\AGENTS\agent-worker\src\ (invokeRemote pattern)_
  - _Requirements: 1.1 AC1-9_
  - _Prompt: Implement the task for spec M6, first run spec-workflow-guide to get the workflow guide then implement the task: Role: Integration Test Engineer | Task: Test all 8 new DaemonAgent tools from agent-worker on DigitalOcean via KADI broker. For each tool: invoke via invokeRemote, verify response format, verify error handling. Test validate_script with valid and invalid JS. Test run_script_test with a simple script. Test get_entity_list, get_engine_metrics, list_scripts for correct data. Test rebuild_game, restart_game, shutdown_game lifecycle | Restrictions: DaemonAgent must be running on local Windows machine. Broker must be connected. Do not leave DaemonAgent in a broken state after testing | Success: All 8 tools respond correctly via broker, error cases handled, DaemonAgent stable after test cycle_

- [x] 1.2.1. Create VERSION file and `get_version` tool
  - File: C:\GitHub\DaemonAgent\VERSION, C:\GitHub\DaemonAgent\Run\Data\Scripts\kadi\BuildTools.js
  - Create VERSION file with initial `0.1.0`, implement get_version GenericCommand + JS wrapper
  - Time Estimate: [1.0, 2.0] hours
  - Purpose: Establish version tracking for DaemonAgent releases
  - _Leverage: C:\GitHub\DaemonAgent\Run\Data\Scripts\kadi\ (tool registration pattern)_
  - _Requirements: 1.2 AC1-2_
  - _Prompt: Implement the task for spec M6, first run spec-workflow-guide to get the workflow guide then implement the task: Role: Build Engineer | Task: Create a VERSION file at DaemonAgent repo root containing `0.1.0`. Implement GetVersion GenericCommand that reads this file and returns the version string. Register as KADI tool in BuildTools.js | Restrictions: VERSION file is plain text, single line, semver format. GenericCommand must handle missing VERSION file gracefully | Success: VERSION file exists, get_version tool returns correct version via broker_

- [x] 1.2.2. Implement `package_release` tool
  - File: C:\GitHub\DaemonAgent\Code\Game\KADI\GenericCommands\PackageRelease.cpp, C:\GitHub\DaemonAgent\Run\Data\Scripts\kadi\BuildTools.js
  - Zip Run/ folder (exe + DLLs + Data/, exclude Logs/ and Screenshots/), return zip path and size
  - Time Estimate: [2.0, 3.0] hours
  - Purpose: Automate release artifact creation
  - _Leverage: C:\GitHub\DaemonAgent\Run\ (release artifact structure)_
  - _Requirements: 1.2 AC3-4_
  - _Prompt: Implement the task for spec M6, first run spec-workflow-guide to get the workflow guide then implement the task: Role: C++ Build Engineer | Task: Create PackageRelease GenericCommand that zips the Run/ folder contents (Release exe, all DLLs, Data/ directory) excluding Logs/ and Screenshots/ directories. Accept optional config parameter (Debug/Release) to select which exe to include. Return zip file path and size in bytes. Register as KADI tool in BuildTools.js | Restrictions: Must exclude Logs/, Screenshots/, and any .pdb files. Use a standard zip library. Place output zip in a temp directory. Handle missing files gracefully | Success: Zip created with correct contents, excludes specified directories, returns valid path and size_

- [x] 1.2.3. Test release flow end-to-end
  - Verify: agent-lead bumps VERSION via ability-file-remote, calls rebuild_game (Release), calls package_release, creates GitHub release via gh
  - Time Estimate: [2.0, 3.0] hours
  - Purpose: Validate the complete release pipeline
  - _Leverage: C:\GitHub\AGENTS\agent-lead\src\ (orchestration), ability-file-remote (cross-machine file I/O)_
  - _Requirements: 1.2 AC3-5_
  - _Prompt: Implement the task for spec M6, first run spec-workflow-guide to get the workflow guide then implement the task: Role: Release Engineer | Task: Test the full release pipeline: (1) agent-lead on DO bumps VERSION file via ability-file-remote, (2) calls rebuild_game with Release config via broker, (3) calls package_release to create zip, (4) creates GitHub release via gh CLI on local machine. Verify each step succeeds and the GitHub release has the correct zip attached | Restrictions: This is a test — use a test version number. Do not push to main branch. Clean up test release after verification | Success: Full pipeline executes, GitHub release created with correct zip, VERSION bumped_

- [x] 1.3.1. Scaffold mcp-server-blender project
  - File: C:\GitHub\AGENTS\mcp-server-blender\ (new repo)
  - Create Python project with kadi-core-py broker client, config.toml (artist network), agent.json
  - Time Estimate: [2.0, 3.0] hours
  - Purpose: Establish project structure for Blender MCP server
  - _Leverage: C:\GitHub\AGENTS\ability-voice\ (Python KADI ability pattern), C:\GitHub-Reference\blender-mcp\ (Blender MCP architecture)_
  - _Requirements: 1.3 AC1_
  - _Prompt: Implement the task for spec M6, first run spec-workflow-guide to get the workflow guide then implement the task: Role: Python Developer with KADI broker expertise | Task: Scaffold mcp-server-blender as a Python project following ability-voice's pattern. Create config.toml with artist network, agent.json with tool declarations, requirements.txt with kadi-core-py. Set up the broker client connection and tool registration framework | Restrictions: Follow existing Python ability patterns (ability-voice). Use kadi-core-py for broker connectivity. Network must be `artist` | Success: Project scaffolded, connects to broker on artist network, tool registration framework ready_

- [x] 1.3.2. Implement Blender process manager
  - File: C:\GitHub\AGENTS\mcp-server-blender\src\blender_manager.py
  - Launch Blender headless, health check, auto-restart on crash within 5s
  - Time Estimate: [3.0, 4.0] hours
  - Purpose: Manage Blender lifecycle for headless operation on DO droplet
  - _Leverage: C:\GitHub-Reference\blender-mcp\ (Blender addon + socket pattern)_
  - _Requirements: 1.3 AC1, AC9_
  - _Prompt: Implement the task for spec M6, first run spec-workflow-guide to get the workflow guide then implement the task: Role: Python DevOps Engineer | Task: Create BlenderManager class that launches Blender in headless mode (`blender --background --python bootstrap.py`), monitors process health via heartbeat, and auto-restarts within 5s on crash. Implement socket communication between the Python broker client and the Blender process (referencing blender-mcp's addon pattern) | Restrictions: Must work headless (no display). Must handle Blender segfaults gracefully. Socket communication must be reliable. Log all lifecycle events | Success: Blender launches headless, heartbeat works, auto-restart on crash within 5s, socket communication established_

- [x] 1.3.3. Implement Blender tools (create, modify, material, render, export, execute, scene_info)
  - File: C:\GitHub\AGENTS\mcp-server-blender\src\tools\
  - Implement all 7 Blender tools: blender_create_object, blender_modify_object, blender_set_material, blender_render, blender_export, blender_execute_python, blender_get_scene_info
  - Time Estimate: [6.0, 8.0] hours
  - Purpose: Expose full Blender functionality to agent-worker-artist
  - _Leverage: C:\GitHub-Reference\blender-mcp\src\ (tool implementations), Blender bpy API_
  - _Requirements: 1.3 AC2-8_
  - _Prompt: Implement the task for spec M6, first run spec-workflow-guide to get the workflow guide then implement the task: Role: Python 3D Developer with Blender API expertise | Task: Implement 7 Blender tools that execute bpy commands via the socket connection to headless Blender. blender_create_object: create mesh (cube/sphere/cylinder/plane) with optional name/location/scale. blender_modify_object: apply transforms and modifiers. blender_set_material: create/assign material with color/roughness/metallic. blender_render: render scene to file. blender_export: export to glTF/FBX/OBJ. blender_execute_python: run arbitrary bpy code. blender_get_scene_info: return all objects/types/positions/materials | Restrictions: All operations go through socket to Blender process. Handle Blender errors gracefully. Render must work headless (no GPU required, use CPU fallback). Export paths must be accessible from DO filesystem | Success: All 7 tools work headless, create/modify/render/export produce correct results, scene_info returns accurate data_

- [x] 1.3.4. Deploy mcp-server-blender to DigitalOcean
  - Install Blender on DO droplet, deploy mcp-server-blender, verify broker connectivity on artist network
  - Time Estimate: [2.0, 3.0] hours
  - Purpose: Make Blender tools available to agent-worker-artist in production
  - _Leverage: DO droplet setup, kadi-gateway config_
  - _Requirements: 1.3 AC1_
  - _Prompt: Implement the task for spec M6, first run spec-workflow-guide to get the workflow guide then implement the task: Role: DevOps Engineer | Task: Install Blender 4.x on the DigitalOcean droplet (headless, no GUI). Deploy mcp-server-blender, configure it to connect to the KADI broker on the artist network. Verify tools are discoverable and functional from agent-worker-artist | Restrictions: Blender must run headless. Use apt or snap for Blender installation. Ensure sufficient disk space for renders and exports | Success: Blender installed, mcp-server-blender running, tools discoverable on artist network, basic create+render test passes_

- [x] 1.4.1. Configure role-based network joining in agent-worker
  - File: C:\GitHub\AGENTS\agent-worker\config.toml, C:\GitHub\AGENTS\agent-worker\src\index.ts
  - Join role-specific networks based on AGENT_ROLE config (programmer->programmer, artist->artist, designer->file)
  - Time Estimate: [2.0, 3.0] hours
  - Purpose: Enable automatic tool discovery per role
  - _Leverage: C:\GitHub\AGENTS\agent-worker\config.toml (existing network config), C:\GitHub\AGENTS\agents-library\src\base-agent.ts (network joining)_
  - _Requirements: 1.4 AC1-4_
  - _Prompt: Implement the task for spec M6, first run spec-workflow-guide to get the workflow guide then implement the task: Role: TypeScript Developer | Task: Modify agent-worker startup to read AGENT_ROLE from config.toml and dynamically join the corresponding network (programmer->programmer, artist->artist, designer->file) in addition to its base networks. Verify that tools on role networks are discoverable via invokeRemote | Restrictions: Must not break existing network membership. Role network is additive. Handle missing AGENT_ROLE gracefully (default to existing behavior) | Success: agent-worker joins role network on startup, discovers role-specific tools, existing functionality preserved_

---

## Group 2: Enhanced Memory System

- [ ] 2.1.1. Create fact extraction module in ability-memory
  - File: C:\GitHub\AGENTS\ability-memory\src\lib\reconciliation.ts
  - Implement extractFacts() — LLM call with fact extraction prompt, parse JSON response into Fact[]
  - Time Estimate: [3.0, 4.0] hours
  - Purpose: Extract atomic facts from input text for clean memory storage
  - _Leverage: ability-memory\src\ (existing tool pattern), model-manager (LLM calls via broker)_
  - _Requirements: 2.1 AC1_
  - _Prompt: Implement the task for spec M6, first run spec-workflow-guide to get the workflow guide then implement the task: Role: TypeScript Developer with LLM integration expertise | Task: Create reconciliation.ts in ability-memory with extractFacts(input: string) function. Call model-manager via broker with a fact extraction prompt that returns JSON `{"facts": [...]}` array of atomic fact statements with entities and topics. Parse and validate the LLM response | Restrictions: Use existing broker invokeRemote pattern for LLM calls. Handle LLM failures gracefully (return empty array). Keep extraction prompt token-efficient. Each fact must be a single atomic statement | Success: extractFacts returns Fact[] from LLM, handles malformed responses, graceful degradation on LLM failure_

- [ ] 2.1.2. Implement fact reconciliation logic
  - File: C:\GitHub\AGENTS\ability-memory\src\lib\reconciliation.ts
  - Implement reconcileFacts() — for each fact, find related memories via embedding similarity, classify as ADD/UPDATE/DELETE/NONE via LLM
  - Time Estimate: [4.0, 6.0] hours
  - Purpose: Automatic deduplication and conflict resolution for memories
  - _Leverage: ability-memory\src\ (memory-store tool), ability-graph (graph-recall for similarity search)_
  - _Requirements: 2.1 AC2-5_
  - _Prompt: Implement the task for spec M6, first run spec-workflow-guide to get the workflow guide then implement the task: Role: TypeScript Developer with knowledge graph expertise | Task: Implement reconcileFacts(facts, existing) in reconciliation.ts. For each extracted fact: (1) embed the fact text, (2) search existing memories via graph-recall for similar content, (3) call LLM with reconciliation prompt comparing new fact vs existing memories, (4) classify as ADD/UPDATE/DELETE/NONE. Return ReconciliationResult[] with action, targetId, and mergedContent | Restrictions: Reconciliation prompt must be clear about classification criteria. UPDATE means enrich existing, DELETE means contradict. NONE means already known. Handle LLM classification errors by defaulting to ADD | Success: Reconciliation correctly classifies facts, UPDATE merges content, DELETE triggers soft-delete, NONE increments mentions_

- [ ] 2.1.3. Wire reconciliation into memory-store tool
  - File: C:\GitHub\AGENTS\ability-memory\src\index.ts
  - Modify memory-store to extract facts and reconcile before storing
  - Add mentions INTEGER property to Memory vertex schema
  - Time Estimate: [2.0, 3.0] hours
  - Purpose: Make reconciliation the default write path
  - _Leverage: ability-memory\src\index.ts (existing memory-store tool)_
  - _Requirements: 2.1 AC1-5_
  - _Prompt: Implement the task for spec M6, first run spec-workflow-guide to get the workflow guide then implement the task: Role: TypeScript Developer | Task: Modify the memory-store tool in ability-memory to call extractFacts then reconcileFacts before storing. For ADD: create new vertex. For UPDATE: merge into existing vertex. For DELETE: soft-delete existing (set valid=false). For NONE: increment mentions counter. Add mentions INTEGER property to Memory vertex schema. Add optional reconcile=false parameter to bypass for raw storage | Restrictions: Must be backward compatible — existing callers should work without changes. Reconciliation failures should fall back to raw storage. Do not break existing memory-store behavior | Success: memory-store extracts and reconciles by default, mentions tracked, fallback to raw storage on failure_

- [ ] 2.2.1. Implement embedding-based entity deduplication
  - File: C:\GitHub\AGENTS\ability-graph\src\lib\entity-dedup.ts (new)
  - Embed entity names, cosine-compare against existing entities (threshold 0.7), merge or create
  - Add name_embedding LIST property to Entity vertex schema
  - Time Estimate: [3.0, 4.0] hours
  - Purpose: Prevent duplicate entity nodes for similar names
  - _Leverage: ability-graph\src\ (existing entity creation), model-manager (embedding endpoint)_
  - _Requirements: 2.2 AC1-3_
  - _Prompt: Implement the task for spec M6, first run spec-workflow-guide to get the workflow guide then implement the task: Role: TypeScript Developer with vector search expertise | Task: Create entity-dedup.ts in ability-graph. Before creating a new entity vertex, embed the entity name via model-manager, then cosine-compare against existing entity name_embeddings (threshold 0.7). On match: merge into existing vertex (increment mentions, update last_seen). On no match: create new vertex with name_embedding stored. Add name_embedding LIST property to Entity vertex schema | Restrictions: Threshold must be configurable. Handle embedding service unavailability by falling back to exact string match. Batch embedding calls where possible | Success: Similar entity names resolve to same node, new entities get embeddings stored, configurable threshold_

- [ ] 2.3.1. Implement soft-delete with temporal validity
  - File: C:\GitHub\AGENTS\ability-graph\src\ (modify graph-store and graph-recall)
  - Add valid BOOLEAN, invalidated_at STRING, invalidated_by STRING to Memory and edge schemas
  - Modify graph-recall to filter valid=true by default, add includeInvalid parameter
  - Time Estimate: [3.0, 4.0] hours
  - Purpose: Track knowledge evolution instead of losing history
  - _Leverage: ability-graph\src\ (existing store/recall tools)_
  - _Requirements: 2.3 AC1-3_
  - _Prompt: Implement the task for spec M6, first run spec-workflow-guide to get the workflow guide then implement the task: Role: TypeScript Developer with graph database expertise | Task: Add valid (BOOLEAN, default true), invalidated_at (STRING, ISO timestamp), invalidated_by (STRING, RID) properties to Memory vertex and edge schemas. Modify graph-recall to add WHERE valid = true (or valid IS NULL) by default. Add includeInvalid boolean parameter — when true, return all records with temporal metadata. Modify DELETE reconciliation action to set valid=false + invalidated_at instead of hard-delete | Restrictions: Must not break existing queries. Default behavior filters invalid records. Schema migration must be idempotent (IF NOT EXISTS) | Success: Soft-delete works, graph-recall filters by default, includeInvalid returns full history_

- [ ] 2.4.1. Port chunking pipeline from ability-search into ability-graph
  - File: C:\GitHub\AGENTS\ability-graph\src\lib\chunker.ts (new)
  - Port 5 chunking strategies (markdown-headers, code-blocks, paragraph, sliding-window, auto)
  - Time Estimate: [3.0, 4.0] hours
  - Purpose: Consolidate chunking into ability-graph, deprecate ability-search
  - _Leverage: C:\GitHub\AGENTS\ability-search\src\ (existing chunking logic)_
  - _Requirements: 2.4 AC1_
  - _Prompt: Implement the task for spec M6, first run spec-workflow-guide to get the workflow guide then implement the task: Role: TypeScript Developer with text processing expertise | Task: Port the chunking pipeline from ability-search into ability-graph as chunker.ts. Support 5 strategies: markdown-headers (split on ## headings), code-blocks (extract fenced code), paragraph (split on double newlines), sliding-window (configurable size/overlap), auto (detect format and choose strategy). Each chunk includes content, metadata (strategy, position, heading context) | Restrictions: Pure text processing — no external dependencies. Must handle edge cases (empty input, single-line docs, nested headings). Preserve chunk ordering | Success: All 5 strategies produce correct chunks, auto-detection works, edge cases handled_

- [ ] 2.4.2. Implement graph-index and graph-index-file tools
  - File: C:\GitHub\AGENTS\ability-graph\src\index.ts
  - Register graph-index (chunk + embed + store) and graph-index-file (read file + delegate) tools
  - Time Estimate: [3.0, 4.0] hours
  - Purpose: Provide document indexing through ability-graph
  - _Leverage: ability-graph\src\lib\chunker.ts (from 2.4.1), ability-graph\src\ (existing tool registration)_
  - _Requirements: 2.4 AC1-3_
  - _Prompt: Implement the task for spec M6, first run spec-workflow-guide to get the workflow guide then implement the task: Role: TypeScript Developer | Task: Register two new tools in ability-graph: graph-index (accepts content string + strategy, chunks via chunker.ts, embeds each chunk via model-manager, stores as vertices with NEXT_CHUNK edges) and graph-index-file (accepts file path, reads content, detects format, delegates to graph-index). Both tools should support collection/namespace parameter for organizing indexed content | Restrictions: Follow existing tool registration pattern. Batch embedding calls for efficiency. Handle large documents by chunking before embedding | Success: graph-index chunks and stores with embeddings, graph-index-file reads and delegates, NEXT_CHUNK edges connect sequential chunks_

- [ ] 2.4.3. Update ability-docs-memory to use graph-index and deprecate ability-search
  - File: C:\GitHub\AGENTS\ability-docs-memory\src\, C:\GitHub\AGENTS\ability-search\agent.json
  - Replace internal chunker with graph-index tool calls, mark ability-search as deprecated
  - Time Estimate: [2.0, 3.0] hours
  - Purpose: Complete the consolidation
  - _Leverage: ability-docs-memory\src\ (existing indexing pipeline), ability-graph graph-index tool_
  - _Requirements: 2.4 AC3-4_
  - _Prompt: Implement the task for spec M6, first run spec-workflow-guide to get the workflow guide then implement the task: Role: TypeScript Developer | Task: Modify ability-docs-memory's indexing pipeline to call ability-graph's graph-index tool instead of its own internal chunker. Update the batch-store flow to delegate chunking and embedding to graph-index. Mark ability-search as deprecated in its agent.json description field | Restrictions: Must preserve existing docs-search behavior. Only the indexing/storage path changes, not the recall path. Verify ability-docs-memory still works end-to-end after change | Success: ability-docs-memory uses graph-index for indexing, search still works, ability-search marked deprecated_

- [ ] 2.5.1. Add conversation memory to agent-expert
  - File: C:\GitHub\AGENTS\agent-expert\src\tools\ask-agents.ts
  - Store each Q&A exchange via ability-memory after responding, recall relevant past conversations before responding
  - Time Estimate: [4.0, 6.0] hours
  - Purpose: Give agent-expert context across conversations
  - _Leverage: agent-expert\src\ (existing tool implementations), ability-memory (memory-store, memory-recall)_
  - _Requirements: 2.5 AC1-3_
  - _Prompt: Implement the task for spec M6, first run spec-workflow-guide to get the workflow guide then implement the task: Role: TypeScript Developer with conversational AI expertise | Task: Modify agent-expert's ask-agents tool to: (1) before responding, recall relevant past conversations via ability-memory's memory-recall with the user's query, inject into LLM context; (2) after responding, store the Q&A exchange via memory-store. Implement conversation archival — when exchanges exceed 20, summarize older ones via LLM and store the summary, removing individual exchanges | Restrictions: Memory operations must not block the response. Use fire-and-forget for storage. Recall should have a timeout (2s max). Handle ability-memory unavailability gracefully | Success: Follow-up questions have context from past conversations, archival triggers at 20 exchanges, graceful degradation_

- [ ] 2.5.2. Update agent-docs to use graph-index for document indexing
  - File: C:\GitHub\AGENTS\agent-docs\src\
  - Replace internal chunking in the sync/crawl/index pipeline with graph-index tool calls
  - Time Estimate: [2.0, 3.0] hours
  - Purpose: Ensure all docs go through the enhanced pipeline
  - _Leverage: agent-docs\src\ (existing pipeline), ability-graph graph-index tool_
  - _Requirements: 2.5 AC5_
  - _Prompt: Implement the task for spec M6, first run spec-workflow-guide to get the workflow guide then implement the task: Role: TypeScript Developer | Task: Modify agent-docs' sync/crawl/index pipeline to use ability-graph's graph-index tool for document chunking and indexing instead of its internal chunker. The pipeline should: sync repos, crawl markdown files, call graph-index for each file with markdown-headers strategy | Restrictions: Preserve existing pipeline structure (sync -> crawl -> index). Only replace the indexing step. Verify docs-search still returns correct results after reindexing | Success: agent-docs pipeline uses graph-index, reindexed docs searchable via docs-search_

- [ ] 2.6.1. Implement cross-encoder reranking signal
  - File: C:\GitHub\AGENTS\ability-graph\src\signals\cross-encoder.ts (new)
  - Register as post-fusion step, score (query, candidate) pairs via model-manager cross-encoder endpoint
  - Time Estimate: [3.0, 4.0] hours
  - Purpose: Improve retrieval precision with cross-encoder reranking
  - _Leverage: ability-graph\src\signals\ (existing signal plugin system), model-manager (cross-encoder endpoint)_
  - _Requirements: 2.6 AC1-4_
  - _Prompt: Implement the task for spec M6, first run spec-workflow-guide to get the workflow guide then implement the task: Role: TypeScript Developer with information retrieval expertise | Task: Create cross-encoder.ts as a new signal in ability-graph's plugin system. After RRF fusion produces top-K candidates, pass each (query, candidate.content) pair to model-manager's cross-encoder endpoint for scoring. Reorder candidates by cross-encoder score. Add rerank boolean parameter to graph-recall (default true). Fall back to RRF ranking if cross-encoder unavailable | Restrictions: Must integrate with existing signal plugin registry. Cross-encoder calls should be batched. Timeout at 5s. Fallback must be silent (no error to caller) | Success: Reranking improves result ordering, fallback works, configurable via rerank parameter_

- [ ] 2.7.1. Implement reflect synthesis module
  - File: C:\GitHub\AGENTS\ability-memory\src\lib\reflect.ts (new)
  - LLM synthesis of retrieved fragments into coherent summary with connections and contradictions
  - Time Estimate: [3.0, 4.0] hours
  - Purpose: Produce coherent memory summaries instead of raw fragments
  - _Leverage: ability-memory\src\ (existing recall pipeline), model-manager (LLM calls)_
  - _Requirements: 2.7 AC1-4_
  - _Prompt: Implement the task for spec M6, first run spec-workflow-guide to get the workflow guide then implement the task: Role: TypeScript Developer with LLM expertise | Task: Create reflect.ts in ability-memory with synthesize(query, fragments) function. Call LLM with a synthesis prompt that produces: coherent summary, identified connections between fragments, and any contradictions. Add reflect boolean parameter to memory-recall (default false). When true, run synthesis after retrieval and return both summary and raw fragments | Restrictions: Synthesis prompt must be focused and token-efficient. Handle LLM failures by returning raw fragments only. Timeout at 5s for synthesis call | Success: Reflect produces coherent summaries, identifies connections/contradictions, optional via parameter_

- [ ] 2.8.1. Implement temporal decay and access tracking
  - File: C:\GitHub\AGENTS\ability-graph\src\signals\temporal-decay.ts (new)
  - Decay function with configurable half-life, access_count and last_accessed tracking
  - Time Estimate: [2.0, 3.0] hours
  - Purpose: Surface recent and frequently-accessed memories
  - _Leverage: ability-graph\src\signals\ (signal plugin system), ArcadeDB (vertex properties)_
  - _Requirements: 2.8 AC1-4_
  - _Prompt: Implement the task for spec M6, first run spec-workflow-guide to get the workflow guide then implement the task: Role: TypeScript Developer | Task: Create temporal-decay.ts as a post-fusion signal in ability-graph. Apply exponential decay based on memory age (configurable half-life, default 30 days). Boost memories with higher access_count and mentions. Add access_count INTEGER and last_accessed STRING properties to Memory vertex schema. On each recall hit, increment access_count and update last_accessed | Restrictions: Decay must not eliminate old memories entirely — apply as a weighting factor. Access tracking updates should be fire-and-forget (don't block recall). Schema migration must be idempotent | Success: Newer memories rank higher, frequently accessed memories boosted, access tracking works_

- [ ] 2.9.1. Pull graph explorer from upstream and deploy
  - File: C:\GitHub\AGENTS\ability-graph\src\explorer\ (new, from graph-ability)
  - Pull explorer module, adapt for agents_memory database, add search/filter/soft-delete visualization
  - Deploy and add graph.dadavidtseng.com route to kadi-gateway
  - Time Estimate: [4.0, 6.0] hours
  - Purpose: Web-based knowledge graph visualization
  - _Leverage: C:\GitHub\humin-game-lab\agent-abilities\graph-ability\src\explorer\ (upstream explorer), kadi-gateway Caddy config_
  - _Requirements: 2.9 AC1-7_
  - _Prompt: Implement the task for spec M6, first run spec-workflow-guide to get the workflow guide then implement the task: Role: Full-stack Developer with data visualization expertise | Task: Pull the explorer module from graph-ability upstream into ability-graph. Adapt API routes to query agents_memory database. Add vertex detail view (content, metadata, connected entities), search functionality, agent/type filters, and soft-delete visualization (dimmed/dashed for valid=false). Deploy as a standalone Express server. Add graph.dadavidtseng.com route to kadi-gateway Caddy config | Restrictions: Must work with agents_memory database schema. Preserve upstream explorer's projection and template query features. Style should be clean and functional | Success: Explorer deployed at graph.dadavidtseng.com, shows memory graph, search/filter works, soft-deleted vertices visually distinct_

---

## Group 3: Voice Integration

- [ ] 3.1.1. Publish ability-voice and fix network naming
  - File: C:\GitHub\AGENTS\ability-voice\config.toml, C:\GitHub\AGENTS\ability-voice\agent.json
  - Fix network from voice-services to voice, publish to kadi registry
  - Time Estimate: [1.0, 2.0] hours
  - Purpose: Make ability-voice discoverable by agents
  - _Leverage: ability-voice\ (existing Python ability)_
  - _Requirements: 3.1 AC1-3_
  - _Prompt: Implement the task for spec M6, first run spec-workflow-guide to get the workflow guide then implement the task: Role: Python Developer | Task: Fix ability-voice config.toml network from voice-services to voice. Update agent.json if needed. Run kadi publish to publish to the registry. Verify kadi install resolves it in a test agent directory. Test broker connectivity on the voice network | Restrictions: Do not change tool implementations. Only config and publishing | Success: ability-voice published, network is voice, kadi install resolves it, tools discoverable on broker_

- [ ] 3.2.1. Implement listen-think-speak orchestration loop
  - File: C:\GitHub\AGENTS\agents-library\src\voice\ (new directory)
  - Subscribe to voice.command_transcribed events, route to agent, speak response
  - Time Estimate: [4.0, 6.0] hours
  - Purpose: Enable hands-free voice interaction with agents
  - _Leverage: ability-voice (8 tools), agents-library\src\base-agent.ts (broker event subscription)_
  - _Requirements: 3.2 AC1-4_
  - _Prompt: Implement the task for spec M6, first run spec-workflow-guide to get the workflow guide then implement the task: Role: TypeScript Developer with real-time systems expertise | Task: Create a voice orchestration module in agents-library that: (1) subscribes to voice.command_transcribed broker events, (2) routes the transcribed text to the agent's message handler (same path as text input), (3) after the agent produces a response, invokes speak tool on ability-voice via broker to synthesize and play audio. Add enableVoice config option to base-agent. If ability-voice is unavailable, fall back to text-only silently | Restrictions: Voice must be opt-in (enableVoice config). Must not block text input processing. Handle ability-voice unavailability gracefully. Audio playback is ability-voice's responsibility | Success: Wake word triggers transcription, agent processes command, response spoken aloud, text-only fallback works_

---

## Group 4: Agent Directive System

- [ ] 4.1.1. Create directive loader in agents-library
  - File: C:\GitHub\AGENTS\agents-library\src\utils\directive.ts (new)
  - Implement loadDirective(agentDir, role?) and loadStageDirective(agentDir, stage, context)
  - Time Estimate: [2.0, 3.0] hours
  - Purpose: Standardized system prompt loading for all agents
  - _Leverage: agents-library\src\utils\config.ts (existing config loading patterns)_
  - _Requirements: 4.1 AC1-5_
  - _Prompt: Implement the task for spec M6, first run spec-workflow-guide to get the workflow guide then implement the task: Role: TypeScript Developer | Task: Create directive.ts in agents-library/src/utils/. Implement loadDirective(agentDir, role?) that: (1) tries src/directives/index.ts, (2) if role specified, tries config/roles/{role}/directives/index.ts, (3) if the export is a string, return it, (4) if the export is a function, call it with DirectiveContext (available agents, tools, quest state). Implement loadStageDirective(agentDir, stage, context) that loads src/directives/{stage}.ts. Return null if no directive file exists (backward compatible) | Restrictions: Must handle missing files gracefully (return null, no error). Dynamic import for .ts files. Do not require directives — they're optional | Success: loadDirective returns string or null, loadStageDirective works for stage-specific prompts, backward compatible_

- [ ] 4.1.2. Wire directive loading into base-agent
  - File: C:\GitHub\AGENTS\agents-library\src\base-agent.ts
  - Load root directive on startup, expose method to append stage directives
  - Time Estimate: [1.0, 2.0] hours
  - Purpose: Automatic directive loading for all agents
  - _Leverage: agents-library\src\utils\directive.ts (from 4.1.1), agents-library\src\base-agent.ts_
  - _Requirements: 4.1 AC1-2_
  - _Prompt: Implement the task for spec M6, first run spec-workflow-guide to get the workflow guide then implement the task: Role: TypeScript Developer | Task: In base-agent.ts connect(), after broker connection, call loadDirective() and store the result. Expose getDirective() and appendStageDirective(stage, context) methods. The root directive should be available to agents for inclusion in their LLM system prompts | Restrictions: Directive loading must not block startup. If no directive exists, agent starts normally. Do not force agents to use directives — it's opt-in | Success: Root directive loaded on startup, stage directives appendable, backward compatible_

- [ ] 4.1.3. Create directives for all agents
  - File: C:\GitHub\AGENTS\agent-producer\src\directives\index.ts, agent-lead\src\directives\index.ts, agent-worker\src\directives\index.ts, agent-qa\src\directives\index.ts, agent-expert\src\directives\index.ts, agent-docs\src\directives\index.ts, agent-chatbot\src\directives\index.ts
  - Migrate agent-producer's quest-workflow.ts into directive format, create directives for all other agents
  - Time Estimate: [4.0, 6.0] hours
  - Purpose: Define identity and behavior for every agent
  - _Leverage: C:\GitHub\AGENTS\agent-producer\src\prompts\quest-workflow.ts (existing prompt), each agent's README/description_
  - _Requirements: 4.1 AC1-5_
  - _Prompt: Implement the task for spec M6, first run spec-workflow-guide to get the workflow guide then implement the task: Role: Prompt Engineer with multi-agent system expertise | Task: Create src/directives/index.ts for each agent. For agent-producer: migrate quest-workflow.ts content into directive format (export function that builds dynamic prompt with context). For other agents: define identity, principles, decision-making style, and behavioral guidelines. For agent-worker: create role-specific directives in config/roles/programmer/directives/index.ts, config/roles/artist/directives/index.ts, config/roles/designer/directives/index.ts | Restrictions: Each directive must be self-contained. Dynamic directives export functions, static ones export strings. Do not duplicate information already in agent.json. Keep directives focused and concise | Success: Every agent has a directive, agent-producer's quest-workflow migrated, role-specific directives for agent-worker_

---

## Group 5: Agent-Quest Dashboard — Spec Workflow Features

- [ ] 5.1.1. Create spec API routes in agent-quest server
  - File: C:\GitHub\AGENTS\agent-quest\server\src\routes\specs.ts (new)
  - Implement GET /api/specs, GET /api/specs/:name/:doc, PUT /api/specs/:name/:doc, GET /api/specs/:name/progress
  - Time Estimate: [3.0, 4.0] hours
  - Purpose: Server-side API for spec document management
  - _Leverage: agent-quest\server\src\routes\ (existing route patterns), agent-quest\server\src\index.ts (route mounting)_
  - _Requirements: 5.1 AC1-2, 5.1 AC6_
  - _Prompt: Implement the task for spec M6, first run spec-workflow-guide to get the workflow guide then implement the task: Role: TypeScript Backend Developer with Express expertise | Task: Create specs.ts route file in agent-quest server. GET /api/specs: scan .spec-workflow/specs/ directory, return list with name, phase (based on which docs exist), status. GET /api/specs/:name/:doc: read spec document as raw markdown. PUT /api/specs/:name/:doc: write edited markdown to disk. GET /api/specs/:name/progress: parse tasks.md for [ ]/[-]/[x] markers, return {total, pending, inProgress, completed}. Mount routes in index.ts | Restrictions: Follow existing route patterns (error handling, logging). Validate doc parameter (requirements/design/tasks only). Handle missing files with 404. Sanitize file paths to prevent directory traversal | Success: All 4 endpoints work, spec list shows correct phases, progress parsing accurate, file writes safe_

- [ ] 5.1.2. Create SpecsPage and SpecDetailPage components
  - File: C:\GitHub\AGENTS\agent-quest\client\src\pages\SpecsPage.tsx (new), C:\GitHub\AGENTS\agent-quest\client\src\pages\SpecDetailPage.tsx (new)
  - Spec list with phase badges and progress bars, tabbed document viewer with mode toggle
  - Time Estimate: [4.0, 6.0] hours
  - Purpose: Main UI for spec management in agent-quest
  - _Leverage: agent-quest\client\src\pages\ (existing page patterns), agent-quest\client\src\components\ (existing UI components)_
  - _Requirements: 5.1 AC1-4_
  - _Prompt: Implement the task for spec M6, first run spec-workflow-guide to get the workflow guide then implement the task: Role: React Developer with Tailwind CSS expertise | Task: Create SpecsPage showing spec list with phase badges (requirements/design/tasks/implementation), progress bars from tasks.md markers, and links to SpecDetailPage. Create SpecDetailPage with tab bar (requirements/design/tasks), view mode toggle (Preview/Annotate/Side-by-Side). Use agent-quest's existing Tailwind tokens (bg-bg, text-text-primary, border-border). Add /specs and /specs/:name routes to App.tsx. Add Specs link to navigation | Restrictions: Follow existing page patterns (PageShell, card layouts). Use existing status badge and progress bar components where possible. Dark theme only | Success: SpecsPage lists specs with correct phases/progress, SpecDetailPage shows tabbed documents with mode toggle, navigation updated_

- [ ] 5.1.3. Create MarkdownRenderer and MDXEditor components
  - File: C:\GitHub\AGENTS\agent-quest\client\src\components\MarkdownRenderer.tsx (new), C:\GitHub\AGENTS\agent-quest\client\src\components\MDXEditorWrapper.tsx (new)
  - Markdown rendering with syntax highlighting and Mermaid, rich MDX editor with toolbar
  - Time Estimate: [4.0, 6.0] hours
  - Purpose: Document viewing and editing components
  - _Leverage: C:\GitHub-Reference\spec-workflow-mcp\src\modules\mdx-editor\MDXEditorWrapper.tsx (reference implementation)_
  - _Requirements: 5.1 AC2, 5.1 AC5_
  - _Prompt: Implement the task for spec M6, first run spec-workflow-guide to get the workflow guide then implement the task: Role: React Developer with rich text editing expertise | Task: Create MarkdownRenderer using markdown-it for parsing, highlight.js for syntax highlighting, and Mermaid for diagram rendering. Style with agent-quest dark theme tokens. Create MDXEditorWrapper adapted from spec-workflow-mcp's implementation using @mdxeditor/editor with toolbar (headings, bold/italic, lists, tables, code blocks, links, undo/redo, Mermaid). Install npm deps: markdown-it, highlight.js, mermaid, @mdxeditor/editor | Restrictions: Must work with agent-quest's dark theme. Mermaid diagrams must render in preview mode. Editor must handle large documents without lag. Follow spec-workflow-mcp's patterns but adapt styling | Success: Markdown renders with syntax highlighting and Mermaid, editor has full toolbar, dark theme styled_

- [ ] 5.2.1. Create spec approval routes and components
  - File: C:\GitHub\AGENTS\agent-quest\server\src\routes\spec-approvals.ts (new), C:\GitHub\AGENTS\agent-quest\client\src\components\AnnotationOverlay.tsx (new), C:\GitHub\AGENTS\agent-quest\client\src\components\DiffViewer.tsx (new), C:\GitHub\AGENTS\agent-quest\client\src\components\ApprovalBanner.tsx (new)
  - Server: proxy approval actions to spec-workflow MCP server. Client: annotation, diff viewer, approval banner
  - Time Estimate: [6.0, 8.0] hours
  - Purpose: Full spec approval workflow in agent-quest dashboard
  - _Leverage: C:\GitHub-Reference\spec-workflow-mcp\src\modules\approvals\ (ApprovalsAnnotator), C:\GitHub-Reference\spec-workflow-mcp\src\modules\diff\ (DiffViewer), agent-quest\client\src\components\ApprovalPanel.tsx (existing quest approval pattern)_
  - _Requirements: 5.2 AC1-6_
  - _Prompt: Implement the task for spec M6, first run spec-workflow-guide to get the workflow guide then implement the task: Role: Full-stack React Developer | Task: Server: create spec-approvals.ts with GET /api/spec-approvals (list pending), POST /api/spec-approvals/:id/approve, POST /api/spec-approvals/:id/revise (with comments), POST /api/spec-approvals/:id/reject. These proxy to spec-workflow MCP server's approvals tool. Client: adapt AnnotationOverlay from spec-workflow-mcp (react-text-annotate-blend, color-coded highlights, comment modal). Adapt DiffViewer (unified/split/inline modes, diff library, green additions, red deletions). Create ApprovalBanner (sticky, Approve green/Needs-Revision yellow/Reject red). Install npm deps: react-text-annotate-blend, diff. Wire WebSocket events for spec.approval.updated | Restrictions: MCP server is source of truth for approval state. Agent-quest proxies, not duplicates. Follow existing ApprovalPanel color patterns. Dark theme styling | Success: Full approval flow works in dashboard, annotations with color highlights, diff viewer shows changes, real-time updates via WebSocket_

- [ ] 5.3.1. Implement spec-quest integration
  - File: C:\GitHub\AGENTS\agent-quest\client\src\pages\SpecDetailPage.tsx, C:\GitHub\AGENTS\agent-quest\client\src\pages\QuestDetailPage.tsx
  - Task status indicators in tasks.md viewer, spec links in quest detail, progress bars in spec list
  - Time Estimate: [2.0, 3.0] hours
  - Purpose: Connect specs to quests in the dashboard
  - _Leverage: agent-quest\client\src\pages\ (existing quest/task pages), agent-quest\client\src\components\ (status badges, progress bars)_
  - _Requirements: 5.3 AC1-3_
  - _Prompt: Implement the task for spec M6, first run spec-workflow-guide to get the workflow guide then implement the task: Role: React Developer | Task: In SpecDetailPage tasks.md tab: parse [ ]/[-]/[x] markers and render with visual status badges (pending gray, in-progress yellow, completed green) matching Kanban board style. In QuestDetailPage: when a quest is linked to a spec task, show clickable link to the spec. In SpecsPage: show implementation progress bar for each spec based on tasks.md completion markers | Restrictions: Reuse existing status badge and progress bar components. Task parsing must handle nested tasks and edge cases. Links must use React Router | Success: Tasks.md shows visual status, quest-spec links work, progress bars accurate_
