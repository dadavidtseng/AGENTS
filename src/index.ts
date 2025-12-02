/**
 * Artist Agent for KĀDI Protocol
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
 * - @agents/shared: Shared bot infrastructure (slack-bot, discord-bot, BaseBot)
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
import { KadiClient, z } from '@kadi.build/core';
import { registerAllTools } from './tools/index.js';
import Anthropic from '@anthropic-ai/sdk';

// ============================================================================
// Tool Schemas (Zod Schemas)
// ============================================================================
//
// TEMPLATE PATTERN: Define input/output schemas using Zod
//
// 1. Define input schema with z.object()
// 2. Define output schema with z.object()
// 3. Use .describe() on all fields for auto-generated documentation
// 4. Infer TypeScript types using z.infer<typeof schema>
// 5. Use inferred types in tool handler function signatures
//
// TODO: Replace the echo tool schema with your agent's tool schemas
// ============================================================================

/**
 * Input schema for echo tool
 *
 * @example
 * ```typescript
 * const input: EchoInput = {
 *   text: 'hello world'
 * };
 * ```
 */
const echoInputSchema = z.object({
  text: z.string().describe('Text to echo back')
});

/**
 * Output schema for echo tool
 *
 * @example
 * ```typescript
 * const output: EchoOutput = {
 *   echo: 'hello world',
 *   length: 11
 * };
 * ```
 */
const echoOutputSchema = z.object({
  echo: z.string().describe('Echoed text'),
  length: z.number().describe('Length of text')
});

// ============================================================================
// Type Inference from Schemas
// ============================================================================
//
// TEMPLATE PATTERN: Use z.infer to derive TypeScript types from Zod schemas
//
// Benefits:
// - Single source of truth (schema defines both validation and types)
// - Automatic type safety in tool handlers
// - No manual type duplication
// - Changes to schemas automatically update types
//
// TODO: Add type inference for your custom schemas
// ============================================================================

/** Inferred TypeScript type for echo input */
type EchoInput = z.infer<typeof echoInputSchema>;

/** Inferred TypeScript type for echo output */
type EchoOutput = z.infer<typeof echoOutputSchema>;

// ============================================================================
// List Tools Schemas
// ============================================================================

/**
 * Input schema for list_tools utility
 * No parameters needed - just lists all available tools
 */
const listToolsInputSchema = z.object({});

/**
 * Output schema for list_tools utility
 */
const listToolsOutputSchema = z.object({
  summary: z.string().describe('Human-readable markdown summary of all tools'),
  tools: z.array(z.object({
    name: z.string().describe('Tool name'),
    description: z.string().describe('Tool description')
  })).describe('Array of all available tools')
});

/** Inferred TypeScript type for list_tools output */
type ListToolsOutput = z.infer<typeof listToolsOutputSchema>;

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
  version: process.env.AGENT_VERSION || '1.0.0',
  role: 'agent',
  broker: config.brokerUrl,
  networks: config.networks
});

// ============================================================================
// Tool Definitions
// ============================================================================
//
// TEMPLATE PATTERN: Register tools with client.registerTool()
//
// Structure:
// 1. client.registerTool({ metadata }, handler)
// 2. Metadata: name, description, input schema, output schema
// 3. Handler: async function with typed params and return value
// 4. Handler should: validate, execute logic, publish events, return result
//
// Best Practices:
// - Use emoji in console.log for visual distinction (📝 ✅ ❌ 🔍 etc.)
// - Publish events for significant operations (success and error)
// - Include agent name in event payloads for traceability
// - Return structured data matching output schema
// - Use try/catch for operations that might fail
//
// TODO: Replace the echo tool with your agent's tools
// ============================================================================

// TODO: Replace this echo tool with your own domain-specific tools
// The echo tool is a minimal placeholder - it simply returns the input text with its length.
//
// Example of adding a new tool:
// 1. Define input/output schemas using Zod (see lines 78-96)
// 2. Register tool with client.registerTool() (see below)
// 3. Implement your business logic in the handler function
// 4. Publish events for tracking (optional but recommended)
//
// For more examples, see docs/TEMPLATE_USAGE.md

/**
 * Echo Tool (Placeholder)
 *
 * This is a simple placeholder tool that echoes back the input text
 * along with its length. Replace this with your own tools.
 *
 * @param params - Input parameters matching EchoInput schema
 * @returns Echoed text with length metadata
 *
 * @example
 * ```typescript
 * const result = await client.invokeTool('echo', {
 *   text: 'hello world'
 * });
 * // Returns: { echo: 'hello world', length: 11 }
 * ```
 */
client.registerTool({
  name: 'echo',
  description: 'Echo back the input text with its length (placeholder tool - replace with your own)',
  input: echoInputSchema,
  output: echoOutputSchema
}, async (params: EchoInput): Promise<EchoOutput> => {
  console.log(`🔁 Echoing text: "${params.text}"`);

  const result = {
    echo: params.text,
    length: params.text.length
  };

  // TEMPLATE PATTERN: Publish event for operation
  // TODO: Replace 'echo.processed' with your domain-specific event topic
  // TODO: Replace 'template-agent-typescript' with your agent name
  client.publishEvent('echo.processed', {
    operation: 'echo',
    text_length: result.length,
    agent: 'template-agent-typescript'
  });

  return result;
});

// ============================================================================
// List Tools Utility
// ============================================================================

/**
 * List Tools Utility
 *
 * Provides a human-readable formatted list of all available tools (local + network).
 * This solves the UX problem where raw JSON tool schemas are unreadable in Slack.
 *
 * @returns Formatted markdown list of tools with names and descriptions
 *
 * @example
 * ```typescript
 * const result = await client.invokeTool('list_tools', {});
 * // Returns:
 * // {
 * //   summary: "I have 43 tools available:\n\n• *echo*: Echo text...\n• *git_add*: Stage files...",
 * //   tools: [{ name: 'echo', description: '...' }, ...]
 * // }
 * ```
 */
client.registerTool({
  name: 'list_tools',
  description: 'List all available tools in human-readable format (better UX than raw JSON)',
  input: listToolsInputSchema,
  output: listToolsOutputSchema
}, async (): Promise<ListToolsOutput> => {
  console.log('📋 Listing all available tools...');

  try {
    // 1. Get local tools (registered on this agent)
    const localTools = client.getAllRegisteredTools();

    // 2. Get network tools from broker
    const protocol = client.getBrokerProtocol();
    const networkResult = await (protocol as any).connection.sendRequest({
      jsonrpc: '2.0',
      method: 'kadi.ability.list',
      params: {
        networks: config.networks,
        includeProviders: false
      },
      id: `list_tools_${Date.now()}`
    }) as {
      tools: Array<{
        name: string;
        description?: string;
      }>;
    };

    // 3. Deduplicate: prefer local tools over network tools
    const localNames = new Set(localTools.map(t => t.definition.name));
    const uniqueNetworkTools = networkResult.tools.filter(t => !localNames.has(t.name));

    // 4. Combine all tools
    const allTools = [
      ...localTools.map(t => ({
        name: t.definition.name,
        description: t.definition.description || 'No description'
      })),
      ...uniqueNetworkTools.map(t => ({
        name: t.name,
        description: t.description || 'No description'
      }))
    ];

    // 5. Format as Slack-friendly markdown
    const summary = `I have ${allTools.length} tools available:\n\n` +
      allTools.map(t => `• *${t.name}*: ${t.description}`).join('\n');

    console.log(`✅ Listed ${allTools.length} tools (${localTools.length} local + ${uniqueNetworkTools.length} network)`);

    return { summary, tools: allTools };
  } catch (error: any) {
    console.error('❌ Error listing tools:', error);

    // Fallback: return only local tools if broker query fails
    const localTools = client.getAllRegisteredTools();
    const tools = localTools.map(t => ({
      name: t.definition.name,
      description: t.definition.description || 'No description'
    }));

    const summary = `⚠️ Partial list (broker unavailable): ${tools.length} local tools:\n\n` +
      tools.map(t => `• *${t.name}*: ${t.description}`).join('\n');

    return { summary, tools };
  }
});


// ============================================================================
// Custom Tool Registry
// ============================================================================
//
// TEMPLATE PATTERN: Pluggable tool system
//
// Add custom tools by creating files in src/tools/ directory.
// Tools are automatically loaded from the registry.
//
// See src/tools/index.ts for more information.
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

  console.log(`🔍 [DEBUG] subscribeToTaskAssignments called at ${new Date().toISOString()}`);
  console.log(`🔍 [DEBUG] Stack trace:`, new Error().stack);
  console.log(`[KĀDI] Task Handler: Registering subscription {topic: ${topic}}`);

  try {
    client.subscribeToEvent(topic, async (event: unknown) => {
      // Extract event data from KĀDI envelope
      const eventData = (event as any)?.data || event;

      console.log(`🔍 [DEBUG] Event callback invoked at ${new Date().toISOString()}`);
      console.log(`[KĀDI] Task Assignment: Event received {taskId: ${eventData.taskId}, role: ${eventData.role}}`);

      // Handle task assignment
      await handleTaskAssignment(client, eventData);
    });

    console.log(`[KĀDI] Task Handler: Subscription registered successfully {topic: ${topic}}`);
  } catch (error: any) {
    console.error(`[KĀDI] Task Handler: Subscription registration failed {topic: ${topic}, error: ${error.message || 'Unknown error'}}`);
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
    console.warn('⚠️  ANTHROPIC_API_KEY not set, using fallback filename');
    return `art-${taskId.substring(0, 8)}.txt`;
  }

  try {
    console.log('🤖 Using Claude AI to interpret task and determine filename...');

    const anthropic = new Anthropic({ apiKey: anthropicApiKey });

    const response = await anthropic.messages.create({
      model: 'claude-3-haiku-20240307',
      max_tokens: 200,
      messages: [{
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
      }]
    });

    const filename = (response.content[0] as any).text.trim();

    // Sanitize filename (remove any remaining special characters except . - _)
    const sanitized = filename.replace(/[^a-zA-Z0-9._-]/g, '_');

    console.log(`✅ AI determined filename: ${sanitized}`);
    return sanitized;

  } catch (error: any) {
    console.error('❌ AI filename determination failed:', error.message);
    console.log('⚠️  Falling back to default filename pattern');
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
    console.log(`🎨 Processing artist task: ${task.taskId}`);
    console.log(`   Description: ${task.description}`);

    // Step 0: Call shrimp_execute_task to mark task as in_progress
    const protocol = client.getBrokerProtocol();
    if (!protocol) {
      throw new Error('Protocol not initialized');
    }

    console.log(`📋 Marking task as in_progress in shrimp task manager`);
    try {
      await protocol.invokeTool({
        targetAgent: 'mcp-server-shrimp-agent-playground',
        toolName: 'shrimp_execute_task',
        toolInput: {
          taskId: task.taskId
        },
        timeout: 30000
      });
      console.log(`✅ Task marked as in_progress`);
    } catch (error) {
      console.warn(`⚠️  Failed to mark task as in_progress (continuing anyway):`, error);
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
    console.log(`📝 Writing file: ${filePath}`);
    await protocol.invokeTool({
      targetAgent: 'fs',
      toolName: 'fs_write_file',
      toolInput: {
        path: filePath,
        content: artContent
      },
      timeout: 30000
    });

    console.log(`✅ File written: ${fileName}`);

    // Step 2: Set git working directory to worktree
    console.log(`📂 Setting git working directory: ${worktreePath}`);
    await protocol.invokeTool({
      targetAgent: 'git',
      toolName: 'git_git_set_working_dir',
      toolInput: {
        path: worktreePath
      },
      timeout: 30000
    });

    // Step 3: Stage file with git add
    console.log(`➕ Staging file: ${fileName}`);
    await protocol.invokeTool({
      targetAgent: 'git',
      toolName: 'git_git_add',
      toolInput: {
        files: [fileName]
      },
      timeout: 30000
    });

    // Step 4: Commit changes
    console.log(`💾 Committing changes`);
    const commitResult: any = await protocol.invokeTool({
      targetAgent: 'git',
      toolName: 'git_git_commit',
      toolInput: {
        message: `feat: create artwork for task ${task.taskId}`
      },
      timeout: 30000
    });

    console.log(`🔍 [DEBUG] Commit result:`, JSON.stringify(commitResult, null, 2));
    const commitSha = commitResult?.structuredContent?.commitHash || commitResult?.commitHash || 'unknown';
    console.log(`✅ Created and committed art file: ${fileName} (commit: ${commitSha.substring(0, 7)})`);

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

    console.log(`✅ Task ${task.taskId} completed successfully`);
  } catch (error: any) {
    console.error(`❌ Failed to process task ${task.taskId}:`, error);

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
  console.log('='.repeat(60));
  console.log('🚀 Starting Template Agent (TypeScript)');
  console.log('='.repeat(60));
  console.log(`Broker URL: ${config.brokerUrl}`);
  console.log(`Networks: ${config.networks.join(', ')}`);
  console.log();

  try {
    console.log('⏳ Connecting to broker...');
    console.log();

    // TEMPLATE PATTERN: Print tool information BEFORE blocking serve() call
    // TODO: Update this list to match your registered tools
    console.log('Available Tools:');
    console.log('  Placeholder Tools:');
    console.log('    • echo(text) - Echo text back with length (REPLACE THIS WITH YOUR TOOLS)');
    console.log();
    console.log('  Bot Tools (if enabled):');
    console.log('    • Slack bot tools (when ENABLE_SLACK_BOT=true)');
    console.log('    • Discord bot tools (when ENABLE_DISCORD_BOT=true)');
    console.log();
    console.log('  Broker-provided Tools (via client.load()):');
    console.log('    • git_* tools (on \'git\' network)');
    console.log('    • fs_* tools (on \'global\' network)');
    console.log();
    console.log('Press Ctrl+C to stop the agent...');
    console.log('='.repeat(60));
    console.log();

    // CRITICAL: serve() is blocking - all logs must come BEFORE this line
    // Connect to broker and start serving tool invocations
    // The broker will route tool calls to this agent based on network membership

    // Start Slack Bot after connection is established (async after serve starts)
    const shouldEnableSlackBot = (process.env.ENABLE_SLACK_BOT === 'true' || process.env.ENABLE_SLACK_BOT === undefined) &&
                                  process.env.ANTHROPIC_API_KEY &&
                                  process.env.ANTHROPIC_API_KEY !== 'YOUR_ANTHROPIC_API_KEY_HERE';
    if (shouldEnableSlackBot) {
      console.log('🔄 Slack bot will start after broker connection...');
      console.log();

      // Give serve() a moment to establish connection, then start Slack bot
      setTimeout(async () => {
        try {
          const { SlackBot } = await import('./bot/slack-bot.js');
          const slackBot = new SlackBot({
            client,
            anthropicApiKey: process.env.ANTHROPIC_API_KEY!,
            botUserId: process.env.SLACK_BOT_USER_ID!,
          });
          slackBot.start();
          console.log('✅ Slack bot started (subscribed to Slack mention events)');
        } catch (error) {
          console.error('❌ Failed to start Slack bot:', error);
        }
      }, 2000); // Wait 2 seconds for broker connection
    } else {
      console.log('ℹ️  Slack bot disabled (ENABLE_SLACK_BOT=false or ANTHROPIC_API_KEY not configured)');
      console.log();
    }

    // Start Discord bot if enabled via feature flag and API key is configured
    const shouldEnableDiscordBot = (process.env.ENABLE_DISCORD_BOT === 'true' || process.env.ENABLE_DISCORD_BOT === undefined) &&
                                    process.env.ANTHROPIC_API_KEY &&
                                    process.env.ANTHROPIC_API_KEY !== 'YOUR_ANTHROPIC_API_KEY_HERE';
    if (shouldEnableDiscordBot) {
      console.log('🤖 Discord Bot Configuration:');
      console.log('   - Anthropic API Key: Configured ✓');
      console.log('   - Bot User ID:', process.env.DISCORD_BOT_USER_ID || 'Not configured');
      console.log('   - Mode: Event-driven (KĀDI subscriptions)');
      console.log('🔄 Discord bot will start after broker connection...');
      console.log();

      // Give serve() a moment to establish connection, then start Discord bot
      setTimeout(async () => {
        try {
          const { DiscordBot } = await import('./bot/discord-bot.js');
          const discordBot = new DiscordBot({
            client,
            anthropicApiKey: process.env.ANTHROPIC_API_KEY!,
            botUserId: process.env.DISCORD_BOT_USER_ID!,
          });
          discordBot.start();
          console.log('✅ Discord bot started (subscribed to Discord mention events)');
        } catch (error) {
          console.error('❌ Failed to start Discord bot:', error);
        }
      }, 2500); // Wait 2.5 seconds for broker connection (slightly after Slack)
    } else {
      console.log('ℹ️  Discord bot disabled (ENABLE_DISCORD_BOT=false or ANTHROPIC_API_KEY not configured)');
      console.log();
    }

    // Subscribe to task assignment events (core agent responsibility, independent of bots)
    console.log('🎨 Subscribing to artist task assignments...');
    setTimeout(async () => {
      try {
        subscribeToTaskAssignments(client);
        console.log('✅ Subscribed to artist.task.assigned events');
      } catch (error) {
        console.error('❌ Failed to subscribe to task assignments:', error);
      }
    }, 1000); // Wait 1 second for broker connection

    await client.serve('broker');

    // IMPORTANT: This code never executes because serve() blocks indefinitely
    // Connection success is visible when tools start being invoked
    // Connection events and tool listings are printed above
  } catch (error: any) {
    console.error('❌ Failed to start agent:', error.message || error);
    if (error.stack) {
      console.error('Stack trace:', error.stack);
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
  console.log('\n⏳ Shutting down gracefully...');

  try {
    // TEMPLATE PATTERN: Disconnect from broker before exiting
    await client.disconnect();
    console.log('✅ Disconnected from broker');

    // TODO: Add cleanup for any resources your agent owns
    // Example: await database.close()
    // Example: await fileHandle.close()

    process.exit(0);
  } catch (error: any) {
    console.error('❌ Error during shutdown:', error.message);
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
  console.log('\n⏳ Shutting down gracefully...');

  try {
    await client.disconnect();
    console.log('✅ Disconnected from broker');

    // TODO: Add cleanup for any resources your agent owns

    process.exit(0);
  } catch (error: any) {
    console.error('❌ Error during shutdown:', error.message);
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
  console.error('💥 Fatal error:', error);
  process.exit(1);
});
