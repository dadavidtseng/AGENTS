/**
 * TypeScript Agent Template for KĀDI Protocol
 * ===========================================
 *
 * TEMPLATE USAGE:
 * This file serves as a template for creating new KĀDI agents in TypeScript.
 * Follow these steps to customize:
 *
 * 1. Replace the echo tool with your own tool definitions
 * 2. Update agent metadata in KadiClient config
 * 3. Replace tool handler with your business logic
 * 4. Update event topics and payloads to match your domain
 * 5. Modify networks array to join appropriate KĀDI networks
 * 6. Update documentation comments with your agent's purpose
 *
 * ARCHITECTURE:
 * This agent demonstrates broker-centralized architecture where:
 * - Agent registers its own tools with the KĀDI broker
 * - Agent can call broker's tools via client.load() (see examples/)
 * - No MCP server spawning in agent code
 * - Broker handles all tool routing and network isolation
 *
 * Built-in tools (customize these):
 * - Echo (placeholder - replace with your own tools)
 *
 * Broker-provided tools (access via client.load()):
 * - Git operations (from broker's git-mcp-server on 'git' network)
 * - Filesystem operations (from broker's fs-mcp-server on 'global' network)
 *
 * Dependencies:
 * - @kadi.build/core: KĀDI protocol client library with KadiClient and Zod
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
 *     KADI_NETWORK: Networks to join, comma-separated (default: global,text,git,slack,discord)
 *
 * @module template-agent-typescript
 * @version 2.0.0
 * @license MIT
 */

import 'dotenv/config';
import { KadiClient, z } from '@kadi.build/core';
import { registerAllTools } from './tools/index.js';
import chokidar, { type FSWatcher } from 'chokidar';
import path from 'path';
import fs from 'fs';

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
  networks: (process.env.KADI_NETWORK || 'global,artist').split(',')
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
  name: process.env.AGENT_NAME || 'shadow-agent-artist',
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
// Shadow Backup System
// ============================================================================
//
// SHADOW AGENT PATTERN: Passive monitoring and granular backup
//
// This shadow agent watches the shared worktree for file operations and creates
// granular backup commits to a separate remote. Unlike the worker agent which
// commits once per task, the shadow agent commits after every file operation.
//
// Architecture:
// 1. Filesystem Watcher: Monitors worktree for file operations (create/modify/delete)
// 2. Git Ref Watcher: Monitors worker commits to mirror them
// 3. Atomic Git Operations: add + commit + push for each event
// 4. Circuit Breaker: Error handling with retry and fallback
//
// Benefits:
// - Fine-grained rollback capability (per-operation vs per-task)
// - Detailed audit trail of all file changes
// - Worker agent stays clean with task-based commits
// - Backup isolation via separate remote
//
// ============================================================================

/** Worker worktree path (where files are created/modified) */
const WORKER_WORKTREE_PATH = 'C:/p4/Personal/SD/agent-playground-artist';

/** Shadow worktree path (where shadow commits are created) */
const SHADOW_WORKTREE_PATH = 'C:/p4/Personal/SD/shadow-agent-playground-artist';

/** Worker branch name (main development branch) */
const WORKER_BRANCH = 'agent-artist';

/** Shadow branch name (shadow backup commits) */
const SHADOW_BRANCH = 'shadow-agent-artist';

/** Debounce delay to avoid rapid-fire commits (milliseconds) */
const DEBOUNCE_DELAY = 1000;

/** Circuit breaker state for git operations */
let gitCircuitOpen = false;
let gitFailureCount = 0;
const MAX_FAILURES = 5;
const CIRCUIT_RESET_TIME = 60000; // 1 minute

/**
 * Debounce map to avoid rapid-fire commits for the same file
 * Key: file path, Value: timeout handle
 */
const debounceMap = new Map<string, NodeJS.Timeout>();

/**
 * Global watcher instances to prevent garbage collection
 */
let fsWatcher: FSWatcher | null = null;
let gitRefWatcher: FSWatcher | null = null;

/**
 * Perform git operations with circuit breaker pattern
 *
 * @param operation - Operation name for logging
 * @param fn - Async function to execute
 * @returns Result of the operation
 */
async function withCircuitBreaker<T>(operation: string, fn: () => Promise<T>): Promise<T> {
  if (gitCircuitOpen) {
    throw new Error(`Circuit breaker open - ${operation} blocked due to repeated failures`);
  }

  try {
    const result = await fn();
    // Success - reset failure count
    gitFailureCount = 0;
    return result;
  } catch (error: any) {
    gitFailureCount++;
    console.error(`❌ Git operation failed (${gitFailureCount}/${MAX_FAILURES}): ${operation}`, error.message);

    if (gitFailureCount >= MAX_FAILURES) {
      gitCircuitOpen = true;
      console.error(`🚨 Circuit breaker opened - too many git failures`);

      // Publish error event
      client.publishEvent('shadow-artist.backup.failed', {
        operation,
        error: error.message,
        timestamp: new Date().toISOString(),
        circuitOpen: true
      });

      // Auto-reset circuit after timeout
      setTimeout(() => {
        gitCircuitOpen = false;
        gitFailureCount = 0;
        console.log(`🔄 Circuit breaker reset - retrying git operations`);
      }, CIRCUIT_RESET_TIME);
    }

    throw error;
  }
}

/**
 * Create shadow backup commit using separate shadow worktree
 *
 * @param fileName - File name (relative to worktree)
 * @param operation - Operation type (Created/Modified/Deleted)
 */
async function createShadowBackup(fileName: string, operation: string): Promise<void> {
  const protocol = client.getBrokerProtocol();
  if (!protocol) {
    const error = new Error('Protocol not initialized');
    console.error(JSON.stringify({
      event: 'shadow.backup.error',
      operation,
      fileName,
      error: error.message,
      errorType: 'ProtocolNotInitialized',
      timestamp: new Date().toISOString()
    }));
    throw error;
  }

  const startTime = Date.now();

  try {
    // Structured logging: Backup start
    console.log(JSON.stringify({
      event: 'shadow.backup.start',
      operation,
      fileName,
      timestamp: new Date().toISOString()
    }));

    await withCircuitBreaker(`shadow-backup-${operation}`, async () => {
      const sourceFile = path.join(WORKER_WORKTREE_PATH, fileName);
      const targetFile = path.join(SHADOW_WORKTREE_PATH, fileName);

      // Step 1: File verification and copy from worker worktree to shadow worktree
      if (operation === 'Deleted') {
        // For deletions, verify file exists in shadow worktree
        if (!fs.existsSync(targetFile)) {
          // Log discrepancy but continue operation
          console.warn(JSON.stringify({
            event: 'shadow.file.verification.warning',
            operation,
            fileName,
            issue: 'File reported as deleted but not found in shadow worktree',
            targetPath: targetFile,
            timestamp: new Date().toISOString()
          }));
        } else {
          fs.unlinkSync(targetFile);
          console.log(JSON.stringify({
            event: 'shadow.file.deleted',
            fileName,
            targetPath: targetFile,
            timestamp: new Date().toISOString()
          }));
        }
      } else {
        // For create/modify, verify source file exists
        if (!fs.existsSync(sourceFile)) {
          // Log discrepancy and abort this operation
          console.error(JSON.stringify({
            event: 'shadow.file.verification.error',
            operation,
            fileName,
            issue: 'Source file not found in worker worktree',
            sourcePath: sourceFile,
            timestamp: new Date().toISOString()
          }));
          throw new Error(`Source file not found: ${sourceFile}`);
        }

        try {
          const content = fs.readFileSync(sourceFile, 'utf-8');

          // Ensure target directory exists
          const targetDir = path.dirname(targetFile);
          if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
          }

          fs.writeFileSync(targetFile, content, 'utf-8');
          console.log(JSON.stringify({
            event: 'shadow.file.copied',
            operation,
            fileName,
            sourcePath: sourceFile,
            targetPath: targetFile,
            fileSize: content.length,
            timestamp: new Date().toISOString()
          }));
        } catch (fileError: any) {
          // Handle file operation errors
          console.error(JSON.stringify({
            event: 'shadow.file.operation.error',
            operation,
            fileName,
            error: fileError.message,
            errorType: fileError.constructor.name,
            stack: fileError.stack,
            timestamp: new Date().toISOString()
          }));
          throw fileError;
        }
      }

      // Step 2: Set git working directory to shadow worktree
      try {
        await protocol.invokeTool({
          targetAgent: 'git',
          toolName: 'git_git_set_working_dir',
          toolInput: { path: SHADOW_WORKTREE_PATH },
          timeout: 10000
        });
        console.log(JSON.stringify({
          event: 'shadow.git.setdir.success',
          workingDir: SHADOW_WORKTREE_PATH,
          timestamp: new Date().toISOString()
        }));
      } catch (gitError: any) {
        console.error(JSON.stringify({
          event: 'shadow.git.setdir.error',
          operation,
          fileName,
          workingDir: SHADOW_WORKTREE_PATH,
          error: gitError.message,
          errorType: gitError.constructor.name,
          stack: gitError.stack,
          timestamp: new Date().toISOString()
        }));
        throw gitError;
      }

      // Step 3: Stage file (or deletion)
      try {
        await protocol.invokeTool({
          targetAgent: 'git',
          toolName: 'git_git_add',
          toolInput: { files: [fileName] },
          timeout: 10000
        });
        console.log(JSON.stringify({
          event: 'shadow.git.add.success',
          fileName,
          timestamp: new Date().toISOString()
        }));
      } catch (gitError: any) {
        console.error(JSON.stringify({
          event: 'shadow.git.add.error',
          operation,
          fileName,
          error: gitError.message,
          errorType: gitError.constructor.name,
          stack: gitError.stack,
          timestamp: new Date().toISOString()
        }));
        throw gitError;
      }

      // Step 4: Commit with descriptive message
      const commitMessage = `Shadow: ${operation} ${fileName}`;
      let commitResult;
      try {
        commitResult = await protocol.invokeTool({
          targetAgent: 'git',
          toolName: 'git_git_commit',
          toolInput: { message: commitMessage },
          timeout: 10000
        });
      } catch (gitError: any) {
        // Check if error is "nothing to commit" (not a real error for shadow backup)
        if (gitError.message?.includes('nothing to commit') || gitError.message?.includes('no changes')) {
          console.warn(JSON.stringify({
            event: 'shadow.git.commit.nochanges',
            operation,
            fileName,
            message: 'No changes to commit - file may be identical',
            timestamp: new Date().toISOString()
          }));
          return; // Skip publishing success event
        }

        // Real commit error
        console.error(JSON.stringify({
          event: 'shadow.git.commit.error',
          operation,
          fileName,
          commitMessage,
          error: gitError.message,
          errorType: gitError.constructor.name,
          stack: gitError.stack,
          timestamp: new Date().toISOString()
        }));
        throw gitError;
      }

      // Extract commit SHA
      const commitSha = (commitResult as any)?.structuredContent?.commitHash ||
                        (commitResult as any)?.commitHash ||
                        'unknown';

      const duration = Date.now() - startTime;
      console.log(JSON.stringify({
        event: 'shadow.backup.success',
        operation,
        fileName,
        commitSha: commitSha.substring(0, 7),
        branch: SHADOW_BRANCH,
        durationMs: duration,
        timestamp: new Date().toISOString()
      }));

      // Publish success event
      client.publishEvent('shadow-artist.backup.completed', {
        operation,
        fileName,
        commitSha,
        branch: SHADOW_BRANCH,
        timestamp: new Date().toISOString()
      });
    });
  } catch (error: any) {
    // Structured logging: Backup failure
    const duration = Date.now() - startTime;
    console.error(JSON.stringify({
      event: 'shadow.backup.error',
      operation,
      fileName,
      error: error.message,
      errorType: error.constructor.name,
      stack: error.stack,
      durationMs: duration,
      circuitOpen: gitCircuitOpen,
      timestamp: new Date().toISOString()
    }));

    // Publish error event (if circuit not open to avoid event spam)
    if (!gitCircuitOpen) {
      client.publishEvent('shadow-artist.backup.failed', {
        operation,
        fileName,
        error: error.message,
        errorType: error.constructor.name,
        timestamp: new Date().toISOString()
      });
    }

    // Note: DO NOT re-throw - failed backups should not crash the process
    // Shadow agent continues monitoring even if individual backups fail
  }
}

/**
 * Setup filesystem watcher for file operations
 * Monitors worker worktree for create/modify/delete operations
 */
function setupFilesystemWatcher(): void {
  console.log(`👁️  Setting up filesystem watcher: ${WORKER_WORKTREE_PATH}`);

  // Chokidar v5 removed glob support - watch directory directly
  fsWatcher = chokidar.watch(WORKER_WORKTREE_PATH, {
    persistent: true,
    ignoreInitial: true, // Don't trigger for existing files
    ignored: [
      '**/node_modules/**',
      '**/.git/**',
      '**/.git',  // Also ignore .git file (for worktrees)
      '**/.env',
      '**/.env.*'
    ],
    awaitWriteFinish: {
      stabilityThreshold: 500,
      pollInterval: 100
    }
  });

  fsWatcher
    .on('all', (event: string, filePath: string) => {
      console.log(`📡 Chokidar event: ${event} - ${filePath}`);
    })
    .on('add', (filePath: string) => {
      const fileName = path.relative(WORKER_WORKTREE_PATH, filePath);
      console.log(`➕ File created: ${fileName}`);

      // Debounce to avoid rapid-fire commits
      if (debounceMap.has(filePath)) {
        clearTimeout(debounceMap.get(filePath)!);
      }

      const timeout = setTimeout(() => {
        createShadowBackup(fileName, 'Created');
        debounceMap.delete(filePath);
      }, DEBOUNCE_DELAY);

      debounceMap.set(filePath, timeout);
    })
    .on('change', (filePath: string) => {
      const fileName = path.relative(WORKER_WORKTREE_PATH, filePath);
      console.log(`✏️  File modified: ${fileName}`);

      // Debounce to avoid rapid-fire commits
      if (debounceMap.has(filePath)) {
        clearTimeout(debounceMap.get(filePath)!);
      }

      const timeout = setTimeout(() => {
        createShadowBackup(fileName, 'Modified');
        debounceMap.delete(filePath);
      }, DEBOUNCE_DELAY);

      debounceMap.set(filePath, timeout);
    })
    .on('unlink', (filePath: string) => {
      const fileName = path.relative(WORKER_WORKTREE_PATH, filePath);
      console.log(`🗑️  File deleted: ${fileName}`);

      // Debounce to avoid rapid-fire commits
      if (debounceMap.has(filePath)) {
        clearTimeout(debounceMap.get(filePath)!);
      }

      const timeout = setTimeout(() => {
        createShadowBackup(fileName, 'Deleted');
        debounceMap.delete(filePath);
      }, DEBOUNCE_DELAY);

      debounceMap.set(filePath, timeout);
    })
    .on('error', (error: unknown) => {
      console.error('❌ Filesystem watcher error:', error);
    })
    .on('ready', () => {
      console.log('✅ Filesystem watcher ready');
    });
}

/**
 * Setup git ref watcher for worker commits
 * Monitors worker agent commits and creates mirror commits in shadow worktree
 */
function setupGitRefWatcher(): void {
  // Watch the worker branch ref file in the main repo
  const workerBranchRefPath = `${WORKER_WORKTREE_PATH}/.git/refs/heads/${WORKER_BRANCH}`;
  console.log(`👁️  Setting up git ref watcher: ${workerBranchRefPath}`);

  gitRefWatcher = chokidar.watch(workerBranchRefPath, {
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 500,
      pollInterval: 100
    }
  });

  gitRefWatcher
    .on('change', async () => {
      console.log(`🔄 Worker commit detected on ${WORKER_BRANCH}`);

      try {
        const protocol = client.getBrokerProtocol();
        if (!protocol) {
          throw new Error('Protocol not initialized');
        }

        // Get latest commit message from worker worktree
        await protocol.invokeTool({
          targetAgent: 'git',
          toolName: 'git_git_set_working_dir',
          toolInput: { path: WORKER_WORKTREE_PATH },
          timeout: 10000
        });

        const logResult = await protocol.invokeTool({
          targetAgent: 'git',
          toolName: 'git_git_log',
          toolInput: { maxCount: 1 },
          timeout: 10000
        });

        const latestCommitMsg = (logResult as any)?.commits?.[0]?.message ||
                                (logResult as any)?.structuredContent?.commits?.[0]?.message ||
                                'Unknown commit';

        console.log(`📋 Worker commit message: ${latestCommitMsg}`);

        // Create mirror commit in shadow worktree
        await withCircuitBreaker('mirror-commit', async () => {
          // Set working directory to shadow worktree
          await protocol.invokeTool({
            targetAgent: 'git',
            toolName: 'git_git_set_working_dir',
            toolInput: { path: SHADOW_WORKTREE_PATH },
            timeout: 10000
          });

          const mirrorMessage = `Shadow: Backup of ${latestCommitMsg}`;

          const commitResult = await protocol.invokeTool({
            targetAgent: 'git',
            toolName: 'git_git_commit',
            toolInput: {
              message: mirrorMessage,
              allowEmpty: true // Allow empty commit for mirroring
            },
            timeout: 10000
          });

          const commitSha = (commitResult as any)?.structuredContent?.commitHash ||
                            (commitResult as any)?.commitHash ||
                            'unknown';

          console.log(`✅ Mirror commit created on ${SHADOW_BRANCH}: ${commitSha.substring(0, 7)}`);

          // Publish success event
          client.publishEvent('shadow-artist.backup.completed', {
            operation: 'Mirror',
            workerCommitMessage: latestCommitMsg,
            commitSha,
            branch: SHADOW_BRANCH,
            timestamp: new Date().toISOString()
          });
        });
      } catch (error: any) {
        console.error(`❌ Mirror commit failed:`, error.message);

        if (!gitCircuitOpen) {
          client.publishEvent('shadow-artist.backup.failed', {
            operation: 'Mirror',
            error: error.message,
            timestamp: new Date().toISOString()
          });
        }
      }
    })
    .on('error', (error: unknown) => {
      console.error('❌ Git ref watcher error:', error);
    })
    .on('ready', () => {
      console.log('✅ Git ref watcher ready');
    });
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
  console.log('🚀 Starting Shadow Agent Artist');
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

    // Start shadow backup watchers after broker connection
    console.log('🔄 Shadow backup watchers will start after broker connection...');
    setTimeout(() => {
      try {
        setupFilesystemWatcher();
        setupGitRefWatcher();
        console.log('✅ Shadow backup system initialized');
      } catch (error) {
        console.error('❌ Failed to start shadow backup watchers:', error);
      }
    }, 3000); // Wait 3 seconds for broker connection

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
