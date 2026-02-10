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
 * @module worker-agent-factory
 */

import { KadiClient, z } from '@kadi.build/core';
import Anthropic from '@anthropic-ai/sdk';
import type { WorkerAgentConfig, AgentRole } from './types/agent-config.js';
import { BaseBot, BaseBotConfig } from './base-bot.js';
import {
  TaskAssignedEvent,
  TaskAssignedEventSchema,
  TaskCompletedEvent,
  TaskFailedEvent
} from './types/event-schemas.js';
import { logger, MODULE_AGENT } from './utils/logger.js';
import { timer } from './utils/timer.js';

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
  role: z.enum(['artist', 'designer', 'programmer']),
  worktreePath: z.string().min(1, 'Worktree path is required'),
  brokerUrl: z.string()
    .min(1, 'Broker URL is required')
    .regex(/^wss?:\/\//, 'Broker URL must start with ws:// or wss://'),
  networks: z.array(z.string().min(1, 'Network name cannot be empty'))
    .min(1, 'At least one network is required'),
  anthropicApiKey: z.string().min(1, 'Anthropic API key is required'),
  claudeModel: z.string().optional(),
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
   * - Registering tools
   * - Subscribing to events
   * - Publishing completion/failure events
   * - Accessing broker protocol for tool invocation
   */
  protected client: KadiClient;

  /**
   * Broker protocol for tool invocation
   *
   * Initialized in start() via client.getBrokerProtocol().
   * Used to invoke tools on other agents via broker.
   */
  protected protocol: any = null;

  /**
   * Anthropic API client for Claude integration
   *
   * Used for task execution orchestration:
   * - Analyzing task requirements
   * - Generating creative content
   * - Making decisions about file structure
   */
  protected anthropic: Anthropic;

  /**
   * Agent role (artist, designer, programmer)
   *
   * Used for:
   * - Event topic construction ({role}.task.assigned)
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
   * @example 'C:/p4/Personal/SD/agent-playground-artist'
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
   * Claude model to use for task execution
   *
   * @default 'claude-sonnet-4-20250514'
   */
  protected claudeModel: string;

  // ============================================================================
  // Private Properties (internal use only)
  // ============================================================================

  /**
   * BaseBot instance for circuit breaker and retry logic (COMPOSITION)
   *
   * This is the key to our composition pattern:
   * - We create a BaseBot instance and delegate resilience operations to it
   * - We do NOT extend BaseBot (inheritance would couple us to its interface)
   * - We can call baseBot.invokeToolWithRetry() for resilient tool invocation
   * - We can call baseBot.checkCircuitBreaker() to respect circuit breaker state
   *
   * Why private?
   * - Implementation detail of composition pattern
   * - External code should not depend on BaseBot's interface
   * - Keeps BaseWorkerAgent API stable if BaseBot changes
   */
  private baseBot: BaseBot;

  /**
   * Full agent configuration
   *
   * Stored for reference and potential reconfiguration.
   */
  private config: WorkerAgentConfig;

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

    // Initialize KĀDI client
    this.client = new KadiClient({
      name: `agent-${config.role}`,
      version: '1.0.0',
      brokers: {
        default: config.brokerUrl
      },
      defaultBroker: 'default',
      networks: config.networks
    });

    // Initialize Anthropic API client
    this.anthropic = new Anthropic({ apiKey: config.anthropicApiKey });

    // COMPOSITION: Create BaseBot instance for circuit breaker and retry logic
    // We pass a minimal BaseBotConfig - BaseBot only needs client, apiKey, and botUserId
    const baseBotConfig: BaseBotConfig = {
      client: this.client,
      anthropicApiKey: config.anthropicApiKey,
      botUserId: `agent-${config.role}` // Use agent name as bot ID
    };
    this.baseBot = new (class extends BaseBot {
      // Anonymous class to satisfy BaseBot's abstract methods
      // We don't use these methods - BaseWorkerAgent has its own task handling
      protected async handleMention(_event: any): Promise<void> {
        // No-op: worker agents don't handle mentions
      }
      public async start(): Promise<void> {
        // No-op: lifecycle managed by BaseWorkerAgent
      }
      public stop(): void {
        // No-op: lifecycle managed by BaseWorkerAgent
      }
    })(baseBotConfig);
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

      // Step 2: Initialize ability response subscription
      logger.info(MODULE_AGENT, '   → Initializing ability response subscription...', timer.elapsed('factory'));
      await this.baseBot['initializeAbilityResponseSubscription']();
      logger.info(MODULE_AGENT, '   ✅ Ability response subscription initialized', timer.elapsed('factory'));

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
   * Execute task with Claude API integration
   *
   * Workflow:
   * 1. Change to worktree directory
   * 2. Determine filename using AI or custom behavior
   * 3. Generate content with Claude API
   * 4. Write file to worktree
   * 5. (Git operations handled in next task)
   *
   * Uses BaseBot retry logic for resilience against transient failures.
   *
   * @param task - Validated task assignment event
   *
   * @example
   * ```typescript
   * await this.executeTask({
   *   taskId: 'task-123',
   *   role: 'artist',
   *   description: 'Create hero banner',
   *   requirements: 'Size: 1920x1080',
   *   timestamp: '2025-12-04T10:30:00.000Z'
   * });
   * ```
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
          }>('quest_quest_get_task_details', {
            taskId: task.taskId
          });

          // Parse task details
          const detailsText = taskDetails.content[0].text;
          const details = JSON.parse(detailsText);
          
          implementationGuide = details.implementationGuide || task.requirements;
          verificationCriteria = details.verificationCriteria || '';
          
          logger.info(MODULE_AGENT, `   ✅ Task details fetched`, timer.elapsed('factory'));
          logger.info(MODULE_AGENT, `   Implementation guide: ${implementationGuide.substring(0, 100)}...`, timer.elapsed('factory'));
          if (verificationCriteria) {
            logger.info(MODULE_AGENT, `   Verification criteria: ${verificationCriteria.substring(0, 100)}...`, timer.elapsed('factory'));
          }
        } catch (error: any) {
          logger.warn(MODULE_AGENT, `   ⚠️  Failed to fetch task details: ${error.message}`, timer.elapsed('factory'));
          logger.warn(MODULE_AGENT, `   Continuing with basic requirements`, timer.elapsed('factory'));
        }
      }

      // Step 2: Change to worktree directory
      const originalCwd = process.cwd();
      logger.info(MODULE_AGENT, `📂 Changing to worktree: ${this.worktreePath}`, timer.elapsed('factory'));
      process.chdir(this.worktreePath);

      try {
        // Step 3: Determine filename
        const fileName = await this.determineFilename(task);
        const filePath = `${this.worktreePath}/${fileName}`;

        // Validate file path is within worktree
        if (!filePath.startsWith(this.worktreePath)) {
          throw new Error(`Invalid file path: must be within worktree ${this.worktreePath}`);
        }

        logger.info(MODULE_AGENT, `📝 Target file: ${fileName}`, timer.elapsed('factory'));

        // Step 4: Generate content with Claude API using implementation guide
        logger.info(MODULE_AGENT, `🤖 Generating content with Claude AI...`, timer.elapsed('factory'));

        const prompt = `You are a ${this.role} agent. Create content for this task:

Task ID: ${task.taskId}
Description: ${task.description}
Implementation Guide: ${implementationGuide}
${verificationCriteria ? `Verification Criteria: ${verificationCriteria}` : ''}

Instructions:
1. Follow the implementation guide carefully
2. Create appropriate content based on the task description
3. Ensure the output meets the verification criteria (if provided)
4. Make the content professional and high-quality
5. For ${this.role} role, focus on ${this.role === 'artist' ? 'creative and artistic elements' : this.role === 'designer' ? 'design principles and aesthetics' : 'code quality and best practices'}

Respond with ONLY the file content, no explanations or markdown code blocks.`;

        const stream = await this.anthropic.messages.stream({
          model: this.claudeModel,
          max_tokens: 4096,
          messages: [{
            role: 'user',
            content: prompt
          }]
        });

        // Collect streamed content
        let content = '';
        for await (const chunk of stream) {
          if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
            content += chunk.delta.text;
          }
        }

        logger.info(MODULE_AGENT, `   ✅ Content generated (${content.length} characters)`, timer.elapsed('factory'));

        // Step 5: Write file to worktree
        logger.info(MODULE_AGENT, `💾 Writing file: ${filePath}`, timer.elapsed('factory'));

        const fs = await import('fs/promises');
        await fs.writeFile(filePath, content, 'utf-8');

        logger.info(MODULE_AGENT, `   ✅ File written: ${fileName}`, timer.elapsed('factory'));

        // Step 6: Commit changes with git
        const commitSha = await this.commitChanges(task.taskId, [fileName]);

        // Step 7: Publish completion event with questId
        await this.publishCompletion(
          task.taskId,
          task.questId,
          [fileName],  // filesCreated
          [],          // filesModified (none in this implementation)
          commitSha
        );

        logger.info(MODULE_AGENT, `✅ Task ${task.taskId} execution completed`, timer.elapsed('factory'));

      } finally {
        // Always restore original working directory
        process.chdir(originalCwd);
      }

    } catch (error: any) {
      logger.error(MODULE_AGENT, `Failed to execute task ${task.taskId}`, timer.elapsed('factory'), error);
      logger.error(MODULE_AGENT, `   Error: ${error.message || String(error)}`, timer.elapsed('factory'));
      logger.error(MODULE_AGENT, `   Stack: ${error.stack || 'No stack trace'}`, timer.elapsed('factory'));

      // Publish failure event
      await this.publishFailure(task.taskId, error);

      throw error; // Re-throw for caller to handle
    }
  }

  /**
   * Determine filename for task output
   *
   * Strategy:
   * 1. If config.customBehaviors.determineFilename exists, use it
   * 2. Otherwise, use Claude API to determine filename from task description
   * 3. Fallback to default pattern if AI determination fails
   *
   * Uses Claude Haiku for fast, cost-effective filename generation.
   *
   * @param task - Task assignment event
   * @returns Sanitized filename
   *
   * @example
   * ```typescript
   * const filename = await this.determineFilename({
   *   taskId: 'task-123',
   *   role: 'artist',
   *   description: 'Create file named hero-banner.png',
   *   requirements: '',
   *   timestamp: '2025-12-04T10:30:00.000Z'
   * });
   * // Returns: "hero-banner.png"
   * ```
   */
  protected async determineFilename(task: TaskAssignedEvent): Promise<string> {
    // Check if custom behavior is provided
    if (this.config.customBehaviors?.determineFilename) {
      logger.info(MODULE_AGENT, `🔧 Using custom filename behavior`, timer.elapsed('factory'));
      const customFilename = await this.config.customBehaviors.determineFilename(task.taskId, task.description);
      return this.sanitizeFilename(customFilename);
    }

    // Use Claude API to determine filename
    logger.info(MODULE_AGENT, `🤖 Using Claude AI to determine filename...`, timer.elapsed('factory'));

    try {
      const response = await this.anthropic.messages.create({
        model: 'claude-3-haiku-20240307', // Fast and cost-effective
        max_tokens: 200,
        messages: [{
          role: 'user',
          content: `You are a ${this.role} agent. Analyze this task description and determine the appropriate filename:

Task: "${task.description}"

Instructions:
1. If the description explicitly specifies a filename (e.g., "create file named X", "name it Y", "call it Z"), use that EXACT name
2. Remove any angle brackets, quotes, or other markup (e.g., "<placeholder>" becomes "placeholder")
3. If no explicit filename is given, extract a meaningful name from the task description
4. Add appropriate extension based on role:
   - artist: .txt, .md, .html, .svg, etc.
   - designer: .css, .scss, .json, .md, etc.
   - programmer: .ts, .js, .py, .java, etc.
5. If you cannot determine a good filename, respond with: ${this.role}-${task.taskId.substring(0, 8)}.txt

Respond with ONLY the filename, nothing else. No explanations, no markdown, just the filename.`
        }]
      });

      const filename = (response.content[0] as any).text.trim();
      const sanitized = this.sanitizeFilename(filename);

      logger.info(MODULE_AGENT, `   ✅ AI determined filename: ${sanitized}`, timer.elapsed('factory'));
      return sanitized;

    } catch (error: any) {
      logger.error(MODULE_AGENT, `   AI filename determination failed: ${error.message}`, timer.elapsed('factory'), error);
      logger.warn(MODULE_AGENT, `   ⚠️  Falling back to default filename pattern`, timer.elapsed('factory'));
      return `${this.role}-${task.taskId.substring(0, 8)}.txt`;
    }
  }

  /**
   * Sanitize filename to remove unsafe characters
   *
   * Removes all characters except:
   * - Alphanumeric: a-z, A-Z, 0-9
   * - Safe punctuation: . - _
   *
   * @param filename - Raw filename from AI or user
   * @returns Sanitized filename safe for filesystem
   *
   * @example
   * ```typescript
   * this.sanitizeFilename('my file!.txt') // Returns: "my_file_.txt"
   * this.sanitizeFilename('<hero-banner>.png') // Returns: "hero-banner.png"
   * ```
   */
  private sanitizeFilename(filename: string): string {
    return filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  }

  /**
   * Commit changes to git repository
   *
   * Workflow:
   * 1. Stage files with `git add`
   * 2. Commit with formatted message via `git commit`
   * 3. Extract commit SHA from output
   *
   * Uses child_process.exec for git commands with retry logic for transient failures.
   * All commands are executed in config.worktreePath directory.
   *
   * @param taskId - Task ID for commit message formatting
   * @param files - Array of filenames to stage (relative to worktree)
   * @returns Promise that resolves to commit SHA
   *
   * @throws {Error} If git operations fail after retries
   *
   * @example
   * ```typescript
   * const commitSha = await this.commitChanges('task-123', ['artwork.png', 'README.md']);
   * // Runs: git add artwork.png README.md
   * // Then: git commit -m "feat: create artwork for task task-123"
   * // Returns: "a1b2c3d4e5f6g7h8i9j0"
   * ```
   */
  protected async commitChanges(taskId: string, files: string[]): Promise<string> {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);

    logger.info(MODULE_AGENT, `📦 Committing changes for task ${taskId}`, timer.elapsed('factory'));
    logger.info(MODULE_AGENT, `   Files: ${files.join(', ')}`, timer.elapsed('factory'));

    try {
      // Step 1: Stage files with git add
      const addCommand = `git add ${files.join(' ')}`;
      logger.info(MODULE_AGENT, `   → Running: ${addCommand}`, timer.elapsed('factory'));

      await execAsync(addCommand, { cwd: this.worktreePath });
      logger.info(MODULE_AGENT, `   ✅ Files staged`, timer.elapsed('factory'));

      // Step 2: Generate commit message
      const commitMessage = this.formatCommitMessage(taskId, files);
      logger.info(MODULE_AGENT, `   → Commit message: ${commitMessage}`, timer.elapsed('factory'));

      // Step 3: Commit changes
      const commitCommand = `git commit -m "${commitMessage}"`;
      logger.info(MODULE_AGENT, `   → Running: git commit`, timer.elapsed('factory'));

      const { stdout } = await execAsync(commitCommand, { cwd: this.worktreePath });

      // Extract commit SHA from output
      // Git commit output format: "[branch commitSha] commit message"
      const shaMatch = stdout.match(/\[[\w-]+\s+([a-f0-9]+)\]/);
      const commitSha = shaMatch ? shaMatch[1] : 'unknown';

      logger.info(MODULE_AGENT, `   ✅ Changes committed (SHA: ${commitSha.substring(0, 7)})`, timer.elapsed('factory'));
      logger.info(MODULE_AGENT, `   Full output: ${stdout.trim()}`, timer.elapsed('factory'));

      return commitSha;

    } catch (error: any) {
      // Classify error for retry logic
      const errorMessage = error.message?.toLowerCase() || '';

      // Check if this is a transient error (network, lock file, etc.)
      const isTransient =
        errorMessage.includes('lock') ||
        errorMessage.includes('timeout') ||
        errorMessage.includes('connection') ||
        errorMessage.includes('unable to access');

      if (isTransient) {
        logger.warn(MODULE_AGENT, `   ⚠️  Transient git error detected: ${error.message}`, timer.elapsed('factory'));
        logger.warn(MODULE_AGENT, `   Retrying with exponential backoff...`, timer.elapsed('factory'));

        // Retry with exponential backoff for transient errors
        // Note: In production, this should use baseBot.retryWithBackoff
        // For now, implement simple retry logic
        let retries = 3;
        let delay = 1000;

        for (let attempt = 1; attempt <= retries; attempt++) {
          try {
            logger.info(MODULE_AGENT, `   Retry attempt ${attempt}/${retries} (delay: ${delay}ms)`, timer.elapsed('factory'));
            await new Promise(resolve => setTimeout(resolve, delay));

            // Retry git add
            await execAsync(`git add ${files.join(' ')}`, { cwd: this.worktreePath });

            // Retry git commit
            const commitMessage = this.formatCommitMessage(taskId, files);
            const { stdout: retryStdout } = await execAsync(`git commit -m "${commitMessage}"`, { cwd: this.worktreePath });

            // Extract commit SHA from retry output
            const retryShaMatch = retryStdout.match(/\[[\w-]+\s+([a-f0-9]+)\]/);
            const retryCommitSha = retryShaMatch ? retryShaMatch[1] : 'unknown';

            logger.info(MODULE_AGENT, `   ✅ Git operation succeeded on retry ${attempt}`, timer.elapsed('factory'));
            return retryCommitSha; // Success - return SHA

          } catch (retryError: any) {
            if (attempt === retries) {
              // Final attempt failed
              logger.error(MODULE_AGENT, `   All retry attempts exhausted`, timer.elapsed('factory'), retryError);
              throw retryError;
            }
            delay *= 2; // Exponential backoff
          }
        }

        // This should never be reached - all code paths above either return or throw
        throw new Error('Unexpected: retry loop completed without return or throw');

      } else {
        // Permanent error - fail immediately
        logger.error(MODULE_AGENT, `Git operation failed (permanent error)`, timer.elapsed('factory'), error);
        logger.error(MODULE_AGENT, `   Error: ${error.message || String(error)}`, timer.elapsed('factory'));
        logger.error(MODULE_AGENT, `   Command output: ${error.stdout || 'none'}`, timer.elapsed('factory'));
        logger.error(MODULE_AGENT, `   Command stderr: ${error.stderr || 'none'}`, timer.elapsed('factory'));
        throw error;
      }
    }
  }

  /**
   * Format commit message for git commit
   *
   * Strategy pattern implementation:
   * 1. If config.customBehaviors.formatCommitMessage exists, use it
   * 2. Otherwise, use default format: "feat: create {role} for task {taskId}"
   *
   * @param taskId - Task ID to include in commit message
   * @param files - Array of file paths that were modified/created
   * @returns Formatted commit message
   *
   * @example
   * ```typescript
   * // Default format
   * this.formatCommitMessage('task-123', ['artwork.png'])
   * // Returns: "feat: create artist for task task-123"
   *
   * // Custom format (if customBehaviors.formatCommitMessage provided)
   * config.customBehaviors.formatCommitMessage = (taskId, files) =>
   *   `feat: add ${files.join(', ')} for task ${taskId}`;
   * this.formatCommitMessage('task-123', ['artwork.png', 'README.md'])
   * // Returns: "feat: add artwork.png, README.md for task task-123"
   * ```
   */
  protected formatCommitMessage(taskId: string, files: string[]): string {
    // Check if custom behavior is provided
    if (this.config.customBehaviors?.formatCommitMessage) {
      return this.config.customBehaviors.formatCommitMessage(taskId, files);
    }

    // Default format: "feat: create {role} for task {taskId}"
    return `feat: create ${this.role} for task ${taskId}`;
  }

  /**
   * Publish task completion event
   *
   * Publishes TaskCompletedEvent to KĀDI broker with topic pattern: {role}.task.completed
   * Event payload matches TaskCompletedEvent schema exactly for backward compatibility.
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
   * // Publishes to: artist.task.completed
   * ```
   */
  protected async publishCompletion(
    taskId: string,
    questId: string | undefined,
    filesCreated: string[],
    filesModified: string[],
    commitSha: string
  ): Promise<void> {
    // Construct topic dynamically from role (no hardcoding)
    const topic = `${this.role}.task.completed`;

    // Create payload matching TaskCompletedEvent schema
    const payload: TaskCompletedEvent = {
      taskId,
      questId,
      role: this.role,
      status: 'completed',
      filesCreated,
      filesModified,
      commitSha,
      timestamp: new Date().toISOString(),
      agent: `agent-${this.role}`
    };

    try {
      logger.info(MODULE_AGENT, `📢 Publishing completion event`, timer.elapsed('factory'));
      logger.info(MODULE_AGENT, `   Topic: ${topic}`, timer.elapsed('factory'));
      logger.info(MODULE_AGENT, `   Task ID: ${taskId}`, timer.elapsed('factory'));
      if (questId) {
        logger.info(MODULE_AGENT, `   Quest ID: ${questId}`, timer.elapsed('factory'));
      }
      logger.info(MODULE_AGENT, `   Commit SHA: ${commitSha.substring(0, 7)}`, timer.elapsed('factory'));

      await this.client.publish(topic, payload, { broker: 'default', network: 'global' });

      logger.info(MODULE_AGENT, `   ✅ Completion event published`, timer.elapsed('factory'));

    } catch (error: any) {
      // Handle publishing failures gracefully - don't throw
      logger.error(MODULE_AGENT, `Failed to publish completion event (non-fatal)`, timer.elapsed('factory'), error);
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
   *   // Publishes to: artist.task.failed
   * }
   * ```
   */
  protected async publishFailure(taskId: string, error: Error): Promise<void> {
    // Construct topic dynamically from role (no hardcoding)
    const topic = `${this.role}.task.failed`;

    // Create payload matching TaskFailedEvent schema
    const payload: TaskFailedEvent = {
      taskId,
      role: this.role,
      error: error.message || String(error),
      timestamp: new Date().toISOString(),
      agent: `agent-${this.role}`
    };

    try {
      logger.info(MODULE_AGENT, `📢 Publishing failure event`, timer.elapsed('factory'));
      logger.info(MODULE_AGENT, `   Topic: ${topic}`, timer.elapsed('factory'));
      logger.info(MODULE_AGENT, `   Task ID: ${taskId}`, timer.elapsed('factory'));
      logger.info(MODULE_AGENT, `   Error: ${error.message.substring(0, 100)}${error.message.length > 100 ? '...' : ''}`, timer.elapsed('factory'));

      await this.client.publish(topic, payload, { broker: 'default', network: 'global' });

      logger.info(MODULE_AGENT, `   ✅ Failure event published`, timer.elapsed('factory'));

    } catch (publishError: any) {
      // Handle publishing failures gracefully - don't throw
      logger.error(MODULE_AGENT, `Failed to publish failure event (non-fatal)`, timer.elapsed('factory'), publishError);
      logger.error(MODULE_AGENT, `   Error: ${publishError.message || String(publishError)}`, timer.elapsed('factory'));
      // Don't throw - cascading event publishing failure is worse than no event
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
    logger.info(MODULE_AGENT, `Claude Model: ${this.claudeModel}`, timer.elapsed('factory'));
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

      // Clear protocol reference
      this.protocol = null;

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
    // Delegate to BaseBot's retry logic (composition pattern)
    return this.baseBot['invokeToolWithRetry'](params);
  }

  /**
   * Check circuit breaker state using composed BaseBot
   *
   * Returns true if circuit is open (blocking requests).
   * This demonstrates composition - we delegate to BaseBot's circuit breaker.
   *
   * @returns True if circuit is open, false if closed
   *
   * @example
   * ```typescript
   * if (this.checkCircuitBreaker()) {
   *   console.log('Circuit open - skipping task execution');
   *   return;
   * }
   * ```
   */
  protected checkCircuitBreaker(): boolean {
    // Delegate to BaseBot's circuit breaker (composition pattern)
    return this.baseBot['checkCircuitBreaker']();
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
