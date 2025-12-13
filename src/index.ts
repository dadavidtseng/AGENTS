/**
 * Template Agent TypeScript for AGENTS
 * ================================
 *
 * PURPOSE:
 * Worker agent specialized in creative and artistic tasks. Receives task assignments
 * from agent-producer via KĀDI events and executes creative work.
 *
 * ARCHITECTURE:
 * This agent is part of a multi-agent orchestration system where:
 * - Agent listens for artist.task.assigned events from agent-producer
 * - Agent executes artistic tasks in its own git worktree (agent-playground-artist)
 * - Agent publishes artist.task.completed events when work is done
 * - Broker handles all tool routing and network isolation
 *
 * Built-in tools:
 * - Echo (placeholder - will be replaced with artist-specific tools)
 * - list_tools (utility to list all available tools)
 *
 * Broker-provided tools (access via client.load()):
 * - Git operations (from broker's git-mcp-server on 'git' network)
 * - Filesystem operations (from broker's fs-mcp-server on 'global' network)
 *
 * Dependencies:
 * - @kadi.build/core: KĀDI protocol client library with KadiClient and Zod
 * - agents-library: Shared bot infrastructure (slack-bot, discord-bot, BaseBot)
 * - dotenv: Environment variable loading
 *
 * Usage:
 *     npm start              # Production mode
 *     npm run dev            # Development mode with hot-reload
 *     npm run build          # Compile TypeScript
 *     npm test               # Run test suite
 *
 * Environment Variables:
 *     KADI_BROKER_URL: WebSocket URL for KĀDI broker (default: ws://localhost:8080)
 *     KADI_NETWORKS: Networks to join (configured as: global,artist)
 *     AGENT_NAME: Agent identifier (configured as: agent-artist)
 *
 * @module agent-artist
 * @version 1.0.0
 * @license MIT
 */

import 'dotenv/config';
import { KadiClient } from '@kadi.build/core';
import { registerAllTools } from './tools';
import { logger, MODULE_AGENT, timer } from 'agents-library';
import { AnthropicProvider } from './providers/anthropic-provider.js';

// ============================================================================
// Tool Registration via Registry
// ============================================================================
//
// TEMPLATE PATTERN: Tools are registered via the toolRegistry pattern
//
// Core tools (echo, list_tools) are registered via src/tools/echo.ts
// and src/tools/list-tools.ts, then added to the toolRegistry in
// src/tools/index.ts. This provides a clean separation between core
// template tools and user-defined custom tools.
//
// To add new custom tools:
// 1. Create a new file in src/tools/ (e.g., my-tool.ts)
// 2. Export a registration function: export function registerMyTool(client: KadiClient)
// 3. Import and add the function to the toolRegistry array in src/tools/index.ts
// ============================================================================

// ============================================================================
// Configuration
// ============================================================================
//
// TEMPLATE PATTERN: Load configuration from environment variables
//
// TODO: Customize these defaults for your agent
// - brokerUrl: Change if using different broker
// - networks: Update to match your agent's network requirements
//
// Common KĀDI networks:
// - 'global': All agents can see tools on this network
// - 'text': Domain-specific network for text processing
// - 'git': Domain-specific network for git operations
// - 'slack': Domain-specific network for Slack bot operations
// - 'discord': Domain-specific network for Discord bot operations
// ============================================================================

/**
 * Agent configuration loaded from environment variables
 */
const config = {
  /** WebSocket URL for KĀDI broker */
  brokerUrl: process.env.KADI_BROKER_URL || 'ws://localhost:8080',

  /** Networks to join (comma-separated in env var) */
  networks: (process.env.KADI_NETWORKS || 'global,slack,discord').split(',')
};

// ============================================================================
// KĀDI Client
// ============================================================================
//
// TEMPLATE PATTERN: Initialize KadiClient with agent metadata
//
// TODO: Update these fields for your agent
// - name: Unique agent identifier (kebab-case recommended)
// - version: Semantic version of your agent
// - role: Always 'agent' for agent processes
// - broker: Broker WebSocket URL from config
// - networks: Array of network names to join
//
// The client instance is used to:
// 1. Register tools (client.registerTool)
// 2. Publish events (client.publishEvent)
// 3. Load broker tools (client.load)
// 4. Connect and serve (client.serve)
// ============================================================================

/**
 * KĀDI protocol client instance
 *
 * This client handles:
 * - WebSocket connection to broker
 * - Ed25519 authentication
 * - Tool registration and invocation
 * - Event pub/sub
 * - Network isolation
 */
const client = new KadiClient({
  name: process.env.AGENT_NAME || 'template-agent-typescript',
  version: process.env.AGENT_VERSION || '0.0.1',
  role: 'agent',
  broker: config.brokerUrl,
  networks: config.networks
});

// ============================================================================
// Custom Tool Registry
// ============================================================================
//
// Tools are registered via the src/tools/ directory and toolRegistry.
// See registerAllTools(client) call below.
//
// For more information on adding custom tools, see src/tools/index.ts
//
registerAllTools(client);

// ============================================================================
// Task Assignment Event Handler
// ============================================================================
//
// Core agent responsibility: Subscribe to artist.task.assigned events
// This is independent of bot features and handles task execution directly.
//
// Flow:
// 1. agent-producer publishes artist.task.assigned event
// 2. This handler receives event and processes task
// 3. Creates art file in agent-playground-artist worktree
// 4. Publishes completion/failure events
// ============================================================================

/**
 * Subscribe to artist.task.assigned events and handle task execution
 *
 * This is a core agent responsibility independent of Slack/Discord bot features.
 * The agent can receive and execute tasks whether or not bots are enabled.
 *
 * @param client - KĀDI client instance for event subscription
 */
function subscribeToTaskAssignments(client: KadiClient): void {
  const topic = 'artist.task.assigned';

  logger.info(MODULE_AGENT, `Task Handler: Registering subscription {topic: ${topic}}`, timer.elapsed('main'));

  try {
    client.subscribeToEvent(topic, async (event: unknown) => {
      // Extract event data from KĀDI envelope
      const eventData = (event as any)?.data || event;

      logger.info(MODULE_AGENT, `Task Assignment: Event received {taskId: ${eventData.taskId}, role: ${eventData.role}}`, timer.elapsed('main'));

      // Handle task assignment
      await handleTaskAssignment(client, eventData);
    });

    logger.info(MODULE_AGENT, `Task Handler: Subscription registered successfully {topic: ${topic}}`, timer.elapsed('main'));
  } catch (error: any) {
    logger.error(MODULE_AGENT, `Task Handler: Subscription registration failed {topic: ${topic}}`, timer.elapsed('main'), error);
  }
}

/**
 * Use Claude AI to interpret task description and determine filename
 *
 * @param taskDescription - Task description from agent-producer
 * @param taskId - Task ID for fallback naming
 * @returns Filename to create
 */
async function determineFilenameWithAI(taskDescription: string, taskId: string): Promise<string> {
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;

  if (!anthropicApiKey) {
    logger.warn(MODULE_AGENT, 'ANTHROPIC_API_KEY not set, using fallback filename', timer.elapsed('main'));
    return `art-${taskId.substring(0, 8)}.txt`;
  }

  try {
    logger.info(MODULE_AGENT, 'Using Claude AI to interpret task and determine filename', timer.elapsed('main'));

    // Use AnthropicProvider for standardized LLM interaction
    const provider = new AnthropicProvider(anthropicApiKey);

    const result = await provider.chat(
      [{
        role: 'user',
        content: `You are an artist agent. Analyze this task description and determine the appropriate filename:

Task: "${taskDescription}"

Instructions:
1. If the description explicitly specifies a filename (e.g., "create file named X", "name it Y", "call it Z"), use that EXACT name
2. Remove any angle brackets, quotes, or other markup (e.g., "<placeholder>" becomes "placeholder")
3. If no explicit filename is given, extract a meaningful name from the task description
4. Add .txt extension if no extension is specified
5. If you cannot determine a good filename, respond with: art-${taskId.substring(0, 8)}.txt

Respond with ONLY the filename, nothing else. No explanations, no markdown, just the filename.`
      }],
      {
        model: 'claude-3-haiku-20240307',
        maxTokens: 200,
      }
    );

    // Handle provider response
    if (!result.success) {
      logger.error(MODULE_AGENT, `AI filename determination failed: ${result.error.message}`, "+0ms");
      logger.warn(MODULE_AGENT, 'Falling back to default filename pattern', timer.elapsed('main'));
      return `art-${taskId.substring(0, 8)}.txt`;
    }

    const filename = result.data.trim();

    // Sanitize filename (remove any remaining special characters except . - _)
    const sanitized = filename.replace(/[^a-zA-Z0-9._-]/g, '_');

    logger.info(MODULE_AGENT, `AI determined filename: ${sanitized}`, timer.elapsed('main'));
    return sanitized;

  } catch (error: any) {
    logger.error(MODULE_AGENT, 'AI filename determination failed', "+0ms", error);
    logger.warn(MODULE_AGENT, 'Falling back to default filename pattern', timer.elapsed('main'));
    return `art-${taskId.substring(0, 8)}.txt`;
  }
}

/**
 * Handle artist task assignment
 *
 * Executes artistic task in agent-playground-artist worktree:
 * 1. Uses AI to interpret task description and determine filename
 * 2. Validates file paths are within worktree
 * 3. Performs file operations (create/modify)
 * 4. Publishes progress events
 * 5. Makes atomic git commit
 *
 * @param client - KĀDI client for event publishing
 * @param task - Task assignment data from agent-producer
 */
async function handleTaskAssignment(client: KadiClient, task: any): Promise<void> {
  const worktreePath = 'C:/p4/Personal/SD/agent-playground-artist';

  try {
    logger.info(MODULE_AGENT, `Processing artist task: ${task.taskId}`, timer.elapsed('main'));
    logger.info(MODULE_AGENT, `   Description: ${task.description}`, timer.elapsed('main'));

    // Step 0: Call shrimp_execute_task to mark task as in_progress
    const protocol = client.getBrokerProtocol();
    if (!protocol) {
      throw new Error('Protocol not initialized');
    }

    logger.info(MODULE_AGENT, `Marking task as in_progress in shrimp task manager`, timer.elapsed('main'));
    try {
      await protocol.invokeTool({
        targetAgent: 'mcp-server-shrimp-agent-playground',
        toolName: 'shrimp_execute_task',
        toolInput: {
          taskId: task.taskId
        },
        timeout: 30000
      });
      logger.info(MODULE_AGENT, `Task marked as in_progress`, timer.elapsed('main'));
    } catch (error) {
      logger.warn(MODULE_AGENT, `Failed to mark task as in_progress (continuing anyway)`, timer.elapsed('main'), error);
      // Continue execution even if shrimp call fails - this is non-critical
    }

    // Use AI to determine appropriate filename from task description
    const fileName = await determineFilenameWithAI(task.description, task.taskId);
    const filePath = `${worktreePath}/${fileName}`;

    // Validate file path is within worktree
    if (!filePath.startsWith(worktreePath)) {
      throw new Error(`Invalid file path: must be within worktree ${worktreePath}`);
    }

    // Publish file creation event
    client.publishEvent('artist.file.created', {
      taskId: task.taskId,
      fileName,
      filePath,
      timestamp: new Date().toISOString(),
      agent: 'agent-artist'
    });

    // Create art file using filesystem and git MCP servers
    const artContent = `# Artwork for Task ${task.taskId}\n\nCreated: ${new Date().toISOString()}\nDescription: ${task.description}\n\n[Artistic content would go here]`;

    // Step 1: Write file using filesystem server
    logger.info(MODULE_AGENT, `Writing file: ${filePath}`, timer.elapsed('main'));
    await protocol.invokeTool({
      targetAgent: 'fs',
      toolName: 'fs_write_file',
      toolInput: {
        path: filePath,
        content: artContent
      },
      timeout: 30000
    });

    logger.info(MODULE_AGENT, `File written: ${fileName}`, timer.elapsed('main'));

    // Step 2: Set git working directory to worktree
    logger.info(MODULE_AGENT, `Setting git working directory: ${worktreePath}`, timer.elapsed('main'));
    await protocol.invokeTool({
      targetAgent: 'git',
      toolName: 'git_git_set_working_dir',
      toolInput: {
        path: worktreePath
      },
      timeout: 30000
    });

    // Step 3: Stage file with git add
    logger.info(MODULE_AGENT, `Staging file: ${fileName}`, timer.elapsed('main'));
    await protocol.invokeTool({
      targetAgent: 'git',
      toolName: 'git_git_add',
      toolInput: {
        files: [fileName]
      },
      timeout: 30000
    });

    // Step 4: Commit changes
    logger.info(MODULE_AGENT, `Committing changes`, timer.elapsed('main'));
    const commitResult: any = await protocol.invokeTool({
      targetAgent: 'git',
      toolName: 'git_git_commit',
      toolInput: {
        message: `feat: create artwork for task ${task.taskId}`
      },
      timeout: 30000
    });

    logger.debug(MODULE_AGENT, `Commit result:`, JSON.stringify(commitResult, null, 2));
    const commitSha = commitResult?.structuredContent?.commitHash || commitResult?.commitHash || 'unknown';
    logger.info(MODULE_AGENT, `Created and committed art file: ${fileName} (commit: ${commitSha.substring(0, 7)})`, timer.elapsed('main'));

    // Publish task completion event
    client.publishEvent('artist.task.completed', {
      taskId: task.taskId,
      status: 'completed',
      filesCreated: [fileName],
      filesModified: [],
      commitSha: commitSha,
      timestamp: new Date().toISOString(),
      agent: 'agent-artist'
    });

    logger.info(MODULE_AGENT, `Task ${task.taskId} completed successfully`, timer.elapsed('main'));
  } catch (error: any) {
    logger.error(MODULE_AGENT, `Failed to process task ${task.taskId}`, "+0ms", error);

    // Publish failure event
    client.publishEvent('artist.task.failed', {
      taskId: task.taskId,
      error: error.message || String(error),
      timestamp: new Date().toISOString(),
      agent: 'agent-artist'
    });
  }
}

// ============================================================================
// Main Function
// ============================================================================
//
// TEMPLATE PATTERN: Entry point for agent startup
//
// Responsibilities:
// 1. Print startup banner with configuration
// 2. List all registered tools (for debugging/monitoring)
// 3. Connect to broker with client.serve('broker')
// 4. Handle connection errors gracefully
//
// IMPORTANT: client.serve() is a BLOCKING call that:
// - Connects to broker via WebSocket
// - Authenticates with Ed25519 key
// - Registers all tools with broker
// - Enters event loop (never returns)
//
// All informational logs MUST come BEFORE serve() call
// Code after serve() never executes
//
// TODO: Update tool listings to match your agent's tools
// ============================================================================

/**
 * Main entry point for the KĀDI agent
 *
 * Connects to broker and starts serving tool invocation requests.
 * This function blocks indefinitely once serve() is called.
 *
 * @throws {Error} If broker connection fails
 */
async function main() {
  // Start main timer for application lifetime tracking
  timer.start('main');

  logger.info(MODULE_AGENT, '='.repeat(60), timer.elapsed('main'));
  logger.warn(MODULE_AGENT, 'Starting Template Agent (TypeScript)', timer.elapsed('main'));
  logger.info(MODULE_AGENT, '='.repeat(60), timer.elapsed('main'));
  logger.info(MODULE_AGENT, `Broker URL: ${config.brokerUrl}`, timer.elapsed('main'));
  logger.info(MODULE_AGENT, `Networks: ${config.networks.join(', ')}`, timer.elapsed('main'));
  logger.info(MODULE_AGENT, '', timer.elapsed('main'));

  try {
    logger.info(MODULE_AGENT, 'Connecting to broker...', timer.elapsed('main'));
    logger.info(MODULE_AGENT, '', timer.elapsed('main'));

    // TEMPLATE PATTERN: Print tool information BEFORE blocking serve() call
    // Dynamically list all registered tools
    const registeredTools = client.getAllRegisteredTools();
    logger.info(MODULE_AGENT, `Available Tools: ${registeredTools.length} registered`, timer.elapsed('main'));

    if (registeredTools.length > 0) {
      logger.info(MODULE_AGENT, '  Local Tools:', timer.elapsed('main'));
      for (const tool of registeredTools) {
        const description = tool.definition.description || 'No description';
        logger.info(MODULE_AGENT, `    • ${tool.definition.name} - ${description}`, timer.elapsed('main'));
      }
      logger.info(MODULE_AGENT, '', timer.elapsed('main'));
    }

    logger.info(MODULE_AGENT, '  Bot Tools (if enabled):', timer.elapsed('main'));
    logger.info(MODULE_AGENT, '    • Slack bot tools (when ENABLE_SLACK_BOT=true)', timer.elapsed('main'));
    logger.info(MODULE_AGENT, '    • Discord bot tools (when ENABLE_DISCORD_BOT=true)', timer.elapsed('main'));
    logger.info(MODULE_AGENT, '', timer.elapsed('main'));
    logger.info(MODULE_AGENT, '  Broker-provided Tools (via client.load()):', timer.elapsed('main'));
    logger.info(MODULE_AGENT, `    • Tools from '${config.networks.join("', '")}' network(s)`, timer.elapsed('main'));
    logger.info(MODULE_AGENT, '', timer.elapsed('main'));
    logger.info(MODULE_AGENT, 'Press Ctrl+C to stop the agent...', timer.elapsed('main'));
    logger.info(MODULE_AGENT, '='.repeat(60), timer.elapsed('main'));
    logger.info(MODULE_AGENT, '', timer.elapsed('main'));

    // CRITICAL: serve() is blocking - all logs must come BEFORE this line
    // Connect to broker and start serving tool invocations
    // The broker will route tool calls to this agent based on network membership

    // Initialize shared services for bots (ProviderManager and MemoryService)
    const shouldEnableBots = (process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY !== 'YOUR_ANTHROPIC_API_KEY_HERE');

    if (shouldEnableBots) {
      // Wait for broker connection before initializing services
      setTimeout(async () => {
        try {
          // Step 1: Load environment variables
          const anthropicApiKey = process.env.ANTHROPIC_API_KEY!;
          const modelManagerBaseUrl = process.env.MODEL_MANAGER_BASE_URL;
          const modelManagerApiKey = process.env.MODEL_MANAGER_API_KEY;
          const memoryDataPath = process.env.MEMORY_DATA_PATH || './data/memory';
          const arcadedbUrl = process.env.ARCADEDB_URL;
          const arcadedbPassword = process.env.ARCADEDB_ROOT_PASSWORD || 'root';

          logger.info(MODULE_AGENT, 'Initializing shared services for bots...', timer.elapsed('main'));

          // Step 2: Import service classes
          const { ProviderManager } = await import('./providers/provider-manager.js');
          const { AnthropicProvider } = await import('./providers/anthropic-provider.js');
          const { ModelManagerProvider } = await import('./providers/model-manager-provider.js');
          const { MemoryService } = await import('./memory/memory-service.js');

          // Step 3: Instantiate providers
          const anthropicProvider = new AnthropicProvider(anthropicApiKey);
          const providers: any[] = [anthropicProvider];

          // Add ModelManagerProvider if configured
          if (modelManagerBaseUrl && modelManagerApiKey) {
            const modelManagerProvider = new ModelManagerProvider(modelManagerBaseUrl, modelManagerApiKey);
            providers.push(modelManagerProvider);
            logger.info(MODULE_AGENT, '   - ModelManager provider configured', timer.elapsed('main'));
          }

          // Step 4: Create ProviderManager with configuration
          const providerManager = new ProviderManager(
            providers,
            {
              primaryProvider: 'anthropic',
              fallbackProvider: providers.length > 1 ? 'model-manager' : undefined,
              retryAttempts: 3,
              retryDelayMs: 1000,
              healthCheckIntervalMs: 60000,
            }
          );

          logger.info(MODULE_AGENT, '   - ProviderManager initialized with ' + providers.length + ' provider(s)', timer.elapsed('main'));

          // Step 5: Create and initialize MemoryService
          const memoryService = new MemoryService(
            memoryDataPath,
            arcadedbUrl,
            arcadedbPassword,
            providerManager
          );

          await memoryService.initialize();
          logger.info(MODULE_AGENT, '   - MemoryService initialized', timer.elapsed('main'));

          // Store services for graceful shutdown
          (global as any).__providerManager = providerManager;
          (global as any).__memoryService = memoryService;

          // Step 6: Start Slack Bot if enabled
          const shouldEnableSlackBot = (process.env.ENABLE_SLACK_BOT === 'true' || process.env.ENABLE_SLACK_BOT === undefined);
          if (shouldEnableSlackBot) {
            logger.info(MODULE_AGENT, 'Starting Slack bot...', timer.elapsed('main'));
            const { SlackBot } = await import('./bot/slack-bot.js');
            const slackBot = new SlackBot({
              client,
              anthropicApiKey,
              botUserId: process.env.SLACK_BOT_USER_ID!,
              providerManager,
              memoryService,
            });
            slackBot.start();
            logger.info(MODULE_AGENT, 'Slack bot started (subscribed to Slack mention events)', timer.elapsed('main'));
          }

          // Step 7: Start Discord Bot if enabled
          const shouldEnableDiscordBot = (process.env.ENABLE_DISCORD_BOT === 'true' || process.env.ENABLE_DISCORD_BOT === undefined);
          if (shouldEnableDiscordBot) {
            logger.info(MODULE_AGENT, 'Starting Discord bot...', timer.elapsed('main'));
            const { DiscordBot } = await import('./bot/discord-bot.js');
            const discordBot = new DiscordBot({
              client,
              anthropicApiKey,
              botUserId: process.env.DISCORD_BOT_USER_ID!,
              providerManager,
              memoryService,
            });
            discordBot.start();
            logger.info(MODULE_AGENT, 'Discord bot started (subscribed to Discord mention events)', timer.elapsed('main'));
          }

        } catch (error) {
          logger.error(MODULE_AGENT, 'Failed to initialize services or bots', "+0ms", error as Error | string);
        }
      }, 2000); // Wait 2 seconds for broker connection
    } else {
      logger.info(MODULE_AGENT, 'Bots disabled (ANTHROPIC_API_KEY not configured)', timer.elapsed('main'));
      logger.info(MODULE_AGENT, '', timer.elapsed('main'));
    }

    // Subscribe to task assignment events (core agent responsibility, independent of bots)
    logger.info(MODULE_AGENT, 'Subscribing to artist task assignments...', timer.elapsed('main'));
    setTimeout(async () => {
      try {
        subscribeToTaskAssignments(client);
        logger.info(MODULE_AGENT, 'Subscribed to artist.task.assigned events', timer.elapsed('main'));
      } catch (error) {
        logger.error(MODULE_AGENT, 'Failed to subscribe to task assignments', "+0ms", error as Error | string);
      }
    }, 1000); // Wait 1 second for broker connection

    await client.serve('broker');

    // IMPORTANT: This code never executes because serve() blocks indefinitely
    // Connection success is visible when tools start being invoked
    // Connection events and tool listings are printed above
  } catch (error: any) {
    logger.error(MODULE_AGENT, 'Failed to start agent', "+0ms", error);
    if (error.stack) {
      logger.error(MODULE_AGENT, 'Stack trace', "+0ms", error.stack);
    }
    process.exit(1);
  }
}

// ============================================================================
// Graceful Shutdown
// ============================================================================
//
// TEMPLATE PATTERN: Handle process termination signals
//
// SIGINT: Ctrl+C in terminal (user-initiated shutdown)
// SIGTERM: System termination request (Docker/systemd stop)
//
// Both handlers:
// 1. Disconnect from broker cleanly
// 2. Log shutdown status
// 3. Exit with appropriate code (0 for success, 1 for error)
//
// This ensures:
// - Broker knows agent is offline
// - No orphaned connections
// - Clean logs for debugging
//
// TODO: Add cleanup for any additional resources (databases, files, etc.)
// ============================================================================

/**
 * Handle Ctrl+C (SIGINT) for graceful shutdown
 *
 * Disconnects from broker and exits cleanly when user presses Ctrl+C
 */
process.on('SIGINT', async () => {
  logger.info(MODULE_AGENT, 'Shutting down gracefully...', timer.elapsed('main'));

  try {
    // Dispose ProviderManager (closes health check intervals, cleans up resources)
    if ((global as any).__providerManager) {
      await (global as any).__providerManager.dispose();
      logger.info(MODULE_AGENT, 'Disposed ProviderManager', timer.elapsed('main'));
    }

    // Dispose MemoryService (closes ArcadeDB connection, flushes pending writes)
    if ((global as any).__memoryService) {
      await (global as any).__memoryService.dispose();
      logger.info(MODULE_AGENT, 'Disposed MemoryService', timer.elapsed('main'));
    }

    // TEMPLATE PATTERN: Disconnect from broker before exiting
    await client.disconnect();
    logger.info(MODULE_AGENT, 'Disconnected from broker', timer.elapsed('main'));

    process.exit(0);
  } catch (error: any) {
    logger.error(MODULE_AGENT, 'Error during shutdown', "+0ms", error);
    process.exit(1);
  }
});

/**
 * Handle SIGTERM for graceful shutdown
 *
 * Disconnects from broker and exits cleanly when system requests termination
 * (e.g., Docker stop, systemd stop, kill command)
 */
process.on('SIGTERM', async () => {
  logger.info(MODULE_AGENT, 'Shutting down gracefully...', timer.elapsed('main'));

  try {
    // Dispose ProviderManager (closes health check intervals, cleans up resources)
    if ((global as any).__providerManager) {
      await (global as any).__providerManager.dispose();
      logger.info(MODULE_AGENT, 'Disposed ProviderManager', timer.elapsed('main'));
    }

    // Dispose MemoryService (closes ArcadeDB connection, flushes pending writes)
    if ((global as any).__memoryService) {
      await (global as any).__memoryService.dispose();
      logger.info(MODULE_AGENT, 'Disposed MemoryService', timer.elapsed('main'));
    }

    await client.disconnect();
    logger.info(MODULE_AGENT, 'Disconnected from broker', timer.elapsed('main'));

    process.exit(0);
  } catch (error: any) {
    logger.error(MODULE_AGENT, 'Error during shutdown', "+0ms", error);
    process.exit(1);
  }
});

// ============================================================================
// Start Agent
// ============================================================================
//
// TEMPLATE PATTERN: Execute main function and handle fatal errors
//
// This is the last line of the file - starts the agent immediately when
// the module is loaded.
//
// Fatal errors (thrown before serve() connects) are caught here and logged
// ============================================================================

/**
 * Start the agent and handle fatal startup errors
 *
 * This executes immediately when the module loads
 */
main().catch((error) => {
  logger.error(MODULE_AGENT, 'Fatal error', "+0ms", error);
  process.exit(1);
});
