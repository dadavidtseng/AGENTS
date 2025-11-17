/**
 * TypeScript Agent Template for KĀDI Protocol
 * ===========================================
 *
 * TEMPLATE USAGE:
 * This file serves as a template for creating new KĀDI agents in TypeScript.
 * Follow these steps to customize:
 *
 * 1. Replace tool definitions (lines 35-95) with your own Zod schemas
 * 2. Update agent metadata in KadiClient config (lines 110-116)
 * 3. Replace tool handlers (lines 122-293) with your business logic
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
 * - Text processing (format, validate, count, reverse, trim)
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
 * @module typescript-agent-template
 * @version 2.0.0
 * @license MIT
 */

import 'dotenv/config';
import { KadiClient, z } from '@kadi.build/core';
import { registerAllTools } from './tools/index.js';

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
// TODO: Replace these example schemas with your agent's tool schemas
// ============================================================================

/**
 * Input schema for format_text tool
 *
 * @example
 * ```typescript
 * const input: FormatTextInput = {
 *   text: 'hello world',
 *   style: 'uppercase'
 * };
 * ```
 */
const formatTextInputSchema = z.object({
  text: z.string().describe('Text to format'),
  style: z.enum(['uppercase', 'lowercase', 'capitalize', 'title']).describe('Formatting style to apply')
});

/**
 * Output schema for format_text tool
 *
 * @example
 * ```typescript
 * const output: FormatTextOutput = {
 *   result: 'HELLO WORLD',
 *   original_length: 11,
 *   formatted_length: 11
 * };
 * ```
 */
const formatTextOutputSchema = z.object({
  result: z.string().describe('Formatted text'),
  original_length: z.number().describe('Length of original text'),
  formatted_length: z.number().describe('Length of formatted text')
});

/** Input schema for validate_json tool */
const validateJsonInputSchema = z.object({
  json_string: z.string().describe('JSON string to validate')
});

/** Output schema for validate_json tool */
const validateJsonOutputSchema = z.object({
  valid: z.boolean().describe('Whether the JSON is valid'),
  parsed: z.any().optional().describe('Parsed JSON object if valid'),
  error: z.string().optional().describe('Error message if invalid')
});

/** Input schema for count_words tool */
const countWordsInputSchema = z.object({
  text: z.string().describe('Text to analyze')
});

/** Output schema for count_words tool */
const countWordsOutputSchema = z.object({
  words: z.number().describe('Number of words'),
  characters: z.number().describe('Number of characters'),
  lines: z.number().describe('Number of lines')
});

/** Input schema for reverse_text tool */
const reverseTextInputSchema = z.object({
  text: z.string().describe('Text to reverse')
});

/** Output schema for reverse_text tool */
const reverseTextOutputSchema = z.object({
  result: z.string().describe('Reversed text'),
  length: z.number().describe('Length of text')
});

/** Input schema for trim_text tool */
const trimTextInputSchema = z.object({
  text: z.string().describe('Text to trim'),
  mode: z.enum(['both', 'start', 'end']).describe('Trimming mode')
});

/** Output schema for trim_text tool */
const trimTextOutputSchema = z.object({
  result: z.string().describe('Trimmed text'),
  removed_chars: z.number().describe('Number of characters removed')
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

/** Inferred TypeScript type for format_text input */
type FormatTextInput = z.infer<typeof formatTextInputSchema>;

/** Inferred TypeScript type for format_text output */
type FormatTextOutput = z.infer<typeof formatTextOutputSchema>;

/** Inferred TypeScript type for validate_json input */
type ValidateJsonInput = z.infer<typeof validateJsonInputSchema>;

/** Inferred TypeScript type for validate_json output */
type ValidateJsonOutput = z.infer<typeof validateJsonOutputSchema>;

/** Inferred TypeScript type for count_words input */
type CountWordsInput = z.infer<typeof countWordsInputSchema>;

/** Inferred TypeScript type for count_words output */
type CountWordsOutput = z.infer<typeof countWordsOutputSchema>;

/** Inferred TypeScript type for reverse_text input */
type ReverseTextInput = z.infer<typeof reverseTextInputSchema>;

/** Inferred TypeScript type for reverse_text output */
type ReverseTextOutput = z.infer<typeof reverseTextOutputSchema>;

/** Inferred TypeScript type for trim_text input */
type TrimTextInput = z.infer<typeof trimTextInputSchema>;

/** Inferred TypeScript type for trim_text output */
type TrimTextOutput = z.infer<typeof trimTextOutputSchema>;

/**
 * Input schema for create_file tool
 *
 * @example
 * ```typescript
 * const input: CreateFileInput = {
 *   filename: 'placeholder.txt',
 *   content: 'This is placeholder content'
 * };
 * ```
 */
const createFileInputSchema = z.object({
  filename: z.string().describe('Name of the file to create'),
  content: z.string().describe('Content to write to the file')
});

/**
 * Output schema for create_file tool
 *
 * @example
 * ```typescript
 * const output: CreateFileOutput = {
 *   success: true,
 *   filepath: '/path/to/placeholder.txt',
 *   bytes_written: 27
 * };
 * ```
 */
const createFileOutputSchema = z.object({
  success: z.boolean().describe('Whether file was created successfully'),
  filepath: z.string().describe('Absolute path to created file'),
  bytes_written: z.number().describe('Number of bytes written to file')
});

/** Inferred TypeScript type for create_file input */
type CreateFileInput = z.infer<typeof createFileInputSchema>;

/** Inferred TypeScript type for create_file output */
type CreateFileOutput = z.infer<typeof createFileOutputSchema>;

/**
 * Input schema for agent_send_slack_message tool
 */
const agentSendSlackMessageInputSchema = z.object({
  channel: z.string().describe('Slack channel ID (e.g., C09T6RU41HP)'),
  text: z.string().describe('Message text to send'),
  thread_ts: z.string().optional().describe('Optional thread timestamp')
});

/**
 * Output schema for agent_send_slack_message tool
 */
const agentSendSlackMessageOutputSchema = z.object({
  success: z.boolean().describe('Whether message was sent successfully'),
  message: z.string().describe('Result message from Slack'),
  timestamp: z.string().optional().describe('Slack message timestamp')
});

type AgentSendSlackMessageInput = z.infer<typeof agentSendSlackMessageInputSchema>;
type AgentSendSlackMessageOutput = z.infer<typeof agentSendSlackMessageOutputSchema>;

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
// - 'discord': Domain-specific network for Discord bot operations
// ============================================================================

/**
 * Agent configuration loaded from environment variables
 */
const config = {
  /** WebSocket URL for KĀDI broker */
  brokerUrl: process.env.KADI_BROKER_URL || 'ws://localhost:8080',

  /** Networks to join (comma-separated in env var) */
  networks: (process.env.KADI_NETWORK || 'global,text,git,slack,discord').split(',')
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
  name: process.env.AGENT_NAME || 'typescript-agent',
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
// TODO: Replace these example tools with your agent's tools
// ============================================================================

/**
 * Tool 1: Format Text
 *
 * Formats text with different styling options: uppercase, lowercase,
 * capitalize (first letter), or title case (all words).
 *
 * @param params - Input parameters matching FormatTextInput schema
 * @returns Formatted text with length metadata
 *
 * @example
 * ```typescript
 * const result = await client.invokeTool('format_text', {
 *   text: 'hello world',
 *   style: 'uppercase'
 * });
 * // Returns: { result: 'HELLO WORLD', original_length: 11, formatted_length: 11 }
 * ```
 */
client.registerTool({
  name: 'format_text',
  description: 'Format text with different styles (uppercase, lowercase, capitalize, title case)',
  input: formatTextInputSchema,
  output: formatTextOutputSchema
}, async (params: FormatTextInput): Promise<FormatTextOutput> => {
  console.log(`📝 Formatting text with style: ${params.style}`);

  let result: string;
  const originalLength = params.text.length;

  switch (params.style) {
    case 'uppercase':
      result = params.text.toUpperCase();
      break;
    case 'lowercase':
      result = params.text.toLowerCase();
      break;
    case 'capitalize':
      result = params.text.charAt(0).toUpperCase() + params.text.slice(1).toLowerCase();
      break;
    case 'title':
      result = params.text.replace(/\b\w/g, char => char.toUpperCase());
      break;
  }

  const formattedLength = result.length;

  // TEMPLATE PATTERN: Publish event for successful operation
  // TODO: Replace 'text.processing' with your domain-specific event topic
  // TODO: Replace 'text-processor-typescript' with your agent name
  client.publishEvent('text.processing', {
    operation: 'format_text',
    style: params.style,
    original_length: originalLength,
    formatted_length: formattedLength,
    agent: 'text-processor-typescript'  // TODO: Replace with your agent name
  });

  return {
    result,
    original_length: originalLength,
    formatted_length: formattedLength
  };
});

/**
 * Tool 2: Validate JSON
 *
 * Validates and parses JSON strings, returning either the parsed object
 * or an error message if invalid.
 *
 * @param params - Input parameters with json_string to validate
 * @returns Validation result with parsed data or error message
 *
 * @example
 * ```typescript
 * const result = await client.invokeTool('validate_json', {
 *   json_string: '{"name": "Alice", "age": 30}'
 * });
 * // Returns: { valid: true, parsed: { name: 'Alice', age: 30 } }
 * ```
 */
client.registerTool({
  name: 'validate_json',
  description: 'Validate and parse JSON strings',
  input: validateJsonInputSchema,
  output: validateJsonOutputSchema
}, async (params: ValidateJsonInput): Promise<ValidateJsonOutput> => {
  console.log('🔍 Validating JSON string');

  // TEMPLATE PATTERN: Use try/catch for operations that might fail
  try {
    const parsed = JSON.parse(params.json_string);

    client.publishEvent('text.processing', {
      operation: 'validate_json',
      valid: true,
      agent: 'text-processor-typescript'  // TODO: Replace
    });

    return {
      valid: true,
      parsed
    };
  } catch (error: any) {
    // TEMPLATE PATTERN: Type guard for Error instances
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';

    // TEMPLATE PATTERN: Publish error events to separate topic
    // TODO: Replace 'text.error' with your domain-specific error topic
    client.publishEvent('text.error', {
      operation: 'validate_json',
      error: errorMsg,
      agent: 'text-processor-typescript'  // TODO: Replace
    });

    // TEMPLATE PATTERN: Return structured error (don't throw)
    return {
      valid: false,
      error: errorMsg
    };
  }
});

/**
 * Tool 3: Count Words
 *
 * Analyzes text to count words, characters, and lines.
 *
 * @param params - Input parameters with text to analyze
 * @returns Word count, character count, and line count
 */
client.registerTool({
  name: 'count_words',
  description: 'Count words, characters, and lines in text',
  input: countWordsInputSchema,
  output: countWordsOutputSchema
}, async (params: CountWordsInput): Promise<CountWordsOutput> => {
  console.log('🔢 Counting words in text');

  const words = params.text.trim() ? params.text.trim().split(/\s+/).length : 0;
  const characters = params.text.length;
  const lines = params.text.split('\n').length;

  client.publishEvent('text.processing', {
    operation: 'count_words',
    words,
    characters,
    lines,
    agent: 'text-processor-typescript'  // TODO: Replace
  });

  return {
    words,
    characters,
    lines
  };
});

/**
 * Tool 4: Reverse Text
 *
 * Reverses the order of characters in the input text.
 *
 * @param params - Input parameters with text to reverse
 * @returns Reversed text with length metadata
 */
client.registerTool({
  name: 'reverse_text',
  description: 'Reverse the order of characters in text',
  input: reverseTextInputSchema,
  output: reverseTextOutputSchema
}, async (params: ReverseTextInput): Promise<ReverseTextOutput> => {
  console.log('🔄 Reversing text');

  const result = params.text.split('').reverse().join('');
  const length = result.length;

  client.publishEvent('text.processing', {
    operation: 'reverse_text',
    length,
    agent: 'text-processor-typescript'  // TODO: Replace
  });

  return {
    result,
    length
  };
});

/**
 * Tool 5: Trim Text
 *
 * Trims whitespace from text with configurable mode:
 * - 'both': Trim from both ends (default trim())
 * - 'start': Trim from start only (trimStart())
 * - 'end': Trim from end only (trimEnd())
 *
 * @param params - Input parameters with text and mode
 * @returns Trimmed text with count of removed characters
 */
client.registerTool({
  name: 'trim_text',
  description: 'Trim whitespace from text (both ends, start only, or end only)',
  input: trimTextInputSchema,
  output: trimTextOutputSchema
}, async (params: TrimTextInput): Promise<TrimTextOutput> => {
  console.log(`✂️  Trimming text (mode: ${params.mode})`);

  const originalLength = params.text.length;
  let result: string;

  switch (params.mode) {
    case 'both':
      result = params.text.trim();
      break;
    case 'start':
      result = params.text.trimStart();
      break;
    case 'end':
      result = params.text.trimEnd();
      break;
  }

  const removedChars = originalLength - result.length;

  client.publishEvent('text.processing', {
    operation: 'trim_text',
    mode: params.mode,
    removed_chars: removedChars,
    agent: 'text-processor-typescript'  // TODO: Replace
  });

  return {
    result,
    removed_chars: removedChars
  };
});

/**
 * Tool 6: Create File
 *
 * Creates a new file with specified content in the current directory.
 * This demonstrates file I/O operations in a KĀDI agent.
 *
 * @param params - Input parameters with filename and content
 * @returns File creation result with path and bytes written
 *
 * @example
 * ```typescript
 * const result = await client.invokeTool('create_file', {
 *   filename: 'placeholder.txt',
 *   content: 'This is placeholder content'
 * });
 * // Returns: { success: true, filepath: '/path/to/placeholder.txt', bytes_written: 27 }
 * ```
 */
client.registerTool({
  name: 'create_file',
  description: 'Create a new file with specified content',
  input: createFileInputSchema,
  output: createFileOutputSchema
}, async (params: CreateFileInput): Promise<CreateFileOutput> => {
  console.log(`📄 Creating file: ${params.filename}`);

  // Import Node.js filesystem module
  const fs = await import('fs/promises');
  const path = await import('path');

  try {
    // Get absolute path
    const filepath = path.resolve(process.cwd(), params.filename);

    // Write file to disk
    await fs.writeFile(filepath, params.content, 'utf-8');

    // Get file size
    const stats = await fs.stat(filepath);
    const bytesWritten = stats.size;

    console.log(`✅ File created: ${filepath} (${bytesWritten} bytes)`);

    // Publish success event
    client.publishEvent('file.created', {
      operation: 'create_file',
      filename: params.filename,
      filepath,
      bytes_written: bytesWritten,
      agent: 'typescript-agent'
    });

    return {
      success: true,
      filepath,
      bytes_written: bytesWritten
    };
  } catch (error: any) {
    console.error(`❌ Failed to create file: ${error.message}`);

    // Publish error event
    client.publishEvent('file.error', {
      operation: 'create_file',
      filename: params.filename,
      error: error.message,
      agent: 'typescript-agent'
    });

    return {
      success: false,
      filepath: '',
      bytes_written: 0
    };
  }
});

/**
 * Tool 7: Send Slack Message (via Broker MCP Upstream)
 *
 * Sends a message to Slack by invoking the broker's Slack MCP upstream tool.
 * This demonstrates how a KĀDI agent can call MCP upstream tools.
 *
 * @param params - Input parameters with channel and text
 * @returns Slack send result with success status and timestamp
 */
client.registerTool({
  name: 'agent_send_slack_message',
  description: 'Send a message to Slack channel via broker MCP upstream',
  input: agentSendSlackMessageInputSchema,
  output: agentSendSlackMessageOutputSchema
}, async (params: AgentSendSlackMessageInput): Promise<AgentSendSlackMessageOutput> => {
  console.log(`💬 Sending Slack message to channel: ${params.channel}`);

  try {
    // Get broker protocol to invoke MCP upstream tools
    const protocol = client.getBrokerProtocol();

    // Invoke Slack MCP upstream tool
    // Note: Tool name is double-prefixed (slack_slack_send_message)
    const result = await protocol.invokeTool({
      targetAgent: 'slack',
      toolName: 'slack_slack_send_message',
      toolInput: {
        channel: params.channel,
        text: params.text,
        thread_ts: params.thread_ts
      },
      timeout: 30000
    });

    console.log(`✅ Slack message sent successfully`);

    // Extract timestamp from result
    const resultStr = String((result as any).result || '');
    const timestampMatch = resultStr.match(/Timestamp: ([\d.]+)/);
    const timestamp = timestampMatch ? timestampMatch[1] : undefined;

    // Publish success event
    client.publishEvent('slack.message_sent', {
      operation: 'agent_send_slack_message',
      channel: params.channel,
      timestamp,
      agent: 'typescript-agent'
    });

    return {
      success: true,
      message: resultStr,
      timestamp
    };
  } catch (error: any) {
    console.error(`❌ Failed to send Slack message: ${error.message}`);

    // Publish error event
    client.publishEvent('slack.error', {
      operation: 'agent_send_slack_message',
      channel: params.channel,
      error: error.message,
      agent: 'typescript-agent'
    });

    return {
      success: false,
      message: `Error: ${error.message}`,
      timestamp: undefined
    };
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
  console.log('🚀 Starting TypeScript Text Processing Agent');  // TODO: Update agent name
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
    console.log('  Built-in Text Tools:');
    console.log('    • format_text(text, style) - Format text with styles');
    console.log('    • validate_json(json_string) - Validate and parse JSON');
    console.log('    • count_words(text) - Count words, characters, lines');
    console.log('    • reverse_text(text) - Reverse text characters');
    console.log('    • trim_text(text, mode) - Trim whitespace');
    console.log();
    console.log('  File Operations:');
    console.log('    • create_file(filename, content) - Create a new file');
    console.log();
    console.log('  Git Tools (via broker on \'git\' network):');
    console.log('    • git_* tools provided by kadi-broker\'s git-mcp-server');
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
          const { SlackBot } = await import('./slack-bot.js');
          const slackBot = new SlackBot({
            client,
            anthropicApiKey: process.env.ANTHROPIC_API_KEY!,
            pollIntervalMs: parseInt(process.env.BOT_POLL_INTERVAL_MS || '5000'),
          });
          slackBot.start();
          console.log('✅ Slack bot started (polling for @mentions every 10s)');
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
      console.log('   - Poll Interval: 5 seconds');
      console.log('🔄 Discord bot will start after broker connection...');
      console.log();

      // Give serve() a moment to establish connection, then start Discord bot
      setTimeout(async () => {
        try {
          const { DiscordBot } = await import('./discord-bot.js');
          const discordBot = new DiscordBot({
            client,
            anthropicApiKey: process.env.ANTHROPIC_API_KEY!,
            pollIntervalMs: parseInt(process.env.BOT_POLL_INTERVAL_MS || '5000'),
          });
          discordBot.start();
          console.log('✅ Discord bot started (polling for @mentions every 5s)');
        } catch (error) {
          console.error('❌ Failed to start Discord bot:', error);
        }
      }, 2500); // Wait 2.5 seconds for broker connection (slightly after Slack)
    } else {
      console.log('ℹ️  Discord bot disabled (ENABLE_DISCORD_BOT=false or ANTHROPIC_API_KEY not configured)');
      console.log();
    }

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
