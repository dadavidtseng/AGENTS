# M6 Tasks Document — Agent Factory, Agent Communication, Context Window

## Milestone Overview

| Milestone | Focus | Tasks | Est. Hours |
|-----------|-------|-------|------------|
| M6 | Agent Factory Enhancement, Advanced Communication Patterns, Context Window Management | 16 | 52.0 - 78.0 |

## Task Groups

| Group | Tasks | Focus | Est. Hours |
|-------|-------|-------|------------|
| Agent Factory Enhancement | 6.1 - 6.5 | Local/remote spawning, pool management, auto-scaling, health monitoring | 18.0 - 27.0 |
| Agent Communication Patterns | 6.6 - 6.10 | Direct messaging, pub/sub enhancement, request/response, shared context | 18.0 - 27.0 |
| Context Window Management | 6.11 - 6.15 | Conversation summarization, ArcadeDB memory, pruning, retrieval optimization | 12.0 - 18.0 |
| Buffer and Completion | 6.16 | Completion report | 4.0 - 6.0 |

---

- [ ] 6.1. Implement local agent spawning
  - File: C:\GitHub\AGENTS\agent-producer\src\factory\AgentFactory.ts
  - Implement AgentFactory class that can spawn agent-worker processes on the local machine
  - Support spawning with specific role configuration and environment variables
  - Time Estimate: [4.0, 6.0] hours
  - Purpose: Enable programmatic agent spawning
  - _Leverage: agent-worker CLI interface (AGENT_ROLE env var, --role argument)_
  - _Requirements: M3 agent-worker operational_
  - _Prompt: Implement the task for spec M6-agent-factory-communication, first run spec-workflow-guide to get the workflow guide then implement the task: Role: Backend Developer with expertise in process management | Task: Implement AgentFactory class that spawns agent-worker processes on the local machine with specific role configuration, supporting environment variable and CLI argument configuration | Restrictions: Must handle process lifecycle (start, monitor, stop), capture stdout/stderr, support graceful shutdown | Success: AgentFactory spawns agent-worker processes, processes register with KĀDI broker, lifecycle management works_

- [ ] 6.2. Implement remote agent spawning
  - File: C:\GitHub\AGENTS\agent-producer\src\factory\RemoteAgentFactory.ts
  - Implement RemoteAgentFactory that can spawn agents on remote machines via SSH or KĀDI broker commands
  - Support spawning on DigitalOcean droplets and other remote servers
  - Time Estimate: [4.0, 6.0] hours
  - Purpose: Enable distributed agent deployment
  - _Leverage: AgentFactory from task 6.1, KĀDI broker network communication_
  - _Requirements: 6.1 completed_
  - _Prompt: Implement the task for spec M6-agent-factory-communication, first run spec-workflow-guide to get the workflow guide then implement the task: Role: DevOps Engineer with expertise in remote process management | Task: Implement RemoteAgentFactory that spawns agents on remote machines via SSH or KĀDI broker commands, supporting DigitalOcean droplets and other remote servers | Restrictions: Must handle SSH key authentication, support configurable remote paths, handle network failures gracefully | Success: Remote agent spawning works, agents register with KĀDI broker from remote machines, lifecycle management works remotely_

- [ ] 6.3. Implement agent pool management
  - File: C:\GitHub\AGENTS\agent-producer\src\factory\AgentPool.ts
  - Implement AgentPool class that manages a pool of agent-worker instances
  - Support minimum/maximum pool size, idle timeout, and role-based pool partitioning
  - Time Estimate: [3.0, 5.0] hours
  - Purpose: Manage agent resources efficiently
  - _Leverage: AgentFactory from task 6.1_
  - _Requirements: 6.1 completed_
  - _Prompt: Implement the task for spec M6-agent-factory-communication, first run spec-workflow-guide to get the workflow guide then implement the task: Role: Backend Developer with expertise in resource pool management | Task: Implement AgentPool class managing agent-worker instances with configurable min/max pool size, idle timeout, and role-based pool partitioning | Restrictions: Must handle agent failures gracefully, support dynamic resizing, log pool state changes | Success: Agent pool manages instances correctly, respects min/max limits, handles failures with replacement_

- [ ] 6.4. Implement auto-scaling based on task queue
  - File: C:\GitHub\AGENTS\agent-producer\src\factory\AutoScaler.ts
  - Implement AutoScaler that monitors task queue depth and scales agent pool accordingly
  - Scale up when queue depth exceeds threshold, scale down when agents are idle
  - Time Estimate: [3.0, 5.0] hours
  - Purpose: Automatically adjust agent capacity to workload
  - _Leverage: AgentPool from task 6.3, mcp-server-quest task queue_
  - _Requirements: 6.3 completed_
  - _Prompt: Implement the task for spec M6-agent-factory-communication, first run spec-workflow-guide to get the workflow guide then implement the task: Role: Backend Developer with expertise in auto-scaling systems | Task: Implement AutoScaler that monitors task queue depth and scales agent pool up/down based on configurable thresholds and cooldown periods | Restrictions: Must prevent thrashing (rapid scale up/down), implement cooldown periods, log scaling decisions | Success: Auto-scaling responds to queue depth, scales up under load, scales down when idle, no thrashing_

- [ ] 6.5. Implement health monitoring and auto-restart
  - File: C:\GitHub\AGENTS\agent-producer\src\factory\HealthMonitor.ts
  - Implement HealthMonitor that tracks agent health via heartbeat and auto-restarts failed agents
  - Integrate with AgentPool for seamless replacement of failed agents
  - Time Estimate: [2.0, 3.0] hours
  - Purpose: Ensure agent availability
  - _Leverage: mcp-server-quest agent heartbeat tools, AgentPool from task 6.3_
  - _Requirements: 6.3 completed_
  - _Prompt: Implement the task for spec M6-agent-factory-communication, first run spec-workflow-guide to get the workflow guide then implement the task: Role: Backend Developer with expertise in health monitoring | Task: Implement HealthMonitor that tracks agent health via heartbeat and auto-restarts failed agents, integrating with AgentPool for seamless replacement | Restrictions: Must use existing heartbeat mechanism, implement configurable health check interval and failure threshold, log all health events | Success: Health monitoring detects failures, auto-restart works, AgentPool maintains desired capacity_

- [ ] 6.6. Implement direct peer-to-peer agent messaging
  - File: C:\GitHub\AGENTS\agents-library\src\messaging\DirectMessaging.ts
  - Implement direct messaging between agents using KĀDI broker point-to-point channels
  - Support typed messages with request/response correlation
  - Time Estimate: [4.0, 6.0] hours
  - Purpose: Enable direct agent-to-agent communication
  - _Leverage: KĀDI broker pub/sub, agents-library_
  - _Requirements: M3 KĀDI integration operational_
  - _Prompt: Implement the task for spec M6-agent-factory-communication, first run spec-workflow-guide to get the workflow guide then implement the task: Role: Backend Developer with expertise in messaging systems | Task: Implement direct peer-to-peer messaging between agents using KĀDI broker point-to-point channels, supporting typed messages with request/response correlation IDs | Restrictions: Must use existing KĀDI broker infrastructure, support message acknowledgment, handle offline agents gracefully | Success: Agents can send direct messages, messages are delivered reliably, request/response correlation works_

- [ ] 6.7. Enhance pub/sub system
  - File: C:\GitHub\AGENTS\agents-library\src\messaging\PubSubEnhanced.ts
  - Enhance existing pub/sub system with message filtering, priority queues, and dead letter handling
  - Support topic-based filtering with complex predicates
  - Time Estimate: [3.0, 5.0] hours
  - Purpose: Improve event-driven communication
  - _Leverage: KĀDI broker topic exchange, agents-library kadi-event-publisher.ts_
  - _Requirements: M3 KĀDI event naming operational_
  - _Prompt: Implement the task for spec M6-agent-factory-communication, first run spec-workflow-guide to get the workflow guide then implement the task: Role: Backend Developer with expertise in pub/sub systems | Task: Enhance existing pub/sub system with message filtering, priority queues, and dead letter handling, supporting topic-based filtering with complex predicates | Restrictions: Must build on existing KĀDI broker infrastructure, maintain backward compatibility, support existing event patterns | Success: Enhanced pub/sub works, filtering reduces unnecessary message processing, priority queues work, dead letters handled_

- [ ] 6.8. Implement request/response pattern
  - File: C:\GitHub\AGENTS\agents-library\src\messaging\RequestResponse.ts
  - Implement synchronous-style request/response pattern over KĀDI broker
  - Support configurable timeout and automatic retry
  - Time Estimate: [3.0, 4.0] hours
  - Purpose: Enable synchronous agent communication
  - _Leverage: Direct messaging from task 6.6_
  - _Requirements: 6.6 completed_
  - _Prompt: Implement the task for spec M6-agent-factory-communication, first run spec-workflow-guide to get the workflow guide then implement the task: Role: Backend Developer with expertise in RPC patterns | Task: Implement synchronous-style request/response pattern over KĀDI broker with configurable timeout and automatic retry | Restrictions: Must use correlation IDs, implement timeout handling, support retry with backoff | Success: Request/response pattern works, timeouts handled, retries work correctly_

- [ ] 6.9. Implement shared context access
  - File: C:\GitHub\AGENTS\agents-library\src\context\SharedContext.ts
  - Implement shared context system allowing agents to read/write shared state via ArcadeDB
  - Support optimistic locking for concurrent access
  - Time Estimate: [4.0, 6.0] hours
  - Purpose: Enable agents to share state
  - _Leverage: ArcadeDB integration in agent-producer_
  - _Requirements: M3 ArcadeDB operational_
  - _Prompt: Implement the task for spec M6-agent-factory-communication, first run spec-workflow-guide to get the workflow guide then implement the task: Role: Backend Developer with expertise in distributed state management | Task: Implement shared context system allowing agents to read/write shared state via ArcadeDB with optimistic locking for concurrent access | Restrictions: Must handle concurrent writes safely, implement versioning, support partial context reads | Success: Shared context works, concurrent access handled safely, agents can share state_

- [ ] 6.10. Test all communication patterns end-to-end
  - File: C:\GitHub\AGENTS\agent-producer\src\workflows\
  - Test all communication patterns (direct messaging, enhanced pub/sub, request/response, shared context) in multi-agent workflow scenarios
  - Time Estimate: [2.0, 3.0] hours
  - Purpose: Validate communication patterns work together
  - _Leverage: Tasks 6.6-6.9_
  - _Requirements: 6.6-6.9 completed_
  - _Prompt: Implement the task for spec M6-agent-factory-communication, first run spec-workflow-guide to get the workflow guide then implement the task: Role: QA Engineer with expertise in distributed systems testing | Task: Test all communication patterns in multi-agent workflow scenarios, verifying direct messaging, enhanced pub/sub, request/response, and shared context work correctly together | Restrictions: Must test with multiple agents, verify no message loss, test error scenarios | Success: All communication patterns work correctly in multi-agent scenarios_

- [ ] 6.11. Implement conversation summarization
  - File: C:\GitHub\AGENTS\agents-library\src\context\ConversationSummarizer.ts
  - Implement conversation summarization for long-running agent sessions
  - Use LLM to generate concise summaries of conversation history when context window approaches limit
  - Time Estimate: [3.0, 5.0] hours
  - Purpose: Manage context window for long sessions
  - _Leverage: agents-library LLM integration_
  - _Requirements: M3 agent-worker operational_
  - _Prompt: Implement the task for spec M6-agent-factory-communication, first run spec-workflow-guide to get the workflow guide then implement the task: Role: Backend Developer with expertise in LLM context management | Task: Implement conversation summarization that generates concise summaries of conversation history when context window approaches limit, preserving key decisions and context | Restrictions: Must preserve critical context, implement configurable summarization threshold, support incremental summarization | Success: Summarization triggers at threshold, summaries preserve key context, agent continues working with summarized history_

- [ ] 6.12. Implement long-term memory with ArcadeDB
  - File: C:\GitHub\AGENTS\agents-library\src\context\LongTermMemory.ts
  - Implement long-term memory storage in ArcadeDB for agent knowledge persistence across sessions
  - Support storing and retrieving memories by topic, relevance, and recency
  - Time Estimate: [3.0, 5.0] hours
  - Purpose: Enable persistent agent memory
  - _Leverage: ArcadeDB integration, agents-library_
  - _Requirements: M3 ArcadeDB operational_
  - _Prompt: Implement the task for spec M6-agent-factory-communication, first run spec-workflow-guide to get the workflow guide then implement the task: Role: Backend Developer with expertise in knowledge management systems | Task: Implement long-term memory storage in ArcadeDB for agent knowledge persistence across sessions, supporting storage and retrieval by topic, relevance, and recency | Restrictions: Must use ArcadeDB graph model, implement efficient retrieval, support memory expiration | Success: Memories persist across sessions, retrieval by topic works, relevance ranking works_

- [ ] 6.13. Implement context pruning strategies
  - File: C:\GitHub\AGENTS\agents-library\src\context\ContextPruner.ts
  - Implement context pruning strategies to optimize context window usage
  - Support strategies: recency-based, relevance-based, and importance-based pruning
  - Time Estimate: [2.0, 3.0] hours
  - Purpose: Optimize context window usage
  - _Leverage: ConversationSummarizer from task 6.11_
  - _Requirements: 6.11 completed_
  - _Prompt: Implement the task for spec M6-agent-factory-communication, first run spec-workflow-guide to get the workflow guide then implement the task: Role: Backend Developer with expertise in context optimization | Task: Implement context pruning strategies (recency-based, relevance-based, importance-based) to optimize context window usage | Restrictions: Must not prune critical context, support configurable strategies, integrate with summarization | Success: Pruning reduces context size, critical context preserved, strategies are configurable_

- [ ] 6.14. Implement memory retrieval optimization
  - File: C:\GitHub\AGENTS\agents-library\src\context\MemoryRetriever.ts
  - Implement optimized memory retrieval using embedding-based similarity search
  - Support hybrid retrieval combining keyword search and semantic similarity
  - Time Estimate: [3.0, 4.0] hours
  - Purpose: Optimize memory retrieval for agents
  - _Leverage: LongTermMemory from task 6.12, ArcadeDB_
  - _Requirements: 6.12 completed_
  - _Prompt: Implement the task for spec M6-agent-factory-communication, first run spec-workflow-guide to get the workflow guide then implement the task: Role: Backend Developer with expertise in information retrieval | Task: Implement optimized memory retrieval using embedding-based similarity search with hybrid retrieval combining keyword search and semantic similarity | Restrictions: Must be efficient for large memory stores, support configurable similarity thresholds, cache frequently accessed memories | Success: Retrieval returns relevant memories, hybrid search works, performance is acceptable_

- [ ] 6.15. Test context management end-to-end
  - File: C:\GitHub\AGENTS\agent-worker\src\
  - Test complete context management pipeline: summarization → long-term memory → pruning → retrieval in a long-running agent session
  - Time Estimate: [1.0, 2.0] hours
  - Purpose: Validate context management works end-to-end
  - _Leverage: Tasks 6.11-6.14_
  - _Requirements: 6.11-6.14 completed_
  - _Prompt: Implement the task for spec M6-agent-factory-communication, first run spec-workflow-guide to get the workflow guide then implement the task: Role: QA Engineer with expertise in LLM testing | Task: Test complete context management pipeline in a long-running agent session, verifying summarization, long-term memory persistence, pruning, and retrieval work together | Restrictions: Must simulate long session, verify no critical context lost, test memory persistence across restarts | Success: Context management pipeline works end-to-end, agent maintains coherence in long sessions_

- [ ] 6.16. Create M6 completion report
  - File: C:\GitHub\AGENTS\.spec-workflow\specs\M3-expand-task-complexity\m6-completion-report.md
  - Create comprehensive M6 completion report documenting agent factory, communication patterns, and context management
  - Time Estimate: [0.5, 1.0] hours
  - Purpose: Document M6 milestone completion
  - _Leverage: All M6 task results_
  - _Requirements: All M6 tasks completed_
  - _Prompt: Implement the task for spec M6-agent-factory-communication, first run spec-workflow-guide to get the workflow guide then implement the task: Role: Project Manager with expertise in milestone reporting | Task: Create comprehensive M6 completion report documenting agent factory capabilities, communication patterns, and context management | Restrictions: Must cover all task groups, include metrics, document known issues | Success: Report is comprehensive, all areas covered, M7 prerequisites documented_
