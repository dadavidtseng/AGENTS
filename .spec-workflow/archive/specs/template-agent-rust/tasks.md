# Tasks Document: Template Agent Rust

## Phase 1: Project Foundation & Common Utilities

- [ ] 1.1. Initialize Cargo workspace and crate structure
  - **Files**:
    - `Cargo.toml` (workspace manifest)
    - `crates/*/Cargo.toml` (crate manifests)
    - `.gitignore`
    - `README.md`
  - **Description**: Set up Cargo workspace with all crates (template-agent, providers, memory, bot, file-management, deployment, common)
  - **Purpose**: Establish project foundation with proper Rust workspace organization
  - **_Leverage**: None (greenfield Rust project)
  - **_Requirements**: Non-Functional Requirements (Build & Development)
  - **_Prompt**:
    ```
    Implement the task for spec template-agent-rust, first run spec-workflow-guide to get the workflow guide then implement the task:

    Role: Rust Build Engineer specializing in Cargo workspace management and project structure

    Task: Initialize Cargo workspace for template-agent-rust following design.md specifications. Create workspace-level Cargo.toml with all member crates (template-agent, providers, memory, bot, file-management, deployment, common). Configure shared dependencies in workspace.dependencies section. Set up proper .gitignore for Rust projects. Create README.md with quick start instructions.

    Restrictions:
    - Do not include any code implementation yet (just structure)
    - Ensure workspace members are correctly listed
    - Use workspace inheritance for common dependencies (tokio, serde, etc.)
    - Follow Rust 2021 edition conventions

    _Leverage: design.md Project Structure section

    _Requirements: Non-Functional Requirements - Build & Development

    Success:
    - `cargo check --workspace` runs without errors
    - All crate manifests properly inherit workspace dependencies
    - Workspace builds successfully
    - README provides clear quick start instructions

    After completing this task:
    1. Edit tasks.md: Change `- [ ] 1.1` to `- [-] 1.1` to mark as in-progress
    2. Implement the task
    3. Test that `cargo check --workspace` succeeds
    4. Use log-implementation tool to record: crate structure created, workspace configuration, files created
    5. Edit tasks.md: Change `- [-] 1.1` to `- [x] 1.1` to mark as completed
    ```

- [ ] 1.2. Implement common Result and error types
  - **Files**:
    - `crates/common/src/lib.rs`
    - `crates/common/src/result.rs`
    - `crates/common/src/error.rs`
  - **Description**: Create Result type aliases and base error types using thiserror
  - **Purpose**: Establish error handling patterns for entire workspace
  - **_Leverage**: TypeScript Result&lt;T, E&gt; pattern from template-agent-typescript
  - **_Requirements**: Requirement 8 (Error Handling & Observability)
  - **_Prompt**:
    ```
    Implement the task for spec template-agent-rust, first run spec-workflow-guide to get the workflow guide then implement the task:

    Role: Rust Systems Programmer specializing in error handling and type design

    Task: Implement comprehensive Result and error types in crates/common following design.md error handling specifications. Create Result&lt;T, E&gt; type alias. Define base error enums for different domains (ProviderError, MemoryError, FileError, BotError, DeployError) using thiserror crate. Implement Display and Error traits properly.

    Restrictions:
    - Must use thiserror crate for error derivation
    - Error messages must not expose sensitive information
    - Each error type should have clear variants with meaningful messages
    - Do not implement conversion traits between errors yet

    _Leverage: design.md Error Handling section, TypeScript error patterns from template-agent-typescript

    _Requirements: Requirement 8.1 (Error handling with Result&lt;T, E&gt; pattern)

    Success:
    - All error types compile without warnings
    - Error messages are clear and actionable
    - thiserror derives work correctly
    - rustdoc documentation is comprehensive

    After completing this task:
    1. Mark task 1.2 as in-progress `- [-]` in tasks.md
    2. Implement error types with full documentation
    3. Test error formatting with example usage
    4. Log implementation: error types created, thiserror integration, example error messages
    5. Mark task 1.2 as completed `- [x]` in tasks.md
    ```

- [ ] 1.3. Implement configuration loading and validation
  - **Files**:
    - `crates/template-agent/src/config.rs`
    - `.env.template`
  - **Description**: Environment variable loading with dotenv, validation, and defaults
  - **Purpose**: Centralized configuration management with fail-fast validation
  - **_Leverage**: TypeScript configuration model from template-agent-typescript
  - **_Requirements**: Requirement 7 (Configuration & Environment Management)
  - **_Prompt**:
    ```
    Implement the task for spec template-agent-rust, first run spec-workflow-guide to get the workflow guide then implement the task:

    Role: Rust DevOps Engineer specializing in configuration management

    Task: Implement Config struct in crates/template-agent/src/config.rs following design.md configuration specifications. Load environment variables using dotenv crate. Implement validation for required variables (ANTHROPIC_API_KEY, MEMORY_DATA_PATH, etc.). Provide sensible defaults for optional variables. Create .env.template with documented variables.

    Restrictions:
    - Must fail fast on missing required variables with clear error messages
    - Use Option&lt;T&gt; for optional configuration
    - Parse and validate types (URLs, paths, booleans)
    - Never expose secrets in error messages or logs

    _Leverage: design.md Configuration Management section, .env structure from TypeScript template

    _Requirements: Requirement 7 (Configuration & Environment Management)

    Success:
    - Config::from_env() loads and validates all variables
    - Missing required variables produce clear errors
    - .env.template documents all configuration options
    - Type parsing (PathBuf, Url) works correctly

    After completing this task:
    1. Mark task 1.3 as in-progress in tasks.md
    2. Implement Config with comprehensive validation
    3. Test with valid and invalid .env files
    4. Log implementation: Config struct, validation logic, .env.template created
    5. Mark task 1.3 as completed in tasks.md
    ```

## Phase 2: Provider System

- [ ] 2.1. Define LLMProvider trait and provider types
  - **Files**:
    - `crates/providers/src/lib.rs`
    - `crates/providers/src/types.rs`
  - **Description**: Define async trait for LLM providers with Message, ChatOptions, and error types
  - **Purpose**: Establish provider abstraction layer
  - **_Leverage**: TypeScript LLMProvider interface patterns
  - **_Requirements**: Requirement 1 (Multi-LLM Provider System)
  - **_Prompt**:
    ```
    Implement the task for spec template-agent-rust, first run spec-workflow-guide to get the workflow guide then implement the task:

    Role: Rust API Designer specializing in trait design and async programming

    Task: Define LLMProvider trait in crates/providers/src/types.rs following design.md Component 1 specifications. Use async_trait for async methods. Define Message, ChatOptions, and ProviderError types. Implement Send + Sync bounds for thread safety.

    Restrictions:
    - Must use async_trait crate for async trait methods
    - Trait must be object-safe for dynamic dispatch
    - Define stream_chat return type using Pin&lt;Box&lt;dyn Stream&gt;&gt;
    - Follow Rust naming conventions (snake_case for methods)

    _Leverage: design.md Component 1 interface, TypeScript provider types

    _Requirements: Requirement 1.1, 1.6

    Success:
    - LLMProvider trait compiles with async_trait
    - Message and ChatOptions serialize/deserialize correctly
    - Trait is object-safe and can be used with Box&lt;dyn LLMProvider&gt;
    - Comprehensive rustdoc documentation

    After completing this task:
    1. Mark task 2.1 as in-progress in tasks.md
    2. Implement trait with full type definitions
    3. Write example implementation to verify trait design
    4. Log implementation: LLMProvider trait, Message/ChatOptions types
    5. Mark task 2.1 as completed in tasks.md
    ```

- [ ] 2.2. Implement AnthropicProvider
  - **Files**:
    - `crates/providers/src/anthropic.rs`
  - **Description**: Anthropic Claude API client with streaming support
  - **Purpose**: Provide Claude integration via Anthropic API
  - **_Leverage**: TypeScript AnthropicProvider implementation patterns
  - **_Requirements**: Requirement 1.1, 1.7
  - **_Prompt**:
    ```
    Implement the task for spec template-agent-rust, first run spec-workflow-guide to get the workflow guide then implement the task:

    Role: Rust API Integration Engineer specializing in HTTP clients and streaming

    Task: Implement AnthropicProvider in crates/providers/src/anthropic.rs following design.md. Use reqwest for HTTP client. Implement chat and stream_chat methods. Support claude-3-5-sonnet, claude-3-opus, claude-3-sonnet, claude-3-haiku models. Parse API responses and map errors to ProviderError variants.

    Restrictions:
    - Must use reqwest with rustls-tls (no OpenSSL)
    - Implement proper request/response serialization with serde
    - Stream responses must use futures::Stream
    - Handle rate limiting (429) and authentication errors properly

    _Leverage: design.md Component 1, TypeScript AnthropicProvider patterns, Anthropic API docs

    _Requirements: Requirement 1.1, 1.6, 1.7

    Success:
    - chat() method returns successful responses from Anthropic API
    - stream_chat() properly streams response chunks
    - Error handling maps HTTP errors to ProviderError correctly
    - Health check validates API key

    After completing this task:
    1. Mark task 2.2 as in-progress in tasks.md
    2. Implement provider with streaming support
    3. Test with real Anthropic API (use test key if available)
    4. Log implementation: AnthropicProvider struct, HTTP client, streaming, error mapping
    5. Mark task 2.2 as completed in tasks.md
    ```

- [ ] 2.3. Implement ModelManagerProvider
  - **Files**:
    - `crates/providers/src/model_manager.rs`
  - **Description**: OpenAI-compatible Model Manager Gateway client
  - **Purpose**: Provide GPT model integration via Model Manager
  - **_Leverage**: TypeScript ModelManagerProvider patterns
  - **_Requirements**: Requirement 1.1
  - **_Prompt**:
    ```
    Implement the task for spec template-agent-rust, first run spec-workflow-guide to get the workflow guide then implement the task:

    Role: Rust API Integration Engineer specializing in OpenAI-compatible APIs

    Task: Implement ModelManagerProvider in crates/providers/src/model_manager.rs following OpenAI Chat Completions API format. Support gpt-4o, gpt-4o-mini, gpt-4-turbo models. Use reqwest for HTTP client with configurable base URL.

    Restrictions:
    - Follow OpenAI API format for requests/responses
    - Support streaming responses using Server-Sent Events (SSE)
    - Handle authentication with Bearer token
    - Map OpenAI error responses to ProviderError

    _Leverage: design.md Component 1, TypeScript ModelManagerProvider, OpenAI API docs

    _Requirements: Requirement 1.1, 1.6

    Success:
    - chat() works with Model Manager Gateway
    - Streaming responses work correctly with SSE
    - Authentication and error handling are robust
    - Supports all GPT model variants

    After completing this task:
    1. Mark task 2.3 as in-progress in tasks.md
    2. Implement provider with OpenAI compatibility
    3. Test with Model Manager Gateway if available
    4. Log implementation: ModelManagerProvider, SSE streaming, OpenAI format
    5. Mark task 2.3 as completed in tasks.md
    ```

- [ ] 2.4. Implement ProviderManager with health monitoring
  - **Files**:
    - `crates/providers/src/manager.rs`
  - **Description**: Provider orchestration with routing, fallback, retry, circuit breaker
  - **Purpose**: Intelligent provider selection and resilience
  - **_Leverage**: TypeScript ProviderManager patterns (circuit breaker, retry, health checks)
  - **_Requirements**: Requirement 1.1, 1.2, 1.3, 1.4
  - **_Prompt**:
    ```
    Implement the task for spec template-agent-rust, first run spec-workflow-guide to get the workflow guide then implement the task:

    Role: Rust Distributed Systems Engineer specializing in resilience patterns

    Task: Implement ProviderManager in crates/providers/src/manager.rs following design.md Component 1. Implement model-based routing (claude→Anthropic, gpt→Model Manager). Add automatic fallback on provider failure. Implement retry with exponential backoff. Add circuit breaker pattern. Use Arc&lt;RwLock&lt;HashMap&gt;&gt; for health status. Spawn Tokio task for periodic health checks.

    Restrictions:
    - Must use Arc&lt;RwLock&lt;T&gt;&gt; for concurrent access to health status
    - Circuit breaker should open after 3 consecutive failures
    - Retry should use exponential backoff (delay * 2^attempt)
    - Health check task must be cancellable

    _Leverage: design.md Component 1, TypeScript ProviderManager (retry, circuit breaker, health monitoring)

    _Requirements: Requirement 1.1-1.4

    Success:
    - Model routing works correctly (claude→Anthropic, gpt→Model Manager)
    - Fallback activates when primary provider fails
    - Circuit breaker prevents cascading failures
    - Health checks run periodically and update status

    After completing this task:
    1. Mark task 2.4 as in-progress in tasks.md
    2. Implement ProviderManager with full resilience features
    3. Write unit tests for routing, fallback, circuit breaker
    4. Log implementation: ProviderManager, routing logic, resilience patterns, health checks
    5. Mark task 2.4 as completed in tasks.md
    ```

## Phase 3: Memory System

- [ ] 3.1. Implement FileStorageAdapter for JSON file operations
  - **Files**:
    - `crates/memory/src/lib.rs`
    - `crates/memory/src/types.rs`
    - `crates/memory/src/file_storage.rs`
  - **Description**: Async file I/O for conversation JSON files using tokio::fs
  - **Purpose**: Short-term memory storage in JSON files
  - **_Leverage**: TypeScript FileStorageAdapter patterns
  - **_Requirements**: Requirement 2.1, 2.2
  - **_Prompt**:
    ```
    Implement the task for spec template-agent-rust, first run spec-workflow-guide to get the workflow guide then implement the task:

    Role: Rust File I/O Engineer specializing in async file operations

    Task: Implement FileStorageAdapter in crates/memory/src/file_storage.rs following design.md Component 2. Use tokio::fs for async file operations. Store conversations as JSON files (user_id/channel_id.json). Implement read_conversation and write_conversation methods. Use serde_json for serialization.

    Restrictions:
    - Must use tokio::fs for async file I/O
    - Handle file permissions and missing directories gracefully
    - Use serde_json for efficient JSON serialization
    - Return descriptive errors on file operations failures

    _Leverage: design.md Component 2, TypeScript FileStorageAdapter

    _Requirements: Requirement 2.1, 2.2, 2.7

    Success:
    - Conversations are stored as valid JSON files
    - Async file operations don't block runtime
    - Missing directories are created automatically
    - Error handling provides clear file operation context

    After completing this task:
    1. Mark task 3.1 as in-progress in tasks.md
    2. Implement FileStorageAdapter with comprehensive error handling
    3. Write unit tests with tempdir
    4. Log implementation: FileStorageAdapter, JSON serialization, error handling
    5. Mark task 3.1 as completed in tasks.md
    ```

- [ ] 3.2. Implement DatabaseAdapter for ArcadeDB
  - **Files**:
    - `crates/memory/src/database.rs`
  - **Description**: HTTP client for ArcadeDB long-term storage
  - **Purpose**: Long-term memory persistence and search
  - **_Leverage**: TypeScript ArcadeDBAdapter patterns
  - **_Requirements**: Requirement 2.3, 2.5
  - **_Prompt**:
    ```
    Implement the task for spec template-agent-rust, first run spec-workflow-guide to get the workflow guide then implement the task:

    Role: Rust Database Engineer specializing in HTTP-based database clients

    Task: Implement DatabaseAdapter in crates/memory/src/database.rs for ArcadeDB following design.md. Use reqwest for HTTP client. Implement methods: store_summary, search_entries. Support relevance-based search. Handle connection failures gracefully (return None or error).

    Restrictions:
    - Must handle database unavailability gracefully
    - Use reqwest with connection pooling
    - Implement retry logic for transient failures
    - Return clear errors on database operations

    _Leverage: design.md Component 2, TypeScript ArcadeDBAdapter, ArcadeDB HTTP API docs

    _Requirements: Requirement 2.3, 2.5

    Success:
    - store_summary writes to ArcadeDB correctly
    - search_entries returns relevant results
    - Connection failures are handled gracefully
    - Database client reuses connections efficiently

    After completing this task:
    1. Mark task 3.2 as in-progress in tasks.md
    2. Implement DatabaseAdapter with graceful degradation
    3. Test with ArcadeDB instance if available, otherwise mock
    4. Log implementation: DatabaseAdapter, HTTP client, search implementation
    5. Mark task 3.2 as completed in tasks.md
    ```

- [ ] 3.3. Implement MemoryService with automatic archival
  - **Files**:
    - `crates/memory/src/service.rs`
  - **Description**: Hybrid memory orchestration with automatic archival at 20 message threshold
  - **Purpose**: Coordinate short-term and long-term memory with LLM summarization
  - **_Leverage**: TypeScript MemoryService patterns (archival, summarization)
  - **_Requirements**: Requirement 2.1, 2.2, 2.3
  - **_Prompt**:
    ```
    Implement the task for spec template-agent-rust, first run spec-workflow-guide to get the workflow guide then implement the task:

    Role: Rust Systems Architect specializing in storage orchestration

    Task: Implement MemoryService in crates/memory/src/service.rs following design.md Component 2. Coordinate FileStorageAdapter and DatabaseAdapter. Implement automatic archival when conversation exceeds 20 messages. Use ProviderManager to generate LLM summaries before archival. Implement graceful degradation if database unavailable (use AtomicBool flag).

    Restrictions:
    - Use Arc&lt;FileStorageAdapter&gt; and Option&lt;Arc&lt;DatabaseAdapter&gt;&gt;
    - Archival should happen asynchronously in background task
    - Must not block message storage on archival
    - Gracefully handle database unavailability

    _Leverage: design.md Component 2, TypeScript MemoryService (archival, summarization, graceful degradation)

    _Requirements: Requirement 2.1-2.3, 2.6

    Success:
    - store_message writes to files synchronously
    - Archival triggers automatically at 20 message threshold
    - LLM summarization works before archival
    - System continues working if database unavailable

    After completing this task:
    1. Mark task 3.3 as in-progress in tasks.md
    2. Implement MemoryService with background archival task
    3. Write integration test for archival flow
    4. Log implementation: MemoryService, archival logic, graceful degradation
    5. Mark task 3.3 as completed in tasks.md
    ```

- [ ] 3.4. Implement user preferences and knowledge base storage
  - **Files**:
    - `crates/memory/src/service.rs` (extend)
  - **Description**: Store/retrieve user preferences and public knowledge
  - **Purpose**: Persistent user settings and shared knowledge
  - **_Leverage**: TypeScript MemoryService preference patterns
  - **_Requirements**: Requirement 2.6
  - **_Prompt**:
    ```
    Implement the task for spec template-agent-rust, first run spec-workflow-guide to get the workflow guide then implement the task:

    Role: Rust Backend Developer specializing in data persistence

    Task: Extend MemoryService in crates/memory/src/service.rs to add user preference and knowledge base methods. Implement store_preference, get_preference, store_knowledge, get_knowledge. Store preferences in user_id/preferences.json. Store knowledge in public/knowledge.json.

    Restrictions:
    - Use serde_json::Value for flexible value types
    - Ensure thread-safe access to preference files
    - Handle missing preference keys gracefully (return None)
    - Validate JSON structure on read

    _Leverage: design.md Component 2, TypeScript MemoryService preferences

    _Requirements: Requirement 2.6

    Success:
    - Preferences persist across agent restarts
    - Knowledge base supports shared data across users
    - Methods are thread-safe and concurrent-friendly
    - JSON files are valid and readable

    After completing this task:
    1. Mark task 3.4 as in-progress in tasks.md
    2. Implement preference and knowledge methods
    3. Test concurrent access with multiple async tasks
    4. Log implementation: preference storage, knowledge base, JSON handling
    5. Mark task 3.4 as completed in tasks.md
    ```

## Phase 4: Bot Integration & KĀDI Protocol

- [ ] 4.1. Implement KĀDI client Rust bindings (or FFI)
  - **Files**:
    - `crates/bot/src/lib.rs`
    - `crates/bot/src/kadi_client.rs` (FFI wrapper or native implementation)
  - **Description**: Rust client for KĀDI broker WebSocket protocol
  - **Purpose**: Enable KĀDI protocol communication from Rust
  - **_Leverage**: KĀDI protocol specifications, TypeScript KĀDI client patterns
  - **_Requirements**: Requirement 6 (KĀDI Protocol Integration)
  - **_Prompt**:
    ```
    Implement the task for spec template-agent-rust, first run spec-workflow-guide to get the workflow guide then implement the task:

    Role: Rust Protocol Engineer specializing in WebSocket and FFI

    Task: Implement KĀDI client for Rust in crates/bot/src/kadi_client.rs. Options: (1) Native Rust WebSocket client using tokio-tungstenite, or (2) FFI bindings to existing KĀDI TypeScript/JavaScript client using napi-rs. Implement tool registration, event subscription, and tool invocation.

    Restrictions:
    - Must handle WebSocket reconnection with exponential backoff
    - Support async event handling with tokio::spawn
    - Serialize/deserialize KĀDI protocol messages with serde
    - Handle connection drops gracefully

    _Leverage: KĀDI protocol docs, TypeScript KĀDI client patterns, tokio-tungstenite or napi-rs

    _Requirements: Requirement 6 (KĀDI Protocol Integration)

    Success:
    - KĀDI client connects to broker successfully
    - Tool registration works correctly
    - Event subscription receives events
    - Reconnection handles connection drops

    After completing this task:
    1. Mark task 4.1 as in-progress in tasks.md
    2. Implement KĀDI client (native or FFI)
    3. Test connection and basic operations with KĀDI broker
    4. Log implementation: KĀDI client, WebSocket handling, protocol messages
    5. Mark task 4.1 as completed in tasks.md
    ```

- [ ] 4.2. Implement CircuitBreaker for bot resilience
  - **Files**:
    - `crates/bot/src/circuit_breaker.rs`
  - **Description**: Circuit breaker pattern for preventing cascading failures
  - **Purpose**: Bot resilience and failure isolation
  - **_Leverage**: TypeScript BaseBot circuit breaker patterns
  - **_Requirements**: Requirement 5.5
  - **_Prompt**:
    ```
    Implement the task for spec template-agent-rust, first run spec-workflow-guide to get the workflow guide then implement the task:

    Role: Rust Reliability Engineer specializing in resilience patterns

    Task: Implement CircuitBreaker in crates/bot/src/circuit_breaker.rs following design.md Component 3. Implement three states: Closed, Open, HalfOpen. Track failure count and last failure time. Open circuit after max_failures (5). Reset after timeout (60s). Provide is_open and record_failure methods.

    Restrictions:
    - Use Arc&lt;RwLock&lt;CircuitBreaker&gt;&gt; for thread-safe access
    - State transitions must be atomic
    - HalfOpen should allow single test request
    - Reset timer should use Instant for accuracy

    _Leverage: design.md Component 3, TypeScript BaseBot circuit breaker

    _Requirements: Requirement 5.5

    Success:
    - Circuit opens after configured failures
    - Circuit resets after timeout
    - Half-open state allows recovery testing
    - Thread-safe for concurrent bot operations

    After completing this task:
    1. Mark task 4.2 as in-progress in tasks.md
    2. Implement CircuitBreaker with state machine
    3. Write unit tests for state transitions
    4. Log implementation: CircuitBreaker, state machine, timing logic
    5. Mark task 4.2 as completed in tasks.md
    ```

- [ ] 4.3. Implement SlackBot with event subscription
  - **Files**:
    - `crates/bot/src/slack.rs`
  - **Description**: Slack bot implementation with @mention event handling
  - **Purpose**: Slack platform integration with conversation memory
  - **_Leverage**: TypeScript SlackBot patterns (event subscription, resilience, memory integration)
  - **_Requirements**: Requirement 5 (Bot Integration)
  - **_Prompt**:
    ```
    Implement the task for spec template-agent-rust, first run spec-workflow-guide to get the workflow guide then implement the task:

    Role: Rust Bot Developer specializing in event-driven systems

    Task: Implement SlackBot in crates/bot/src/slack.rs following design.md Component 3. Subscribe to slack.app_mention.{BOT_USER_ID} events via KĀDI client. On mention: retrieve context from MemoryService, call ProviderManager.chat, store response, reply via KĀDI. Integrate CircuitBreaker for resilience. Support model preference extraction from [model-name] syntax.

    Restrictions:
    - Use tokio::spawn for event handler tasks
    - Circuit breaker must protect provider calls
    - Must handle async event processing without blocking
    - Implement retry with exponential backoff (3 attempts)

    _Leverage: design.md Component 3, TypeScript SlackBot (event handling, resilience, memory)

    _Requirements: Requirement 5.1-5.6

    Success:
    - Bot subscribes to Slack mention events successfully
    - Events trigger conversation flow (memory → LLM → reply)
    - Circuit breaker prevents cascading failures
    - Model preference extraction works correctly

    After completing this task:
    1. Mark task 4.3 as in-progress in tasks.md
    2. Implement SlackBot with full event handling
    3. Test with real or mocked Slack events
    4. Log implementation: SlackBot, event subscription, resilience integration
    5. Mark task 4.3 as completed in tasks.md
    ```

- [ ] 4.4. Implement DiscordBot with event subscription
  - **Files**:
    - `crates/bot/src/discord.rs`
  - **Description**: Discord bot implementation with @mention event handling
  - **Purpose**: Discord platform integration with conversation memory
  - **_Leverage**: SlackBot implementation patterns (reuse architecture)
  - **_Requirements**: Requirement 5 (Bot Integration)
  - **_Prompt**:
    ```
    Implement the task for spec template-agent-rust, first run spec-workflow-guide to get the workflow guide then implement the task:

    Role: Rust Bot Developer specializing in multi-platform bots

    Task: Implement DiscordBot in crates/bot/src/discord.rs following SlackBot architecture. Subscribe to discord.message.{BOT_USER_ID} events via KĀDI client. Implement similar flow: retrieve context, call provider, store response, reply. Reuse CircuitBreaker and resilience patterns.

    Restrictions:
    - Architecture should mirror SlackBot for consistency
    - Circuit breaker and retry logic identical to SlackBot
    - Handle Discord-specific event format differences
    - Use shared event handling utilities where possible

    _Leverage: SlackBot implementation (crates/bot/src/slack.rs), design.md Component 3

    _Requirements: Requirement 5.1-5.6

    Success:
    - DiscordBot works identically to SlackBot
    - Event handling architecture is consistent
    - All resilience features work correctly
    - Code reuse minimizes duplication

    After completing this task:
    1. Mark task 4.4 as in-progress in tasks.md
    2. Implement DiscordBot reusing SlackBot patterns
    3. Test with real or mocked Discord events
    4. Log implementation: DiscordBot, code reuse from SlackBot
    5. Mark task 4.4 as completed in tasks.md
    ```

## Phase 5: File Management & Deployment

- [ ] 5.1. Implement FileManagerProxy for KĀDI file abilities
  - **Files**:
    - `crates/file-management/src/lib.rs`
    - `crates/file-management/src/proxy.rs`
  - **Description**: Proxy for file management abilities via KĀDI broker
  - **Purpose**: Unified interface to local server, cloud storage, container registry, SSH/SCP
  - **_Leverage**: TypeScript FileManagerProxy patterns
  - **_Requirements**: Requirement 3 (File Management Capabilities)
  - **_Prompt**:
    ```
    Implement the task for spec template-agent-rust, first run spec-workflow-guide to get the workflow guide then implement the task:

    Role: Rust Integration Engineer specializing in RPC and tool invocation

    Task: Implement FileManagerProxy in crates/file-management/src/proxy.rs following design.md Component 4. Use KĀDI client to invoke file management tools: local-remote-file-manager, cloud-file-manager, container-registry, file-management (SSH/SCP). Implement methods: start_file_server, upload_to_cloud, share_container, upload_via_ssh.

    Restrictions:
    - All methods should be async and use KĀDI client tool invocation
    - Serialize requests and deserialize responses with serde
    - Handle tool invocation failures with descriptive errors
    - Return structured types (FileServerInfo, ContainerRegistryInfo)

    _Leverage: design.md Component 4, TypeScript FileManagerProxy, KĀDI tool protocol

    _Requirements: Requirement 3.1-3.6

    Success:
    - start_file_server invokes KĀDI tool correctly
    - upload_to_cloud supports multiple providers
    - share_container returns registry info
    - All methods handle errors gracefully

    After completing this task:
    1. Mark task 5.1 as in-progress in tasks.md
    2. Implement FileManagerProxy with all tool methods
    3. Test with KĀDI broker and mock tool responses
    4. Log implementation: FileManagerProxy, KĀDI tool invocation, response parsing
    5. Mark task 5.1 as completed in tasks.md
    ```

- [ ] 5.2. Implement DeployService for Digital Ocean
  - **Files**:
    - `crates/deployment/src/lib.rs`
    - `crates/deployment/src/service.rs`
  - **Description**: Programmatic deployment to Digital Ocean infrastructure
  - **Purpose**: Autonomous Model Manager Gateway deployment
  - **_Leverage**: TypeScript DeployService patterns
  - **_Requirements**: Requirement 4 (Autonomous Deployment System)
  - **_Prompt**:
    ```
    Implement the task for spec template-agent-rust, first run spec-workflow-guide to get the workflow guide then implement the task:

    Role: Rust DevOps Engineer specializing in cloud automation

    Task: Implement DeployService in crates/deployment/src/service.rs following design.md Component 5. Use reqwest to call Digital Ocean API. Implement deploy_model_manager to create droplets, configure deployment, and return gateway URL and API key. Implement generate_api_key and register_openai_models for gateway configuration.

    Restrictions:
    - Use reqwest with Bearer token authentication
    - Implement proper error handling for API failures
    - Resource cleanup on deployment failure
    - Return DeploymentResult with all necessary information

    _Leverage: design.md Component 5, TypeScript DeployService, Digital Ocean API docs

    _Requirements: Requirement 4.1-4.5

    Success:
    - deploy_model_manager creates droplet successfully
    - Gateway URL and API key are returned correctly
    - Model registration works with gateway admin API
    - Cleanup handles partial deployment failures

    After completing this task:
    1. Mark task 5.2 as in-progress in tasks.md
    2. Implement DeployService with full deployment flow
    3. Test with Digital Ocean API (use test account if available)
    4. Log implementation: DeployService, Digital Ocean API, deployment flow
    5. Mark task 5.2 as completed in tasks.md
    ```

## Phase 6: Main Application & Integration

- [ ] 6.1. Implement main application entry point
  - **Files**:
    - `crates/template-agent/src/main.rs`
  - **Description**: Initialize all components, load configuration, start bots
  - **Purpose**: Orchestrate agent startup and shutdown
  - **_Leverage**: TypeScript main entry point patterns
  - **_Requirements**: All requirements
  - **_Prompt**:
    ```
    Implement the task for spec template-agent-rust, first run spec-workflow-guide to get the workflow guide then implement the task:

    Role: Rust Application Engineer specializing in system integration

    Task: Implement main application in crates/template-agent/src/main.rs. Initialize Tokio runtime. Load Config from environment. Create ProviderManager with configured providers. Initialize MemoryService. Connect to KĀDI broker. Start SlackBot and DiscordBot if enabled. Handle graceful shutdown on SIGINT/SIGTERM.

    Restrictions:
    - Use tokio::main macro for async runtime
    - Implement signal handlers for graceful shutdown
    - Log initialization progress with tracing crate
    - Handle initialization failures gracefully (display clear errors)

    _Leverage: design.md overall architecture, TypeScript main entry point

    _Requirements: All requirements (integration)

    Success:
    - Agent initializes all components successfully
    - Configuration errors display helpful messages
    - Graceful shutdown stops all background tasks
    - Logging provides clear visibility into startup

    After completing this task:
    1. Mark task 6.1 as in-progress in tasks.md
    2. Implement main with full initialization sequence
    3. Test startup and shutdown flows
    4. Log implementation: main entry point, initialization, shutdown handling
    5. Mark task 6.1 as completed in tasks.md
    ```

- [ ] 6.2. Add comprehensive logging and observability
  - **Files**:
    - `crates/template-agent/src/main.rs` (extend)
    - `crates/*/src/lib.rs` (add tracing throughout)
  - **Description**: Structured logging with tracing, log levels, and context
  - **Purpose**: Production observability and debugging
  - **_Leverage**: TypeScript logging patterns
  - **_Requirements**: Requirement 8.2, 8.3
  - **_Prompt**:
    ```
    Implement the task for spec template-agent-rust, first run spec-workflow-guide to get the workflow guide then implement the task:

    Role: Rust Observability Engineer specializing in structured logging

    Task: Integrate tracing crate throughout template-agent-rust. Add tracing_subscriber in main for formatted output. Add tracing::info, debug, warn, error macros throughout code. Use spans for operation context. Configure log level from environment (RUST_LOG). Add tracing to providers, memory, bots.

    Restrictions:
    - Use tracing macros (not println! or eprintln!)
    - Never log sensitive information (API keys, secrets)
    - Use appropriate log levels (debug for verbose, info for important events)
    - Use spans to track operation context

    _Leverage: design.md observability requirements, tracing crate docs

    _Requirements: Requirement 8.2, 8.3

    Success:
    - Structured logs provide clear insight into agent operations
    - Log levels are configurable via RUST_LOG
    - Spans provide operation context
    - No sensitive information in logs

    After completing this task:
    1. Mark task 6.2 as in-progress in tasks.md
    2. Add tracing throughout all crates
    3. Test log output at different levels
    4. Log implementation: tracing integration, log levels, spans
    5. Mark task 6.2 as completed in tasks.md
    ```

## Phase 7: Testing & Documentation

- [ ] 7.1. Write unit tests for provider system
  - **Files**:
    - `crates/providers/src/anthropic.rs` (#[cfg(test)] module)
    - `crates/providers/src/manager.rs` (#[cfg(test)] module)
  - **Description**: Unit tests for provider routing, retry, circuit breaker
  - **Purpose**: Ensure provider system reliability
  - **_Leverage**: TypeScript provider tests
  - **_Requirements**: Testing Strategy
  - **_Prompt**:
    ```
    Implement the task for spec template-agent-rust, first run spec-workflow-guide to get the workflow guide then implement the task:

    Role: Rust Test Engineer specializing in unit testing and mocking

    Task: Write comprehensive unit tests for provider system in crates/providers. Test ProviderManager routing logic (claude→Anthropic, gpt→Model Manager). Test fallback activation. Test circuit breaker state transitions. Test retry exponential backoff. Use mockito or wiremock for HTTP mocking.

    Restrictions:
    - Tests must be isolated (no real API calls in unit tests)
    - Use #[tokio::test] for async tests
    - Mock HTTP responses for provider testing
    - Test both success and failure scenarios

    _Leverage: design.md Testing Strategy, TypeScript provider tests

    _Requirements: Testing Strategy (Unit Testing)

    Success:
    - All unit tests pass consistently
    - Routing logic is thoroughly tested
    - Circuit breaker state machine is validated
    - Mocking prevents external dependencies

    After completing this task:
    1. Mark task 7.1 as in-progress in tasks.md
    2. Write unit tests with high coverage
    3. Run `cargo test --package providers`
    4. Log implementation: unit tests, test coverage, mocking strategy
    5. Mark task 7.1 as completed in tasks.md
    ```

- [ ] 7.2. Write integration tests for memory flow
  - **Files**:
    - `tests/memory_flow.rs`
  - **Description**: Integration test for message storage, archival, and retrieval
  - **Purpose**: Validate memory system end-to-end
  - **_Leverage**: TypeScript memory integration tests
  - **_Requirements**: Testing Strategy
  - **_Prompt**:
    ```
    Implement the task for spec template-agent-rust, first run spec-workflow-guide to get the workflow guide then implement the task:

    Role: Rust Integration Test Engineer

    Task: Write integration test in tests/memory_flow.rs. Test full memory flow: store 21 messages → verify archival triggers → check only 20 remain in file storage → verify summary in database. Use tempdir for isolated file storage. Mock or use test ArcadeDB instance.

    Restrictions:
    - Use tempdir for isolated test environment
    - Clean up test data after test completion
    - Test should be idempotent and repeatable
    - Use #[tokio::test] for async integration test

    _Leverage: design.md Testing Strategy, TypeScript memory integration tests

    _Requirements: Testing Strategy (Integration Testing)

    Success:
    - Integration test validates full memory flow
    - Archival triggers correctly at 20 message threshold
    - Test runs reliably without external dependencies
    - Cleanup leaves no test artifacts

    After completing this task:
    1. Mark task 7.2 as in-progress in tasks.md
    2. Write integration test for memory archival flow
    3. Run `cargo test --test memory_flow`
    4. Log implementation: integration test, archival validation, cleanup
    5. Mark task 7.2 as completed in tasks.md
    ```

- [ ] 7.3. Write README and documentation
  - **Files**:
    - `README.md` (update)
    - `docs/architecture.md`
    - `docs/deployment-guide.md`
  - **Description**: Comprehensive documentation for users and developers
  - **Purpose**: Enable others to use and contribute
  - **_Leverage**: TypeScript template README structure
  - **_Requirements**: Non-Functional (Usability)
  - **_Prompt**:
    ```
    Implement the task for spec template-agent-rust, first run spec-workflow-guide to get the workflow guide then implement the task:

    Role: Technical Writer specializing in developer documentation

    Task: Update README.md with comprehensive documentation following template-agent-typescript structure. Include: Quick Start, Environment Variables, Architecture diagram, Usage examples, Testing guide, Troubleshooting. Create docs/architecture.md with technical deep-dive. Create docs/deployment-guide.md with deployment instructions.

    Restrictions:
    - Use clear, concise language
    - Include code examples for common operations
    - Provide troubleshooting for common errors
    - Link to external resources where appropriate

    _Leverage: template-agent-typescript README structure, design.md

    _Requirements: Non-Functional (Usability, Documentation)

    Success:
    - README provides clear quick start path
    - Examples are copy-pasteable and work
    - Architecture documentation explains system design
    - Deployment guide enables autonomous deployment

    After completing this task:
    1. Mark task 7.3 as in-progress in tasks.md
    2. Write comprehensive documentation
    3. Test all code examples for accuracy
    4. Log implementation: README, architecture.md, deployment-guide.md
    5. Mark task 7.3 as completed in tasks.md
    ```

- [ ] 7.4. Create usage examples
  - **Files**:
    - `examples/basic_chat.rs`
    - `examples/slack_bot.rs`
    - `examples/memory_demo.rs`
  - **Description**: Working examples demonstrating key features
  - **Purpose**: Help developers understand usage patterns
  - **_Leverage**: TypeScript usage patterns
  - **_Requirements**: Non-Functional (Usability)
  - **_Prompt**:
    ```
    Implement the task for spec template-agent-rust, first run spec-workflow-guide to get the workflow guide then implement the task:

    Role: Rust Developer Advocate creating educational content

    Task: Create example programs in examples/ directory. basic_chat.rs: Initialize ProviderManager, send message, print response. slack_bot.rs: Full Slack bot setup and event handling. memory_demo.rs: Demonstrate conversation storage and retrieval.

    Restrictions:
    - Examples must compile with `cargo run --example <name>`
    - Use clear comments explaining each step
    - Load configuration from .env (provide .env.example)
    - Keep examples focused and concise

    _Leverage: design.md architecture, template-agent-typescript usage patterns

    _Requirements: Non-Functional (Usability, Documentation)

    Success:
    - All examples compile and run successfully
    - Examples demonstrate key features clearly
    - Comments explain what each section does
    - Examples help developers get started quickly

    After completing this task:
    1. Mark task 7.4 as in-progress in tasks.md
    2. Create working examples with clear documentation
    3. Test each example thoroughly
    4. Log implementation: example programs, documentation comments
    5. Mark task 7.4 as completed in tasks.md
    ```

## Phase 8: Final Polish & Release

- [ ] 8.1. Configure CI/CD with GitHub Actions
  - **Files**:
    - `.github/workflows/ci.yml`
    - `.github/workflows/release.yml`
  - **Description**: Automated testing, linting, and release builds
  - **Purpose**: Ensure code quality and automate releases
  - **_Leverage**: Rust CI/CD best practices
  - **_Requirements**: Non-Functional (Build & Development)
  - **_Prompt**:
    ```
    Implement the task for spec template-agent-rust, first run spec-workflow-guide to get the workflow guide then implement the task:

    Role: DevOps Engineer specializing in CI/CD automation

    Task: Create GitHub Actions workflows. ci.yml: Run `cargo test`, `cargo clippy`, `cargo fmt --check` on push/PR. Test on Linux, macOS, Windows. release.yml: Build release binaries on tag push, attach to GitHub release. Use cargo-audit for security checks.

    Restrictions:
    - CI must run on all platforms (Linux, macOS, Windows)
    - Use latest stable Rust toolchain
    - Cache cargo dependencies for faster builds
    - Security audit should fail on vulnerabilities

    _Leverage: Rust CI/CD patterns, GitHub Actions Rust templates

    _Requirements: Non-Functional (Build & Development, Security)

    Success:
    - CI runs on all commits and PRs
    - Linting enforces code quality
    - Release workflow creates binaries automatically
    - Security audits catch vulnerabilities

    After completing this task:
    1. Mark task 8.1 as in-progress in tasks.md
    2. Create CI/CD workflows
    3. Test workflows by pushing to GitHub
    4. Log implementation: GitHub Actions workflows, CI checks
    5. Mark task 8.1 as completed in tasks.md
    ```

- [ ] 8.2. Performance optimization and profiling
  - **Files**:
    - `Cargo.toml` (release profile)
    - Various source files (optimization opportunities)
  - **Description**: Optimize performance with profiling and release configuration
  - **Purpose**: Achieve production-ready performance
  - **_Leverage**: Rust optimization techniques
  - **_Requirements**: Non-Functional (Performance)
  - **_Prompt**:
    ```
    Implement the task for spec template-agent-rust, first run spec-workflow-guide to get the workflow guide then implement the task:

    Role: Rust Performance Engineer specializing in optimization

    Task: Configure release profile in Cargo.toml with LTO, codegen-units=1, opt-level=3. Profile with flamegraph or perf. Identify hot paths. Optimize: use Bytes for buffers, connection pooling, batch file operations. Measure before/after with benchmarks.

    Restrictions:
    - Use cargo-flamegraph or similar profiling tool
    - Measure performance improvements quantitatively
    - Don't sacrifice code readability for micro-optimizations
    - Focus on algorithmic improvements over micro-optimizations

    _Leverage: design.md Performance Optimizations

    _Requirements: Non-Functional (Performance)

    Success:
    - Release builds are optimized with LTO
    - Hot paths identified and optimized
    - Performance improvements measured
    - Memory usage is optimal

    After completing this task:
    1. Mark task 8.2 as in-progress in tasks.md
    2. Profile and optimize performance
    3. Measure improvements with benchmarks
    4. Log implementation: optimization techniques, performance gains
    5. Mark task 8.2 as completed in tasks.md
    ```

- [ ] 8.3. Security audit and dependency review
  - **Files**:
    - `Cargo.toml` (dependency versions)
    - Security audit report
  - **Description**: Review dependencies for vulnerabilities and security issues
  - **Purpose**: Ensure production security
  - **_Leverage**: cargo-audit, Rust security advisories
  - **_Requirements**: Non-Functional (Security)
  - **_Prompt**:
    ```
    Implement the task for spec template-agent-rust, first run spec-workflow-guide to get the workflow guide then implement the task:

    Role: Rust Security Engineer

    Task: Run `cargo audit` to check for known vulnerabilities. Review all dependencies for security issues. Update vulnerable dependencies. Document security considerations in docs/security.md. Verify TLS configuration uses rustls. Ensure no secrets in code or logs.

    Restrictions:
    - All dependencies must pass cargo audit
    - Use rustls instead of OpenSSL where possible
    - Never commit secrets or API keys
    - Sanitize error messages to avoid information disclosure

    _Leverage: design.md Security Considerations, cargo-audit

    _Requirements: Non-Functional (Security, Dependency Audits)

    Success:
    - cargo audit passes with no vulnerabilities
    - All dependencies are up-to-date and secure
    - Security documentation is comprehensive
    - No secrets or sensitive data in codebase

    After completing this task:
    1. Mark task 8.3 as in-progress in tasks.md
    2. Run security audit and address issues
    3. Document security practices
    4. Log implementation: security audit results, dependency updates
    5. Mark task 8.3 as completed in tasks.md
    ```

- [ ] 8.4. Final integration testing and validation
  - **Files**:
    - `tests/e2e_flow.rs`
  - **Description**: End-to-end validation of complete agent functionality
  - **Purpose**: Verify all components work together correctly
  - **_Leverage**: TypeScript E2E test patterns
  - **_Requirements**: All requirements
  - **_Prompt**:
    ```
    Implement the task for spec template-agent-rust, first run spec-workflow-guide to get the workflow guide then implement the task:

    Role: QA Engineer specializing in end-to-end testing

    Task: Create comprehensive E2E test in tests/e2e_flow.rs. Test full agent lifecycle: initialization → provider calls → memory storage/retrieval → bot event handling → graceful shutdown. Use real KĀDI broker if available, otherwise mock. Validate all requirements are met.

    Restrictions:
    - Test should simulate real usage patterns
    - Use test containers if external services needed
    - Clean up all test data after completion
    - Test should be reproducible and reliable

    _Leverage: design.md Testing Strategy (E2E), TypeScript E2E patterns

    _Requirements: All requirements (validation)

    Success:
    - E2E test validates complete agent functionality
    - All critical user flows work correctly
    - Test is reliable and reproducible
    - Validation confirms all requirements met

    After completing this task:
    1. Mark task 8.4 as in-progress in tasks.md
    2. Write comprehensive E2E test
    3. Run test multiple times to ensure reliability
    4. Log implementation: E2E test, validation results
    5. Mark task 8.4 as completed in tasks.md
    ```
