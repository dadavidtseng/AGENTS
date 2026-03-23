/**
 * Worker Agent Factory
 * =====================
 *
 * Factory for creating worker agents (artist, designer, programmer) with
 * configuration-driven instantiation and shared infrastructure.
 *
 * Architecture Pattern: **Composition over Inheritance**
 * - BaseWorkerAgent COMPOSES with BaseBot (does NOT extend)
 * - Uses delegation pattern to access BaseBot's circuit breaker and retry logic
 * - This avoids tight coupling and allows flexible behavior customization
 *
 * Design Principles:
 * - Factory pattern for consistent agent creation
 * - Composition over inheritance for flexibility
 * - Strategy pattern for role-specific customization via WorkerBehaviors
 * - Template method pattern for lifecycle management (start/stop)
 *
 * Tool-Calling Agent Loop (Task 3.15):
 * - executeTask sends task + available tools to LLM via ProviderManager
 * - LLM calls tools iteratively (file ops, git ops via MCP)
 * - Loop continues until LLM returns final text response
 * - Git operations use client.invokeRemote() MCP tools, NOT child_process
 *
 * @module worker-agent-factory
 */

import { KadiClient, z } from '@kadi.build/core';
import type { WorkerAgentConfig, AgentRole } from './types/agent-config.js';
import { BaseBot, BaseBotConfig } from './base-bot.js';
import type { ProviderManager } from './providers/provider-manager.js';
import type { Message, ToolDefinition, ChatOptions } from './providers/types.js';
import {
  TaskAssignedEvent,
  TaskAssignedEventSchema,
  TaskFailedEvent,
  TaskRejectedEvent,
  type TaskReviewRequestedPayload,
} from './types/event-schemas.js';
import { logger, MODULE_AGENT } from './utils/logger.js';
import { timer } from './utils/timer.js';
import type { MemoryService } from './memory/memory-service.js';
import { formatMemoryContext } from './memory/memory-service.js';

// ============================================================================
// Configuration Validation Schema
// ============================================================================

/**
 * Zod schema for WorkerAgentConfig runtime validation
 *
 * Validates all required fields for worker agent configuration:
 * - role: Must be 'artist', 'designer', or 'programmer'
 * - worktreePath: Must be non-empty string (absolute path)
 * - brokerUrl: Must be valid WebSocket URL (ws:// or wss://)
 * - networks: Must be non-empty array of network names
 * - anthropicApiKey: Must be non-empty string
 * - claudeModel: Optional string with default value
 * - customBehaviors: Optional object with behavior overrides
 *
 * @example
 * ```typescript
 * const config = WorkerAgentConfigSchema.parse({
 *   role: 'artist',
 *   worktreePath: 'C:/p4/Personal/SD/agent-playground-artist',
 *   brokerUrl: 'ws://localhost:8080/kadi',
 *   networks: ['kadi'],
 *   anthropicApiKey: process.env.ANTHROPIC_API_KEY!
 * });
 * ```
 */
const WorkerAgentConfigSchema = z.object({
  agentId: z.string().optional(),
  role: z.enum(['artist', 'designer', 'programmer']),
  worktreePath: z.string().min(1, 'Worktree path is required'),
  brokerUrl: z.string()
    .min(1, 'Broker URL is required')
    .regex(/^wss?:\/\//, 'Broker URL must start with ws:// or wss://'),
  networks: z.array(z.string().min(1, 'Network name cannot be empty'))
    .min(1, 'At least one network is required'),
  anthropicApiKey: z.string().min(1, 'Anthropic API key is required'),
  claudeModel: z.string().optional(),
  capabilities: z.array(z.string()).optional(),
  customBehaviors: z.any().optional() // Use any() for customBehaviors to avoid complex function type inference
});

// ============================================================================
// BaseWorkerAgent Class (Skeleton)
// ============================================================================

/**
 * Base class for worker agents (artist, designer, programmer)
 *
 * **COMPOSITION PATTERN**: This class COMPOSES with BaseBot instead of extending it.
 * - Maintains a private `baseBot` instance for circuit breaker and retry logic
 * - Delegates tool invocation to `baseBot.invokeToolWithRetry()`
 * - Keeps agent-specific logic separate from bot resilience patterns
 *
 * Why Composition over Inheritance?
 * 1. **Flexibility**: Can compose multiple utilities (BaseBot, etc.)
 * 2. **Decoupling**: Changes to BaseBot don't force changes to worker agent interface
 * 3. **Single Responsibility**: BaseBot handles resilience, BaseWorkerAgent handles workflow
 * 4. **Testability**: Can mock BaseBot behavior independently
 *
 * Lifecycle:
 * 1. Constructor: Initialize configuration and compose utilities
 * 2. start(): Connect to broker, subscribe to task events, initialize protocol
 * 3. [Task execution happens asynchronously via event handlers]
 * 4. stop(): Cleanup subscriptions, disconnect from broker
 *
 * @example
 * ```typescript
 * const config: WorkerAgentConfig = {
 *   role: 'artist',
 *   worktreePath: 'C:/p4/Personal/SD/agent-playground-artist',
 *   brokerUrl: 'ws://localhost:8080/kadi',
 *   networks: ['kadi'],
 *   anthropicApiKey: process.env.ANTHROPIC_API_KEY!,
 *   claudeModel: 'claude-sonnet-4-20250514'
 * };
 *
 * const agent = new BaseWorkerAgent(config);
 * await agent.start();
 * // Agent now listens for {role}.task.assigned events and executes tasks
 * ```
 */
export class BaseWorkerAgent {
  // ============================================================================
  // Protected Properties (accessible to subclasses/extensions)
  // ============================================================================

  /**
   * KĀDI client for broker communication
   *
   * Used for:
   * - Subscribing to events
   * - Publishing completion/failure events
   * - Invoking remote MCP tools (git, file management)
   */
  protected client: KadiClient;

  /**
   * LLM provider manager for model selection and chat
   *
   * Replaces direct Anthropic SDK usage. Provides:
   * - Model-based routing (claude→Anthropic, gpt→Model Manager)
   * - Automatic fallback on provider failure
   * - Tool-calling via ChatOptions.tools
   *
   * Optional — if null, agent cannot execute tasks requiring LLM.
   */
  protected providerManager: ProviderManager | null = null;

  /**
   * Memory service for storing task outcomes and recalling past patterns.
   * Injected via setMemoryService() from the agent entry point.
   */
  protected memoryService: MemoryService | null = null;

  /**
   * Agent role (artist, designer, programmer)
   *
   * Used for:
   * - Event topic filtering (generic task.assigned, role in payload)
   * - Default file extensions
   * - Commit message prefixes
   */
  protected role: AgentRole;

  /**
   * Absolute path to git worktree for this agent
   *
   * Agent creates files and commits in this directory.
   * Must be a valid git worktree with initialized repository.
   *
   * @example 'C:/GitHub/agent-playground-artist'
   */
  protected worktreePath: string;

  /**
   * Network(s) this agent belongs to
   *
   * Used for network-based event routing in KĀDI broker.
   * Agent only receives events published to these networks.
   *
   * @example ['kadi']
   * @example ['production', 'team-alpha']
   */
  protected networks: string[];

  /**
   * Claude model to use for task execution (from role config or WorkerAgentConfig)
   *
   * @default 'claude-sonnet-4-20250514'
   */
  protected claudeModel: string;

  /**
   * Temperature for LLM requests (from role config)
   *
   * @default undefined (uses provider default)
   */
  protected temperature?: number;

  /**
   * Max tokens for LLM responses (from role config)
   *
   * @default undefined (uses provider default)
   */
  protected maxTokens?: number;

  /**
   * Commit message format template from role config
   *
   * Supports `{taskId}` placeholder. Used in the system prompt to guide
   * the LLM on commit message formatting.
   *
   * @default 'feat({role}): <description> [{taskId}]'
   */
  protected commitFormat?: string;

  /**
   * Agent capabilities for task validation
   *
   * Used to validate incoming tasks before execution.
   * If a task description doesn't match any capabilities, the agent rejects the task.
   */
  protected capabilities: string[];

  /**
   * MCP tool prefixes this agent is allowed to invoke (from role config)
   *
   * Controls which remote tools the agent can call via client.invokeRemote().
   * Examples: ['git_git_', 'ability_file_']
   *
   * If empty, no remote tools are available to the agent.
   */
  protected toolPrefixes: string[];

  /**
   * Maximum iterations for the tool-calling loop.
   * Prevents infinite loops if Claude keeps calling tools.
   */
  protected static readonly MAX_TOOL_LOOP_ITERATIONS = 25;

  // ============================================================================
  // Private Properties (internal use only)
  // ============================================================================

  /**
   * BaseBot instance for circuit breaker and retry logic (COMPOSITION)
   *
   * Used for resilient tool invocation with exponential backoff.
   * Created lazily when anthropicApiKey is available.
   */
  private baseBot: BaseBot | null = null;

  /**
   * Full agent configuration
   *
   * Stored for reference and potential reconfiguration.
   */
  private config: WorkerAgentConfig;

  /**
   * Set of task IDs that have been processed or are currently in-flight.
   * Prevents duplicate execution when the same task.assigned event arrives
   * multiple times (e.g., retry re-publish while first execution is still running).
   */
  private processedTaskIds = new Set<string>();

  // ============================================================================
  // Constructor
  // ============================================================================

  /**
   * Create a new BaseWorkerAgent instance
   *
   * Initializes all configuration properties and composes utility classes
   * (BaseBot). Does NOT connect to broker yet - call start()
   * to establish connection.
   *
   * @param config - Worker agent configuration with all required fields
   *
   * @example
   * ```typescript
   * const agent = new BaseWorkerAgent({
   *   role: 'artist',
   *   worktreePath: 'C:/p4/Personal/SD/agent-playground-artist',
   *   brokerUrl: 'ws://localhost:8080/kadi',
   *   networks: ['kadi'],
   *   anthropicApiKey: process.env.ANTHROPIC_API_KEY!,
   *   claudeModel: 'claude-sonnet-4-20250514',
   *   customBehaviors: {
   *     determineFilename: (taskId) => `artwork-${taskId}.png`
   *   }
   * });
   * ```
   */
  constructor(config: WorkerAgentConfig) {
    // Start factory timer for lifetime tracking
    timer.start('factory');

    // Store full configuration
    this.config = config;

    // Extract and store individual config properties
    this.role = config.role;
    this.worktreePath = config.worktreePath;
    this.networks = config.networks;
    this.claudeModel = config.claudeModel || 'claude-sonnet-4-20250514';
    this.capabilities = config.capabilities || [];
    this.toolPrefixes = [];

    // Initialize KĀDI client
    this.client = new KadiClient({
      name: config.agentId || `agent-${config.role}`,
      version: '1.0.0',
      brokers: {
        default: { url: config.brokerUrl, networks: config.networks }
      },
      defaultBroker: 'default',
    });

    // COMPOSITION: Create BaseBot instance for circuit breaker and retry logic
    // Only created when anthropicApiKey is available (backward compatibility)
    if (config.anthropicApiKey) {
      const baseBotConfig: BaseBotConfig = {
        client: this.client,
        anthropicApiKey: config.anthropicApiKey,
        botUserId: config.agentId || `agent-${config.role}`
      };
      this.baseBot = new (class extends BaseBot {
        protected async handleMention(_event: any): Promise<void> { /* No-op */ }
        public async start(): Promise<void> { /* No-op */ }
        public stop(): void { /* No-op */ }
      })(baseBotConfig);
    }
  }

  // ============================================================================
  // Protected Initialization Methods
  // ============================================================================

  /**
   * Initialize KĀDI client and connect to broker
   *
   * Performs connection sequence with retry logic:
   * 1. Connect KĀDI client to broker (client.serve blocks, so we use setTimeout)
   * 2. Wait for connection to establish (1 second delay)
   * 3. Initialize broker protocol for tool invocation
   * 4. Connect event publisher with retry logic
   *
   * Connection is performed with exponential backoff retry logic inherited from
   * Uses client.publish() for event publishing. If broker is unavailable, events will be queued.
   *
   * @throws {Error} If broker connection fails after all retries
   *
   * @example
   * ```typescript
   * await this.initializeClient();
   * // Client is now connected, protocol is initialized, publisher is ready
   * ```
   */
  protected async initializeClient(): Promise<void> {
    logger.info(MODULE_AGENT, '', timer.elapsed('factory'));
    logger.info(MODULE_AGENT, '🔌 Initializing KĀDI client...', timer.elapsed('factory'));

    try {
      // Step 1: Start client connection to broker
      logger.info(MODULE_AGENT, '   → Connecting to broker...', timer.elapsed('factory'));

      try {
        await this.client.connect();
        logger.info(MODULE_AGENT, '   ✅ Connected to broker', timer.elapsed('factory'));
      } catch (error: any) {
        logger.error(MODULE_AGENT, `Client connection error: ${error.message || String(error)}`, timer.elapsed('factory'), error);
        throw error;
      }

      // Step 2: Initialize ability response subscription (if BaseBot available)
      if (this.baseBot) {
        logger.info(MODULE_AGENT, '   → Initializing ability response subscription...', timer.elapsed('factory'));
        await this.baseBot['initializeAbilityResponseSubscription']();
        logger.info(MODULE_AGENT, '   ✅ Ability response subscription initialized', timer.elapsed('factory'));
      }

      logger.info(MODULE_AGENT, '', timer.elapsed('factory'));
      logger.info(MODULE_AGENT, '✅ KĀDI client initialized successfully', timer.elapsed('factory'));
      logger.info(MODULE_AGENT, `   Networks: ${this.networks.join(', ')}`, timer.elapsed('factory'));
      logger.info(MODULE_AGENT, `   Protocol: Ready`, timer.elapsed('factory'));
      logger.info(MODULE_AGENT, '', timer.elapsed('factory'));

      // Note: client.serve() continues running in background to handle incoming requests
      // We don't await it because it never resolves (blocks indefinitely)

    } catch (error: any) {
      logger.error(MODULE_AGENT, '', timer.elapsed('factory'));
      logger.error(MODULE_AGENT, 'Failed to initialize KĀDI client', timer.elapsed('factory'), error);
      logger.error(MODULE_AGENT, `   Error: ${error.message || String(error)}`, timer.elapsed('factory'));
      logger.error(MODULE_AGENT, '', timer.elapsed('factory'));
      throw error;
    }
  }

  /**
   * Subscribe to task assignment events
   *
   * Subscribes to {role}.task.assigned topic pattern to receive task assignments
   * from agent-producer. Topic is constructed dynamically from config.role to avoid
   * hardcoding and ensure flexibility.
   *
   * Event Flow:
   * 1. agent-producer publishes {role}.task.assigned event
   * 2. Broker routes event to this agent based on network membership
   * 3. handleTaskAssignment callback is invoked with event data
   * 4. Event is validated with Zod schema
   * 5. If valid, task execution begins
   * 6. If invalid, error is logged and event is rejected
   *
   * @throws {Error} If subscription fails (e.g., client not connected)
   *
   * @example
   * ```typescript
   * await this.subscribeToTaskAssignments();
   * // Agent now listens for task assignments on {role}.task.assigned
   * ```
   */
  protected async subscribeToTaskAssignments(): Promise<void> {
    // Subscribe to generic task.assigned topic (role filtering done in handler)
    const topic = `task.assigned`;

    logger.info(MODULE_AGENT, '', timer.elapsed('factory'));
    logger.info(MODULE_AGENT, `📡 Subscribing to task assignments...`, timer.elapsed('factory'));
    logger.info(MODULE_AGENT, `   Topic: ${topic}`, timer.elapsed('factory'));

    try {
      // Subscribe to event topic with bound callback
      // Using .bind(this) to preserve instance context in callback
      await this.client.subscribe(topic, this.handleTaskAssignment.bind(this), { broker: 'default' });

      logger.info(MODULE_AGENT, `   ✅ Subscribed successfully`, timer.elapsed('factory'));
      logger.info(MODULE_AGENT, '', timer.elapsed('factory'));

    } catch (error: any) {
      logger.error(MODULE_AGENT, '', timer.elapsed('factory'));
      logger.error(MODULE_AGENT, `Failed to subscribe to task assignments`, timer.elapsed('factory'), error);
      logger.error(MODULE_AGENT, `   Topic: ${topic}`, timer.elapsed('factory'));
      logger.error(MODULE_AGENT, `   Error: ${error.message || String(error)}`, timer.elapsed('factory'));
      logger.error(MODULE_AGENT, '', timer.elapsed('factory'));
      throw error;
    }
  }

  /**
   * Handle task assignment event
   *
   * Callback invoked when {role}.task.assigned event is received.
   * Performs validation and delegates to task execution.
   *
   * Validation Strategy:
   * - Uses Zod schema for runtime validation (TaskAssignedEventSchema)
   * - Rejects invalid events gracefully without crashing
   * - Logs detailed validation errors for debugging
   * - Maintains backward compatibility with existing event format
   *
   * Error Handling:
   * - Invalid events: Log error, reject event, continue processing
   * - Execution errors: Logged by executeTask method (implemented in next task)
   *
   * @param event - Raw event data from KĀDI broker (may include envelope wrapper)
   *
   * @example
   * ```typescript
   * // Event structure from broker:
   * {
   *   data: {
   *     taskId: 'task-123',
   *     role: 'artist',
   *     description: 'Create hero banner',
   *     requirements: 'Size: 1920x1080',
   *     timestamp: '2025-12-04T10:30:00.000Z'
   *   }
   * }
   * ```
   */
  protected async handleTaskAssignment(event: unknown): Promise<void> {
    try {
      // Extract event data from KĀDI envelope if present
      // Broker may wrap events in { data: {...} } envelope
      const eventData = (event as any)?.data || event;

      logger.info(MODULE_AGENT, '', timer.elapsed('factory'));
      logger.info(MODULE_AGENT, '📬 Task assignment received', timer.elapsed('factory'));
      logger.info(MODULE_AGENT, `   Raw event: ${JSON.stringify(eventData).substring(0, 200)}...`, timer.elapsed('factory'));

      // Validate event with Zod schema
      const validatedEvent: TaskAssignedEvent = TaskAssignedEventSchema.parse(eventData);

      logger.info(MODULE_AGENT, `   ✅ Event validated`, timer.elapsed('factory'));
      logger.info(MODULE_AGENT, `   Task ID: ${validatedEvent.taskId}`, timer.elapsed('factory'));
      logger.info(MODULE_AGENT, `   Role: ${validatedEvent.role}`, timer.elapsed('factory'));
      logger.info(MODULE_AGENT, `   Description: ${validatedEvent.description.substring(0, 80)}${validatedEvent.description.length > 80 ? '...' : ''}`, timer.elapsed('factory'));

      // Check if task is for this agent's role
      if (validatedEvent.role !== this.role) {
        logger.warn(MODULE_AGENT, `   ⚠️  Task role mismatch: expected ${this.role}, got ${validatedEvent.role}`, timer.elapsed('factory'));
        logger.warn(MODULE_AGENT, `   Rejecting task (wrong role)`, timer.elapsed('factory'));
        logger.info(MODULE_AGENT, '', timer.elapsed('factory'));
        return;
      }

      // Deduplication: skip tasks already processed or in-flight
      // Allow retries (events with feedback) by clearing the previous entry
      if (this.processedTaskIds.has(validatedEvent.taskId)) {
        if (validatedEvent.feedback) {
          // Retry with feedback — allow re-processing
          logger.info(MODULE_AGENT, `   🔄 Retry detected for task ${validatedEvent.taskId}, allowing re-execution`, timer.elapsed('factory'));
          this.processedTaskIds.delete(validatedEvent.taskId);
        } else {
          // Duplicate without feedback — skip
          logger.warn(MODULE_AGENT, `   ⚠️  Duplicate task.assigned for ${validatedEvent.taskId}, skipping (already processed/in-flight)`, timer.elapsed('factory'));
          logger.info(MODULE_AGENT, '', timer.elapsed('factory'));
          return;
        }
      }
      // Mark task as in-flight before execution
      this.processedTaskIds.add(validatedEvent.taskId);

      // Capability validation: skip if task role matches this agent's role (role-based routing
      // already ensures correct assignment). Only validate when roles don't match or are missing.
      if (this.capabilities.length > 0 && validatedEvent.role !== this.role) {
        const rejectionReason = this.validateTaskCapability(validatedEvent);
        if (rejectionReason) {
          logger.warn(MODULE_AGENT, `   ⚠️  Task capability mismatch`, timer.elapsed('factory'));
          logger.warn(MODULE_AGENT, `   Reason: ${rejectionReason}`, timer.elapsed('factory'));
          logger.warn(MODULE_AGENT, `   Publishing task.rejected event`, timer.elapsed('factory'));
          await this.publishRejection(validatedEvent.taskId, validatedEvent.questId, rejectionReason);
          logger.info(MODULE_AGENT, '', timer.elapsed('factory'));
          return;
        }
        logger.info(MODULE_AGENT, `   ✅ Capability check passed`, timer.elapsed('factory'));
      } else if (validatedEvent.role === this.role) {
        logger.info(MODULE_AGENT, `   ✅ Role match (${this.role}) — skipping capability check`, timer.elapsed('factory'));
      }

      // Worktree scope validation: soft warning only (worker always operates within its worktree directory)
      const outOfScopeReason = this.validateTaskScope(validatedEvent);
      if (outOfScopeReason) {
        logger.warn(MODULE_AGENT, `   ⚠️  Path reference outside worktree detected (non-blocking)`, timer.elapsed('factory'));
        logger.warn(MODULE_AGENT, `   Note: ${outOfScopeReason}`, timer.elapsed('factory'));
        logger.warn(MODULE_AGENT, `   Proceeding — worker operates within worktree "${this.worktreePath}"`, timer.elapsed('factory'));
      }

      // Log retry context if present
      if (validatedEvent.feedback) {
        logger.info(MODULE_AGENT, `   🔄 RETRY attempt #${validatedEvent.retryAttempt || 1}`, timer.elapsed('factory'));
        logger.info(MODULE_AGENT, `   Feedback: ${validatedEvent.feedback.substring(0, 120)}${validatedEvent.feedback.length > 120 ? '...' : ''}`, timer.elapsed('factory'));
      }

      // Execute task
      await this.executeTask(validatedEvent);
      logger.info(MODULE_AGENT, '', timer.elapsed('factory'));

    } catch (error: any) {
      // Validation error or other error - log and reject gracefully
      if (error.name === 'ZodError') {
        // Zod validation error - detailed error logging
        logger.error(MODULE_AGENT, '', timer.elapsed('factory'));
        logger.error(MODULE_AGENT, 'Invalid task assignment event (Zod validation failed)', timer.elapsed('factory'), error);
        logger.error(MODULE_AGENT, `   Validation errors:`, timer.elapsed('factory'));

        // Log each validation issue
        for (const issue of error.issues || []) {
          logger.error(MODULE_AGENT, `   - ${issue.path.join('.')}: ${issue.message}`, timer.elapsed('factory'));
        }

        logger.error(MODULE_AGENT, `   Raw event: ${JSON.stringify((event as any)?.data || event).substring(0, 300)}...`, timer.elapsed('factory'));
        logger.error(MODULE_AGENT, '   Event rejected (invalid format)', timer.elapsed('factory'));
        logger.error(MODULE_AGENT, '', timer.elapsed('factory'));
      } else {
        // Other error (execution error, etc.)
        logger.error(MODULE_AGENT, '', timer.elapsed('factory'));
        logger.error(MODULE_AGENT, 'Error handling task assignment', timer.elapsed('factory'), error);
        logger.error(MODULE_AGENT, `   Error: ${error.message || String(error)}`, timer.elapsed('factory'));
        logger.error(MODULE_AGENT, `   Stack: ${error.stack || 'No stack trace'}`, timer.elapsed('factory'));
        logger.error(MODULE_AGENT, '', timer.elapsed('factory'));
      }

      // Don't throw - reject event gracefully and continue processing
      // Agent should remain operational even if one event fails
    }
  }

  /**
   * Execute task using tool-calling agent loop
   *
   * Replaces the old linear pipeline (generate content → write file → git commit)
   * with an iterative tool-calling loop where the LLM decides what tools to use.
   *
   * Flow:
   * 1. Fetch full task details from quest (if questId provided)
   * 2. Set git working directory to worktree via MCP
   * 3. Build system prompt with task context and available tools
   * 4. Enter tool-calling loop:
   *    a. Send messages + tools to ProviderManager.chat()
   *    b. If response contains __TOOL_CALLS__, execute each tool via invokeRemote
   *    c. Feed tool results back as messages
   *    d. Repeat until LLM returns plain text (done) or max iterations reached
   * 5. Extract files created/modified and commit SHA from tool call history
   * 6. Publish task.completed event
   *
   * @param task - Validated task assignment event
   */
  protected async executeTask(task: TaskAssignedEvent): Promise<void> {
    logger.info(MODULE_AGENT, `🎨 Processing ${this.role} task: ${task.taskId}`, timer.elapsed('factory'));
    logger.info(MODULE_AGENT, `   Description: ${task.description}`, timer.elapsed('factory'));

    try {
      // Step 1: Get full task details if questId is provided
      let implementationGuide = task.requirements;
      let verificationCriteria = '';

      if (task.questId) {
        logger.info(MODULE_AGENT, `📋 Fetching full task details from quest ${task.questId}...`, timer.elapsed('factory'));
        try {
          const taskDetails = await this.client.invokeRemote<{
            content: Array<{ type: string; text: string }>;
          }>('quest_quest_query_task', { taskId: task.taskId });

          const detailsText = taskDetails.content[0].text;
          const details = JSON.parse(detailsText);
          implementationGuide = details.task?.implementationGuide || task.requirements;
          verificationCriteria = details.task?.verificationCriteria || '';

          logger.info(MODULE_AGENT, `   ✅ Task details fetched`, timer.elapsed('factory'));
        } catch (error: any) {
          logger.warn(MODULE_AGENT, `   ⚠️  Failed to fetch task details: ${error.message}`, timer.elapsed('factory'));
        }
      }

      // Step 2: Set git working directory via MCP tool
      logger.info(MODULE_AGENT, `📂 Setting git working directory: ${this.worktreePath}`, timer.elapsed('factory'));
      try {
        await this.client.invokeRemote('git_git_set_working_dir', { path: this.worktreePath });
        logger.info(MODULE_AGENT, `   ✅ Git working directory set`, timer.elapsed('factory'));
      } catch (error: any) {
        logger.warn(MODULE_AGENT, `   ⚠️  Failed to set git working dir: ${error.message}`, timer.elapsed('factory'));
        // Non-fatal — tools can still pass explicit path
      }

      // Step 3: Check if ProviderManager is available
      if (!this.providerManager) {
        throw new Error('ProviderManager not initialized — cannot execute task without LLM');
      }

      // Step 4: Build tool definitions — local tools + dynamic discovery from broker
      const tools = await this.buildToolDefinitionsAsync();
      logger.info(MODULE_AGENT, `🔧 Available tools: ${tools.length}`, timer.elapsed('factory'));

      // Step 4.5: Recall relevant past experience (non-blocking, best-effort)
      let memoryContext = '';
      if (this.memoryService) {
        try {
          const recallResult = await this.memoryService.recallRelevant(
            this.role, task.description, this.role, 3, ['*'],
          );
          if (recallResult.success && recallResult.data.length > 0) {
            memoryContext = formatMemoryContext(recallResult.data);
            logger.info(MODULE_AGENT, `Recalled ${recallResult.data.length} past patterns`, timer.elapsed('factory'));
          }
        } catch (err: any) {
          logger.warn(MODULE_AGENT, `Memory recall failed (non-fatal): ${err.message}`, timer.elapsed('factory'));
        }
      }

      // Step 5: Build initial system prompt
      const systemPrompt = this.buildTaskSystemPrompt(task, implementationGuide, verificationCriteria, memoryContext);

      // Step 6: Enter tool-calling agent loop
      const messages: Message[] = [
        { role: 'user', content: systemPrompt }
      ];

      const chatOptions: ChatOptions = {
        model: this.claudeModel,
        maxTokens: this.maxTokens || 8192,
        temperature: this.temperature,
        tools: tools.length > 0 ? tools : undefined,
        tool_choice: tools.length > 0 ? 'auto' : undefined
      };

      // Track files created/modified and commit SHA across tool calls
      const filesCreated: string[] = [];
      const filesModified: string[] = [];
      let commitSha = 'unknown';
      let finalResponse = '';
      let consecutiveFailures = 0;

      for (let iteration = 0; iteration < BaseWorkerAgent.MAX_TOOL_LOOP_ITERATIONS; iteration++) {
        logger.info(MODULE_AGENT, `🔄 Agent loop iteration ${iteration + 1}/${BaseWorkerAgent.MAX_TOOL_LOOP_ITERATIONS}`, timer.elapsed('factory'));

        const result = await this.providerManager.chat(messages, chatOptions);

        if (!result.success) {
          throw new Error(`LLM chat failed: ${result.error?.message || 'Unknown error'}`);
        }

        const responseText = result.data;

        // Check if response contains tool calls
        if (responseText.startsWith('__TOOL_CALLS__')) {
          const toolCallsData = JSON.parse(responseText.substring('__TOOL_CALLS__'.length));
          const toolCalls: Array<{
            id: string;
            type: 'function';
            function: { name: string; arguments: string };
          }> = toolCallsData.tool_calls;
          const assistantMessage = toolCallsData.message || '';

          logger.info(MODULE_AGENT, `   🤖 LLM requested ${toolCalls.length} tool call(s)`, timer.elapsed('factory'));
          if (assistantMessage) {
            logger.info(MODULE_AGENT, `   💬 ${assistantMessage.substring(0, 120)}${assistantMessage.length > 120 ? '...' : ''}`, timer.elapsed('factory'));
          }

          // Add assistant message with tool_calls to conversation
          messages.push({
            role: 'assistant',
            content: assistantMessage || null,
            tool_calls: toolCalls
          });

          // Execute each tool call and collect results
          for (const toolCall of toolCalls) {
            const toolName = toolCall.function.name;
            const toolArgs = JSON.parse(toolCall.function.arguments);

            logger.info(MODULE_AGENT, `   🔧 Executing tool: ${toolName}`, timer.elapsed('factory'));

            try {
              const toolResult = await this.executeRemoteTool(toolName, toolArgs);
              const resultText = typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult);

              // Track file operations from tool results
              this.trackFileOperations(toolName, toolArgs, toolResult, filesCreated, filesModified);

              // Track commit SHA from git_commit results
              if (toolName === 'git_git_commit' || toolName === 'git_commit') {
                const sha = this.extractCommitSha(toolResult);
                if (sha) commitSha = sha;
              }

              messages.push({
                role: 'tool',
                content: resultText,
                tool_call_id: toolCall.id
              });

              consecutiveFailures = 0;
              logger.info(MODULE_AGENT, `   ✅ Tool ${toolName} succeeded`, timer.elapsed('factory'));
            } catch (error: any) {
              consecutiveFailures++;
              const errorMsg = `Tool ${toolName} failed: ${error.message || String(error)}`;
              logger.error(MODULE_AGENT, `   ❌ ${errorMsg}`, timer.elapsed('factory'));

              messages.push({
                role: 'tool',
                content: JSON.stringify({ error: errorMsg }),
                tool_call_id: toolCall.id
              });
            }
          }
          // Circuit breaker: if 3+ consecutive tool failures, tell LLM to stop retrying
          if (consecutiveFailures >= 3) {
            logger.warn(MODULE_AGENT, `⚠️  Circuit breaker: ${consecutiveFailures} consecutive tool failures — instructing LLM to wrap up`, timer.elapsed('factory'));
            messages.push({
              role: 'user',
              content: 'SYSTEM: Multiple consecutive tool failures detected. Stop retrying failed tools and provide your final response summarizing what you accomplished so far.'
            });
          }
          // Continue loop — LLM will process tool results
        } else {
          // Plain text response — agent is done
          finalResponse = responseText;
          logger.info(MODULE_AGENT, `   ✅ Agent completed (${finalResponse.length} chars response)`, timer.elapsed('factory'));
          break;
        }
      }

      // Step 7: Safety net — auto-commit if LLM forgot to commit
      if (commitSha === 'unknown' && (filesCreated.length > 0 || filesModified.length > 0)) {
        logger.warn(MODULE_AGENT, `⚠️  LLM did not commit — auto-committing staged changes`, timer.elapsed('factory'));
        try {
          const commitMsg = this.commitFormat
            ? this.commitFormat.replace('{taskId}', task.taskId)
            : `feat(${this.role}): task ${task.taskId}`;
          const commitResult = await this.executeRemoteTool('git_git_commit', { path: this.worktreePath, message: commitMsg });
          const sha = this.extractCommitSha(commitResult);
          if (sha) {
            commitSha = sha;
            logger.info(MODULE_AGENT, `   ✅ Auto-commit succeeded: ${sha.substring(0, 7)}`, timer.elapsed('factory'));
          } else {
            logger.warn(MODULE_AGENT, `   ⚠️  Auto-commit returned no SHA`, timer.elapsed('factory'));
          }
        } catch (err: any) {
          logger.warn(MODULE_AGENT, `   ⚠️  Auto-commit failed: ${err.message}`, timer.elapsed('factory'));
        }
      }

      // Step 8: Publish completion or failure event
      if (!commitSha || commitSha === 'unknown') {
        logger.warn(MODULE_AGENT, `⚠️  No valid commit SHA — publishing task.failed instead of review request`, timer.elapsed('factory'));
        // Clear dedup so agent-lead retries are accepted
        this.processedTaskIds.delete(task.taskId);
        await this.publishFailure(
          task.taskId,
          new Error('Git commit failed — no valid commit SHA available. Files may have been written but were not committed.'),
          task.questId,
          task.retryAttempt,
        );
      } else {
        const contentSummary = finalResponse.length > 500
          ? finalResponse.substring(0, 500) + `... (${finalResponse.length} chars total)`
          : finalResponse;

        await this.publishCompletion(
          task.taskId,
          task.questId,
          filesCreated,
          filesModified,
          commitSha,
          contentSummary,
          task.retryAttempt,
        );
      }

      logger.info(MODULE_AGENT, `✅ Task ${task.taskId} execution completed`, timer.elapsed('factory'));

    } catch (error: any) {
      logger.error(MODULE_AGENT, `Failed to execute task ${task.taskId}`, timer.elapsed('factory'), error);
      logger.error(MODULE_AGENT, `   Error: ${error.message || String(error)}`, timer.elapsed('factory'));
      logger.error(MODULE_AGENT, `   Stack: ${error.stack || 'No stack trace'}`, timer.elapsed('factory'));

      // Clear dedup so agent-lead retries are accepted
      this.processedTaskIds.delete(task.taskId);

      await this.publishFailure(task.taskId, error, task.questId, task.retryAttempt);
      throw error;
    }
  }

  // ============================================================================
  // Tool-Calling Loop Helpers
  // ============================================================================

  /**
   * Build the system prompt for the tool-calling agent loop
   *
   * Includes task context, role identity, worktree path, and instructions
   * for using available tools (git, file operations).
   */
  protected buildTaskSystemPrompt(
    task: TaskAssignedEvent,
    implementationGuide: string,
    verificationCriteria: string,
    memoryContext?: string
  ): string {
    const retryContext = task.feedback
      ? `\n⚠️ REVISION REQUIRED (Attempt #${task.retryAttempt || 1})\nPrevious attempt was rejected. Feedback:\n${task.feedback}\nPlease carefully address the feedback above.\n`
      : '';

    const predecessorContext = task.predecessors && task.predecessors.length > 0
      ? `\n## Predecessor Tasks\nThe following tasks were completed before yours. You can read their output files using git_git_show with the branch name:\n${task.predecessors.map(p => `- **${p.role}** task (${p.taskId}): branch \`${p.branch}\`${p.commitHash ? ` commit \`${p.commitHash}\`` : ''}\n  To read a file: git_git_show with path="${this.worktreePath}" and object="${p.branch}:<filename>"`).join('\n')}\n`
      : '';

    return `You are a ${this.role} agent working in the KĀDI multi-agent system.
Your worktree directory is: ${this.worktreePath}

Task ID: ${task.taskId}
Description: ${task.description}
Implementation Guide: ${implementationGuide}
${verificationCriteria ? `Verification Criteria: ${verificationCriteria}` : ''}
${retryContext}${predecessorContext}
${memoryContext ? `\n## Past Experience\nThe following are relevant outcomes from past similar tasks. Use these to avoid known mistakes and apply proven patterns:\n${memoryContext}` : ''}

Instructions:
1. Analyze the task requirements carefully
2. Create the necessary files in the worktree using available tools
3. Stage ALL changed files with git_git_add (pass path: "${this.worktreePath}")
4. CRITICAL: You MUST call git_git_commit with path: "${this.worktreePath}" to commit your staged changes. Do NOT return a summary until you have committed.
5. When done, provide a brief summary of what you created

Important:
- All file operations must be within the worktree: ${this.worktreePath}
- For ALL git tools (git_git_add, git_git_commit, etc.), you MUST pass path: "${this.worktreePath}" as a parameter.
- You MUST complete the full cycle: write files → git_git_add → git_git_commit. Skipping the commit is a failure.
- If the task description specifies an exact commit message, you MUST use that exact message
- Default commit message format (use ONLY when no commit message is specified in the task): "${this.commitFormat ? this.commitFormat.replace('{taskId}', task.taskId) : `feat(${this.role}): <description> [${task.taskId}]`}"
- Focus on ${this.role === 'artist' ? 'creative and artistic elements. IMPORTANT: You cannot generate binary image files (PNG, GIF, JPG). Instead, generate all pixel art and graphics as SVG files using <rect> elements on a grid. Use a limited palette (<=16 colors). Never create placeholder or fake image files — always produce real, renderable SVG that displays the intended artwork when opened in a browser.' : this.role === 'designer' ? 'design principles and aesthetics' : 'code quality and best practices'}`;
  }

  /**
   * Build tool definitions: local tools + dynamic discovery from KĀDI broker
   *
   * 1. Always includes local tools (write_file, read_file)
   * 2. Discovers all network tools from broker via kadi.ability.list
   * 3. Converts to OpenAI-compatible ToolDefinition format
   */
  protected async buildToolDefinitionsAsync(): Promise<ToolDefinition[]> {
    const tools: ToolDefinition[] = [];

    // Always include local file tools (not MCP — handled directly in executeRemoteTool)
    tools.push({
      type: 'function',
      function: {
        name: 'write_file',
        description: 'Write content to a file in the worktree. Creates parent directories if needed.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Absolute file path within the worktree' },
            content: { type: 'string', description: 'File content to write' }
          },
          required: ['path', 'content']
        }
      }
    });

    tools.push({
      type: 'function',
      function: {
        name: 'read_file',
        description: 'Read content from a file in the worktree.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Absolute file path within the worktree' }
          },
          required: ['path']
        }
      }
    });

    // Discover network tools from broker, filtered by toolPrefixes if configured
    if (this.client.isConnected()) {
      try {
        const response = await this.client.invokeRemote<{ tools: Array<{
          name: string;
          description?: string;
          inputSchema?: Record<string, unknown>;
        }> }>('kadi.ability.list', { includeProviders: false });

        if (response?.tools && Array.isArray(response.tools)) {
          for (const tool of response.tools) {
            // If toolPrefixes configured, filter by prefix; otherwise include all
            if (this.toolPrefixes.length > 0 && !this.toolPrefixes.some(prefix => tool.name.startsWith(prefix))) {
              continue;
            }
            tools.push({
              type: 'function',
              function: {
                name: tool.name,
                description: tool.description || '',
                parameters: (tool.inputSchema as ToolDefinition['function']['parameters']) || {
                  type: 'object',
                  properties: {},
                  required: []
                }
              }
            });
          }
          logger.info(
            MODULE_AGENT,
            `Discovered ${tools.length - 2} network tools from broker${this.toolPrefixes.length > 0 ? ` (filtered by prefixes: ${this.toolPrefixes.join(', ')})` : ''}`,
            timer.elapsed('factory')
          );
        }
      } catch (error: any) {
        logger.warn(
          MODULE_AGENT,
          `Failed to discover network tools from broker: ${error.message} — falling back to hardcoded definitions`,
          timer.elapsed('factory')
        );
        // Fallback: use hardcoded git tools if discovery fails
        this.appendHardcodedGitTools(tools);
      }
    } else {
      // Not connected to broker — use hardcoded fallback
      logger.warn(MODULE_AGENT, 'Not connected to broker — using hardcoded tool definitions', timer.elapsed('factory'));
      this.appendHardcodedGitTools(tools);
    }

    return tools;
  }

  /**
   * Fallback: append hardcoded git tool definitions when broker discovery fails
   */
  private appendHardcodedGitTools(tools: ToolDefinition[]): void {
    if (this.toolPrefixes.length > 0 && !this.toolPrefixes.some(p => p.startsWith('git_git_'))) return;

    tools.push(
      {
        type: 'function',
        function: {
          name: 'git_git_status',
          description: 'Show git working tree status',
          parameters: { type: 'object', properties: { path: { type: 'string', description: 'Repository path (defaults to working dir)' } } }
        }
      },
      {
        type: 'function',
        function: {
          name: 'git_git_add',
          description: 'Stage files for commit',
          parameters: { type: 'object', properties: { files: { type: 'array', items: { type: 'string' }, description: 'File paths to stage' }, all: { type: 'boolean', description: 'Stage all changes' }, path: { type: 'string', description: 'Repository path' } }, required: ['files'] }
        }
      },
      {
        type: 'function',
        function: {
          name: 'git_git_commit',
          description: 'Create a new git commit with staged changes',
          parameters: { type: 'object', properties: { message: { type: 'string', description: 'Commit message' }, path: { type: 'string', description: 'Repository path' } }, required: ['message'] }
        }
      },
      {
        type: 'function',
        function: {
          name: 'git_git_log',
          description: 'View recent commit history',
          parameters: { type: 'object', properties: { maxCount: { type: 'number', description: 'Max commits to show' }, path: { type: 'string', description: 'Repository path' } } }
        }
      },
      {
        type: 'function',
        function: {
          name: 'git_git_diff',
          description: 'Show changes between commits or working tree',
          parameters: { type: 'object', properties: { path: { type: 'string', description: 'Repository path' } } }
        }
      }
    );
  }

  /**
   * @deprecated Use buildToolDefinitionsAsync() instead. Kept for backward compatibility.
   */
  protected buildToolDefinitions(): ToolDefinition[] {
    const tools: ToolDefinition[] = [];

    tools.push({
      type: 'function',
      function: {
        name: 'write_file',
        description: 'Write content to a file in the worktree. Creates parent directories if needed.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Absolute file path within the worktree' },
            content: { type: 'string', description: 'File content to write' }
          },
          required: ['path', 'content']
        }
      }
    });

    tools.push({
      type: 'function',
      function: {
        name: 'read_file',
        description: 'Read content from a file in the worktree.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Absolute file path within the worktree' }
          },
          required: ['path']
        }
      }
    });

    this.appendHardcodedGitTools(tools);

    return tools;
  }

  /**
   * Execute a remote MCP tool or local file operation via KĀDI broker
   *
   * Routes tool calls to either local file operations (write_file, read_file)
   * or remote MCP tools via client.invokeRemote().
   *
   * @param toolName - Tool name (e.g., 'git_git_add', 'write_file')
   * @param toolArgs - Tool arguments object
   * @returns Tool execution result
   */
  protected async executeRemoteTool(toolName: string, toolArgs: Record<string, any>): Promise<any> {
    // Handle local file operations (not MCP)
    if (toolName === 'write_file') {
      const filePath = toolArgs.path as string;
      // Validate path is within worktree
      const normalizedPath = filePath.replace(/\\/g, '/');
      const normalizedWorktree = this.worktreePath.replace(/\\/g, '/');
      if (!normalizedPath.startsWith(normalizedWorktree)) {
        throw new Error(`Path ${filePath} is outside worktree ${this.worktreePath}`);
      }
      const fs = await import('fs/promises');
      const path = await import('path');
      // Ensure parent directory exists
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, toolArgs.content as string, 'utf-8');
      return { success: true, path: filePath, bytesWritten: (toolArgs.content as string).length };
    }

    if (toolName === 'read_file') {
      const filePath = toolArgs.path as string;
      const normalizedPath = filePath.replace(/\\/g, '/');
      const normalizedWorktree = this.worktreePath.replace(/\\/g, '/');
      if (!normalizedPath.startsWith(normalizedWorktree)) {
        throw new Error(`Path ${filePath} is outside worktree ${this.worktreePath}`);
      }
      const fs = await import('fs/promises');
      const content = await fs.readFile(filePath, 'utf-8');
      return { success: true, content };
    }

    // Route to MCP tool via KĀDI broker
    const result = await this.client.invokeRemote<any>(toolName, toolArgs);

    // Check for error responses from the broker/tool
    if (result?.isError) {
      const errorText = result?.content?.[0]?.text ?? JSON.stringify(result);
      throw new Error(`Remote tool ${toolName} returned error: ${errorText}`);
    }

    // invokeRemote returns { content: [{ type, text }] } — extract text
    if (result?.content?.[0]?.text) {
      try {
        return JSON.parse(result.content[0].text);
      } catch {
        return result.content[0].text;
      }
    }
    return result;
  }

  /**
   * Track file operations from tool call results
   *
   * Inspects tool name and arguments to determine which files were
   * created or modified during the agent loop.
   */
  private trackFileOperations(
    toolName: string,
    toolArgs: Record<string, any>,
    _toolResult: any,
    filesCreated: string[],
    filesModified: string[]
  ): void {
    if (toolName === 'write_file') {
      const filePath = toolArgs.path as string;
      // Extract relative path from worktree
      const relativePath = filePath.replace(/\\/g, '/').replace(
        this.worktreePath.replace(/\\/g, '/') + '/',
        ''
      );
      if (!filesCreated.includes(relativePath) && !filesModified.includes(relativePath)) {
        filesCreated.push(relativePath);
      }
    }
  }

  /**
   * Extract commit SHA from git_commit tool result
   */
  private extractCommitSha(toolResult: any): string | null {
    if (typeof toolResult === 'string') {
      const match = toolResult.match(/\b([a-f0-9]{7,40})\b/);
      return match ? match[1] : null;
    }
    // Check common property names for commit SHA (including mcp-server-git's "commitHash")
    if (toolResult?.commitHash) return toolResult.commitHash;
    if (toolResult?.sha) return toolResult.sha;
    if (toolResult?.commit) return toolResult.commit;
    if (toolResult?.hash) return toolResult.hash;
    // Try to find SHA in stringified result
    const str = JSON.stringify(toolResult);
    const match = str.match(/"(?:commitHash|sha|hash|commit)":\s*"([a-f0-9]{7,40})"/);
    return match ? match[1] : null;
  }

  /**
   * Sanitize filename to remove unsafe characters
   *
   * Utility method kept for subclass use and backward compatibility.
   *
   * @param filename - Raw filename
   * @returns Sanitized filename safe for filesystem
   */
  protected sanitizeFilename(filename: string): string {
    return filename.replace(/[^a-zA-Z0-9._\-/]/g, '_');
  }

  /**
   * Format commit message for git commit
   *
   * Utility method kept for subclass use. The tool-calling loop
   * instructs the LLM to use this format in the system prompt.
   *
   * @param taskId - Task ID to include in commit message
   * @param files - Array of file paths that were modified/created
   * @param taskDescription - Optional task description for context
   * @returns Formatted commit message
   */
  protected formatCommitMessage(taskId: string, files: string[], taskDescription?: string): string {
    if (this.config.customBehaviors?.formatCommitMessage) {
      return this.config.customBehaviors.formatCommitMessage(taskId, files);
    }

    if (taskDescription) {
      const commitMsgMatch = taskDescription.match(
        /(?:commit.*?(?:with\s+)?message|commit\s+message)[\s:]*['"`]([^'"`]+)['"`]/i
      );
      if (commitMsgMatch) {
        return commitMsgMatch[1];
      }
    }

    return `feat: create ${this.role} for task ${taskId}`;
  }

  /**
   * Publish task completion event
   *
   * Publishes TaskReviewRequestedPayload to KĀDI broker on the qa network.
   * Per QUEST_WORKFLOW_V2: worker → task.review_requested → agent-qa for validation.
   *
   * Publishing failures are handled gracefully - errors are logged but do not throw.
   * This ensures task execution completes even if event publishing fails.
   *
   * @param taskId - Task ID that completed
   * @param filesCreated - Array of file paths created during task execution
   * @param filesModified - Array of file paths modified during task execution
   * @param commitSha - Git commit SHA of the commit containing task output
   *
   * @example
   * ```typescript
   * await this.publishCompletion(
   *   'task-123',
   *   ['artwork.png'],
   *   [],
   *   'a1b2c3d4e5f6g7h8i9j0'
   * );
   * // Publishes to: task.review_requested (→ agent-qa)
   * ```
   */
  protected async publishCompletion(
    taskId: string,
    questId: string | undefined,
    _filesCreated: string[],
    _filesModified: string[],
    commitSha: string,
    _contentSummary?: string,
    retryAttempt?: number,
  ): Promise<void> {
    // Per QUEST_WORKFLOW_V2: worker publishes task.review_requested → agent-qa for validation
    const topic = `task.review_requested`;

    // Create payload matching TaskReviewRequestedPayload schema
    const payload: TaskReviewRequestedPayload = {
      taskId,
      questId: questId || '',
      branch: this.worktreePath,
      commitHash: commitSha,
      ...(retryAttempt && { revisionCount: retryAttempt }),
    };

    try {
      logger.info(MODULE_AGENT, `📢 Publishing review request event`, timer.elapsed('factory'));
      logger.info(MODULE_AGENT, `   Topic: ${topic}`, timer.elapsed('factory'));
      logger.info(MODULE_AGENT, `   Task ID: ${taskId}`, timer.elapsed('factory'));
      if (questId) {
        logger.info(MODULE_AGENT, `   Quest ID: ${questId}`, timer.elapsed('factory'));
      }
      logger.info(MODULE_AGENT, `   Commit SHA: ${commitSha.substring(0, 7)}`, timer.elapsed('factory'));

      await this.client.publish(topic, payload, { broker: 'default', network: 'qa' });

      logger.info(MODULE_AGENT, `   ✅ Review request published to qa network`, timer.elapsed('factory'));

      // Store task memory (fire-and-forget) for learning from past outcomes
      if (this.memoryService) {
        this.memoryService.storeTaskMemory({
          taskId,
          questId: questId || '',
          agentId: this.client.readAgentJson().name || `agent-worker-${this.role}`,
          agentRole: this.role,
          taskType: this.role,
          description: _contentSummary || `Task ${taskId} completed`,
          outcome: 'success',
          context: `worktree: ${this.worktreePath}`,
          result: `commit: ${commitSha}`,
          entities: [],
          duration: 0,
          timestamp: Date.now(),
        }).catch((err: any) => {
          logger.warn(MODULE_AGENT, `Failed to store task memory (non-fatal): ${err.message || String(err)}`, timer.elapsed('factory'));
        });
      }

    } catch (error: any) {
      // Handle publishing failures gracefully - don't throw
      logger.error(MODULE_AGENT, `Failed to publish review request event (non-fatal)`, timer.elapsed('factory'), error);
      logger.error(MODULE_AGENT, `   Error: ${error.message || String(error)}`, timer.elapsed('factory'));
      logger.error(MODULE_AGENT, `   Task execution succeeded despite event publishing failure`, timer.elapsed('factory'));
      // Don't throw - event publishing failure should not fail the task
    }
  }

  /**
   * Publish task failure event
   *
   * Publishes TaskFailedEvent to KĀDI broker with topic pattern: {role}.task.failed
   * Event payload matches TaskFailedEvent schema exactly for backward compatibility.
   *
   * Publishing failures are handled gracefully - errors are logged but do not throw.
   * This prevents cascading failures when event publishing is unavailable.
   *
   * @param taskId - Task ID that failed
   * @param error - Error that caused task failure
   *
   * @example
   * ```typescript
   * try {
   *   await this.executeTask(task);
   * } catch (error) {
   *   await this.publishFailure('task-123', error as Error);
   *   // Publishes to: task.failed
   * }
   * ```
   */
  protected async publishFailure(taskId: string, error: Error, questId?: string, retryAttempt?: number): Promise<void> {
    // Generic topic — agent identity is in the payload (agent, role fields)
    const topic = `task.failed`;

    // Create payload matching TaskFailedEvent schema
    const payload: TaskFailedEvent = {
      taskId,
      questId: questId || '',
      role: this.role,
      error: error.message || String(error),
      timestamp: new Date().toISOString(),
      agent: `agent-${this.role}`,
      retryAttempt: retryAttempt ?? 0
    };

    try {
      logger.info(MODULE_AGENT, `📢 Publishing failure event`, timer.elapsed('factory'));
      logger.info(MODULE_AGENT, `   Topic: ${topic}`, timer.elapsed('factory'));
      logger.info(MODULE_AGENT, `   Task ID: ${taskId}`, timer.elapsed('factory'));
      logger.info(MODULE_AGENT, `   Error: ${error.message.substring(0, 100)}${error.message.length > 100 ? '...' : ''}`, timer.elapsed('factory'));

      await this.client.publish(topic, payload, { broker: 'default', network: this.role });

      logger.info(MODULE_AGENT, `   ✅ Failure event published`, timer.elapsed('factory'));

    } catch (publishError: any) {
      // Handle publishing failures gracefully - don't throw
      logger.error(MODULE_AGENT, `Failed to publish failure event (non-fatal)`, timer.elapsed('factory'), publishError);
      logger.error(MODULE_AGENT, `   Error: ${publishError.message || String(publishError)}`, timer.elapsed('factory'));
      // Don't throw - cascading event publishing failure is worse than no event
    }
  }

  /**
   * Validate whether a task matches this agent's capabilities
   *
   * Performs keyword matching between the task description and the agent's
   * capability list. If no overlap is found, returns a rejection reason.
   *
   * @param task - Task assignment event to validate
   * @returns Rejection reason string if task doesn't match, null if it does
   */
  protected validateTaskCapability(task: TaskAssignedEvent): string | null {
    const taskText = `${task.description} ${task.requirements}`.toLowerCase();

    // Check if any capability keyword appears in the task description
    const matchedCapabilities: string[] = [];
    for (const capability of this.capabilities) {
      const capWords = capability.toLowerCase().split('-');
      for (const word of capWords) {
        if (word.length > 2 && taskText.includes(word)) {
          matchedCapabilities.push(capability);
          break;
        }
      }
    }

    if (matchedCapabilities.length > 0) {
      logger.info(MODULE_AGENT, `   Matched capabilities: ${matchedCapabilities.join(', ')}`, timer.elapsed('factory'));
      return null; // Task matches capabilities
    }

    // No capability match found — reject
    return `Task "${task.description.substring(0, 80)}" does not match agent capabilities [${this.capabilities.join(', ')}]. This ${this.role} agent cannot handle this type of work.`;
  }

  /**
   * Validate that task targets paths within this agent's worktree.
   *
   * Extracts absolute file paths from task description and requirements,
   * then checks if any fall outside the agent's worktree directory.
   *
   * @param task - Task assignment event to validate
   * @returns Rejection reason string if task targets out-of-scope paths, null if OK
   */
  protected validateTaskScope(task: TaskAssignedEvent): string | null {
    const combined = `${task.description || ''} ${task.requirements || ''}`;

    // Extract absolute file paths (Windows C:\... and Unix /foo/bar with 2+ segments)
    const pathPattern = /[A-Za-z]:\\[\w\\.\-\s]+|\/[\w.\-]+(?:\/[\w.\-]+)+/g;
    const paths = combined.match(pathPattern) || [];

    if (paths.length === 0) {
      return null; // No absolute paths found — allow execution
    }

    const worktreeNormalized = this.worktreePath.replace(/\\/g, '/').replace(/\/+/g, '/').toLowerCase();

    for (const rawPath of paths) {
      const normalized = rawPath.replace(/\\/g, '/').replace(/\/+/g, '/').toLowerCase().trimEnd();
      // Only check absolute paths
      const isAbsolute = /^[a-z]:\//.test(normalized) || normalized.startsWith('/');
      if (isAbsolute && !normalized.startsWith(worktreeNormalized)) {
        return `Task references path "${rawPath.trim()}" which is outside this agent's worktree "${this.worktreePath}". Agent cannot operate on files outside its designated directory.`;
      }
    }

    return null;
  }

  /**
   * Publish task rejection event
   *
   * Publishes TaskRejectedEvent to KĀDI broker with topic: task.rejected
   * This notifies agent-producer that the task was rejected due to capability mismatch,
   * allowing it to reassign or escalate to the human.
   *
   * @param taskId - Task ID that was rejected
   * @param questId - Quest ID (optional)
   * @param reason - Reason for rejection
   */
  protected async publishRejection(
    taskId: string,
    questId: string | undefined,
    reason: string
  ): Promise<void> {
    const topic = `task.rejected`;

    const payload: TaskRejectedEvent = {
      taskId,
      questId,
      role: this.role,
      reason,
      timestamp: new Date().toISOString(),
      agent: `agent-${this.role}`
    };

    try {
      logger.info(MODULE_AGENT, `📢 Publishing rejection event`, timer.elapsed('factory'));
      logger.info(MODULE_AGENT, `   Topic: ${topic}`, timer.elapsed('factory'));
      logger.info(MODULE_AGENT, `   Task ID: ${taskId}`, timer.elapsed('factory'));
      logger.info(MODULE_AGENT, `   Reason: ${reason.substring(0, 100)}${reason.length > 100 ? '...' : ''}`, timer.elapsed('factory'));

      await this.client.publish(topic, payload, { broker: 'default', network: this.role });

      logger.info(MODULE_AGENT, `   ✅ Rejection event published`, timer.elapsed('factory'));

    } catch (error: any) {
      // Handle publishing failures gracefully — don't throw
      logger.error(MODULE_AGENT, `Failed to publish rejection event (non-fatal)`, timer.elapsed('factory'), error);
      logger.error(MODULE_AGENT, `   Error: ${error.message || String(error)}`, timer.elapsed('factory'));
    }
  }

  // ============================================================================
  // Lifecycle Methods (Public API)
  // ============================================================================

  /**
   * Start the worker agent
   *
   * Performs initialization sequence:
   * 1. Connect to KĀDI broker
   * 2. Initialize broker protocol
   * 3. Connect event publisher
   * 4. Subscribe to {role}.task.assigned events
   * 5. Enter event loop (non-blocking)
   *
   * After start() completes, the agent is ready to receive task assignments.
   *
   * @throws {Error} If broker connection fails after all retries
   *
   * @example
   * ```typescript
   * const agent = new BaseWorkerAgent(config);
   * await agent.start();
   * console.log('Agent is now listening for task assignments');
   * ```
   */
  public async start(): Promise<void> {
    logger.info(MODULE_AGENT, '='.repeat(60), timer.elapsed('factory'));
    logger.info(MODULE_AGENT, `Starting Worker Agent: ${this.role}`, timer.elapsed('factory'));
    logger.info(MODULE_AGENT, '='.repeat(60), timer.elapsed('factory'));
    logger.info(MODULE_AGENT, `Broker URL: ${this.config.brokerUrl}`, timer.elapsed('factory'));
    logger.info(MODULE_AGENT, `Networks: ${this.networks.join(', ')}`, timer.elapsed('factory'));
    logger.info(MODULE_AGENT, `Worktree Path: ${this.worktreePath}`, timer.elapsed('factory'));
    logger.info(MODULE_AGENT, `LLM Model: ${this.claudeModel}`, timer.elapsed('factory'));
    logger.info(MODULE_AGENT, '='.repeat(60), timer.elapsed('factory'));

    // Initialize KĀDI client and connect to broker
    await this.initializeClient();

    // Subscribe to task assignment events
    await this.subscribeToTaskAssignments();

    // TODO: Implement remaining start logic in next tasks
    // 1. Register tools (if any)
  }

  /**
   * Stop the worker agent
   *
   * Performs cleanup sequence:
   * 1. Unsubscribe from all events (TODO: next task)
   * 2. Disconnect event publisher
   * 3. Disconnect KĀDI client
   * 4. Clear protocol reference
   *
   * After stop() completes, the agent is fully shut down and can be safely destroyed.
   *
   * @example
   * ```typescript
   * await agent.stop();
   * console.log('Agent has been stopped');
   * ```
   */
  public async stop(): Promise<void> {
    logger.info(MODULE_AGENT, '='.repeat(60), timer.elapsed('factory'));
    logger.info(MODULE_AGENT, `Stopping Worker Agent: ${this.role}`, timer.elapsed('factory'));
    logger.info(MODULE_AGENT, '='.repeat(60), timer.elapsed('factory'));

    try {
      // TODO: Unsubscribe from events in next task

      // Disconnect KĀDI client
      logger.info(MODULE_AGENT, '   → Disconnecting KĀDI client...', timer.elapsed('factory'));
      await this.client.disconnect();
      logger.info(MODULE_AGENT, '   ✅ KĀDI client disconnected', timer.elapsed('factory'));

      // Clear references
      this.providerManager = null;

      logger.info(MODULE_AGENT, '', timer.elapsed('factory'));
      logger.info(MODULE_AGENT, '✅ Worker agent stopped successfully', timer.elapsed('factory'));
      logger.info(MODULE_AGENT, '='.repeat(60), timer.elapsed('factory'));

    } catch (error: any) {
      logger.error(MODULE_AGENT, '', timer.elapsed('factory'));
      logger.error(MODULE_AGENT, 'Error during shutdown', timer.elapsed('factory'), error);
      logger.error(MODULE_AGENT, `   Error: ${error.message || String(error)}`, timer.elapsed('factory'));
      logger.error(MODULE_AGENT, '', timer.elapsed('factory'));
      // Don't throw - best effort cleanup
    }
  }

  // ============================================================================
  // Protected Helper Methods (for subclass/extension use)
  // ============================================================================

  /**
   * Invoke tool with retry logic using composed BaseBot
   *
   * Delegates to BaseBot's invokeToolWithRetry() method for resilient tool invocation.
   * This demonstrates the composition pattern - we use BaseBot's functionality
   * without inheriting from it.
   *
   * @param params - Tool invocation parameters
   * @returns Tool invocation result
   *
   * @example
   * ```typescript
   * const result = await this.invokeToolWithRetry({
   *   targetAgent: 'mcp-server-git',
   *   toolName: 'git_commit',
   *   toolInput: { message: 'feat: create artwork', files: ['artwork.png'] },
   *   timeout: 30000
   * });
   * ```
   */
  protected async invokeToolWithRetry(params: {
    targetAgent: string;
    toolName: string;
    toolInput: any;
    timeout: number;
  }): Promise<any> {
    if (!this.baseBot) {
      // Fallback: direct invocation without retry
      return this.client.invokeRemote(params.toolName, params.toolInput);
    }
    return this.baseBot['invokeToolWithRetry'](params);
  }

  /**
   * Check circuit breaker state using composed BaseBot
   *
   * @returns True if circuit is open, false if closed (or no BaseBot)
   */
  protected checkCircuitBreaker(): boolean {
    if (!this.baseBot) return false;
    return this.baseBot['checkCircuitBreaker']();
  }

  // ============================================================================
  // Public Setters (for dependency injection)
  // ============================================================================

  /**
   * Set the ProviderManager for LLM chat
   *
   * Called by the agent entry point after constructing BaseAgent
   * (which creates the ProviderManager).
   *
   * @param pm - ProviderManager instance from BaseAgent
   */
  public setProviderManager(pm: ProviderManager): void {
    this.providerManager = pm;
  }

  /**
   * Set the MemoryService for task memory storage and recall
   *
   * Called by the agent entry point after constructing BaseAgent
   * (which creates the MemoryService).
   *
   * @param ms - MemoryService instance from BaseAgent
   */
  public setMemoryService(ms: MemoryService): void {
    this.memoryService = ms;
  }

  /**
   * Configure role-specific settings from a loaded RoleConfig
   *
   * @param roleConfig - Parsed role configuration
   */
  public applyRoleConfig(roleConfig: {
    capabilities?: string[];
    tools?: string[];
    provider?: { model?: string; temperature?: number; maxTokens?: number };
    commitFormat?: string;
  }): void {
    if (roleConfig.capabilities) this.capabilities = roleConfig.capabilities;
    if (roleConfig.tools) this.toolPrefixes = roleConfig.tools;
    if (roleConfig.provider?.model) this.claudeModel = roleConfig.provider.model;
    if (roleConfig.provider?.temperature !== undefined) this.temperature = roleConfig.provider.temperature;
    if (roleConfig.provider?.maxTokens !== undefined) this.maxTokens = roleConfig.provider.maxTokens;
    if (roleConfig.commitFormat) this.commitFormat = roleConfig.commitFormat;
  }
}

// ============================================================================
// Factory Function (to be implemented)
// ============================================================================

// ============================================================================
// WorkerAgentFactory (Public API)
// ============================================================================

/**
 * Factory class for creating worker agents with validated configuration
 *
 * Provides static factory method for instantiating worker agents with:
 * - Runtime configuration validation using Zod schemas
 * - Descriptive error messages for invalid configurations
 * - Type-safe agent creation with compile-time checks
 * - Clean separation between validation and instantiation
 *
 * The factory validates all required configuration fields before creating
 * the agent instance, ensuring early failure with clear error messages
 * rather than runtime errors during agent execution.
 *
 * @example
 * ```typescript
 * // Minimal agent creation (10-15 lines)
 * import { WorkerAgentFactory } from 'agents-library';
 *
 * const agent = WorkerAgentFactory.createAgent({
 *   role: 'artist',
 *   worktreePath: 'C:/p4/Personal/SD/agent-playground-artist',
 *   brokerUrl: 'ws://localhost:8080/kadi',
 *   networks: ['kadi'],
 *   anthropicApiKey: process.env.ANTHROPIC_API_KEY!
 * });
 *
 * await agent.start();
 * // Agent now listens for artist.task.assigned events
 * ```
 *
 * @example
 * ```typescript
 * // With custom behaviors (under 50 lines)
 * import { WorkerAgentFactory } from 'agents-library';
 *
 * const agent = WorkerAgentFactory.createAgent({
 *   role: 'artist',
 *   worktreePath: 'C:/p4/Personal/SD/agent-playground-artist',
 *   brokerUrl: 'ws://localhost:8080/kadi',
 *   networks: ['kadi'],
 *   anthropicApiKey: process.env.ANTHROPIC_API_KEY!,
 *   claudeModel: 'claude-sonnet-4-20250514',
 *   customBehaviors: {
 *     determineFilename: (taskId, description) => {
 *       // Custom filename logic
 *       return `artwork-${taskId}.png`;
 *     },
 *     formatCommitMessage: (taskId, files) => {
 *       // Custom commit message format
 *       return `feat: create artwork for ${taskId}`;
 *     }
 *   }
 * });
 *
 * await agent.start();
 * console.log('Agent started successfully');
 * ```
 */
export class WorkerAgentFactory {
  /**
   * Create a worker agent with validated configuration
   *
   * Static factory method that validates configuration and creates a
   * BaseWorkerAgent instance ready for start().
   *
   * Validation performed:
   * - Role must be 'artist', 'designer', or 'programmer'
   * - Worktree path must be non-empty string
   * - Broker URL must start with ws:// or wss://
   * - Networks array must contain at least one network name
   * - Anthropic API key must be provided
   * - Custom behaviors (if provided) must match expected signatures
   *
   * @param config - Worker agent configuration object
   * @returns Configured BaseWorkerAgent instance (not started)
   *
   * @throws {z.ZodError} If configuration validation fails with detailed error messages
   *
   * @example
   * ```typescript
   * // Basic usage
   * const agent = WorkerAgentFactory.createAgent({
   *   role: 'artist',
   *   worktreePath: 'C:/p4/Personal/SD/agent-playground-artist',
   *   brokerUrl: 'ws://localhost:8080/kadi',
   *   networks: ['kadi'],
   *   anthropicApiKey: process.env.ANTHROPIC_API_KEY!
   * });
   *
   * // Agent is created but not started - caller must call start()
   * await agent.start();
   * ```
   *
   * @example
   * ```typescript
   * // Error handling
   * try {
   *   const agent = WorkerAgentFactory.createAgent(config);
   *   await agent.start();
   * } catch (error) {
   *   if (error instanceof z.ZodError) {
   *     console.error('Configuration validation failed:');
   *     error.issues.forEach(issue => {
   *       console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
   *     });
   *   } else {
   *     console.error('Agent startup failed:', error);
   *   }
   * }
   * ```
   */
  static createAgent(config: WorkerAgentConfig): BaseWorkerAgent {
    try {
      // Validate configuration with Zod schema
      const validatedConfig = WorkerAgentConfigSchema.parse(config);

      // Create and return BaseWorkerAgent instance
      // Agent is not started automatically - caller must call start()
      return new BaseWorkerAgent(validatedConfig);

    } catch (error: any) {
      // Re-throw Zod validation errors with context
      if (error.name === 'ZodError') {
        logger.error(MODULE_AGENT, 'Worker agent configuration validation failed', timer.elapsed('factory'), error);
        logger.error(MODULE_AGENT, '   Validation errors:', timer.elapsed('factory'));
        for (const issue of error.issues || []) {
          logger.error(MODULE_AGENT, `   - ${issue.path.join('.')}: ${issue.message}`, timer.elapsed('factory'));
        }
      }
      throw error;
    }
  }
}

/**
 * Create a worker agent with configuration
 *
 * Convenience function that delegates to WorkerAgentFactory.createAgent().
 * Provides backward compatibility with existing code.
 *
 * @param config - Worker agent configuration
 * @returns Configured BaseWorkerAgent instance
 *
 * @example
 * ```typescript
 * const agent = createWorkerAgent({
 *   role: 'artist',
 *   worktreePath: 'C:/p4/Personal/SD/agent-playground-artist',
 *   brokerUrl: 'ws://localhost:8080/kadi',
 *   networks: ['kadi'],
 *   anthropicApiKey: process.env.ANTHROPIC_API_KEY!
 * });
 * await agent.start();
 * ```
 */
export function createWorkerAgent(config: WorkerAgentConfig): BaseWorkerAgent {
  return WorkerAgentFactory.createAgent(config);
}
