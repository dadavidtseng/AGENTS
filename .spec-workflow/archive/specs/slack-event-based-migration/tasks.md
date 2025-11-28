# Tasks Document

## Task Breakdown

- [x] 1. Add KĀDI client dependency and configuration to mcp-client-slack
  - Files:
    - `C:\p4\Personal\SD\mcp-client-slack\package.json` (modify)
    - `C:\p4\Personal\SD\mcp-client-slack\.env.example` (modify)
    - `C:\p4\Personal\SD\mcp-client-slack\src\index.ts` (modify - config section)
  - Add `@kadi.build/core` dependency to package.json
  - Add KĀDI broker configuration to environment variables
  - Update Config schema to include KĀDI_BROKER_URL and SLACK_BOT_USER_ID
  - Purpose: Prepare mcp-client-slack to connect to KĀDI broker for event publishing
  - _Leverage: Existing Zod ConfigSchema validation pattern (lines 41-46 in src/index.ts)_
  - _Requirements: 1, 6_
  - _Prompt: Implement the task for spec slack-event-based-migration, first run spec-workflow-guide to get the workflow guide then implement the task: Role: DevOps Engineer specializing in dependency management and configuration | Task: Add @kadi.build/core dependency to package.json, extend ConfigSchema to validate KADI_BROKER_URL (WebSocket URL) and SLACK_BOT_USER_ID (string, format U*), update .env.example with commented examples following requirements 1 and 6, leveraging existing Zod validation patterns from lines 41-46 in src/index.ts | Restrictions: Do not modify existing config fields, maintain backward compatibility, use existing Zod patterns for validation | Success: npm install succeeds, ConfigSchema compiles with new fields, .env.example documents new variables clearly | Instructions: Edit tasks.md to mark this task as [-] in-progress before starting. After completion, log implementation with log-implementation tool including artifacts (all modified config schemas, dependency changes). Then mark task as [x] completed in tasks.md_

- [x] 2. Create SlackMentionEvent schema and types in mcp-client-slack
  - Files:
    - `C:\p4\Personal\SD\mcp-client-slack\src\types.ts` (create new file)
  - Define SlackMentionEvent interface with Zod schema
  - Include all 8 required fields: id, user, text, channel, thread_ts, ts, bot_id, timestamp
  - Export type inference from schema
  - Purpose: Establish type-safe event payload contract for publishing
  - _Leverage: Existing SlackMention interface (lines 71-84 in src/index.ts), Zod validation patterns_
  - _Requirements: 1_
  - _Prompt: Implement the task for spec slack-event-based-migration, first run spec-workflow-guide to get the workflow guide then implement the task: Role: TypeScript Developer specializing in type systems and schema validation | Task: Create src/types.ts with SlackMentionEventSchema (Zod) containing 8 fields (id, user, text, channel, thread_ts, ts, bot_id as string, timestamp as ISO datetime string) following requirement 1, leveraging existing SlackMention interface structure from lines 71-84 in src/index.ts | Restrictions: Do not modify existing SlackMention interface, ensure all fields are required (no optionals), use .datetime() for timestamp validation | Success: Schema compiles without errors, type inference produces correct TypeScript type, all 8 fields validated with appropriate Zod types | Instructions: Edit tasks.md to mark this task as [-] in-progress before starting. After completion, log implementation with log-implementation tool including artifacts (schema definition, exported types). Then mark task as [x] completed in tasks.md_

- [x] 3. Implement KadiEventPublisher class in mcp-client-slack
  - Files:
    - `C:\p4\Personal\SD\mcp-client-slack\src\kadi-publisher.ts` (create new file)
  - Create class with connect(), publishMention(), disconnect() methods
  - Initialize KadiClient with broker URL and client configuration
  - Handle connection errors gracefully (log and set enabled flag)
  - Purpose: Encapsulate KĀDI broker connection and event publishing logic
  - _Leverage: KadiClient from @kadi.build/core, existing stub mode pattern from SlackManager (lines 153-171)_
  - _Requirements: 1, 2_
  - _Prompt: Implement the task for spec slack-event-based-migration, first run spec-workflow-guide to get the workflow guide then implement the task: Role: Backend Developer with expertise in event-driven architecture and TypeScript classes | Task: Create KadiEventPublisher class with constructor(config), async connect(), async publishMention(mention, botUserId), async disconnect() methods following requirements 1 and 2. Initialize KadiClient with name:'mcp-client-slack', role:'client', broker URL from config. Use graceful degradation pattern from lines 153-171 (stub mode). Publish to topic 'slack.app_mention.{botUserId}' with SlackMentionEvent payload. | Restrictions: Must handle connection failures gracefully without crashing, do not retry on publish failure (fail-fast), log all errors with structured format | Success: Class compiles correctly, connect() establishes WebSocket connection, publishMention() sends event to correct topic, errors are logged but don't crash process | Instructions: Edit tasks.md to mark this task as [-] in-progress before starting. After completion, log implementation with log-implementation tool including artifacts (class definition with all methods, error handling patterns). Then mark task as [x] completed in tasks.md_

- [x] 4. Integrate KadiEventPublisher into SlackManager.handleMention()
  - Files:
    - `C:\p4\Personal\SD\mcp-client-slack\src\index.ts` (modify - SlackManager class)
  - Instantiate KadiEventPublisher in SlackClientMCPServer constructor
  - Call publisher.connect() during server startup
  - Call publisher.publishMention() in handleMention() after queue.add()
  - Extract bot user ID from Slack SDK for topic routing
  - Purpose: Publish events to KĀDI broker immediately upon receiving Slack mentions
  - _Leverage: Existing handleMention() logic (lines 177-189), SlackManager initialization (lines 159-164)_
  - _Requirements: 1_
  - _Prompt: Implement the task for spec slack-event-based-migration, first run spec-workflow-guide to get the workflow guide then implement the task: Role: Backend Developer with expertise in Slack SDK and event integration | Task: Integrate KadiEventPublisher into SlackClientMCPServer by: 1) Add publisher instance variable, 2) Initialize in constructor, 3) Call publisher.connect() in run() method after slackManager.start(), 4) In handleMention() after mentionQueue.add(), create SlackMentionEvent payload and call publisher.publishMention(). Extract bot user ID from this.app.client.auth.test() during startup. Follow requirement 1, leverage existing patterns from lines 159-164 and 177-189. | Restrictions: Must not break existing functionality, keep mentionQueue.add() for now (backward compat), handle publish failures gracefully, do not block Slack event processing on KĀDI publish | Success: Publisher connects on startup, events published to correct topics on each mention, Slack processing not blocked, errors logged clearly | Instructions: Edit tasks.md to mark this task as [-] in-progress before starting. After completion, log implementation with log-implementation tool including artifacts (integration points, event publishing flow, bot ID extraction). Then mark task as [x] completed in tasks.md_

- [x] 5. Remove MentionQueue class and get_slack_mentions tool from mcp-client-slack
  - Files:
    - `C:\p4\Personal\SD\mcp-client-slack\src\index.ts` (modify - remove code)
  - Delete MentionQueue class (lines 106-139)
  - Remove handleGetMentions() method (lines 311-334)
  - Remove get_slack_mentions from tools array in ListToolsRequest handler
  - Remove mentionQueue instance variable from SlackClientMCPServer
  - Purpose: Clean up legacy polling infrastructure that's no longer needed
  - _Leverage: None (deletion task)_
  - _Requirements: 3, 4_
  - _Prompt: Implement the task for spec slack-event-based-migration, first run spec-workflow-guide to get the workflow guide then implement the task: Role: Senior Developer with expertise in refactoring and code cleanup | Task: Remove all polling-related code following requirements 3 and 4: 1) Delete MentionQueue class (lines 106-139), 2) Delete handleGetMentions() method (lines 311-334), 3) Remove 'get_slack_mentions' from tools array, 4) Remove mentionQueue instance variable and initialization, 5) Clean up imports if unused. | Restrictions: Do not remove SlackMention interface (still used for events), ensure no broken references remain, verify compilation succeeds after removal | Success: Code compiles without errors, no references to MentionQueue or get_slack_mentions remain, server starts successfully, tools list doesn't include removed tool | Instructions: Edit tasks.md to mark this task as [-] in-progress before starting. After completion, log implementation with log-implementation tool including artifacts (list of removed classes/methods, verification of no broken references). Then mark task as [x] completed in tasks.md_

- [x] 6. Replace polling with event subscription in template-agent-typescript SlackBot
  - Files:
    - `C:\p4\Personal\SD\template-agent-typescript\src\slack-bot.ts` (modify)
  - Remove pollForMentions() method and setInterval timer
  - Add subscribeToMentions() method that calls kadiClient.subscribeToEvent()
  - Subscribe to topic pattern 'slack.app_mention.{BOT_USER_ID}'
  - Update initialize() to call subscribeToMentions() instead of starting polling
  - Purpose: Replace polling mechanism with real-time event subscription
  - _Leverage: Existing KadiClient instance, existing handleMention() processing logic, circuit breaker pattern_
  - _Requirements: 2, 3, 5_
  - _Prompt: Implement the task for spec slack-event-based-migration, first run spec-workflow-guide to get the workflow guide then implement the task: Role: TypeScript Developer specializing in event-driven architecture and refactoring | Task: Refactor SlackBot class following requirements 2, 3, and 5: 1) Remove pollForMentions() method entirely, 2) Remove setInterval() call from initialize(), 3) Add async subscribeToMentions() that calls this.kadiClient.subscribeToEvent('slack.app_mention.{botUserId}', handler), 4) In event handler, validate payload with SlackMentionEventSchema, then call existing processing logic. Extract bot user ID from environment variable SLACK_BOT_USER_ID. Leverage existing KadiClient and circuit breaker patterns. | Restrictions: Do not modify existing Claude API integration, maintain circuit breaker and retry logic, ensure event handler is properly bound to class context, handle schema validation errors gracefully | Success: Polling code completely removed, event subscription established on initialize(), mentions processed in real-time via events, existing error handling preserved | Instructions: Edit tasks.md to mark this task as [-] in-progress before starting. After completion, log implementation with log-implementation tool including artifacts (event subscription setup, removed polling code, event handler implementation). Then mark task as [x] completed in tasks.md_

- [x] 7. Add SlackMentionEvent schema to template-agent-typescript
  - Files:
    - `C:\p4\Personal\SD\template-agent-typescript\src\types\slack-events.ts` (create new file)
  - Copy SlackMentionEvent schema from mcp-client-slack for validation
  - Export schema and type for use in event handlers
  - Purpose: Validate incoming event payloads for type safety
  - _Leverage: Zod schema from mcp-client-slack/src/types.ts (created in task 2)_
  - _Requirements: 2_
  - _Prompt: Implement the task for spec slack-event-based-migration, first run spec-workflow-guide to get the workflow guide then implement the task: Role: TypeScript Developer specializing in type safety and schema validation | Task: Create src/types/slack-events.ts containing SlackMentionEventSchema (Zod) with identical structure to mcp-client-slack version from task 2 following requirement 2. Include all 8 fields with same validation rules. Export both schema and inferred type. | Restrictions: Must match mcp-client-slack schema exactly, ensure schema can validate events from publisher, do not add optional fields | Success: Schema compiles correctly, validates events from mcp-client-slack, type inference produces correct TypeScript type, can catch invalid payloads | Instructions: Edit tasks.md to mark this task as [-] in-progress before starting. After completion, log implementation with log-implementation tool including artifacts (schema definition, validation examples). Then mark task as [x] completed in tasks.md_

- [x] 8. Update environment configuration and documentation
  - Files:
    - `C:\p4\Personal\SD\mcp-client-slack\.env.example` (modify)
    - `C:\p4\Personal\SD\mcp-client-slack\README.md` (modify)
    - `C:\p4\Personal\SD\template-agent-typescript\.env.example` (modify)
    - `C:\p4\Personal\SD\template-agent-typescript\README.md` (modify)
  - Document new environment variables: KADI_BROKER_URL, SLACK_BOT_USER_ID
  - Update README files with event-based architecture explanation
  - Add migration notes for users upgrading from polling version
  - Document breaking changes (get_slack_mentions tool removed)
  - Purpose: Ensure developers understand configuration and migration path
  - _Leverage: Existing README structure and documentation patterns_
  - _Requirements: All (non-functional requirement: usability)_
  - _Prompt: Implement the task for spec slack-event-based-migration, first run spec-workflow-guide to get the workflow guide then implement the task: Role: Technical Writer with expertise in API documentation and developer guides | Task: Update configuration and documentation following all requirements: 1) Add KADI_BROKER_URL (ws://localhost:8080) and SLACK_BOT_USER_ID (get from Slack app settings) to both .env.example files, 2) Update README.md files to explain event-based architecture, 3) Add 'Breaking Changes' section documenting get_slack_mentions removal, 4) Add 'Migration Guide' section with step-by-step upgrade instructions, 5) Document event topics and payload schema. Leverage existing README structure. | Restrictions: Must clearly mark breaking changes, provide complete migration instructions, include example configurations, maintain documentation consistency with code | Success: All environment variables documented with examples, breaking changes clearly marked, migration guide is comprehensive and actionable, architecture changes well-explained | Instructions: Edit tasks.md to mark this task as [-] in-progress before starting. After completion, log implementation with log-implementation tool including artifacts (documentation sections added, configuration examples). Then mark task as [x] completed in tasks.md_

- [x] 9. Add structured logging for event publishing and subscription
  - Files:
    - `C:\p4\Personal\SD\mcp-client-slack\src\kadi-publisher.ts` (modify)
    - `C:\p4\Personal\SD\template-agent-typescript\src\slack-bot.ts` (modify)
  - Add structured logs for connection events (success/failure)
  - Log event publications with topic names and payload summaries
  - Log event receipts with processing timestamps
  - Log subscription registration and errors
  - Purpose: Enable debugging and monitoring of event flow
  - _Leverage: Existing console logging patterns_
  - _Requirements: All (non-functional requirement: usability)_
  - _Prompt: Implement the task for spec slack-event-based-migration, first run spec-workflow-guide to get the workflow guide then implement the task: Role: DevOps Engineer with expertise in logging and observability | Task: Add comprehensive structured logging following all requirements: In kadi-publisher.ts: 1) Log connection success/failure, 2) Log each event publication with topic and mention ID, 3) Log publish errors with context. In slack-bot.ts: 1) Log subscription registration with topic pattern, 2) Log each event receipt with payload summary, 3) Log validation errors. Use format: '[KĀDI] Component: message {context}'. Leverage existing console.log patterns. | Restrictions: Do not log sensitive data (tokens, full message content beyond preview), keep logs concise but informative, use consistent format across both files | Success: All connection events logged, event publications tracked, subscription events visible, errors have sufficient context for debugging | Instructions: Edit tasks.md to mark this task as [-] in-progress before starting. After completion, log implementation with log-implementation tool including artifacts (logging statements added, log format examples). Then mark task as [x] completed in tasks.md_

- [x] 10. Integration testing: End-to-end event flow validation
  - Files:
    - `C:\p4\Personal\SD\AGENTS\tests\integration\slack-event-flow.test.ts` (create new file if testing in AGENTS repo)
    - Or test manually with documentation in README
  - Start KĀDI broker, mcp-client-slack, and template-agent-typescript
  - Simulate Slack app_mention event or send real Slack message
  - Verify event published to correct topic (check broker logs)
  - Verify agent receives event and processes with Claude API
  - Verify reply sent back to Slack
  - Verify no polling requests occur (check mcp-client-slack logs)
  - Purpose: Validate complete event-driven flow works end-to-end
  - _Leverage: Existing integration test patterns if available_
  - _Requirements: All_
  - _Prompt: Implement the task for spec slack-event-based-migration, first run spec-workflow-guide to get the workflow guide then implement the task: Role: QA Engineer with expertise in integration testing and event-driven systems | Task: Validate end-to-end event flow following all requirements: 1) Start KĀDI broker (from kadi-broker repo), 2) Start mcp-client-slack with real/mock Slack connection, 3) Start template-agent-typescript, 4) Send test mention to Slack or simulate via Slack SDK mock, 5) Verify event appears in broker (topic: slack.app_mention.{botId}), 6) Verify agent receives and processes event, 7) Verify agent sends reply via mcp-server-slack, 8) Verify zero calls to get_slack_mentions tool, 9) Document test procedure in README if not automated. Leverage existing test patterns if available. | Restrictions: Ensure clean test environment, document all setup steps, verify both happy path and error scenarios, do not modify production configurations for testing | Success: Event published successfully, agent receives event <100ms after publish, mention processed correctly, reply sent to Slack, no polling detected, test is repeatable | Instructions: Edit tasks.md to mark this task as [-] in-progress before starting. After completion, log implementation with log-implementation tool including artifacts (test results, latency measurements, verification steps). Then mark task as [x] completed in tasks.md_
