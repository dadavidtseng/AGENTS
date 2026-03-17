# M4 Tasks Document — Stability, Architecture Expansion, Documentation, and Demo for GDC

## Milestone Overview

| Milestone | Focus | Tasks | Est. Hours |
|-----------|-------|-------|------------|
| M4 | M3 Cleanup, Architecture Expansion (agent-lead, agent-qa, agent-quest, agent-deployer), Abilities (file, voice, vision, memory, eval, tunnel, secret, deploy), GitHub PR Webhook, Error Handling, Image & Visual Verification, Intelligence Integration, GDC Materials, Documentation | 55 | 202.0 - 301.0 |

## Task Groups

| Group | Tasks | Focus | Est. Hours |
|-------|-------|-------|------------|
| M3 Cleanup & Architecture Planning | 4.1 - 4.6 | Fix M3 bugs, audit abilities, define network topology, event schemas, plan agent-lead/qa | 14.0 - 21.0 |
| Workflow Documentation & Design | 4.7 - 4.8 | Refine end-to-end workflow, architecture diagrams | 4.0 - 6.0 |
| Core Agent Architecture | 4.9 - 4.19 | agent-lead, agent-qa, agent-quest refactor, agent-deployer, slim agent-producer | 40.0 - 60.0 |
| Core Abilities | 4.20 - 4.27 | ability-file (local/remote/cloud), voice, vision, memory, eval, learning pipeline | 28.0 - 42.0 |
| Infrastructure Abilities | 4.28 - 4.31 | ability-tunnel (public/private), secret, deploy | 12.0 - 18.0 |
| GitHub Webhook & PR Approval | 4.32 - 4.34 | Webhook/polling in mcp-server-github, KĀDI event, agent-lead integration | 6.0 - 9.0 |
| Error Handling & Stability | 4.35 - 4.39 | Task failure retry, offline agents, rate limits, network disconnection | 12.0 - 18.0 |
| GDC Networking Materials | 4.40 - 4.43 | Demo video, slides, project summary, contact materials | 8.0 - 12.0 |
| Project Documentation | 4.44 - 4.48 | README.md, CLAUDE.md, API docs for all sub-projects | 16.0 - 24.0 |
| Image & Visual Verification | 4.50 - 4.52 | agent-chatbot image passthrough, ability-vision multimodal tools, ability-eval visual QA | 8.0 - 11.0 |
| Intelligence Integration | 4.53 - 4.55 | agent-qa + ability-eval/vision, agent-lead + model-manager LLM orchestration | 14.0 - 20.0 |
| Completion | 4.49 | M4 completion report | 0.5 - 1.0 |

{/* APPEND_MARKER */}

---

## Group: M3 Cleanup & Architecture Planning (4.1 - 4.6)

- [x] 4.1. Fix agent-producer container build (file: deps → npm registry)
  - File: C:\GitHub\agent-producer\package.json, C:\GitHub\agent-producer\agent.json
  - Replace `file:` dependencies (@kadi.build/core, agents-library) with npm registry versions
  - Verify `kadi build --engine podman` produces a working container image
  - Time Estimate: [1.0, 2.0] hours
  - Purpose: Enable containerized deployment of agent-producer
  - _Leverage: agents-library@0.1.0 published to npm, @kadi.build/core@0.9.0 on npm_
  - _Requirements: agents-library published to npm_

- [x] 4.2. Complete remaining M3 tasks and fix bugs
  - File: Various files across all components
  - Complete any M3 tasks that were not finished, fix bugs discovered during M3 and M4 testing
  - Address technical debt identified during M3
  - Time Estimate: [4.0, 6.0] hours
  - Purpose: Clean up M3 carryover before expanding architecture

- [x] 4.3. Audit and consolidate ability projects (old vs new)
  - File: C:\GitHub\AGENTS\Docs\ability-audit.md
  - Map existing abilities to canonical names: ability-file-management → ability-file-local, ability-local-remote-file-manager → ability-file-remote, ability-cloud-file-manager → ability-file-cloud, ability-arcadedb → ability-memory, ability-tunnel → ability-tunnel-public, ability-deploy + ability-container-registry → ability-deploy
  - Identify truly new abilities to create: ability-vision, ability-voice, ability-eval, ability-tunnel-private, ability-secret
  - Document the 4 new agent projects: agent-lead, agent-qa, agent-quest (refactor from mcp-client-quest), agent-deployer
  - Time Estimate: [2.0, 3.0] hours
  - Purpose: Clear picture of what exists vs what needs building vs what needs renaming
  - _Leverage: humin-game-lab references for file-manager, file-sharing, tunnel-services, secret-ability, deploy-ability, voice-agent_

- [x] 4.4. Define KĀDI network topology
  - File: C:\GitHub\AGENTS\Docs\network-topology.md
  - Define which agent/ability joins which KĀDI networks
  - Map event flows between networks (producer ↔ lead ↔ worker ↔ qa ↔ quest)
  - Document network naming convention and purpose of each network
  - Time Estimate: [2.0, 3.0] hours
  - Purpose: Foundation for all inter-agent communication

- [x] 4.5. Define event schemas for new inter-agent communication
  - File: C:\GitHub\agents-library\src\types\event-schemas.ts
  - Define KĀDI event schemas for: lead ↔ producer, lead ↔ worker, lead ↔ qa, quest events
  - Include event types: task-delegated, task-assigned, task-completed, task-failed, task-validated, pr-created, pr-approved, merge-completed
  - Time Estimate: [2.0, 3.0] hours
  - Purpose: Typed event contracts between all agents
  - _Requirements: 4.4 completed_

- [x] 4.6. Plan agent-lead extraction from agent-producer
  - File: C:\GitHub\AGENTS\Docs\agent-lead-extraction-plan.md
  - Identify exactly which code/logic moves from agent-producer to agent-lead
  - Map: task creation, task assignment, task verification, git merge, PR creation
  - Define the slim agent-producer interface (quest discussion, HUMAN Q&A, status relay)
  - Time Estimate: [3.0, 4.0] hours
  - Purpose: Detailed extraction plan before implementation
  - _Requirements: 4.4, 4.5 completed_

---

## Group: Workflow Documentation & Design (4.7 - 4.8)

- [x] 4.7. Review and update QUEST_WORKFLOW_V2.md for M4 agent hierarchy
  - File: C:\GitHub\AGENTS\Docs\QUEST_WORKFLOW_V2.md (already exists)
  - Verify all 22 steps align with the 4-zone agent hierarchy
  - Update any references to agent-producer doing work that now belongs to agent-lead/agent-worker
  - Ensure event names match `KadiEvent<T>` definitions from design.md
  - Time Estimate: [1.0, 2.0] hours
  - Purpose: Keep quest workflow doc in sync with M4 architecture
  - _Requirements: 4.4, 4.5, 4.6 completed_

- [x] 4.8. Review and update ARCHITECTURE_V2.md for M4 changes
  - File: C:\GitHub\AGENTS\Docs\ARCHITECTURE_V2.md (already exists)
  - Verify diagrams match the 4-zone architecture: Interaction, Distribution, Execution, Validation
  - Update ability names to canonical names (ability-file-local, ability-file-remote, etc.)
  - Ensure agent hierarchy and event flow diagrams are current
  - Time Estimate: [1.0, 2.0] hours
  - Purpose: Keep architecture doc in sync with M4 design
  - _Requirements: 4.7 completed_

---

## Group: Core Agent Architecture (4.9 - 4.19)

- [x] 4.9. Scaffold agent-lead project
  - File: C:\GitHub\agent-lead\
  - Create new project with agent.json, package.json, tsconfig.json, src/index.ts
  - Register as KĀDI agent on network: lead
  - Set up build pipeline (TypeScript, ESLint, Vitest)
  - Time Estimate: [2.0, 3.0] hours
  - Purpose: Foundation for agent-lead
  - _Leverage: agent-producer project structure as template_
  - _Requirements: 4.6 completed_

- [x] 4.10. Implement quest.tasks_ready handoff from agent-producer → agent-lead
  - File: C:\GitHub\agent-lead\src\handlers\task-reception.ts
  - agent-producer retains task creation logic (quest_plan_task, quest_analyze_task, quest_reflect_task, quest_split_task)
  - After tasks are created, agent-producer publishes quest.tasks_ready event
  - agent-lead subscribes to quest.tasks_ready, calls quest_query_quest to get tasks matching its role
  - Each agent-lead instance (artist/designer/programmer) filters tasks by specialization
  - Time Estimate: [3.0, 5.0] hours
  - Purpose: Establish the producer → lead handoff boundary
  - _Requirements: 4.9 completed_

- [x] 4.11. Extract task assignment logic from agent-producer → agent-lead
  - File: C:\GitHub\agent-lead\src\handlers\task-assignment.ts
  - Move agent selection logic and quest_assign_task orchestration to agent-lead
  - agent-lead publishes task-assigned events to agent-worker(s)
  - Time Estimate: [3.0, 4.0] hours
  - Purpose: Separate task assignment from UX layer
  - _Requirements: 4.10 completed_

- [x] 4.12. Extract task verification logic from agent-producer → agent-lead
  - File: C:\GitHub\agent-lead\src\handlers\task-verification.ts
  - Move quest_verify_task orchestration to agent-lead
  - Wire validation chain: worker → qa → lead → producer
  - Time Estimate: [3.0, 4.0] hours
  - Purpose: Distribute validation across agent hierarchy
  - _Requirements: 4.11 completed_

- [x] 4.13. Implement git merge conflict resolution in agent-lead
  - File: C:\GitHub\agent-lead\src\handlers\git-operations.ts
  - agent-lead detects merge conflicts via mcp-server-git tools
  - Resolve conflicts before creating PR, or escalate to HUMAN
  - Time Estimate: [3.0, 5.0] hours
  - Purpose: Handle git conflicts at the lead level
  - _Requirements: 4.12 completed_

- [x] 4.14. Implement PR creation workflow in agent-lead
  - File: C:\GitHub\agent-lead\src\handlers\pr-workflow.ts
  - agent-lead creates PR via mcp-server-github after all tasks in quest complete
  - Merge worktree branches, push, create PR with quest summary
  - Time Estimate: [3.0, 4.0] hours
  - Purpose: Automate PR lifecycle
  - _Requirements: 4.13 completed_

- [x] 4.15. Slim agent-producer to UX layer
  - File: C:\GitHub\agent-producer\src\
  - Remove extracted logic (task creation, assignment, verification, git ops)
  - agent-producer becomes: quest discussion with HUMAN, status relay from agent-lead, answer HUMAN questions
  - Wire KĀDI events to delegate to agent-lead and relay results back to HUMAN
  - Time Estimate: [4.0, 6.0] hours
  - Purpose: Make agent-producer always responsive to HUMAN
  - _Requirements: 4.10, 4.11, 4.12, 4.13, 4.14 completed_

- [x] 4.16. Scaffold agent-qa project
  - File: C:\GitHub\agent-qa\
  - Create new project with agent.json, package.json, tsconfig.json, src/index.ts
  - Register as KĀDI agent on network: qa
  - Time Estimate: [2.0, 3.0] hours
  - Purpose: Foundation for agent-qa
  - _Leverage: agent-lead project structure as template_
  - _Requirements: 4.6 completed_

- [x] 4.17. Implement agent-qa validation logic
  - File: C:\GitHub\agent-qa\src\handlers\validation.ts
  - Semantic validation: code compiles, tests pass, task requirement matching
  - Behavioral validation: code diffs match task description, no regressions
  - Produce structured scores and feedback for agent-lead
  - Time Estimate: [5.0, 8.0] hours
  - Purpose: Automated quality gate before human review
  - _Requirements: 4.16 completed_

- [x] 4.18. Refactor mcp-client-quest → agent-quest
  - File: C:\GitHub\mcp-client-quest\ (rename to C:\GitHub\agent-quest\)
  - Refactor Express backend to register as KĀDI agent on network: quest
  - Subscribe to quest/task events directly from broker
  - Push real-time updates to React frontend via WebSocket
  - Keep React frontend, fix dashboard issues
  - Time Estimate: [6.0, 8.0] hours
  - Purpose: Dashboard becomes a proper KĀDI agent
  - _Requirements: 4.5 completed_

- [x] 4.19. Scaffold agent-deployer project
  - File: C:\GitHub\agent-deployer\
  - Create new project with agent.json, package.json, tsconfig.json, src/index.ts
  - Register as KĀDI agent on network: deploy
  - Integrate ability-deploy for container deployment (local Docker, remote Akash)
  - Expose deployment tools via KĀDI broker
  - Time Estimate: [3.0, 4.0] hours
  - Purpose: Agent that deploys other agents/containers on demand
  - _Leverage: deploy-ability@0.0.8 as dependency_
  - _Requirements: 4.31 completed_

---

## Group: Core Abilities (4.20 - 4.27)

- [x] 4.20. Refactor ability-file-management → ability-file-local
  - File: C:\GitHub\ability-file-management\ (rename to C:\GitHub\ability-file-local\)
  - Existing: 18 tools (list, move, copy, delete, create, watch files/folders)
  - Rename project, update agent.json name, register on network: file
  - Remove remote file tools (send_file_to_remote_server, etc.) — those belong in ability-file-remote
  - Ensure path security and validation (prevent traversal attacks)
  - Time Estimate: [2.0, 3.0] hours
  - Purpose: Clean separation of local file operations
  - _Leverage: humin-game-lab/agent-abilities/file-manager as reference_

- [x] 4.21. Refactor ability-local-remote-file-manager → ability-file-remote _(completed 2026-02-22)_
  - File: C:\GitHub\ability-local-remote-file-manager\ (rename to C:\GitHub\ability-file-remote\)
  - Existing: 33 tools (upload, download, transfer, compress, tunnel, watch)
  - Rename project, update agent.json name, register on network: file
  - Remove local-only tools that overlap with ability-file-local
  - Keep remote transfer (SFTP/SSH/SCP), HTTP file server, streaming, tunnel tools
  - Time Estimate: [2.0, 3.0] hours
  - Purpose: Clean separation of remote file operations
  - _Leverage: humin-game-lab/agent-abilities/file-manager (SFTP parts) + file-sharing as reference_

- [x] 4.22. Refactor ability-cloud-file-manager → ability-file-cloud
  - File: C:\GitHub\ability-cloud-file-manager\ (rename to C:\GitHub\ability-file-cloud\)
  - Existing: 15 tools (Dropbox, Google Drive, Box operations)
  - Rename project, update agent.json name, register on network: file
  - Ensure unified API across providers (upload, download, list, delete, share)
  - Time Estimate: [1.0, 2.0] hours
  - Purpose: Cloud file operations for agents
  - _Leverage: existing ability-cloud-file-manager codebase_

- [x] 4.23. Create ability-voice _(completed 2026-02-22)_
  - File: C:\GitHub\ability-voice\
  - Text-to-Speech (Piper), Speech-to-Text (Whisper), wake word detection
  - CUDA-accelerated for NVIDIA hardware
  - Expose voice tools via KĀDI broker
  - Time Estimate: [4.0, 6.0] hours
  - Purpose: Voice capabilities for agents
  - _Leverage: humin-game-lab/agents/voice-agent as reference_

- [x] 4.24. Create ability-vision
  - File: C:\GitHub\ability-vision\
  - Accept image path/URL + analysis prompt
  - Pass to multimodal LLM (Claude, GPT-4V) for visual analysis
  - Return structured analysis (description, objects detected, text extracted, feedback)
  - Time Estimate: [3.0, 4.0] hours
  - Purpose: Visual understanding for agents (e.g., agent-qa reviewing UI screenshots)

- [x] 4.25. Refactor ability-arcadedb → ability-memory
  - File: C:\GitHub\ability-arcadedb\ (rename to C:\GitHub\ability-memory\)
  - Existing: 14 tools (container lifecycle, database CRUD, backup/restore, import/export)
  - Rename project, update agent.json name, register on network: memory
  - Add graph relationship tools for linking related memories
  - Add short-term context store (JSON/in-memory) alongside ArcadeDB
  - Add relevance-based query API for agents to retrieve past experiences
  - Time Estimate: [3.0, 5.0] hours
  - Purpose: Persistent memory for agents to retain knowledge across sessions
  - _Leverage: agents-library memory-service + existing ability-arcadedb codebase_

- [x] 4.26. Create ability-eval
  - File: C:\GitHub\ability-eval\
  - Stateless evaluation engine: analyze code diffs, test results, logs, behavior traces
  - Produce structured scores, pass/fail, improvement suggestions
  - Support multiple evaluation criteria (semantic correctness, code quality, task match)
  - Time Estimate: [4.0, 6.0] hours
  - Purpose: Evaluation framework used by agent-qa, agent-lead, agent-producer

- [x] 4.27. Wire ability-eval → ability-memory learning pipeline
  - File: C:\GitHub\ability-memory\src\learning-pipeline.ts
  - After quest/task completion, ability-eval produces evaluation results
  - ability-memory ingests results as graph relationships (patterns, lessons, strategies)
  - Agents query ability-memory for relevant past experiences before making decisions
  - Time Estimate: [3.0, 5.0] hours
  - Purpose: Agents learn from experience and improve over time
  - _Requirements: 4.25, 4.26 completed_

---

## Group: Infrastructure Abilities (4.28 - 4.31)

- [x] 4.28. Refactor ability-tunnel → ability-tunnel-public (merged with 4.29 into unified ability-tunnel)
  - File: C:\GitHub\ability-tunnel\ (rename to C:\GitHub\ability-tunnel-public\)
  - Existing: 6 tools (create/destroy tunnel, health check, connection stats, list tunnels)
  - Rename project, update agent.json name, register on network: infra
  - Verify multi-provider support: ngrok, Serveo, LocalTunnel, Pinggy, localhost.run
  - Ensure automatic fallback between providers and event-driven lifecycle
  - Time Estimate: [1.0, 2.0] hours
  - Purpose: Expose local services to the internet via third-party tunnels
  - _Leverage: humin-game-lab/agent-abilities/tunnel-services as reference_

- [x] 4.29. Create ability-tunnel-private (merged with 4.28 into unified ability-tunnel)
  - File: C:\GitHub\ability-tunnel-private\
  - Self-hosted tunnel client using kadi-tunnel (frp + Caddy)
  - SSH mode and frpc client mode, reconnection management
  - Time Estimate: [3.0, 4.0] hours
  - Purpose: Secure private tunnels via self-hosted infrastructure
  - _Leverage: kadi-tunnel client library as dependency_

- [x] 4.30. Refactor secret-ability → ability-secret
  - File: C:\GitHub\ability-secret\ (new project, based on humin-game-lab/agent-abilities/secret-ability)
  - Existing reference: 23 tools (vault CRUD, encrypt/decrypt, key management, remote sharing, audit logs)
  - Create new project with agent.json, register on network: infra
  - Port secret-ability code into KĀDI ability format with @kadi.build/core
  - Ensure agent-to-agent encrypted communication via KĀDI broker
  - Time Estimate: [3.0, 5.0] hours
  - Purpose: Secure secret management and encrypted agent communication
  - _Leverage: humin-game-lab/agent-abilities/secret-ability as reference, kadi-secret for CLI_

- [x] 4.31. Refactor ability-deploy + ability-container-registry → ability-deploy
  - File: C:\GitHub\ability-deploy\ (consolidate with C:\GitHub\ability-container-registry\)
  - Existing: ability-deploy (deployment library), ability-container-registry (8 tools: registry lifecycle, container management)
  - Merge container registry tools into ability-deploy
  - Register on network: deploy, update agent.json
  - Ensure profile-based configuration for local Docker and remote Akash Network
  - Time Estimate: [2.0, 4.0] hours
  - Purpose: Unified deployment ability for agent-deployer
  - _Leverage: humin-game-lab/agent-abilities/deploy-ability as reference, kadi-deploy for CLI_

---

## Group: GitHub Webhook & PR Approval (4.32 - 4.34)

- [x] 4.32. Add webhook endpoint to mcp-server-github (implemented in agent-quest instead — merged with 4.34)
  - File: C:\GitHub\mcp-server-github\src\webhook.ts
  - Add HTTP endpoint to receive GitHub webhook POST for PR events (approved, merged, closed)
  - Verify webhook signature for security
  - Publish KĀDI event (github.pr.approved, github.pr.merged) to broker
  - Time Estimate: [3.0, 4.0] hours
  - Purpose: React to GitHub PR approval events in real-time
  - _Leverage: mcp-server-github existing HTTP transport_

- [x] 4.33. Implement polling fallback for PR status
  - File: C:\GitHub\agent-lead\src\handlers\pr-polling.ts
  - agent-lead periodically checks PR status via mcp-server-github get_pr tool
  - Fallback when webhook is unavailable (no public URL, firewall, etc.)
  - Configurable polling interval
  - Time Estimate: [1.0, 2.0] hours
  - Purpose: Reliable PR status tracking without webhook dependency
  - _Requirements: 4.14 completed_

- [x] 4.34. agent-quest receives PR webhook and publishes merge/rejection events (merged with 4.32)
  - File: C:\GitHub\agent-quest\src\handlers\pr-webhook.ts
  - agent-quest receives GitHub webhook (pr.merged, pr.closed, pr.changes_requested)
  - Publishes KĀDI events: quest.merged, quest.pr_rejected, pr.changes_requested
  - agent-lead subscribes to pr.changes_requested → creates revision tasks for workers
  - agent-lead subscribes to quest.merged → deletes staging branch, publishes quest.completed
  - agent-producer subscribes to quest.merged → notifies HUMAN in Discord
  - Time Estimate: [2.0, 3.0] hours
  - Purpose: Close the loop from GitHub PR actions to quest lifecycle
  - _Requirements: 4.32 completed, 4.18 completed_

---

## Group: Error Handling & Stability (4.35 - 4.39)

- [x] 4.35. Implement task failure retry with exponential backoff
  - File: C:\GitHub\agents-library\src\common\retry.ts
  - Configurable retry count, backoff strategy, max timeout
  - Apply to: agent-worker task execution, agent-lead tool calls, LLM API calls
  - Publish task-failed event with retry count and failure reason
  - Time Estimate: [2.0, 3.0] hours
  - Purpose: Resilient task execution across all agents

- [x] 4.36. Handle offline agent detection and recovery
  - File: C:\GitHub\agent-lead\src\handlers\agent-health.ts
  - agent-lead monitors worker heartbeats via mcp-server-quest agent tools
  - Detect offline agents, reassign their tasks to available workers
  - Notify agent-producer when agent goes offline/recovers
  - Time Estimate: [3.0, 4.0] hours
  - Purpose: Graceful handling of agent failures
  - _Requirements: 4.11 completed_

- [x] 4.37. Implement LLM API rate limiting
  - File: C:\GitHub\agents-library\src\common\rate-limiter.ts
  - Token bucket or sliding window rate limiter for Anthropic/OpenAI API calls
  - Shared across all agents via agents-library
  - Queue requests when rate limit is hit, retry after cooldown
  - Time Estimate: [2.0, 3.0] hours
  - Purpose: Prevent API rate limit errors across the system

- [x] 4.38. Handle git merge conflicts gracefully (already implemented in git-operations.ts by task 4.13)
  - File: C:\GitHub\agent-lead\src\handlers\merge-conflict.ts
  - Detect merge conflicts during worktree merge
  - Attempt auto-resolution for simple conflicts (non-overlapping changes)
  - Escalate complex conflicts to HUMAN via agent-producer → Discord/Slack
  - Time Estimate: [3.0, 5.0] hours
  - Purpose: Prevent blocked workflows due to git conflicts
  - _Requirements: 4.13 completed_

- [x] 4.39. Handle KĀDI network disconnection and reconnection
  - File: C:\GitHub\agents-library\src\common\connection-manager.ts
  - Auto-reconnect to broker on network drop with exponential backoff
  - Queue outgoing events during disconnection, flush on reconnect
  - Emit connection status events for monitoring
  - Time Estimate: [2.0, 3.0] hours
  - Purpose: Resilient broker connectivity for all agents

---

## Group: GDC Networking Materials (4.40 - 4.43)

- [x] 4.40. Create demo video of multi-agent workflow
  - File: C:\GitHub\AGENTS\Docs\gdc\demo-video-script.md
  - Script and record a demo showing: HUMAN request → quest creation → task planning → worker execution → QA validation → PR creation → approval
  - Highlight agent-lead orchestration and real-time dashboard
  - Time Estimate: [2.0, 3.0] hours
  - Purpose: Visual demonstration of KĀDI multi-agent system for GDC

- [x] 4.41. Create presentation slides
  - File: C:\GitHub\AGENTS\Docs\gdc\presentation.md
  - Cover: KĀDI architecture, agent hierarchy, ability ecosystem, workflow, live demo highlights
  - Target audience: game developers, technical leads, AI enthusiasts
  - Time Estimate: [2.0, 3.0] hours
  - Purpose: GDC networking presentation material

- [x] 4.42. Write project summary document
  - File: C:\GitHub\AGENTS\Docs\gdc\project-summary.md
  - One-page summary: what KĀDI is, what it does, key features, architecture overview
  - Include QR code to project repo or demo
  - Time Estimate: [1.0, 2.0] hours
  - Purpose: Handout for GDC networking

- [x] 4.43. Prepare contact and networking materials
  - File: C:\GitHub\AGENTS\Docs\gdc\contact-materials.md
  - Business card design with QR code, social links, project URL
  - Elevator pitch script (30 seconds, 2 minutes)
  - Time Estimate: [1.0, 2.0] hours
  - Purpose: Professional networking materials for GDC

---

## Group: Project Documentation (4.44 - 4.48)

- [x] 4.44. Write README.md for all new agent projects
  - File: C:\GitHub\agent-lead\README.md, C:\GitHub\agent-qa\README.md, C:\GitHub\agent-quest\README.md, C:\GitHub\agent-deployer\README.md
  - Include: purpose, architecture role, setup instructions, configuration, KĀDI network membership
  - Time Estimate: [3.0, 4.0] hours
  - Purpose: Onboarding documentation for new agent projects

- [x] 4.45. Write README.md for all new ability projects
  - File: C:\GitHub\ability-file-local\README.md, C:\GitHub\ability-file-remote\README.md, C:\GitHub\ability-file-cloud\README.md, C:\GitHub\ability-voice\README.md, C:\GitHub\ability-vision\README.md, C:\GitHub\ability-memory\README.md, C:\GitHub\ability-eval\README.md, C:\GitHub\ability-tunnel-public\README.md, C:\GitHub\ability-tunnel-private\README.md, C:\GitHub\ability-secret\README.md, C:\GitHub\ability-deploy\README.md
  - Include: purpose, API reference, usage examples, integration guide
  - Time Estimate: [4.0, 6.0] hours
  - Purpose: Onboarding documentation for new ability projects

- [x] 4.46. Update CLAUDE.md for all existing projects
  - File: Various CLAUDE.md files across all repos
  - Update to reflect M4 architecture changes (agent-lead extraction, new networks, new events)
  - Ensure AI assistants have accurate context for each project
  - Time Estimate: [3.0, 5.0] hours
  - Purpose: Keep AI assistant context accurate

- [x] 4.47. Write API documentation for inter-agent communication
  - File: C:\GitHub\AGENTS\Docs\api-reference.md
  - Document all KĀDI events, tool schemas, and network contracts
  - Include: event payloads, tool input/output schemas, error codes
  - Time Estimate: [3.0, 5.0] hours
  - Purpose: Reference for developers working on any agent/ability
  - _Requirements: 4.5 completed_

- [x] 4.48. Update AGENTS monorepo documentation
  - File: C:\GitHub\AGENTS\README.md, C:\GitHub\AGENTS\Docs\
  - Update project overview to reflect M4 architecture (15 new projects, expanded workflow)
  - Include updated architecture diagram, project inventory, getting started guide
  - Time Estimate: [3.0, 4.0] hours
  - Purpose: Central documentation hub for the entire ecosystem

---

## Group: Image & Visual Verification (4.50 - 4.52)

- [x] 4.50. agent-chatbot: extract image attachments from Discord/Slack messages
  - File: C:\GitHub\agent-chatbot\src\
  - When Discord/Slack messages contain image attachments, extract URLs and include them in the KĀDI event payload
  - Downstream agents (agent-producer, agent-qa) receive image data alongside text
  - Handle both Discord CDN URLs and Slack file URLs (may need auth token for Slack files)
  - Time Estimate: [2.0, 3.0] hours
  - Purpose: Enable agents to see images sent by HUMAN in chat
  - _Requirements: agent-chatbot handles both Discord and Slack_

- [x] 4.51. ability-vision: implement multimodal LLM image analysis tools
  - File: C:\GitHub\ability-vision\src\
  - Tools: `vision_analyze` (image + prompt → structured analysis), `vision_compare` (two images → diff report), `vision_extract_text` (image → OCR-like text extraction via multimodal LLM)
  - Accept image as local path, URL, or base64; convert to base64 content block for LLM API
  - Use model-manager for LLM provider selection (Claude, GPT-4V)
  - Time Estimate: [3.0, 4.0] hours
  - Purpose: Shared visual understanding ability for all agents
  - _Requirements: 4.24 scaffolded_

- [x] 4.52. ~~ability-eval: add visual verification using ability-vision~~ (superseded by 4.54)
  - Superseded: The original design had ability-eval calling ability-vision internally. The new approach (4.54) has agent-qa orchestrating both abilities directly — vision describes, eval judges — which is cleaner separation of concerns.
  - Time Estimate: [0, 0] hours

---

## Group: Intelligence Integration (4.53 - 4.55)

- [x] 4.53. Integrate ability-eval into agent-qa validation pipeline
  - File: C:\GitHub\agent-qa\src\handlers\validation.ts
  - Replace current inline LLM semantic review with ability-eval tools via KĀDI broker
  - Use `eval_code_diff` for code task validation (replaces hand-rolled CODE_REVIEW_SYSTEM prompt)
  - Use `eval_task_completion` for structured requirement verification across all task types
  - Code validation scoring: `eval_code_diff` (40%) + `eval_task_completion` (40%) + behavioral heuristics (20%)
  - Time Estimate: [4.0, 6.0] hours
  - Purpose: Structured, consistent validation using dedicated evaluation engine
  - _Leverage: ability-eval tools (eval_code_diff, eval_task_completion), agent-qa ProviderManager_
  - _Requirements: 4.26 completed (ability-eval operational), 4.17 completed (agent-qa validation logic)_
  - _Prompt: Implement the task for spec M4, first run spec-workflow-guide to get the workflow guide then implement the task: Role: Backend Developer with expertise in LLM evaluation pipelines | Task: Replace agent-qa's inline LLM semantic review with ability-eval tools (eval_code_diff, eval_task_completion) via KĀDI broker invokeRemote, update weighted scoring | Restrictions: Must maintain backward compatibility with existing task.validated/task.revision_needed events, keep behavioral heuristics as a secondary signal, handle ability-eval unavailability gracefully with fallback to current inline review | Success: Code validation uses eval_code_diff + eval_task_completion, all task types produce structured evaluation results_

- [x] 4.54. Integrate ability-vision + ability-eval into agent-qa for visual verification
  - File: C:\GitHub\agent-qa\src\handlers\validation.ts
  - Two-stage pipeline: vision sees, eval judges (separation of concerns)
  - Stage 1 (vision): agent-qa calls `vision_describe_ui(image)` → structured UI description (layout, components, colors, accessibility)
  - Stage 2 (eval): agent-qa calls `eval_task_completion(description, requirements)` → score + feedback (text-only, no multimodal needed)
  - This avoids duplicate multimodal LLM calls — only ability-vision needs a vision-capable model
  - Add screenshot capture step: agent-qa calls Playwright MCP to screenshot the output HTML before stage 1
  - For regression detection: `vision_compare(before, after)` → diff description → `eval_task_completion` to judge severity
  - Time Estimate: [4.0, 6.0] hours
  - Purpose: Enable real visual QA for art/design tasks instead of auto-pass at 70
  - _Leverage: ability-vision (vision_describe_ui, vision_compare), ability-eval (eval_task_completion), Playwright MCP_
  - _Requirements: 4.53 completed (ability-eval wired), 4.51 completed (ability-vision operational)_
  - _Prompt: Implement the task for spec M4, first run spec-workflow-guide to get the workflow guide then implement the task: Role: Backend Developer with expertise in visual testing pipelines | Task: Implement two-stage visual QA pipeline — stage 1: call vision_describe_ui to get structured UI description from screenshot, stage 2: call eval_task_completion to compare description against task requirements for scoring. Add Playwright screenshot capture for HTML output. For regressions: vision_compare → eval_task_completion | Restrictions: Must handle missing screenshots gracefully (fall back to code-only validation), vision and eval tools called via KĀDI invokeRemote, only ability-vision needs multimodal model, ability-eval works with text description only | Success: Designer tasks validated visually via two-stage pipeline, vision describes and eval judges, no more auto-pass at 70 for art tasks, regression detection works_

- [x] 4.55. Integrate model-manager into agent-lead for LLM-powered orchestration
  - File: C:\GitHub\agent-lead\src\index.ts, C:\GitHub\agent-lead\src\handlers\task-verification.ts, C:\GitHub\agent-lead\src\handlers\pr-workflow.ts
  - Add ProviderManager to agent-lead via BaseAgent provider config (same pattern as agent-worker/producer)
  - LLM-powered failure analysis: when task.revision_needed, analyze QA feedback + diff to generate targeted fix instructions instead of generic retry
  - LLM-powered PR body generation: summarize all task diffs and quest context into a meaningful PR description
  - LLM-powered merge conflict triage: for source code conflicts, attempt LLM-based resolution before escalating to HUMAN
  - Time Estimate: [6.0, 8.0] hours
  - Purpose: Upgrade agent-lead from rule-based to intelligent orchestration
  - _Leverage: agents-library ProviderManager, model-manager gateway, agent-worker/producer integration pattern_
  - _Requirements: 4.14 completed (PR workflow), 4.13 completed (merge conflict resolution), 4.17 completed (agent-qa validation)_
  - _Prompt: Implement the task for spec M4, first run spec-workflow-guide to get the workflow guide then implement the task: Role: Backend Developer with expertise in LLM orchestration | Task: Add ProviderManager to agent-lead, implement LLM-powered failure analysis (targeted fix instructions on revision_needed), LLM-powered PR body generation (contextual summaries), and LLM-powered merge conflict triage (attempt resolution before HUMAN escalation) | Restrictions: Must add provider config as optional (agent-lead still works without LLM), failure analysis must include original QA feedback + diff context, merge conflict LLM resolution must be conservative (only attempt if confidence is high, otherwise escalate), PR body must reference quest context and task summaries | Success: Agent-lead uses LLM for failure analysis, PR bodies are contextual, merge conflicts attempted by LLM before escalation, all features degrade gracefully without model-manager_

---

## Group: agent-quest Dashboard Improvements (4.56 - 4.62)

- [x] 4.56. Refactor /board and /quests routes to eliminate duplication
  - File: C:\GitHub\agent-quest\client\src\App.tsx, C:\GitHub\agent-quest\client\src\pages\KanbanPage.tsx
  - Current issue: /board (KanbanPage) and /quests (QuestListPage) show the same quest-level content with different layouts, causing duplication
  - Solution: Keep /board as quest-level kanban (current behavior), create new /board/tasks route for task-level kanban across all quests
  - Add TaskKanbanPage component that shows tasks grouped by status (pending, in_progress, review, completed, failed) instead of quests
  - Each task card should display parent quest context (quest name badge) but tasks are the primary entity
  - Time Estimate: [3.0, 4.0] hours
  - Purpose: Provide both high-level (quest) and detailed (task) workflow views without duplication
  - _Leverage: Existing KanbanBoard component patterns, TaskCard component_
  - _Requirements: 4.18 completed (agent-quest refactored)_

- [x] 4.57. Fix /events page to persist event history across route changes
  - File: C:\GitHub\agent-quest\client\src\pages\EventsPage.tsx, C:\GitHub\agent-quest\client\src\services\WebSocketService.ts
  - Current issue: EventsPage only captures events while mounted — navigating away and back loses all history
  - Root cause: Event collection happens in useEffect within EventsPage component, events array is local state
  - Solution: Move event buffering to WebSocketService as a persistent circular buffer (MAX_EVENTS = 500)
  - Add getEventHistory() method to WebSocketService that returns buffered events
  - EventsPage reads from service buffer on mount and subscribes to new events
  - Time Estimate: [2.0, 3.0] hours
  - Purpose: Maintain event history for debugging and monitoring regardless of navigation
  - _Leverage: Existing WebSocketService singleton pattern, EventTimeline component_
  - _Requirements: 4.18 completed_

- [x] 4.58. Fix /tools page API endpoint failure
  - File: C:\GitHub\agent-quest\server\src\index.ts (GET /api/tools endpoint), C:\GitHub\agent-quest\client\src\pages\ToolPlaygroundPage.tsx
  - Current issue: /tools page fails to load tool list — likely broker admin API unreachable or response format mismatch
  - Investigation needed: Check if broker admin API at /api/admin/tools is accessible, verify response format matches expected { tools: ToolDef[] }
  - Solution: Add error handling and fallback — if broker admin API fails, fall back to ObserverContext tool inventory (already available via observer SSE)
  - Update ToolPlaygroundPage to use ObserverContext tools as fallback when API fails
  - Add tool schema inference from ObserverContext (tools have name but no inputSchema — show generic JSON input form)
  - Time Estimate: [2.0, 3.0] hours
  - Purpose: Make tool playground functional even when broker admin API is unavailable
  - _Leverage: ObserverContext tool inventory, existing ToolForm component_
  - _Requirements: 4.18 completed_

- [x] 4.59. Implement WebSocket auto-refresh for quest/task status changes
  - File: C:\GitHub\agent-quest\client\src\pages\QuestListPage.tsx, C:\GitHub\agent-quest\client\src\pages\QuestDetailPage.tsx, C:\GitHub\agent-quest\client\src\components\KanbanBoard.tsx
  - Current issue: Dashboard doesn't auto-refresh when quest/task status changes — requires manual page reload
  - Root cause: WebSocket events are subscribed but not all components update state correctly on events
  - Investigation: QuestListPage has useWsEvent('quest.updated') but only updates status field, not full quest data
  - Solution: On quest.updated/task.completed events, refetch full quest data from API instead of partial state update
  - Add optimistic UI updates with loading states during refetch
  - Ensure KanbanBoard, BacklogTable, and all quest/task views subscribe to relevant events
  - Time Estimate: [3.0, 4.0] hours
  - Purpose: Real-time dashboard updates without manual refresh
  - _Leverage: Existing useWsEvent hook, WebSocket event bridge in broker-events.ts_
  - _Requirements: 4.18 completed_

- [x] 4.60. Add multi-broker support to /network page
  - File: C:\GitHub\agent-quest\server\src\kadi-agent.ts, C:\GitHub\agent-quest\client\src\pages\NetworkPage.tsx, C:\GitHub\agent-quest\server\src\routes\observer.ts
  - Current issue: agent-quest only connects to one broker (default), but agent-producer connects to multiple brokers (default + producer network)
  - Solution: Update BaseAgent config to support multiple broker connections (brokers: { default: {...}, producer: {...} })
  - Update ObserverService to query multiple broker observer endpoints and merge snapshots
  - Update NetworkPage to display agents/networks grouped by broker with visual separation
  - Add broker selector dropdown to filter view by specific broker
  - Time Estimate: [4.0, 6.0] hours
  - Purpose: Full visibility into multi-broker agent topology
  - _Leverage: agents-library BaseAgent multi-broker support, existing NetworkGraph component_
  - _Requirements: 4.18 completed_

- [x] 4.61. Add fullscreen mode to /network page
  - File: C:\GitHub\agent-quest\client\src\pages\NetworkPage.tsx, C:\GitHub\agent-quest\client\src\components\NetworkGraph.tsx
  - Current issue: Network graph is constrained by page layout, no fullscreen option for detailed topology inspection
  - Solution: Add fullscreen toggle button in NetworkPage header (icon: expand/compress)
  - Use Fullscreen API (document.documentElement.requestFullscreen()) to enter fullscreen
  - In fullscreen mode: hide Navigation component, expand graph to full viewport (100vw x 100vh)
  - Add ESC key handler and exit button overlay in fullscreen mode
  - Preserve zoom/pan state when entering/exiting fullscreen
  - Time Estimate: [1.0, 2.0] hours
  - Purpose: Better visualization of complex network topologies
  - _Leverage: Browser Fullscreen API, existing NetworkGraph D3 force simulation_
  - _Requirements: 4.18 completed_

- [x] 4.62. Refactor /backlog to show tasks instead of quests
  - File: C:\GitHub\agent-quest\client\src\pages\BacklogPage.tsx, C:\GitHub\agent-quest\client\src\components\BacklogTable.tsx
  - Current issue: BacklogPage shows quest-level table, but backlog should be task-level (individual work items)
  - Root cause: Backlog is designed for quest filtering, but agile backlog = list of tasks, not epics
  - Solution: Refactor BacklogPage to fetch and display tasks instead of quests
  - Add quest context column showing parent quest name (with link to quest detail)
  - Update filters: status (pending/in_progress/review/completed/failed), assignee (agent), role (artist/designer/programmer), quest (parent quest filter)
  - Update BacklogTable columns: Task Name, Quest, Status, Assignee, Role, Created, Updated
  - Keep existing TanStack Table features: sorting, pagination, column resizing, URL-persisted filters
  - Time Estimate: [3.0, 5.0] hours
  - Purpose: Align backlog view with agile workflow (task-level work items, not quest-level epics)
  - _Leverage: Existing BacklogTable TanStack React Table setup, BacklogFilters component_
  - _Requirements: 4.18 completed_

---

## Group: Completion (4.49)

- [x] 4.49. M4 completion report
  - File: C:\GitHub\AGENTS\.spec-workflow\specs\M3-expand-task-complexity\completion-report.md
  - Summarize all completed tasks, architecture changes, lessons learned
  - Document any deferred items for M5
  - Time Estimate: [0.5, 1.0] hours
  - Purpose: Milestone closure and M5 planning input
  - _Requirements: All previous tasks completed_
