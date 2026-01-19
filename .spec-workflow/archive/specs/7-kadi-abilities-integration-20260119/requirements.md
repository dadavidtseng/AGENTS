# Requirements Document

## Introduction

This feature integrates seven existing KADI abilities into the template-agent-typescript codebase, replacing custom implementations with standardized, reusable KADI ability services. The integration will transform the agent from a monolithic architecture to a distributed, service-oriented architecture using KADI's broker-mediated tool invocation pattern.

The seven abilities to integrate are:
1. **kadi-tunnel-ability** - Self-hosted enterprise tunneling with Let's Encrypt
2. **local-remote-file-manager-ability** - Local file operations + S3 serving + tunneling
3. **arcadedb-ability** - Docker container management for ArcadeDB
4. **cloud-file-manager-ability** - Dropbox/Google Drive/Box integration
5. **container-registry-ability** - OCI-compliant container registry operations
6. **deploy-ability** - Akash Network + Docker deployment orchestration
7. **file-management-ability** - SSH/SCP remote server operations

This integration will eliminate code duplication, improve maintainability, and enable the agent to leverage battle-tested external services that can be scaled independently.

## Alignment with Product Vision

This feature aligns with KADI's core architectural principle of separating agents (AI orchestration) from abilities (I/O operations). By moving file management, deployment, and infrastructure operations into dedicated ability services, the template-agent can focus purely on AI-driven task orchestration while delegating operational concerns to specialized, reusable services.

This supports:
- **Modularity**: Each ability can be developed, tested, and scaled independently
- **Network Isolation**: Abilities are only visible to agents in shared networks
- **Event-Driven Architecture**: Real-time progress updates via pub/sub
- **Zero-Trust Security**: Ed25519 authentication for all broker connections

## Requirements

### Requirement 1: Wrap Existing Abilities as KADI Services

**User Story:** As a KADI developer, I want all 7 abilities to connect to the KADI broker using KadiClient, so that template-agent can invoke their tools via broker-mediated protocol.

**Technical Context:** Based on kadi-core and kadi-broker codebases:
- Abilities use `KadiClient` from `@kadi.build/core`
- Authentication uses Ed25519 signature (auto-generated on connect)
- Tool registration supports both Zod schemas and JSON Schema (MCP-compliant)
- Connection flow: WebSocket → hello → authenticate → register capabilities
- Protocol: JSON-RPC 2.0 over WebSocket at `ws://localhost:8080/kadi`

#### Acceptance Criteria

1. WHEN each ability initializes THEN it SHALL create KadiClient with:
   - `name: string` (ability name)
   - `role: 'ability'` (for semantic clarity)
   - `broker: 'ws://localhost:8080'` (WebSocket URL)
   - `networks: string[]` (e.g., ['global', 'file-ops'])

2. WHEN each ability registers tools THEN it SHALL use `client.registerTool()` with MCP-compliant schema:
   - `inputSchema: { type: 'object', properties: {...}, required: [...] }`
   - `outputSchema: { type: 'object', properties: {...}, required: [...] }`
   - Handler function: `async (params) => { return result; }`

3. WHEN each ability is ready THEN it SHALL call `client.serve('broker')` which will:
   - Automatically call `client.connect()` (performs Ed25519 handshake)
   - Send `kadi.session.hello` with role, name, version, networks
   - Authenticate with Ed25519 signature over nonce
   - Register all tools via `kadi.agent.register` message
   - Listen for `kadi.ability.request` messages (tool invocations)

4. WHEN an ability receives `kadi.ability.request` THEN it SHALL:
   - Execute the tool handler with provided `toolInput`
   - Return result via JSON-RPC 2.0 response message
   - Send error response if handler throws exception

5. WHEN an ability performs long operations THEN it SHALL emit progress events using:
   - `client.publishEvent(eventName, data)` for progress updates
   - Event name pattern: `{ability}.{action}` (e.g., 'deploy.progress')

6. WHEN ability shuts down THEN it SHALL:
   - Call `client.disconnect()` to send `kadi.session.goodbye`
   - Close WebSocket connection gracefully
   - Handle SIGTERM/SIGINT for graceful shutdown

### Requirement 2: Fix Template Agent Broker Configuration

**User Story:** As a template-agent developer, I want the agent to properly connect to KADI broker, so that it can invoke ability tools.

**Technical Context:** Based on kadi-core KadiClient source code:
- Single parameter: `broker: 'ws://localhost:8080'` (NOT `brokers` object)
- Agent role: `role: 'agent'` (default, can be omitted)
- Transport modes: 'native' | 'stdio' | 'broker'
- No `defaultBroker` parameter exists in KadiClient config

#### Acceptance Criteria

1. WHEN agent initializes THEN it SHALL create KadiClient with:
   - `name: string` (agent name)
   - `role: 'agent'` (can be omitted, defaults to 'agent')
   - `broker: 'ws://localhost:8080'` (WebSocket URL - single string parameter)
   - `networks: string[]` (e.g., ['global', 'slack', 'discord'])

2. WHEN agent calls `client.connect()` THEN it SHALL:
   - Generate Ed25519 keypair automatically
   - Send `kadi.session.hello` with agent metadata
   - Sign nonce with Ed25519 private key
   - Receive agentId from broker after authentication

3. WHEN agent loads abilities THEN it SHALL use:
   - `client.load('ability-name', 'broker')` for broker-mediated loading
   - Returns ability proxy object with tool methods

4. WHEN agent is authenticated THEN agentId SHALL be derived from Ed25519 public key

5. WHEN agent registers networks THEN tools SHALL be visible only in registered networks

### Requirement 3: Load Abilities from Template Agent

**User Story:** As a template-agent, I want to load all 7 abilities on startup, so that I can invoke their tools during task execution.

#### Acceptance Criteria

1. WHEN agent finishes broker connection THEN it SHALL load all 7 abilities using `client.load(name, 'broker')`
2. WHEN loading abilities THEN it SHALL subscribe to relevant events (e.g., 'deploy.progress', 'file-manager.upload-progress')
3. WHEN ability loading fails THEN agent SHALL log error and attempt retry
4. WHEN all abilities are loaded THEN agent SHALL store ability proxies for use in task handlers
5. IF ability is not available THEN agent SHALL continue with reduced functionality

### Requirement 4: Replace File Management Implementation

**User Story:** As a template-agent developer, I want to remove custom file management code, so that file operations are handled by dedicated abilities.

#### Acceptance Criteria

1. WHEN integration is complete THEN `src/file-management/file-manager-proxy.ts` SHALL be deleted
2. WHEN file operations are needed THEN agent SHALL call `file-management-ability` for SSH/SCP operations
3. WHEN local file serving is needed THEN agent SHALL call `local-remote-file-manager-ability`
4. WHEN cloud storage is needed THEN agent SHALL call `cloud-file-manager-ability`
5. WHEN agent calls file abilities THEN it SHALL use ability proxy pattern (not direct protocol.invokeTool)

### Requirement 5: Replace Deployment Implementation

**User Story:** As a template-agent developer, I want to remove custom deployment code, so that deployments are handled by deploy-ability.

#### Acceptance Criteria

1. WHEN integration is complete THEN `src/deployment/deploy-service.ts` SHALL be deleted
2. WHEN integration is complete THEN `src/deployment/types.ts` SHALL be deleted
3. WHEN deployment is needed THEN agent SHALL call `deploy-ability` tools
4. WHEN deployment starts THEN agent SHALL listen for 'deploy.progress' events
5. WHEN deployment completes THEN agent SHALL receive deployment details (gatewayUrl, apiKey, status)

### Requirement 6: Integrate Tunneling Capability

**User Story:** As a template-agent, I want to create secure tunnels for local services, so that they are accessible over the internet.

#### Acceptance Criteria

1. WHEN agent needs to expose a local service THEN it SHALL invoke `kadi-tunnel-ability` create_tunnel tool
2. WHEN tunnel is created THEN agent SHALL receive subdomain and public URL
3. WHEN agent has choice between tunneling solutions THEN it SHALL prefer `kadi-tunnel-ability` (self-hosted) over `local-remote-file-manager-ability` (3rd party ngrok/serveo)
4. WHEN tunnel is no longer needed THEN agent SHALL destroy tunnel using destroy_tunnel tool

### Requirement 7: Integrate Container Registry Operations

**User Story:** As a template-agent, I want to push/pull container images, so that I can deploy containerized applications.

#### Acceptance Criteria

1. WHEN agent needs to push a container image THEN it SHALL invoke `container-registry-ability` push_image tool
2. WHEN agent needs to pull a container image THEN it SHALL invoke pull_image tool
3. WHEN agent needs to list available images THEN it SHALL invoke list_images tool
4. WHEN registry operations fail THEN agent SHALL receive detailed error messages

### Requirement 8: Integrate ArcadeDB Container Management

**User Story:** As a template-agent developer, I want to manage ArcadeDB containers, so that the agent can start/stop database instances.

#### Acceptance Criteria

1. WHEN agent needs to start ArcadeDB THEN it SHALL invoke `arcadedb-ability` start_container tool
2. WHEN agent needs to stop ArcadeDB THEN it SHALL invoke stop_container tool
3. WHEN agent needs to backup database THEN it SHALL invoke backup_database tool
4. WHEN agent performs queries THEN it SHALL continue using `src/memory/arcadedb-adapter.ts` (NOT the ability)
5. IF arcadedb-ability is unavailable THEN agent SHALL still function with existing adapter

### Requirement 9: Event Subscription and Monitoring

**User Story:** As a template-agent, I want to receive real-time progress updates from abilities, so that I can track long-running operations.

#### Acceptance Criteria

1. WHEN agent loads abilities THEN it SHALL subscribe to all relevant progress events
2. WHEN 'deploy.progress' event is received THEN agent SHALL log deployment stage and message
3. WHEN 'file-manager.upload-progress' event is received THEN agent SHALL log upload percentage
4. WHEN 'deploy.completed' event is received THEN agent SHALL store deployment details
5. WHEN 'deploy.failed' event is received THEN agent SHALL handle error appropriately

### Requirement 10: Ability Discovery and Documentation

**User Story:** As a template-agent developer, I want to know which tools are available from each ability, so that I can use them correctly.

#### Acceptance Criteria

1. WHEN each ability starts THEN it SHALL have an `agent.json` manifest describing its tools
2. WHEN developer needs tool documentation THEN each ability SHALL have clear JSDoc/TypeDoc comments
3. WHEN agent calls a tool THEN it SHALL follow the tool's input schema exactly
4. WHEN tool invocation fails THEN error message SHALL clearly identify which ability and tool failed

### Requirement 11: End-to-End Testing for All Abilities

**User Story:** As a quality assurance engineer, I want comprehensive E2E tests for all 7 integrated abilities, so that I can verify the integration works correctly across the entire system.

#### Acceptance Criteria

1. WHEN E2E tests are implemented THEN each of the 7 abilities SHALL have dedicated test suites:
   - `test/e2e/kadi-tunnel.e2e.test.ts`
   - `test/e2e/local-remote-file-manager.e2e.test.ts`
   - `test/e2e/arcadedb.e2e.test.ts`
   - `test/e2e/cloud-file-manager.e2e.test.ts`
   - `test/e2e/container-registry.e2e.test.ts`
   - `test/e2e/deploy.e2e.test.ts`
   - `test/e2e/file-management.e2e.test.ts`

2. WHEN E2E tests run THEN each test SHALL:
   - Start KADI broker in test mode
   - Launch the ability as a separate process
   - Launch template-agent as a separate process
   - Verify ability connects and registers tools
   - Verify agent can discover and invoke ability tools
   - Verify tool invocations return expected results
   - Verify event pub/sub works correctly
   - Clean up all processes after test completion

3. WHEN E2E tests execute tool invocations THEN they SHALL test:
   - **Happy path**: Valid inputs produce expected outputs
   - **Error handling**: Invalid inputs produce appropriate errors
   - **Timeout handling**: Long operations respect timeouts
   - **Event emissions**: Progress events are published correctly
   - **Network isolation**: Tools are only visible in correct networks

4. WHEN E2E tests run THEN they SHALL verify integration points:
   - **Broker communication**: WebSocket connection and JSON-RPC messages
   - **Authentication**: Ed25519 handshake completes successfully
   - **Tool routing**: Broker correctly routes requests to ability
   - **Response handling**: Agent receives and processes tool results
   - **Event delivery**: Events reach subscribed agents

5. WHEN all E2E tests pass THEN:
   - All 7 abilities SHALL successfully connect to broker
   - All ability tools SHALL be invocable from agent
   - All tool invocations SHALL return correct results
   - All event subscriptions SHALL receive published events
   - No process crashes or unhandled exceptions occur

6. WHEN E2E test suite runs THEN it SHALL include:
   - **Integration test**: All 7 abilities + agent running simultaneously
   - **Failure scenarios**: Ability crashes, network failures, timeouts
   - **Performance tests**: Measure tool invocation latency (&lt;100ms overhead)
   - **Concurrent tests**: Multiple tool invocations in parallel

7. WHEN E2E tests are added THEN they SHALL use test framework:
   - Vitest (existing test framework in template-agent-typescript)
   - Test fixtures for broker/ability/agent processes
   - Shared test utilities for WebSocket inspection
   - Cleanup helpers to ensure no orphaned processes

## Non-Functional Requirements

### Code Architecture and Modularity

- **Single Responsibility Principle**: Each ability handles one domain (files, deployment, databases, etc.)
- **Modular Design**: Abilities are independent services that can be started/stopped without affecting others
- **Dependency Management**: Template-agent depends on abilities via broker protocol, not direct imports
- **Clear Interfaces**: Each ability exposes tools via JSON-RPC 2.0 with explicit input/output schemas

### Performance

- **Tool Invocation Latency**: Broker-mediated tool calls SHALL complete within 100ms overhead (excluding actual work)
- **Concurrent Operations**: Agent SHALL support parallel ability tool calls when operations are independent
- **Event Delivery**: Progress events SHALL be delivered within 50ms of emission
- **Ability Startup Time**: Each ability SHALL connect to broker within 5 seconds

### Security

- **Authentication**: All broker connections SHALL use Ed25519 signature authentication
- **Network Isolation**: Tools SHALL only be visible to agents/abilities in shared networks
- **Secret Management**: API keys and credentials SHALL be passed via environment variables, not hardcoded
- **Audit Trail**: All tool invocations SHALL be logged for security auditing

### Reliability

- **Graceful Degradation**: If an ability is unavailable, agent SHALL continue with reduced functionality
- **Retry Logic**: Tool invocations SHALL retry up to 3 times with exponential backoff on transient failures
- **Error Handling**: Ability errors SHALL be propagated to agent with clear error messages
- **Health Monitoring**: Abilities SHALL expose health check endpoints for monitoring

### Usability

- **Clear Logging**: All tool invocations and events SHALL be logged with timestamps and context
- **Progress Visibility**: Long-running operations SHALL emit progress events at meaningful intervals
- **Documentation**: Each ability SHALL have comprehensive README with usage examples
- **Developer Experience**: Ability proxy pattern SHALL provide autocomplete and type safety
