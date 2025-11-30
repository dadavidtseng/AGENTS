# Requirements Document: Discord/Slack Event-Based Unification

## Introduction

This specification unifies the Discord and Slack bot architectures in template-agent-typescript into a consistent event-driven pub/sub pattern. Currently, slack-bot.ts uses a modern event subscription model via KĀDI broker while discord-bot.ts relies on legacy polling. This creates architectural inconsistency, duplicated code, and different operational characteristics between platforms.

The unification will:

1. **Modernize Discord architecture**: Convert discord-bot.ts from polling-based to event-driven pub/sub, matching slack-bot.ts's proven architecture
2. **Extract shared abstractions**: Create a common base class for platform-agnostic bot logic while preserving platform-specific implementations
3. **Enable event publishing in MCP clients**: Upgrade mcp-client-discord to publish events through KĀDI broker (similar to mcp-client-slack)
4. **Standardize event topics**: Define consistent topic naming conventions for multi-bot deployments

**Value**: This enables both Discord and Slack bots to run simultaneously in a single agent instance, reduces code duplication, improves maintainability, and provides consistent operational patterns across platforms.

## Alignment with Product Vision

This feature supports the KĀDI broker's vision of unified multi-platform event handling. By standardizing both Discord and Slack integrations around the same event-driven architecture, we enable:

- **Scalability**: Multiple bot instances can subscribe to the same event topics without polling conflicts
- **Real-time responsiveness**: Event-driven architecture eliminates polling delays
- **Operational consistency**: Same monitoring, debugging, and resilience patterns across platforms
- **Code maintainability**: Shared abstractions reduce duplication and testing overhead

## Requirements

### Requirement 1: Event-Driven Discord Bot Architecture

**User Story:** As a bot operator, I want the Discord bot to use event subscriptions instead of polling, so that it responds in real-time and operates consistently with the Slack bot architecture.

#### Acceptance Criteria

1. WHEN a Discord mention event is published to KĀDI broker THEN discord-bot.ts SHALL receive it via event subscription
2. WHEN discord-bot.ts starts THEN it SHALL subscribe to topic `discord.mention.{BOT_USER_ID}` using KĀDI client
3. WHEN discord-bot.ts receives an event THEN it SHALL process it using the same circuit breaker and retry patterns as slack-bot.ts
4. WHEN discord-bot.ts is stopped THEN it SHALL unsubscribe from all event topics
5. IF the event subscription fails THEN the bot SHALL log the error and apply circuit breaker logic (do not fall back to polling)

### Requirement 2: KĀDI Event Publishing in mcp-client-discord

**User Story:** As a system integrator, I want mcp-client-discord to publish mention events through KĀDI broker, so that Discord bots can receive real-time notifications without polling.

#### Acceptance Criteria

1. WHEN a Discord user @mentions the bot THEN mcp-client-discord SHALL publish the event to topic `discord.mention.{BOT_USER_ID}`
2. WHEN mcp-client-discord starts THEN it SHALL connect to KĀDI broker using `KadiEventPublisher`
3. WHEN an event is published THEN it SHALL include all required fields: id, user, username, text, channel, channelName, guild, ts
4. IF KĀDI broker connection fails THEN mcp-client-discord SHALL log the error and continue operating (queue-based fallback)
5. WHEN KĀDI broker is unavailable THEN the existing MCP tool `get_discord_mentions` SHALL continue to work via queue

### Requirement 3: Shared Base Bot Class

**User Story:** As a developer, I want Discord and Slack bots to share common logic, so that I can maintain bot behavior in one place while supporting platform-specific features.

#### Acceptance Criteria

1. WHEN implementing bot functionality THEN a `BaseBot` abstract class SHALL exist containing shared logic
2. WHEN `BaseBot` is instantiated THEN it SHALL provide circuit breaker, retry logic, metrics tracking, and Claude API integration
3. WHEN platform-specific behavior is needed THEN `SlackBot` and `DiscordBot` SHALL extend `BaseBot` and override abstract methods
4. WHEN both bots run simultaneously THEN they SHALL maintain independent state, metrics, and circuit breakers
5. IF shared methods are called THEN they SHALL work identically regardless of which platform bot invokes them

### Requirement 4: Shared Event Publisher Logic

**User Story:** As a maintainer, I want mcp-client-discord and mcp-client-slack to share event publishing code, so that I can fix bugs and add features in one place.

#### Acceptance Criteria

1. WHEN publishing events THEN a shared `KadiEventPublisher` class SHALL handle KĀDI broker connections
2. WHEN either MCP client publishes an event THEN it SHALL use the same publisher interface
3. WHEN configuring the publisher THEN it SHALL accept platform-specific topic patterns as parameters
4. IF publisher logic changes THEN both mcp-client-discord and mcp-client-slack SHALL benefit from the update
5. WHEN publisher fails THEN both clients SHALL handle errors consistently with retry and logging

### Requirement 5: Platform-Specific Event Topic Patterns

**User Story:** As a deployment operator, I want different bots to use unique event topics based on platform and bot ID, so that I can run multiple Discord/Slack bots without cross-talk.

#### Acceptance Criteria

1. WHEN a Slack mention occurs THEN events SHALL be published to topic `slack.app_mention.{BOT_USER_ID}`
2. WHEN a Discord mention occurs THEN events SHALL be published to topic `discord.mention.{BOT_USER_ID}`
3. WHEN multiple bots run on the same platform THEN each SHALL subscribe only to its own bot ID topic
4. IF a bot subscribes to wrong topic THEN it SHALL NOT receive events meant for other bots
5. WHEN a new platform is added THEN the topic pattern SHALL follow `{platform}.{event_type}.{bot_id}` format

## Non-Functional Requirements

### Code Architecture and Modularity

- **Single Responsibility Principle**:
  - BaseBot handles shared bot logic (Claude API, circuit breaker, metrics)
  - Platform-specific bots handle only platform event parsing and integration
  - KadiEventPublisher handles only event publishing to broker
  - MCP clients handle only event listening and tool exposure

- **Modular Design**:
  - Extract KadiEventPublisher to shared module usable by both mcp-client-slack and mcp-client-discord
  - BaseBot must be abstract class in separate file
  - Event type schemas (DiscordMentionEventSchema, SlackMentionEventSchema) remain platform-specific

- **Dependency Management**:
  - Both bots depend on KadiClient but not on MCP clients
  - MCP clients depend on KadiEventPublisher but not on bot implementations
  - No circular dependencies between bot classes and MCP clients

- **Clear Interfaces**:
  - Define `BotEventHandler` interface for event processing
  - Define `EventPublisher` interface for KĀDI publishing
  - Event payload interfaces must be strongly typed with Zod schemas

### Performance

- Event subscription SHALL have < 100ms latency from event publish to bot receipt
- Switching from polling SHALL reduce CPU usage by eliminating 10-second interval timers
- Circuit breaker SHALL prevent cascading failures when Claude API is slow
- Metrics SHALL be logged every 10 events for performance monitoring

### Reliability

- Event subscription failures SHALL trigger circuit breaker (do not silently fall back to polling)
- MCP clients SHALL maintain queue-based fallback if KĀDI broker is unavailable
- Both bots SHALL run independently without shared state to prevent one platform's failure from affecting the other
- Retry logic SHALL use exponential backoff (matching existing slack-bot.ts pattern)

### Maintainability

- Breaking changes from existing architecture are ACCEPTABLE (this is a refactor, not backward-compatible upgrade)
- All shared code SHALL have JSDoc comments explaining platform-agnostic behavior
- Platform-specific code SHALL have comments explaining why it differs from the other platform
- Event topic patterns SHALL be documented in README files for both MCP clients

### Testability

- BaseBot SHALL be testable independently with mock KĀDI client
- Each platform bot SHALL be testable with mock event payloads
- KadiEventPublisher SHALL be testable with mock broker connections
- Existing manual testing procedures for Discord and Slack SHALL continue to work
