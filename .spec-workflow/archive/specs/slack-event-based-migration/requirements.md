# Requirements Document

## Introduction

This specification defines the migration from a polling-based architecture to an event-based architecture for Slack message handling in the KĀDI ecosystem. Currently, `template-agent-typescript` polls `mcp-client-slack` every 5-10 seconds to retrieve Slack mentions, introducing latency and resource waste. The new architecture will leverage KĀDI's existing RabbitMQ-based event system to deliver Slack mentions in real-time via WebSocket push notifications, eliminating polling overhead while maintaining zero changes to `kadi-broker`.

**Value Proposition:**
- **Near-zero latency**: Messages delivered in <100ms instead of 5-10 second polling intervals
- **Resource efficiency**: Agents idle when no messages, eliminating constant CPU/network polling overhead
- **Scalability**: Multiple agents can independently subscribe to their specific Slack app mentions
- **Reliability**: RabbitMQ provides message persistence and guaranteed delivery

## Alignment with Product Vision

This feature aligns with KĀDI's vision of building a robust, scalable multi-agent orchestration platform by:
- **Performance**: Reducing message delivery latency by 50-100x (from 5-10s to <100ms)
- **Efficiency**: Eliminating wasteful polling cycles (99% empty polls in typical usage)
- **Architecture**: Leveraging existing infrastructure (RabbitMQ) without broker modifications
- **Developer Experience**: Simplifying agent code by removing polling logic and replacing with declarative event subscriptions

## Requirements

### Requirement 1: Event Publishing from mcp-client-slack

**User Story:** As a `mcp-client-slack` instance, I want to publish Slack mention events to the KĀDI broker immediately upon receipt, so that subscribed agents receive notifications in real-time without polling.

#### Acceptance Criteria

1. WHEN `mcp-client-slack` receives an `app_mention` event from Slack SDK THEN it SHALL publish an event to KĀDI broker with topic pattern `slack.app_mention.{BOT_USER_ID}` where `{BOT_USER_ID}` is the unique Slack bot user ID (e.g., `U12345ABCD`)

2. WHEN the KĀDI broker connection is unavailable or the publish operation fails THEN `mcp-client-slack` SHALL log the error and drop the message (no persistent queue or retry mechanism required)

3. WHEN publishing the event THEN `mcp-client-slack` SHALL include the following data fields in the event payload:
   - `id`: Event timestamp (string)
   - `user`: Slack user ID who mentioned the bot (string)
   - `text`: Message text with bot mention removed (string)
   - `channel`: Slack channel ID (string)
   - `thread_ts`: Thread timestamp for reply context (string)
   - `ts`: Event timestamp (string)
   - `bot_id`: Bot user ID for routing (string, matches topic suffix)
   - `timestamp`: ISO 8601 publish timestamp (string)

4. WHEN `mcp-client-slack` starts up THEN it SHALL connect to the KĀDI broker as a client using `@kadi.build/core` KadiClient library

5. WHEN `mcp-client-slack` has successfully connected to KĀDI broker THEN it SHALL log "Connected to KĀDI broker for event publishing"

### Requirement 2: Event Subscription in template-agent-typescript

**User Story:** As an agent in `template-agent-typescript`, I want to subscribe to Slack mention events for my specific bot ID, so that I receive real-time notifications without polling and can respond immediately.

#### Acceptance Criteria

1. WHEN `template-agent-typescript` starts up and initializes the SlackBot component THEN it SHALL subscribe to the event topic `slack.app_mention.{BOT_USER_ID}` using the KadiClient's event subscription mechanism, where `{BOT_USER_ID}` matches the bot ID of the Slack app it represents

2. WHEN a Slack mention event matching the subscribed topic is received THEN the agent SHALL process the mention data and invoke Claude API for response generation

3. WHEN the agent successfully processes a mention and sends a reply THEN it SHALL publish a success event to topic `slack.message_sent` with metadata including message ID and processing duration

4. WHEN the agent encounters an error during mention processing THEN it SHALL publish an error event to topic `slack.error` with error details

5. WHEN `template-agent-typescript` connects to KĀDI broker THEN it SHALL log "Subscribed to slack.app_mention.{BOT_USER_ID} events"

### Requirement 3: Removal of Polling Mechanism

**User Story:** As a developer maintaining the codebase, I want all polling logic removed from `template-agent-typescript`, so that the architecture is clean, efficient, and based solely on event-driven patterns.

#### Acceptance Criteria

1. WHEN `template-agent-typescript` SlackBot component initializes THEN it SHALL NOT create any `setInterval()` timers for polling mentions

2. WHEN the codebase is reviewed THEN there SHALL be no references to `pollForMentions()` method in SlackBot class

3. WHEN the codebase is reviewed THEN there SHALL be no tool invocations to `slack_client_get_slack_mentions` tool from the agent

4. WHEN `template-agent-typescript` runs in production THEN system metrics SHALL show zero polling requests to `mcp-client-slack`

### Requirement 4: Removal of get_slack_mentions Tool

**User Story:** As a maintainer of `mcp-client-slack`, I want to remove the `get_slack_mentions` MCP tool completely, so that the codebase reflects the event-based architecture without legacy polling artifacts.

#### Acceptance Criteria

1. WHEN `mcp-client-slack` registers MCP tools THEN it SHALL NOT register a tool named `get_slack_mentions`

2. WHEN the codebase is reviewed THEN there SHALL be no handler function `handleGetMentions()` in the server implementation

3. WHEN the codebase is reviewed THEN there SHALL be no `MentionQueue` class or in-memory queue logic

4. WHEN an external client attempts to invoke `get_slack_mentions` tool THEN it SHALL receive a "tool not found" error from the MCP server

### Requirement 5: Multi-Agent Isolation via Bot ID Routing

**User Story:** As a system architect, I want each agent to receive mentions only for their specific Slack app, so that multiple agents can operate independently without processing each other's messages.

#### Acceptance Criteria

1. WHEN Agent A is configured with Slack App A (bot ID `U111111`) and Agent B is configured with Slack App B (bot ID `U222222`) THEN Agent A SHALL only receive events from topic `slack.app_mention.U111111` and Agent B SHALL only receive events from topic `slack.app_mention.U222222`

2. WHEN a user mentions Slack App A in a Slack workspace THEN only agents subscribed to `slack.app_mention.U111111` SHALL receive the event notification

3. WHEN a user mentions both Slack App A and Slack App B simultaneously (e.g., in separate channels or messages) THEN both Agent A and Agent B SHALL receive their respective events independently and concurrently

4. WHEN multiple agents subscribe to the same bot ID topic (e.g., for horizontal scaling) THEN RabbitMQ fan-out SHALL deliver the event to ALL subscribed agents (not round-robin)

### Requirement 6: KĀDI Broker Remains Unchanged

**User Story:** As a KĀDI broker maintainer, I want zero modifications to the broker codebase, so that the migration is achieved purely through client-side changes without risk to the core infrastructure.

#### Acceptance Criteria

1. WHEN the migration is complete THEN there SHALL be zero commits or modifications to the `kadi-broker` repository

2. WHEN the system is reviewed THEN all event publishing and subscription SHALL use existing KĀDI broker APIs (`client.publishEvent()`, `client.subscribeToEvent()`)

3. WHEN the system operates THEN the KĀDI broker SHALL continue to use existing RabbitMQ topic exchanges for event routing without configuration changes

4. WHEN the migration is tested THEN the broker SHALL demonstrate the same performance, reliability, and functionality as before the migration

## Non-Functional Requirements

### Code Architecture and Modularity

- **Single Responsibility Principle**:
  - `mcp-client-slack` is responsible ONLY for receiving Slack events and publishing to KĀDI
  - `template-agent-typescript` is responsible ONLY for subscribing to events and processing mentions
  - No shared queue logic between components

- **Modular Design**:
  - KĀDI connection logic encapsulated in separate module/class
  - Event handling logic separated from business logic (Claude API calls)
  - SlackBot component refactored to use event handlers instead of polling timers

- **Dependency Management**:
  - `mcp-client-slack` adds dependency on `@kadi.build/core` KadiClient
  - `template-agent-typescript` already has `@kadi.build/core` dependency (no new dependencies)
  - Zero new dependencies on `kadi-broker`

- **Clear Interfaces**:
  - Event payload schema documented and validated
  - Topic naming convention enforced: `slack.app_mention.{BOT_USER_ID}`
  - Error event schema documented: `slack.error` with error field

### Performance

- **Latency**: Event delivery from Slack → Agent SHALL be <100ms (99th percentile)
- **Throughput**: System SHALL support at least 1000 mentions/second without message loss
- **Resource Usage**: Agent CPU usage SHALL drop by >90% compared to polling baseline when idle
- **Network Efficiency**: Eliminate 12 HTTP requests/minute per agent (polling baseline)

### Security

- **Authentication**: KĀDI broker authentication SHALL use existing JWT/WebSocket auth (no changes)
- **Authorization**: Event topic subscriptions SHALL respect KĀDI network membership rules
- **Data Privacy**: Event payloads SHALL NOT include sensitive Slack tokens or API keys
- **Audit Trail**: All event publications and subscriptions SHALL be logged with timestamps

### Reliability

- **Message Delivery**: RabbitMQ SHALL persist undelivered events until agents reconnect (existing broker feature)
- **Error Handling**: Failed event publications SHALL be logged but not retried (fail-fast pattern)
- **Connection Resilience**: Agents SHALL automatically reconnect to broker on WebSocket disconnection (existing KadiClient feature)
- **Graceful Degradation**: If broker is unavailable, `mcp-client-slack` SHALL log errors but continue processing Slack events (no crash)

### Usability

- **Configuration**: Bot ID SHALL be automatically detected from Slack SDK connection (no manual config)
- **Logging**: Clear, structured logs SHALL indicate:
  - Event publishing success/failure with topic names
  - Event subscription registration with topic patterns
  - Event receipt with payload summaries
- **Debugging**: System SHALL support `DEBUG=kadi:*` environment variable for verbose event tracing
- **Backward Compatibility**: Migration SHALL be a breaking change (polling removed), requiring coordinated deployment of both `mcp-client-slack` and `template-agent-typescript`
