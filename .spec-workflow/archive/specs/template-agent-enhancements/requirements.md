# Requirements Document

## Introduction

This document defines the requirements for enhancing the `template-agent-typescript` with four major capability upgrades:

1. **Multi-LLM Provider Support**: Add support for KADI Model Manager Gateway API alongside existing Anthropic Claude API, enabling the agent to use multiple LLM providers (OpenAI GPT-5, GPT-4, local Ollama models, etc.)

2. **Self-Hosted Model Manager Deployment**: Deploy the KADI Model Manager Gateway to Digital Ocean infrastructure with secure API key generation, replacing the current shared development key

3. **Persistent Memory System**: Implement a multi-layered memory architecture (private/public, short-term/long-term) using ArcadeDB for conversation context, user preferences, and knowledge retention

4. **Comprehensive File Management**: Integrate four file management abilities for local/remote file operations, cloud storage, container distribution, and SSH/SCP deployment

These enhancements transform the template agent from a basic Slack/Discord bot into a production-ready autonomous agent with persistent memory, multi-model reasoning capabilities, and comprehensive file management for DevOps workflows.

## Alignment with Product Vision

This enhancement aligns with the KADI ecosystem's vision of creating autonomous, self-sufficient agents that can:

- **Multi-Provider Intelligence**: Leverage multiple LLM providers for cost optimization, capability matching, and redundancy
- **Self-Hosted Infrastructure**: Deploy and manage their own backend services autonomously on decentralized or traditional cloud infrastructure
- **Persistent Context**: Maintain conversation history and learned knowledge across sessions and restarts
- **DevOps Autonomy**: Manage files, containers, and deployments without human intervention

By implementing these capabilities, template-agent-typescript becomes a reference implementation demonstrating the full potential of the KADI agent framework.

## Requirements

### Requirement 1: Multi-LLM Provider Configuration

**User Story:** As an agent developer, I want to configure multiple LLM providers (Anthropic Claude + Model Manager Gateway) with priority/fallback logic, so that my agent can intelligently route requests based on cost, capability, and availability.

#### Acceptance Criteria

1. WHEN agent initializes THEN system SHALL load both Anthropic API key and Model Manager Gateway configuration (base URL + API key) from environment variables
2. WHEN environment contains `MODEL_MANAGER_BASE_URL` and `MODEL_MANAGER_API_KEY` THEN system SHALL register Model Manager as available provider
3. WHEN environment contains `ANTHROPIC_API_KEY` THEN system SHALL register Anthropic as available provider
4. IF both providers are configured THEN system SHALL support provider selection via configuration priority
5. WHEN agent makes LLM request THEN system SHALL route to configured provider based on model name prefix (e.g., "gpt-4o" → Model Manager, "claude-3" → Anthropic)

### Requirement 2: Model Manager Gateway Integration

**User Story:** As an agent developer, I want to make OpenAI-compatible requests through the Model Manager Gateway, so that I can access GPT-5, GPT-4, GPT-3.5, and local Ollama models with the same interface.

#### Acceptance Criteria

1. WHEN Model Manager provider is active THEN agent SHALL construct OpenAI-compatible API requests with proper authentication headers
2. WHEN making chat completion request THEN system SHALL use endpoint `{baseURL}/v1/chat/completions` with Bearer token authentication
3. WHEN response received THEN system SHALL parse OpenAI-compatible response format (choices, message, content)
4. WHEN API request fails THEN system SHALL log error with provider name, model, and error details
5. IF Model Manager returns 401 Unauthorized THEN system SHALL throw authentication error with helpful message
6. WHEN streaming enabled THEN system SHALL support SSE streaming responses from Model Manager

### Requirement 3: Provider Fallback and Health Checks

**User Story:** As a production agent operator, I want automatic fallback between providers when one fails, so that my agent remains operational despite provider outages.

#### Acceptance Criteria

1. WHEN primary provider request fails THEN system SHALL attempt fallback to secondary provider (if configured)
2. WHEN provider responds with 429 rate limit THEN system SHALL implement exponential backoff retry (up to 3 attempts)
3. WHEN provider responds with 5xx error THEN system SHALL mark provider as unhealthy for 60 seconds
4. IF all providers unhealthy THEN system SHALL throw aggregated error listing all provider failures
5. WHEN provider recovers THEN system SHALL automatically restore it to healthy status after successful request

### Requirement 4: Model Manager Gateway Deployment

**User Story:** As an agent operator, I want to deploy the Model Manager Gateway to my Digital Ocean droplet with automated setup, so that I control my own LLM infrastructure.

#### Acceptance Criteria

1. WHEN deployment initiated THEN system SHALL use deploy-ability library to provision Model Manager on Digital Ocean
2. WHEN deployment configuration created THEN system SHALL specify minimum 1 CPU, 2Gi memory, 5Gi persistent storage
3. WHEN deployment succeeds THEN system SHALL expose gateway on public HTTPS endpoint with valid SSL certificate
4. WHEN gateway deployed THEN system SHALL automatically call admin API to create user API key for agent
5. IF API key generation succeeds THEN system SHALL securely store key using kadi-secret vault
6. WHEN deployment complete THEN system SHALL update agent environment variables with new gateway URL and API key
7. IF deployment fails THEN system SHALL provide detailed error message with troubleshooting steps

### Requirement 5: OpenAI Model Registration

**User Story:** As an agent operator, I want to automatically register OpenAI GPT models (GPT-5, GPT-4, GPT-3.5) in my deployed gateway, so that I can immediately start using them without manual configuration.

#### Acceptance Criteria

1. WHEN gateway deployment completes THEN system SHALL execute model registration for all target OpenAI models
2. WHEN registering OpenAI model THEN system SHALL call `POST /admin/models` with model name, backend ID, base URL, and OpenAI API key
3. WHEN model registration succeeds THEN system SHALL verify model available via `GET /admin/models`
4. IF OpenAI API key missing THEN system SHALL skip OpenAI registration and log warning
5. WHEN all models registered THEN system SHALL log summary of available models

### Requirement 6: Multi-Layered Memory Architecture

**User Story:** As an agent user, I want my agent to remember our past conversations and preferences across sessions, so that I don't have to repeat context or re-teach the agent.

#### Acceptance Criteria

1. WHEN agent starts THEN system SHALL initialize ArcadeDB connection for memory storage
2. WHEN user message received THEN system SHALL store message in short-term memory (conversation context)
3. WHEN conversation exceeds 20 messages THEN system SHALL summarize older messages and move to long-term memory
4. WHEN agent learns user preference THEN system SHALL store in private memory associated with user ID
5. WHEN agent learns general knowledge THEN system SHALL store in public memory accessible to all users
6. WHEN generating response THEN system SHALL retrieve relevant memories from all layers and include in context
7. IF memory retrieval fails THEN system SHALL proceed with conversation without crashing

### Requirement 7: Memory Query and Retrieval

**User Story:** As an agent, I want to query my memory for relevant information before responding, so that I can provide contextually aware answers based on past interactions.

#### Acceptance Criteria

1. WHEN user asks question THEN system SHALL query short-term memory for recent conversation context (last 10 messages)
2. WHEN user references past conversation THEN system SHALL query long-term memory using semantic search (top 5 results)
3. WHEN user identity known THEN system SHALL query private memory for user-specific preferences
4. WHEN general knowledge needed THEN system SHALL query public memory for learned facts
5. WHEN memories retrieved THEN system SHALL rank by relevance score and include top 3 in LLM context
6. IF no relevant memories found THEN system SHALL proceed without memory context

### Requirement 8: Memory Management and Cleanup

**User Story:** As an agent operator, I want automatic memory cleanup to prevent unbounded storage growth, so that my agent remains performant over long-term operation.

#### Acceptance Criteria

1. WHEN short-term memory exceeds 50 messages THEN system SHALL archive oldest messages to long-term storage
2. WHEN long-term memory exceeds 1000 entries THEN system SHALL remove lowest-relevance entries (based on access frequency)
3. WHEN agent receives explicit forget command THEN system SHALL delete specified memories from all layers
4. WHEN agent restarts THEN system SHALL restore memory state from ArcadeDB without data loss
5. WHEN memory operation fails THEN system SHALL log error but continue operation

### Requirement 9: Local-Remote File Manager Integration

**User Story:** As an agent, I want to serve local files via HTTP/S3 API with public tunneling, so that I can share build artifacts, logs, or data files with external systems.

#### Acceptance Criteria

1. WHEN agent initializes THEN system SHALL register local-remote-file-manager-ability as available capability
2. WHEN file sharing requested THEN system SHALL start HTTP file server on specified local directory
3. WHEN server started THEN system SHALL create public tunnel URL (via ngrok/serveo) for external access
4. WHEN file requested via tunnel THEN system SHALL serve file with proper content-type headers
5. WHEN sharing session ends THEN system SHALL cleanly shutdown server and close tunnel
6. IF tunnel fails THEN system SHALL provide local-only HTTP URL as fallback

### Requirement 10: Cloud File Manager Integration

**User Story:** As an agent, I want to upload/download files from cloud storage (Dropbox, Google Drive, Box), so that I can backup data or retrieve user-provided files.

#### Acceptance Criteria

1. WHEN agent initializes THEN system SHALL register cloud-file-manager-ability with OAuth credentials for configured providers
2. WHEN cloud upload requested THEN system SHALL authenticate to provider and upload file to specified path
3. WHEN cloud download requested THEN system SHALL authenticate to provider and download file to local path
4. WHEN cloud list requested THEN system SHALL return file listing with names, sizes, and modification dates
5. IF OAuth token expired THEN system SHALL automatically refresh token and retry operation
6. WHEN cloud operation fails THEN system SHALL provide user-friendly error message with provider name

### Requirement 11: Container Registry Integration

**User Story:** As an agent, I want to create temporary Docker registries with public access, so that I can distribute container images to deployment targets without cloud registry dependencies.

#### Acceptance Criteria

1. WHEN agent initializes THEN system SHALL register container-registry-ability as available capability
2. WHEN container sharing requested THEN system SHALL export specified Docker/Podman container to OCI format
3. WHEN export complete THEN system SHALL start Docker Registry v2 API server on local port
4. WHEN registry started THEN system SHALL create public tunnel URL for external access
5. WHEN container pull requested THEN system SHALL serve container layers via Registry API
6. WHEN sharing session ends THEN system SHALL cleanup temporary files and close registry
7. IF container export fails THEN system SHALL provide detailed error with troubleshooting steps

### Requirement 12: SSH/SCP File Management Integration

**User Story:** As an agent, I want to deploy files to remote servers via SSH/SCP, so that I can upload configuration files, build artifacts, or deployment packages.

#### Acceptance Criteria

1. WHEN agent initializes THEN system SHALL register file-management-ability with SSH credentials from secure vault
2. WHEN remote upload requested THEN system SHALL establish SSH connection and upload file via SCP
3. WHEN remote download requested THEN system SHALL establish SSH connection and download file via SCP
4. WHEN remote command requested THEN system SHALL execute command via SSH and return output
5. IF SSH authentication fails THEN system SHALL throw error with connection details for debugging
6. WHEN SSH operation completes THEN system SHALL close connection and cleanup resources

## Non-Functional Requirements

### Code Architecture and Modularity

- **Single Responsibility Principle**: Each provider adapter (AnthropicProvider, ModelManagerProvider) handles only API communication for its respective service
- **Modular Design**: Memory system, file abilities, and LLM providers are independent modules with clean interfaces
- **Dependency Management**: File abilities use KADI MCP protocol for loose coupling, not direct imports
- **Clear Interfaces**: Define Provider interface for LLM backends, Memory interface for storage operations
- **Configuration Management**: All provider credentials and URLs stored in environment variables, never hardcoded
- **Error Boundaries**: Each ability wrapped in try-catch to prevent cascading failures

### Performance

- **Memory Query Performance**: Memory queries must return results within 500ms for real-time conversation flow
- **Provider Response Time**: Primary provider failover must occur within 5 seconds of timeout
- **File Operations**: File uploads/downloads must support files up to 500MB with progress tracking
- **Concurrent Operations**: System must handle 10 concurrent conversations without memory contention

### Security

- **API Key Storage**: All API keys stored in kadi-secret encrypted vault, never in plaintext environment files
- **Tunnel Security**: File server tunnels must use HTTPS with automatic certificate management
- **SSH Credentials**: SSH private keys stored in encrypted vault with restricted file permissions
- **Memory Isolation**: Private memories must be strictly isolated by user ID with authorization checks
- **OAuth Tokens**: Cloud storage OAuth tokens must be encrypted at rest and refreshed securely

### Reliability

- **Provider Redundancy**: If primary LLM provider fails, system must automatically failover to secondary within 5 seconds
- **Memory Persistence**: All memory writes must be confirmed persisted to ArcadeDB before returning success
- **Graceful Degradation**: If memory system fails, agent must continue operating without conversation history
- **Connection Recovery**: File abilities must automatically reconnect after network interruptions with exponential backoff
- **Error Recovery**: Failed file operations must be retryable without corrupting state

### Usability

- **Clear Error Messages**: All failures must provide actionable error messages with troubleshooting guidance
- **Setup Documentation**: README must include step-by-step setup for each provider and ability with examples
- **Configuration Validation**: Agent must validate all configuration at startup and report missing/invalid settings
- **Logging**: All provider requests, memory operations, and file transfers must be logged at INFO level
- **Status Reporting**: Agent must provide status command showing provider health, memory stats, and ability availability
