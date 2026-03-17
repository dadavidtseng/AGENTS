# M4 Requirements: Architecture Expansion, Abilities, and GDC Preparation

## Introduction

M4 expands the KĀDI multi-agent system from a single-orchestrator model (agent-producer does everything) to a distributed hierarchy where responsibilities are split across specialized agents. This milestone introduces agent-lead (orchestration), agent-qa (validation), refactors mcp-client-quest into agent-quest (dashboard + KADI event bridge), adds agent-builder/agent-deployer as specialized workers, implements 11 abilities as broker-registered tool providers, sets up GitHub webhook integration, adds error handling, and prepares GDC networking materials.

**Reference Documents:**
- `Docs/QUEST_WORKFLOW_V2.md` — end-to-end workflow (21 steps + completion)
- `Docs/ARCHITECTURE_V2.md` — component registry, network topology, event flow, status machines
- `Docs/QUEST_WORKFLOW_V1.md` — v1 workflow (baseline)

**Value to Users:**
- agent-producer becomes always-responsive to HUMAN (no longer blocked by heavy orchestration work)
- Multi-tier validation (code review, visual validation, runtime validation) catches issues before HUMAN sees them
- Staging branch strategy prevents broken code from reaching main
- Real-time dashboard shows quest/task progress with grouped status views
- GitHub PR-based approval gives HUMAN familiar review workflow

## Alignment with Product Vision

1. **CEO-Style Orchestration**: HUMAN provides high-level goals, agent-producer discusses and refines, agent-lead handles all orchestration details
2. **Human-in-the-Loop**: Quest approval via agent-quest frontend, PR approval via GitHub, agent-producer relays status via Discord
3. **Multi-Agent Collaboration**: agent-lead assigns tasks to role-specific workers, agent-qa validates, staging branch accumulates verified work
4. **Domain-Driven Networks**: Each network is a bounded context — components only see tools relevant to their domain

## Requirements

### Requirement 1: Workflow Documentation & Architecture Design (Tasks 4.7–4.8)

**User Story:** As a developer, I want a single source of truth for the v2 multi-agent workflow and architecture, so that all implementation tasks have a clear reference.

#### Acceptance Criteria

1. WHEN developer reads QUEST_WORKFLOW_V2.md THEN document SHALL describe the complete 21-step workflow with agent roles, KADI events, and tool calls at each step
2. WHEN developer reads ARCHITECTURE_V2.md THEN document SHALL list all components (agents, MCP servers, abilities), their network memberships, tool-to-network scoping, event catalog, and status state machines
3. WHEN a new agent/ability is added THEN architecture document SHALL be updated to reflect the new component's network membership and tool registration

### Requirement 2: Agent-Lead Extraction from Agent-Producer (Tasks 4.9–4.14)

**User Story:** As a user, I want agent-producer to always respond quickly to my messages, so that I don't have to wait while heavy orchestration work is happening.

#### Acceptance Criteria

1. WHEN quest is approved THEN agent-producer SHALL publish quest.tasks_ready event to agent-lead via KADI, NOT perform task assignment itself
2. WHEN agent-lead starts with role flag (e.g., `npm run start:artist`) THEN agent-lead SHALL only handle tasks matching its AGENT_ROLE specialization
3. WHEN agent-lead receives quest.tasks_ready THEN agent-lead SHALL call mcp-server-quest's quest_query_quest to get tasks, then call quest_assign_task for all tasks matching its role
4. WHEN agent-lead assigns tasks THEN agent-lead SHALL publish task.assigned events ONLY for tasks with NO unmet dependencies; tasks with dependencies remain assigned but not signaled
5. WHEN a task is verified THEN agent-lead SHALL check if any blocked tasks are now unblocked and publish task.assigned events for newly unblocked tasks
6. WHEN agent-lead starts a quest THEN agent-lead SHALL create a staging branch `quest/{quest-id}` from main via mcp-server-git
7. WHEN agent-lead verifies a task THEN agent-lead SHALL merge the worker's branch into the staging branch and delete the worker's worktree
8. WHEN ALL tasks across ALL roles are verified THEN the agent-lead that verified the last task SHALL create a PR from staging branch → main via mcp-server-github and publish quest.pr_created event
9. WHEN agent-producer is slimmed THEN agent-producer SHALL only handle: quest discussion with HUMAN, quest creation, task planning (plan/analyze/reflect/split), and status relay from agent-lead

### Requirement 3: Agent-QA Validation (Tasks 4.16–4.17)

**User Story:** As a user, I want automated quality validation before I review work, so that obvious issues are caught without my involvement.

#### Acceptance Criteria

1. WHEN agent-qa receives task.review_requested event THEN agent-qa SHALL select a validation strategy based on task type
2. WHEN task type is "code" THEN agent-qa SHALL call mcp-server-git's git_diff tool and use LLM to check implementation against task requirements (syntax + semantic validation)
3. WHEN task type is "art/asset" THEN agent-qa SHALL check file existence via ability-file-local and use ability-vision to visually validate output against task requirements
4. WHEN task type is "build" THEN agent-qa SHALL validate by running the built executable, taking screenshots via DaemonAgent, and using ability-vision to verify visual result matches requirements
5. WHEN validation passes (PASS/WARN) THEN agent-qa SHALL publish task.validated event with structured score and feedback to agent-lead
6. WHEN validation fails (FAIL) THEN agent-qa SHALL publish task.revision_needed event with specific feedback (what failed, why, suggestions) to agent-worker
7. WHEN revision cycle count exceeds 3 THEN agent-qa SHALL escalate to agent-lead instead of sending back to agent-worker
8. WHEN agent-qa produces a result THEN result SHALL include severity (PASS/WARN/FAIL), numeric score, and detailed feedback

### Requirement 4: Agent-Quest Refactor (Task 4.18)

**User Story:** As a user, I want a real-time dashboard that shows quest/task progress and lets me approve or reject quests, so that I have full visibility into what agents are doing.

#### Acceptance Criteria

1. WHEN mcp-client-quest is refactored THEN it SHALL become agent-quest — a KADI agent that can pub/sub events (not just an MCP client)
2. WHEN HUMAN clicks approve/reject/request-revision in the frontend THEN agent-quest SHALL publish the corresponding KADI event (quest.approved, quest.rejected, quest.revision_requested)
3. WHEN a KADI event changes quest/task status THEN agent-quest SHALL push real-time updates to the React frontend via WebSocket
4. WHEN GitHub sends a webhook (PR merged, PR closed, PR changes requested) THEN agent-quest SHALL receive it and publish the corresponding KADI event (quest.merged, quest.pr_rejected, pr.changes_requested)
5. WHEN agent-quest needs to receive GitHub webhooks THEN agent-quest SHALL use ability-tunnel-public to expose its webhook endpoint
6. WHEN dashboard displays quest status THEN dashboard SHALL group statuses by HUMAN intent (Needs My Action / In Progress / Done) rather than showing one column per status

### Requirement 5: Agent-Builder and Agent-Deployer (Task 4.19)

**User Story:** As a user, I want build and deploy to be regular tasks within a quest, so that the system handles compilation and deployment automatically when needed.

#### Acceptance Criteria

1. WHEN quest involves C++ changes THEN agent-lead SHALL create a build task (assigned to agent-builder) that depends on the code task
2. WHEN agent-builder receives task.assigned THEN agent-builder SHALL compile DaemonAgent via MSBuild, upload artifact via ability-file-cloud, and publish task.review_requested
3. WHEN agent-deployer receives task.assigned THEN agent-deployer SHALL use ability-deploy to push artifact to target environment and publish task.review_requested
4. WHEN agent-builder/agent-deployer starts THEN it SHALL use the same role-based startup pattern as agent-worker (e.g., `npm run start:builder`)
5. IF quest does not require build or deploy THEN agent-lead SHALL NOT create build/deploy tasks — they are optional

### Requirement 6: Agent-Chatbot (Unified Chat Interface)

**User Story:** As a user, I want to interact with the system through Discord (and later Slack), so that I can give instructions and receive status updates in my preferred chat platform.

#### Acceptance Criteria

1. WHEN agent-chatbot starts THEN it SHALL register on network:text and provide send_message/receive_message tools
2. WHEN agent-producer needs to notify HUMAN THEN agent-producer SHALL call agent-chatbot's send_message tool via network:text
3. WHEN HUMAN sends a message in Discord THEN agent-chatbot SHALL relay it to agent-producer via network:text
4. WHEN agent-chatbot is deployed THEN it SHALL support Discord as primary platform with Slack as future extension

### Requirement 7: Core Abilities (Tasks 4.20–4.27)

**User Story:** As a developer, I want a set of reusable abilities registered on the broker, so that any agent can discover and use file, vision, voice, memory, eval, and other capabilities via KADI networks.

#### Acceptance Criteria

1. WHEN an ability is created THEN it SHALL register its tools on the broker via stdio/native/broker mode and be discoverable via its assigned network
2. WHEN ability-file-local is available THEN agents on network:file SHALL be able to perform local file CRUD, directory operations, and file watching
3. WHEN ability-file-remote is available THEN agents on network:file SHALL be able to transfer files via SFTP/SSH/SCP between machines
4. WHEN ability-file-cloud is available THEN agents on network:file SHALL be able to upload/download files to cloud storage (Dropbox, Google Drive, Box)
5. WHEN ability-vision is available THEN agents on network:vision SHALL be able to pass images to multimodal LLM for visual analysis and receive structured feedback
6. WHEN ability-voice is available THEN agents on network:voice SHALL be able to perform TTS (Piper) and STT (Whisper)
7. WHEN ability-memory is available THEN agents on network:memory SHALL be able to store, retrieve, and query persistent knowledge (backed by ArcadeDB)
8. WHEN ability-eval is available THEN agents on network:qa SHALL be able to run code in a sandbox and produce structured evaluation scores
9. WHEN ability-eval completes an evaluation THEN ability-memory SHALL ingest the result as a learning record for future agent decisions

### Requirement 8: Infrastructure Abilities (Tasks 4.28–4.31)

**User Story:** As a developer, I want tunnel, secret, and deploy abilities registered on the broker, so that agents can securely expose endpoints, manage credentials, and deploy artifacts.

#### Acceptance Criteria

1. WHEN ability-tunnel-public is available THEN agents on network:infra SHALL be able to expose local endpoints via third-party tunnels (ngrok, Serveo, LocalTunnel, Pinggy, localhost.run) with automatic fallback
2. WHEN ability-tunnel-private is available THEN agents on network:infra SHALL be able to create secure private tunnels via self-hosted kadi-tunnel (frp + Caddy)
3. WHEN ability-secret is available THEN agents on network:infra SHALL be able to encrypt/decrypt secrets (ChaCha20-Poly1305), manage vaults, and share secrets between agents with audit logging
4. WHEN ability-deploy is available THEN agents on network:deploy SHALL be able to deploy containers to local Docker or remote Akash Network with profile-based configuration

### Requirement 9: GitHub Webhook & PR Approval (Tasks 4.32–4.34)

**User Story:** As a user, I want the system to automatically detect when I merge or close a PR on GitHub, so that the quest workflow continues without me having to manually notify agents.

#### Acceptance Criteria

1. WHEN GitHub sends a webhook for PR events (merged, closed, changes_requested) THEN agent-quest SHALL receive the webhook and publish the corresponding KADI event
2. WHEN agent-quest receives a webhook THEN it SHALL verify the webhook signature for security
3. WHEN webhook is unavailable (no public URL) THEN agent-lead SHALL fall back to polling PR status via mcp-server-github at a configurable interval
4. WHEN HUMAN merges PR on GitHub THEN agent-quest SHALL publish quest.merged event, agent-lead SHALL delete the staging branch, and agent-producer SHALL confirm completion to HUMAN
5. WHEN HUMAN closes PR without merging THEN agent-quest SHALL publish quest.pr_rejected event, agent-producer SHALL ask HUMAN whether to abandon or rework the quest
6. WHEN HUMAN requests changes on PR THEN agent-quest SHALL publish pr.changes_requested event, agent-lead SHALL create revision tasks and assign to workers

### Requirement 10: Error Handling & Stability (Tasks 4.35–4.39)

**User Story:** As a user, I want the system to handle failures gracefully without losing work, so that I don't have to manually intervene when things go wrong.

#### Acceptance Criteria

1. WHEN a task fails THEN agent-worker SHALL retry with exponential backoff (configurable retry count and max timeout)
2. WHEN an agent goes offline THEN agent-lead SHALL detect via heartbeat monitoring and reassign the agent's tasks to available workers
3. WHEN LLM API rate limit is hit THEN the calling agent SHALL queue requests and retry after cooldown using token bucket or sliding window rate limiting
4. WHEN git merge conflict occurs THEN agent-lead SHALL attempt auto-resolution for non-overlapping changes
5. WHEN KADI broker connection drops THEN agents SHALL auto-reconnect with exponential backoff, queue outgoing events during disconnection, and flush on reconnect
6. WHEN agent-worker commits changes before QA review THEN work SHALL NOT be lost even if the worker process crashes (workflow step 15)

### Requirement 11: KADI Network Topology (Task 4.4)

**User Story:** As a developer, I want a clear network topology where each tool is scoped to the right network, so that agents only see tools relevant to their domain.

#### Acceptance Criteria

1. WHEN a component registers tools THEN tools SHALL be scoped to specific networks using broker's per-tool network scoping (`RegisterToolOptions.brokers`)
2. WHEN network:global is configured THEN it SHALL be reserved for Claude Desktop testing/debugging only, NOT for all components
3. WHEN role-specific networks (network:artist, network:designer, network:programmer) are configured THEN each SHALL connect one agent-lead instance to its matching agent-worker instances
4. WHEN network:quest is configured THEN it SHALL contain agent-quest and mcp-server-quest for dashboard and quest state management
5. WHEN network:producer is configured THEN it SHALL be the bridge where agent-producer registers tools called by agent-quest and agent-chatbot

### Requirement 12: GDC Networking Materials (Tasks 4.40–4.43)

**User Story:** As a founder, I want demo videos, slides, and networking materials for GDC, so that I can showcase the KĀDI multi-agent system to game developers and potential collaborators.

#### Acceptance Criteria

1. WHEN demo video is created THEN it SHALL show the complete workflow: HUMAN request → quest creation → task planning → worker execution → QA validation → PR creation → approval
2. WHEN presentation slides are created THEN they SHALL cover KĀDI architecture, agent hierarchy, ability ecosystem, and live demo highlights
3. WHEN project summary is created THEN it SHALL be a one-page document explaining what KĀDI is, key features, and architecture overview
4. WHEN contact materials are created THEN they SHALL include elevator pitch scripts (30 seconds, 2 minutes)

### Requirement 13: Project Documentation (Tasks 4.44–4.48)

**User Story:** As a developer, I want comprehensive documentation for all new and existing projects, so that I can onboard quickly and understand how components interact.

#### Acceptance Criteria

1. WHEN a new agent project is created THEN it SHALL include README.md with purpose, architecture role, setup instructions, configuration, and KADI network membership
2. WHEN a new ability project is created THEN it SHALL include README.md with purpose, API reference, usage examples, and integration guide
3. WHEN M4 architecture changes are made THEN CLAUDE.md files across all repos SHALL be updated to reflect new networks, events, and agent roles
4. WHEN API documentation is written THEN it SHALL document all KADI events, tool schemas, network contracts, event payloads, and error codes

## Non-Functional Requirements

### Code Architecture and Modularity

- **Single Responsibility**: Each agent has one clear role (producer=UX, lead=orchestration, qa=validation, worker=execution)
- **Domain-Driven Networks**: Network boundaries enforce separation of concerns — agents only see tools in their domain
- **Broker-First Communication**: All inter-agent communication goes through KADI broker (events or tool calls), no direct agent-to-agent connections
- **Ability as Tool Provider**: Abilities register tools on broker, making them discoverable and callable by any agent on the right network

### Performance

- agent-producer response to HUMAN: under 3 seconds (no longer blocked by orchestration)
- Dashboard WebSocket latency: under 500ms for status updates
- Agent startup time: under 5 seconds for role-based initialization
- Task assignment (agent-lead): under 2 seconds after receiving quest.tasks_ready
- KADI event delivery: under 1 second broker-to-subscriber

### Security

- GitHub webhook signature verification on all incoming webhooks
- ability-secret provides ChaCha20-Poly1305 encryption for credential management
- Agent isolation via git worktrees (each worker has its own worktree)
- Network scoping prevents unauthorized tool access (agents only see tools on their networks)

### Reliability

- Worker commits BEFORE QA review — work is never lost if worker crashes (workflow step 15)
- Staging branch accumulates verified work — broken code never reaches main
- Max 3 QA revision cycles before escalating to agent-lead
- Auto-reconnect to broker on network drop with exponential backoff
- Heartbeat monitoring for offline agent detection and task reassignment

### Usability

- Dashboard groups quest/task statuses by HUMAN intent (Needs My Action / In Progress / Done) — no horizontal scroll
- HUMAN approves quests in agent-quest frontend, approves PRs in GitHub — familiar workflows
- agent-producer relays all status updates to HUMAN via Discord — HUMAN doesn't need to check dashboard constantly
- agent-worker can reject mismatched tasks — prevents wrong-role execution

## Dependencies

### Technical Dependencies

- **KADI Broker v0.11.0+**: Per-tool network scoping support (`RegisterToolOptions.brokers`)
- **kadi-core v0.9.0+**: Agent pub/sub event support
- **agents-library v0.9.0+**: Shared agent utilities (retry, rate limiting, connection management)
- **mcp-server-quest**: Quest/task state management (7 quest statuses, 8 task statuses, 3 agent statuses)
- **mcp-server-git**: Git operations (branch, worktree, commit, merge, diff)
- **mcp-server-github**: GitHub PR operations + webhook endpoint
- **MSBuild**: DaemonAgent C++ compilation (agent-builder)

### Milestone Dependencies

- **M3 Completion**: M4 requires M3 agent-worker role-based startup, mcp-client-quest dashboard, and mcp-server-quest tools to be working
- **M4 → M5**: Agent-lead, agent-qa, agent-quest refactor prepare foundation for cross-language agents and advanced orchestration

## Risks and Mitigation

### Risk 1: Agent-Lead Extraction Complexity

**Risk:** Extracting orchestration logic from agent-producer to agent-lead may break existing workflows during transition.
**Mitigation:** Incremental extraction — move one responsibility at a time (task assignment first, then verification, then git ops). Keep agent-producer fallback until agent-lead is verified.

### Risk 2: Multi-Tier Validation Accuracy

**Risk:** agent-qa's LLM-based validation may produce false positives/negatives, causing unnecessary revision cycles or passing bad code.
**Mitigation:** Start with conservative thresholds (high score required to pass). Tune based on real-world results. ability-eval + ability-memory learning pipeline improves accuracy over time.

### Risk 3: GitHub Webhook Reliability

**Risk:** Webhook delivery may fail (tunnel down, agent-quest offline, signature mismatch).
**Mitigation:** Polling fallback in agent-lead. agent-quest retries webhook processing on failure. GitHub retries webhook delivery automatically.

### Risk 4: Staging Branch Merge Conflicts

**Risk:** Multiple workers merging into the same staging branch may cause conflicts.
**Mitigation:** agent-lead serializes merges (one at a time). Workers branch from latest staging (includes all previously verified work). agent-lead attempts auto-resolution for non-overlapping changes.

### Risk 5: Ability Registration Overhead

**Risk:** 11 abilities all registering on broker may increase startup time and broker memory usage.
**Mitigation:** Abilities register lazily (only when first agent on their network connects). Monitor broker health metrics.

## Success Criteria

M4 is considered successful when:

1. agent-lead handles task assignment, verification, staging branch merge, and PR creation — agent-producer only handles UX
2. agent-qa validates tasks with multi-tier strategy (code/art/build) and produces structured scores
3. agent-quest is a KADI agent that bridges frontend ↔ KADI events ↔ GitHub webhooks
4. At least 6 of 11 abilities are implemented and registered on broker
5. GitHub webhook or polling detects PR merge/close and triggers quest completion
6. Error handling covers task retry, offline agent detection, rate limiting, and broker reconnection
7. GDC demo video and presentation materials are ready
8. All new projects have README.md and CLAUDE.md documentation

## Out of Scope

- **Python/Rust Worker Agents**: Deferred to M5
- **agent-healer/agent-maintainer full implementation**: Discussed but deferred (only basic heartbeat monitoring in M4)
- **Quest cancellation flow**: Deferred to later milestone
- **Auto-approve for high-score tasks**: Discussed but deferred (all tasks require explicit approval in M4)
- **Cross-language ability integration**: Deferred to M5
