# Tasks Document

## Phase 1: Foundation Setup

- [ ] 1.1. Fix template-agent broker configuration
  - File: C:/p4/Personal/SD/template-agent-typescript/src/index.ts
  - Fix KadiClient initialization to use correct parameters: `broker: 'ws://localhost:8080'` (single string, not brokers object)
  - Remove any `defaultBroker` references (parameter doesn't exist)
  - Ensure networks array includes: ['global', 'file-ops', 'deployment', 'tunnel']
  - Purpose: Correct broker connection to match kadi-core KadiClient API
  - _Leverage: Existing KadiClient at src/index.ts:127-133_
  - _Requirements: 2.1, 2.2_
  - _Prompt: Role: KADI Systems Developer with expertise in broker-mediated architecture | Task: Fix KadiClient configuration in template-agent following requirements 2.1-2.2, correcting broker parameter from object to string 'ws://localhost:8080' and removing defaultBroker references that don't exist in kadi-core API | Restrictions: Must maintain backward compatibility with existing functionality, do not modify broker connection logic beyond configuration parameters | Success: Agent connects to broker successfully with correct configuration, Ed25519 authentication completes, networks are properly registered_

- [ ] 1.2. Create AbilityManager for centralized ability loading
  - File: C:/p4/Personal/SD/template-agent-typescript/src/abilities/ability-manager.ts
  - Implement AbilityManager class with methods: loadAll(), loadAbility(), getFileOperations(), getDeployment(), getTunneling(), getDatabase(), getContainerRegistry(), checkHealth(), dispose()
  - Use KadiClient.load(name, 'broker') for loading abilities
  - Return Result&lt;T, E&gt; for error handling
  - Purpose: Centralized management for all 7 ability proxies
  - _Leverage: src/common/result.ts, src/providers/provider-manager.ts (manager pattern)_
  - _Requirements: 3.1, 3.5_
  - _Prompt: Role: TypeScript Developer specializing in service orchestration patterns | Task: Create AbilityManager class following requirements 3.1 and 3.5, implementing centralized ability loading using KadiClient.load() and Result&lt;T, E&gt; pattern from src/common/result.ts, following manager patterns from src/providers/provider-manager.ts | Restrictions: Must handle ability loading failures gracefully, maintain lazy loading capability, do not create tight coupling between abilities | Success: AbilityManager successfully loads abilities via broker, provides clean proxy access, handles failures with Result&lt;T, E&gt;, follows existing manager patterns_

- [ ] 1.3. Create ability error types
  - File: C:/p4/Personal/SD/template-agent-typescript/src/abilities/errors.ts
  - Define error types: AbilityError, FileError, DeployError, TunnelError, DBError, RegistryError
  - Extend existing error classification patterns
  - Purpose: Type-safe error handling for ability operations
  - _Leverage: src/providers/anthropic-provider.ts:302-334 (error classification)_
  - _Requirements: Design Document - Error Handling section_
  - _Prompt: Role: TypeScript Developer with expertise in error handling patterns | Task: Create ability-specific error types extending existing error classification patterns from src/providers/anthropic-provider.ts:302-334, implementing AbilityError base class and specific error types for each ability domain | Restrictions: Must maintain consistency with existing error types, ensure errors are serializable for logging, include context information | Success: All error types are properly defined with clear error codes, extend existing patterns, provide useful debugging context_

## Phase 2: Ability Integrations (with incremental E2E testing)

### 2.1 File Management Ability

- [ ] 2.1.1. Wrap file-management-ability as KADI service
  - File: C:/p4/Personal/SD/kadi/file-management-ability/src/index.ts
  - Initialize KadiClient with role: 'ability', broker: 'ws://localhost:8080', networks: ['global', 'file-ops']
  - Register tools: uploadViaSSH, downloadViaSSH, executeRemoteCommand using client.registerTool()
  - Call client.serve('broker') to connect and register
  - Purpose: Enable SSH/SCP file operations via broker
  - _Leverage: @kadi.build/core KadiClient_
  - _Requirements: 1.1, 1.2, 1.3_
  - _Prompt: Role: KADI Ability Developer with expertise in SSH/SCP operations | Task: Wrap file-management-ability as KADI service following requirements 1.1-1.3, implementing KadiClient initialization with proper role, broker URL, and networks, registering all SSH/SCP tools with MCP-compliant schemas | Restrictions: Must use exact broker parameter format from kadi-core, handle SSH connection errors properly, emit progress events for long operations | Success: Ability connects to broker successfully, tools are registered with correct schemas, SSH operations work reliably_

- [ ] 2.1.2. Create FileOperationsProxy in template-agent
  - File: C:/p4/Personal/SD/template-agent-typescript/src/abilities/file-operations-proxy.ts
  - Implement proxy methods: uploadViaSSH(), downloadViaSSH(), executeRemoteCommand()
  - Load file-management-ability using AbilityManager
  - Return Result&lt;T, E&gt; for all methods
  - Purpose: Type-safe wrapper for file-management-ability
  - _Leverage: src/abilities/ability-manager.ts, src/common/result.ts_
  - _Requirements: 4.2_
  - _Prompt: Role: TypeScript Developer specializing in proxy patterns | Task: Create FileOperationsProxy following requirement 4.2, implementing type-safe wrapper methods that load and invoke file-management-ability tools via AbilityManager, using Result&lt;T, E&gt; pattern for error handling | Restrictions: Must not bypass ability loading through AbilityManager, handle network errors gracefully, maintain method signatures matching ability tools | Success: Proxy successfully invokes SSH/SCP operations, errors are properly wrapped in Result&lt;T, E&gt;, type safety is maintained_

- [ ] 2.1.3. E2E test for file-management-ability integration
  - File: C:/p4/Personal/SD/template-agent-typescript/test/e2e/file-management.e2e.test.ts
  - Start broker, launch file-management-ability, launch agent
  - Test SSH upload/download operations with valid credentials
  - Test error handling with invalid credentials
  - Verify ability connects and registers tools correctly
  - Purpose: Validate file-management-ability integration works end-to-end
  - _Leverage: Vitest test framework_
  - _Requirements: 11.1, 11.2, 11.3_
  - _Prompt: Role: QA Engineer with expertise in E2E testing and process orchestration | Task: Create comprehensive E2E test for file-management-ability following requirements 11.1-11.3, starting broker and ability processes, verifying tool registration, testing SSH operations with both valid and invalid scenarios | Restrictions: Must clean up all processes after test, use test fixtures for credentials, ensure test isolation | Success: Test verifies ability connects to broker, tools are invocable from agent, SSH operations return correct results, error handling works properly_

### 2.2 Local Remote File Manager Ability

- [ ] 2.2.1. Wrap local-remote-file-manager-ability as KADI service
  - File: C:/p4/Personal/SD/kadi/local-remote-file-manager-ability/src/index.ts
  - Initialize KadiClient with role: 'ability', broker: 'ws://localhost:8080', networks: ['global', 'file-ops']
  - Register tools: startFileServer, stopFileServer, listFiles using client.registerTool()
  - Call client.serve('broker') to connect and register
  - Purpose: Enable local file serving with S3-compatible API
  - _Leverage: @kadi.build/core KadiClient_
  - _Requirements: 1.1, 1.2, 1.3_
  - _Prompt: Role: KADI Ability Developer with expertise in file serving and S3 APIs | Task: Wrap local-remote-file-manager-ability as KADI service following requirements 1.1-1.3, implementing KadiClient initialization and tool registration for file server operations with S3-compatible interface | Restrictions: Must properly manage file server lifecycle, handle port conflicts gracefully, emit progress events for uploads | Success: Ability connects to broker, file server tools are registered, S3-compatible file serving works correctly_

- [ ] 2.2.2. Extend FileOperationsProxy with local file serving
  - File: C:/p4/Personal/SD/template-agent-typescript/src/abilities/file-operations-proxy.ts (extend)
  - Add methods: startFileServer(), stopFileServer(), listFiles()
  - Load local-remote-file-manager-ability using AbilityManager
  - Subscribe to 'file-manager.upload-progress' events
  - Purpose: Enable local file serving operations
  - _Leverage: src/abilities/ability-manager.ts_
  - _Requirements: 4.2_
  - _Prompt: Role: TypeScript Developer with expertise in file serving systems | Task: Extend FileOperationsProxy with local file serving methods following requirement 4.2, loading local-remote-file-manager-ability and subscribing to upload progress events | Restrictions: Must handle server lifecycle properly, prevent duplicate server instances, emit progress to logging system | Success: File server operations work correctly, progress events are received and logged, server cleanup happens on errors_

- [ ] 2.2.3. E2E test for local-remote-file-manager-ability integration
  - File: C:/p4/Personal/SD/template-agent-typescript/test/e2e/local-remote-file-manager.e2e.test.ts
  - Start broker, launch ability, launch agent
  - Test startFileServer with valid port
  - Test file upload/download via S3 API
  - Test stopFileServer cleanup
  - Verify progress events are received
  - Purpose: Validate local file serving integration
  - _Leverage: Vitest test framework_
  - _Requirements: 11.1, 11.2, 11.3_
  - _Prompt: Role: QA Engineer with expertise in file server testing | Task: Create E2E test for local-remote-file-manager-ability following requirements 11.1-11.3, verifying file server lifecycle, S3 API operations, and progress event delivery | Restrictions: Must use unique ports for each test, clean up server processes, verify no port leaks | Success: File server starts and stops correctly, S3 operations work, progress events are delivered within 50ms_

### 2.3 Cloud File Manager Ability

- [ ] 2.3.1. Wrap cloud-file-manager-ability as KADI service
  - File: C:/p4/Personal/SD/kadi/cloud-file-manager-ability/src/index.ts
  - Initialize KadiClient with role: 'ability', broker: 'ws://localhost:8080', networks: ['global', 'file-ops']
  - Register tools: uploadToCloud, downloadFromCloud, listCloudFiles using client.registerTool()
  - Call client.serve('broker') to connect and register
  - Purpose: Enable Dropbox/Google Drive/Box integration
  - _Leverage: @kadi.build/core KadiClient_
  - _Requirements: 1.1, 1.2, 1.3_
  - _Prompt: Role: KADI Ability Developer with expertise in cloud storage APIs | Task: Wrap cloud-file-manager-ability as KADI service following requirements 1.1-1.3, implementing tool registration for Dropbox, Google Drive, and Box operations | Restrictions: Must handle OAuth credentials from environment variables, implement retry logic for transient failures, emit progress for large uploads | Success: Ability connects to broker, cloud storage tools are registered, OAuth authentication works with all providers_

- [ ] 2.3.2. Extend FileOperationsProxy with cloud storage
  - File: C:/p4/Personal/SD/template-agent-typescript/src/abilities/file-operations-proxy.ts (extend)
  - Add methods: uploadToCloud(), downloadFromCloud(), listCloudFiles()
  - Load cloud-file-manager-ability using AbilityManager
  - Handle cloud provider-specific errors
  - Purpose: Enable cloud storage operations
  - _Leverage: src/abilities/ability-manager.ts_
  - _Requirements: 4.2_
  - _Prompt: Role: TypeScript Developer with expertise in cloud storage integration | Task: Extend FileOperationsProxy with cloud storage methods following requirement 4.2, loading cloud-file-manager-ability and implementing provider-specific error handling | Restrictions: Must validate cloud credentials before operations, handle rate limiting gracefully, support all three cloud providers | Success: Cloud operations work with Dropbox/Drive/Box, errors are properly classified, rate limits are respected_

- [ ] 2.3.3. E2E test for cloud-file-manager-ability integration
  - File: C:/p4/Personal/SD/template-agent-typescript/test/e2e/cloud-file-manager.e2e.test.ts
  - Start broker, launch ability, launch agent
  - Test cloud upload/download with mock credentials (or skip if no test credentials)
  - Test error handling with invalid credentials
  - Verify tool registration for all cloud providers
  - Purpose: Validate cloud storage integration
  - _Leverage: Vitest test framework_
  - _Requirements: 11.1, 11.2, 11.3_
  - _Prompt: Role: QA Engineer with expertise in cloud API testing | Task: Create E2E test for cloud-file-manager-ability following requirements 11.1-11.3, testing cloud operations with mock or test credentials, verifying error handling and tool registration | Restrictions: Must not use production credentials, mock OAuth flows in tests, handle credential absence gracefully | Success: Cloud operations are testable, error handling works correctly, test passes with or without real credentials_

### 2.4 Deploy Ability

- [ ] 2.4.1. Wrap deploy-ability as KADI service
  - File: C:/p4/Personal/SD/kadi/deploy-ability/src/index.ts
  - Initialize KadiClient with role: 'ability', broker: 'ws://localhost:8080', networks: ['global', 'deployment']
  - Register tools: deployModelManager, getDeploymentStatus using client.registerTool()
  - Emit 'deploy.progress', 'deploy.completed', 'deploy.failed' events
  - Call client.serve('broker') to connect and register
  - Purpose: Enable Akash/Docker deployment orchestration
  - _Leverage: @kadi.build/core KadiClient_
  - _Requirements: 1.1, 1.2, 1.3, 1.5_
  - _Prompt: Role: KADI Ability Developer with expertise in container orchestration | Task: Wrap deploy-ability as KADI service following requirements 1.1-1.3 and 1.5, implementing deployment tools with progress event emissions for Akash and Docker deployments | Restrictions: Must emit progress events at meaningful intervals, handle deployment failures gracefully, include deployment details in events | Success: Ability connects to broker, deployment tools registered, progress events emitted during deployments, cleanup works on failures_

- [ ] 2.4.2. Create DeploymentProxy in template-agent
  - File: C:/p4/Personal/SD/template-agent-typescript/src/abilities/deployment-proxy.ts
  - Implement methods: deployModelManager(), getStatus()
  - Subscribe to 'deploy.progress', 'deploy.completed', 'deploy.failed' events
  - Load deploy-ability using AbilityManager
  - Return Result&lt;T, E&gt; for all methods
  - Purpose: Type-safe wrapper for deployment operations
  - _Leverage: src/abilities/ability-manager.ts, src/common/result.ts_
  - _Requirements: 5.3, 9.2, 9.4, 9.5_
  - _Prompt: Role: TypeScript Developer specializing in deployment systems | Task: Create DeploymentProxy following requirements 5.3, 9.2, 9.4, 9.5, implementing deployment methods and event subscriptions for progress tracking, using Result&lt;T, E&gt; for error handling | Restrictions: Must log all deployment events with timestamps, store deployment details on completion, handle deployment failures appropriately | Success: Deployment operations work correctly, progress events are received and logged, deployment details are stored, failures are handled gracefully_

- [ ] 2.4.3. E2E test for deploy-ability integration
  - File: C:/p4/Personal/SD/template-agent-typescript/test/e2e/deploy.e2e.test.ts
  - Start broker, launch ability, launch agent
  - Test deployModelManager with valid parameters
  - Test getDeploymentStatus for active deployment
  - Verify 'deploy.progress', 'deploy.completed' events received
  - Test deployment failure scenarios
  - Purpose: Validate deployment integration
  - _Leverage: Vitest test framework_
  - _Requirements: 11.1, 11.2, 11.3, 11.4_
  - _Prompt: Role: QA Engineer with expertise in deployment testing | Task: Create E2E test for deploy-ability following requirements 11.1-11.4, testing deployment operations, event delivery, and failure scenarios | Restrictions: Must mock Akash/Docker APIs in tests, verify event timing &lt;50ms, test both success and failure paths | Success: Deployment operations testable, events delivered correctly, deployment status accurate, failures handled properly_

### 2.5 Tunnel Ability

- [ ] 2.5.1. Wrap kadi-tunnel-ability as KADI service
  - File: C:/p4/Personal/SD/kadi/kadi-tunnel-ability/src/index.ts
  - Initialize KadiClient with role: 'ability', broker: 'ws://localhost:8080', networks: ['global', 'tunnel']
  - Register tools: createTunnel, listTunnels, destroyTunnel using client.registerTool()
  - Call client.serve('broker') to connect and register
  - Purpose: Enable self-hosted tunneling with Let's Encrypt
  - _Leverage: @kadi.build/core KadiClient_
  - _Requirements: 1.1, 1.2, 1.3_
  - _Prompt: Role: KADI Ability Developer with expertise in tunneling and TLS | Task: Wrap kadi-tunnel-ability as KADI service following requirements 1.1-1.3, implementing tunnel management tools with Let's Encrypt certificate provisioning | Restrictions: Must handle certificate renewal automatically, clean up tunnels on ability shutdown, validate local port availability | Success: Ability connects to broker, tunnel tools registered, Let's Encrypt certificates issued successfully, tunnels expose local services correctly_

- [ ] 2.5.2. Create TunnelingProxy in template-agent
  - File: C:/p4/Personal/SD/template-agent-typescript/src/abilities/tunneling-proxy.ts
  - Implement methods: createTunnel(), listTunnels(), destroyTunnel()
  - Load kadi-tunnel-ability using AbilityManager
  - Return Result&lt;T, E&gt; for all methods
  - Purpose: Type-safe wrapper for tunneling operations
  - _Leverage: src/abilities/ability-manager.ts, src/common/result.ts_
  - _Requirements: 6.1, 6.2, 6.4_
  - _Prompt: Role: TypeScript Developer with expertise in network tunneling | Task: Create TunnelingProxy following requirements 6.1-6.2 and 6.4, implementing tunnel management methods using kadi-tunnel-ability, preferring it over third-party solutions | Restrictions: Must validate local port before tunnel creation, store tunnel details for cleanup, handle DNS propagation delays | Success: Tunnels created successfully with public URLs, tunnel lifecycle managed properly, cleanup works correctly_

- [ ] 2.5.3. E2E test for kadi-tunnel-ability integration
  - File: C:/p4/Personal/SD/template-agent-typescript/test/e2e/kadi-tunnel.e2e.test.ts
  - Start broker, launch ability, launch agent
  - Test createTunnel for local HTTP server
  - Verify public URL is accessible
  - Test destroyTunnel cleanup
  - Purpose: Validate tunneling integration
  - _Leverage: Vitest test framework_
  - _Requirements: 11.1, 11.2, 11.3_
  - _Prompt: Role: QA Engineer with expertise in network testing | Task: Create E2E test for kadi-tunnel-ability following requirements 11.1-11.3, testing tunnel creation, public accessibility, and cleanup | Restrictions: Must start local HTTP server for testing, verify DNS resolution, clean up tunnels after test | Success: Tunnel created successfully, public URL accessible, tunnel destroyed properly, no leaked tunnels_

### 2.6 Container Registry Ability

- [ ] 2.6.1. Wrap container-registry-ability as KADI service
  - File: C:/p4/Personal/SD/kadi/container-registry-ability/src/index.ts
  - Initialize KadiClient with role: 'ability', broker: 'ws://localhost:8080', networks: ['global', 'deployment']
  - Register tools: pushImage, pullImage, listImages using client.registerTool()
  - Call client.serve('broker') to connect and register
  - Purpose: Enable OCI-compliant container registry operations
  - _Leverage: @kadi.build/core KadiClient_
  - _Requirements: 1.1, 1.2, 1.3_
  - _Prompt: Role: KADI Ability Developer with expertise in container registries | Task: Wrap container-registry-ability as KADI service following requirements 1.1-1.3, implementing OCI-compliant registry tools for push/pull/list operations | Restrictions: Must handle authentication with registry, emit progress for large image transfers, validate image tags | Success: Ability connects to broker, registry tools registered, image operations work with OCI registries, authentication handled correctly_

- [ ] 2.6.2. Create ContainerRegistryProxy in template-agent
  - File: C:/p4/Personal/SD/template-agent-typescript/src/abilities/container-registry-proxy.ts
  - Implement methods: pushImage(), pullImage(), listImages()
  - Load container-registry-ability using AbilityManager
  - Return Result&lt;T, E&gt; for all methods
  - Purpose: Type-safe wrapper for registry operations
  - _Leverage: src/abilities/ability-manager.ts, src/common/result.ts_
  - _Requirements: 7.1, 7.2, 7.3, 7.4_
  - _Prompt: Role: TypeScript Developer with expertise in container ecosystems | Task: Create ContainerRegistryProxy following requirements 7.1-7.4, implementing registry operations with proper error handling and Result&lt;T, E&gt; pattern | Restrictions: Must validate image names and tags, handle registry authentication, provide detailed error messages | Success: Registry operations work correctly, errors clearly identify failures, image transfers complete successfully_

- [ ] 2.6.3. E2E test for container-registry-ability integration
  - File: C:/p4/Personal/SD/template-agent-typescript/test/e2e/container-registry.e2e.test.ts
  - Start broker, launch ability, launch agent
  - Test pushImage with test image
  - Test pullImage from registry
  - Test listImages
  - Verify error handling for invalid images
  - Purpose: Validate container registry integration
  - _Leverage: Vitest test framework_
  - _Requirements: 11.1, 11.2, 11.3_
  - _Prompt: Role: QA Engineer with expertise in container testing | Task: Create E2E test for container-registry-ability following requirements 11.1-11.3, testing image operations with test registry | Restrictions: Must use test registry or mock, verify image integrity, clean up test images | Success: Image operations testable, push/pull work correctly, error handling validated, no leaked images_

### 2.7 ArcadeDB Ability

- [ ] 2.7.1. Wrap arcadedb-ability as KADI service
  - File: C:/p4/Personal/SD/kadi/arcadedb-ability/src/index.ts
  - Initialize KadiClient with role: 'ability', broker: 'ws://localhost:8080', networks: ['global', 'database']
  - Register tools: startContainer, stopContainer, backupDatabase using client.registerTool()
  - Call client.serve('broker') to connect and register
  - Purpose: Enable ArcadeDB Docker container management
  - _Leverage: @kadi.build/core KadiClient_
  - _Requirements: 1.1, 1.2, 1.3_
  - _Prompt: Role: KADI Ability Developer with expertise in Docker container management | Task: Wrap arcadedb-ability as KADI service following requirements 1.1-1.3, implementing Docker container lifecycle tools for ArcadeDB | Restrictions: Must handle Docker daemon connection errors, verify container health before returning, manage port conflicts | Success: Ability connects to broker, container management tools registered, ArcadeDB containers start/stop reliably, backups complete successfully_

- [ ] 2.7.2. Create DatabaseProxy in template-agent
  - File: C:/p4/Personal/SD/template-agent-typescript/src/abilities/database-proxy.ts
  - Implement methods: startContainer(), stopContainer(), backupDatabase()
  - Load arcadedb-ability using AbilityManager
  - Return Result&lt;T, E&gt; for all methods
  - Keep existing src/memory/arcadedb-adapter.ts for query operations
  - Purpose: Manage ArcadeDB container lifecycle via ability
  - _Leverage: src/abilities/ability-manager.ts, src/common/result.ts_
  - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_
  - _Prompt: Role: TypeScript Developer with expertise in database operations | Task: Create DatabaseProxy following requirements 8.1-8.5, implementing container lifecycle methods while preserving existing query adapter, using Result&lt;T, E&gt; for error handling | Restrictions: Do not modify src/memory/arcadedb-adapter.ts, handle container startup delays, verify database ready before returning | Success: Container lifecycle managed correctly, existing query adapter continues working, database backup functionality operational_

- [ ] 2.7.3. E2E test for arcadedb-ability integration
  - File: C:/p4/Personal/SD/template-agent-typescript/test/e2e/arcadedb.e2e.test.ts
  - Start broker, launch ability, launch agent
  - Test startContainer and verify database accessibility
  - Test stopContainer cleanup
  - Test backupDatabase creates backup file
  - Verify existing arcadedb-adapter still works for queries
  - Purpose: Validate ArcadeDB integration
  - _Leverage: Vitest test framework_
  - _Requirements: 11.1, 11.2, 11.3_
  - _Prompt: Role: QA Engineer with expertise in database testing | Task: Create E2E test for arcadedb-ability following requirements 11.1-11.3, testing container lifecycle and backup operations while verifying existing query adapter compatibility | Restrictions: Must clean up containers after test, verify database connectivity, test backup file validity | Success: Container lifecycle works correctly, backups complete successfully, existing adapter maintains functionality, no leaked containers_

## Phase 3: Replace Old Implementations

- [ ] 3.1. Remove custom file management implementation
  - File: C:/p4/Personal/SD/template-agent-typescript/src/file-management/file-manager-proxy.ts (DELETE)
  - Delete file-manager-proxy.ts (535 lines)
  - Update imports in files that used FileManagerProxy to use FileOperationsProxy
  - Purpose: Eliminate code duplication now that file operations use abilities
  - _Leverage: FileOperationsProxy from src/abilities/file-operations-proxy.ts_
  - _Requirements: 4.1_
  - _Prompt: Role: Refactoring Specialist with expertise in code migration | Task: Remove custom file management implementation following requirement 4.1, deleting file-manager-proxy.ts and migrating all usages to new FileOperationsProxy from abilities | Restrictions: Must not break existing functionality, verify all imports updated, run tests before finalizing | Success: Old implementation deleted, all usages migrated to FileOperationsProxy, no broken imports, tests pass_

- [ ] 3.2. Remove custom deployment implementation
  - File: C:/p4/Personal/SD/template-agent-typescript/src/deployment/deploy-service.ts (DELETE)
  - File: C:/p4/Personal/SD/template-agent-typescript/src/deployment/types.ts (DELETE)
  - Delete deploy-service.ts (422 lines) and types.ts
  - Update imports to use DeploymentProxy
  - Purpose: Eliminate deployment code duplication
  - _Leverage: DeploymentProxy from src/abilities/deployment-proxy.ts_
  - _Requirements: 5.1, 5.2_
  - _Prompt: Role: Refactoring Specialist with expertise in code migration | Task: Remove custom deployment implementation following requirements 5.1-5.2, deleting deploy-service.ts and types.ts, migrating all usages to new DeploymentProxy | Restrictions: Must verify no other files depend on deleted code, update all imports, ensure deployment functionality intact | Success: Old deployment code deleted, all usages migrated to DeploymentProxy, tests pass, deployment operations work correctly_

## Phase 4: Integration and Documentation

- [ ] 4.1. Update agent initialization to load all abilities
  - File: C:/p4/Personal/SD/template-agent-typescript/src/index.ts
  - Call AbilityManager.loadAll() after broker connection
  - Subscribe to all relevant events (deploy.progress, file-manager.upload-progress, etc.)
  - Handle ability loading failures gracefully (log warning, continue with reduced functionality)
  - Purpose: Initialize all 7 abilities on agent startup
  - _Leverage: src/abilities/ability-manager.ts_
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 9.1_
  - _Prompt: Role: Systems Integration Developer with expertise in startup orchestration | Task: Update agent initialization following requirements 3.1-3.5 and 9.1, loading all 7 abilities via AbilityManager and subscribing to progress events with graceful degradation | Restrictions: Must not block startup on ability failures, log all loading attempts, maintain agent functionality if abilities unavailable | Success: All abilities loaded on startup, event subscriptions active, failures logged but don't crash agent, reduced functionality works_

- [ ] 4.2. Create integration test with all 7 abilities
  - File: C:/p4/Personal/SD/template-agent-typescript/test/e2e/all-abilities-integration.e2e.test.ts
  - Start broker, launch all 7 abilities, launch agent
  - Test concurrent tool invocations across different abilities
  - Measure broker invocation overhead (&lt;100ms requirement)
  - Test failure scenarios (ability crashes, network failures)
  - Verify event delivery for all abilities
  - Purpose: Validate complete system integration
  - _Leverage: Vitest test framework_
  - _Requirements: 11.6 (Integration test, failure scenarios, performance tests, concurrent tests)_
  - _Prompt: Role: Senior QA Engineer with expertise in system integration testing | Task: Create comprehensive integration test following requirement 11.6, launching all 7 abilities simultaneously, testing concurrent operations, measuring performance, and verifying failure handling | Restrictions: Must measure and assert broker overhead &lt;100ms, test ability crashes without hanging, clean up all 7 processes reliably | Success: All 7 abilities work together, concurrent operations succeed, performance meets requirements, failure scenarios handled correctly_

- [ ] 4.3. Create agent.json manifests for all abilities
  - Files:
    - C:/p4/Personal/SD/kadi/file-management-ability/agent.json
    - C:/p4/Personal/SD/kadi/local-remote-file-manager-ability/agent.json
    - C:/p4/Personal/SD/kadi/cloud-file-manager-ability/agent.json
    - C:/p4/Personal/SD/kadi/deploy-ability/agent.json
    - C:/p4/Personal/SD/kadi/kadi-tunnel-ability/agent.json
    - C:/p4/Personal/SD/kadi/container-registry-ability/agent.json
    - C:/p4/Personal/SD/kadi/arcadedb-ability/agent.json
  - Document all tools with descriptions, input schemas, output schemas
  - Include version, networks, capabilities
  - Purpose: Provide ability discovery and documentation
  - _Leverage: MCP protocol specification for schema format_
  - _Requirements: 10.1_
  - _Prompt: Role: Technical Writer with expertise in API documentation | Task: Create agent.json manifests for all 7 abilities following requirement 10.1, documenting all tools with complete schemas, descriptions, and metadata | Restrictions: Must follow MCP schema format exactly, include all tool parameters, provide clear descriptions | Success: All 7 manifests created, schemas validate against MCP spec, documentation is clear and complete_

- [ ] 4.4. Add JSDoc/TypeDoc comments to all ability tools
  - Files: All ability source files in C:/p4/Personal/SD/kadi/*/src/
  - Add comprehensive JSDoc comments to all tool handlers
  - Document parameters, return values, error conditions
  - Include usage examples
  - Purpose: Provide inline developer documentation
  - _Leverage: TypeDoc documentation generator_
  - _Requirements: 10.2_
  - _Prompt: Role: Technical Writer with expertise in code documentation | Task: Add comprehensive JSDoc/TypeDoc comments to all ability tools following requirement 10.2, documenting parameters, returns, errors, and usage examples | Restrictions: Must follow JSDoc standards, include @param and @returns tags, provide realistic examples | Success: All tools documented with JSDoc, TypeDoc generates clean docs, examples are accurate and helpful_

- [ ] 4.5. Create README for each ability
  - Files:
    - C:/p4/Personal/SD/kadi/file-management-ability/README.md
    - C:/p4/Personal/SD/kadi/local-remote-file-manager-ability/README.md
    - C:/p4/Personal/SD/kadi/cloud-file-manager-ability/README.md
    - C:/p4/Personal/SD/kadi/deploy-ability/README.md
    - C:/p4/Personal/SD/kadi/kadi-tunnel-ability/README.md
    - C:/p4/Personal/SD/kadi/container-registry-ability/README.md
    - C:/p4/Personal/SD/kadi/arcadedb-ability/README.md
  - Include setup instructions, configuration, usage examples
  - Document environment variables and dependencies
  - Purpose: Comprehensive ability documentation
  - _Leverage: Existing project README patterns_
  - _Requirements: 10.2 (Documentation), Usability NFR_
  - _Prompt: Role: Technical Writer with expertise in developer documentation | Task: Create comprehensive README for each ability following requirement 10.2 and Usability NFR, documenting setup, configuration, and usage with examples | Restrictions: Must include all environment variables, document all dependencies, provide working examples | Success: All 7 READMEs created, setup instructions complete, examples work correctly, configuration documented_

- [ ] 4.6. Update template-agent README with ability integration docs
  - File: C:/p4/Personal/SD/template-agent-typescript/README.md
  - Document how to start abilities before running agent
  - Explain AbilityManager usage and event subscriptions
  - List all integrated abilities and their purposes
  - Purpose: Developer onboarding for ability integration
  - _Leverage: Existing README structure_
  - _Requirements: Usability NFR (Documentation)_
  - _Prompt: Role: Technical Writer specializing in developer onboarding | Task: Update template-agent README with ability integration documentation following Usability NFR, explaining ability startup, usage patterns, and event handling | Restrictions: Must maintain existing README structure, provide complete startup instructions, include troubleshooting section | Success: README updated with ability docs, startup process clear, examples provided, troubleshooting included_
