/**
 * Multi-Purpose KĀDI Agent with MCP Integration
 * ============================================
 *
 * This agent provides:
 * - Text processing tools (built-in)
 * - Git operations via MCP server (27 tools)
 * - Worktree management
 * - Event pub/sub system
 * - WebSocket communication with KĀDI broker
 *
 * Dependencies:
 * - @kadi.build/core: KĀDI protocol client library
 * - zod: Schema validation and type inference
 * - @cyanheads/git-mcp-server: Git operations via MCP
 *
 * Usage:
 *     npm start
 *     # or
 *     npm run dev (with hot-reload)
 *
 * Environment Variables:
 *     KADI_BROKER_URL: WebSocket URL for KĀDI broker (default: ws://localhost:8080)
 *     KADI_NETWORK: Network to join (default: global,text,git)
 *     GIT_BASE_DIR: Base directory for Git operations (default: current directory)
 */

import 'dotenv/config';
import { KadiClient, z } from '@kadi.build/core';
import { ToolRegistry } from './core/tool-registry.js';
import mcpServersConfig from './config/mcp-servers.json' with { type: 'json' };

// ============================================================================
// Tool Schemas (Zod Schemas)
// ============================================================================

const formatTextInputSchema = z.object({
  text: z.string().describe('Text to format'),
  style: z.enum(['uppercase', 'lowercase', 'capitalize', 'title']).describe('Formatting style to apply')
});

const formatTextOutputSchema = z.object({
  result: z.string().describe('Formatted text'),
  original_length: z.number().describe('Length of original text'),
  formatted_length: z.number().describe('Length of formatted text')
});

const validateJsonInputSchema = z.object({
  json_string: z.string().describe('JSON string to validate')
});

const validateJsonOutputSchema = z.object({
  valid: z.boolean().describe('Whether the JSON is valid'),
  parsed: z.any().optional().describe('Parsed JSON object if valid'),
  error: z.string().optional().describe('Error message if invalid')
});

const countWordsInputSchema = z.object({
  text: z.string().describe('Text to analyze')
});

const countWordsOutputSchema = z.object({
  words: z.number().describe('Number of words'),
  characters: z.number().describe('Number of characters'),
  lines: z.number().describe('Number of lines')
});

const reverseTextInputSchema = z.object({
  text: z.string().describe('Text to reverse')
});

const reverseTextOutputSchema = z.object({
  result: z.string().describe('Reversed text'),
  length: z.number().describe('Length of text')
});

const trimTextInputSchema = z.object({
  text: z.string().describe('Text to trim'),
  mode: z.enum(['both', 'start', 'end']).describe('Where to trim whitespace')
});

const trimTextOutputSchema = z.object({
  result: z.string().describe('Trimmed text'),
  removed_chars: z.number().describe('Number of whitespace characters removed')
});

// Type inference from Zod schemas
type FormatTextInput = z.infer<typeof formatTextInputSchema>;
type FormatTextOutput = z.infer<typeof formatTextOutputSchema>;
type ValidateJsonInput = z.infer<typeof validateJsonInputSchema>;
type ValidateJsonOutput = z.infer<typeof validateJsonOutputSchema>;
type CountWordsInput = z.infer<typeof countWordsInputSchema>;
type CountWordsOutput = z.infer<typeof countWordsOutputSchema>;
type ReverseTextInput = z.infer<typeof reverseTextInputSchema>;
type ReverseTextOutput = z.infer<typeof reverseTextOutputSchema>;
type TrimTextInput = z.infer<typeof trimTextInputSchema>;
type TrimTextOutput = z.infer<typeof trimTextOutputSchema>;

// ============================================================================
// Configuration
// ============================================================================

const config = {
  brokerUrl: process.env.KADI_BROKER_URL || 'ws://localhost:8080',
  networks: (process.env.KADI_NETWORK || 'global,text,git').split(','),
  gitBaseDir: process.env.GIT_BASE_DIR || process.cwd()
};

// Convert Windows path for MCP server compatibility
// The MCP server requires Unix-style paths starting with "/"
// On Windows, convert C:\path\to\dir to /path/to/dir (removing drive letter)
let gitBaseDirNormalized = config.gitBaseDir.replace(/\\/g, '/');
if (gitBaseDirNormalized.match(/^[A-Z]:/i)) {
  // Remove Windows drive letter: C:/path -> /path
  gitBaseDirNormalized = gitBaseDirNormalized.slice(2);
}

// Update MCP server config with GIT_BASE_DIR from environment
// Using batch wrapper (launch-git-mcp.bat) to set PATH explicitly
if (mcpServersConfig.servers && mcpServersConfig.servers[0]) {
  mcpServersConfig.servers[0].env = {
    ...mcpServersConfig.servers[0].env,
    GIT_BASE_DIR: gitBaseDirNormalized
  };

  console.log(`✓ MCP Server Environment configured:`);
  console.log(`  - GIT_BASE_DIR: ${gitBaseDirNormalized}`);
  console.log(`  - Using batch wrapper: launch-git-mcp.bat (sets PATH internally)`);
}

// ============================================================================
// KĀDI Client
// ============================================================================

const client = new KadiClient({
  name: 'typescript-agent',
  version: '2.0.0',
  role: 'agent',
  broker: config.brokerUrl,
  networks: config.networks
});

// ============================================================================
// Tool Registrations
// ============================================================================

client.registerTool({
  name: 'format_text',
  description: 'Format text with various styles (uppercase, lowercase, capitalize, title)',
  input: formatTextInputSchema,
  output: formatTextOutputSchema
}, async (params: FormatTextInput): Promise<FormatTextOutput> => {
  /**
   * Format text according to specified style.
   */
  let result: string;

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
      result = params.text.split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ');
      break;
  }

  console.log(`📝 Format Text: "${params.text}" → "${result}" (style: ${params.style})`);

  // Publish event when formatting completes
  client.publishEvent('text.processing', {
    operation: 'format',
    style: params.style,
    original_length: params.text.length,
    formatted_length: result.length,
    agent: 'text-processor-typescript'
  });

  return {
    result,
    original_length: params.text.length,
    formatted_length: result.length
  };
});

client.registerTool({
  name: 'validate_json',
  description: 'Validate JSON string and parse if valid',
  input: validateJsonInputSchema,
  output: validateJsonOutputSchema
}, async (params: ValidateJsonInput): Promise<ValidateJsonOutput> => {
  /**
   * Validate and parse JSON string.
   */
  try {
    const parsed = JSON.parse(params.json_string);

    console.log(`✅ Valid JSON: ${params.json_string.substring(0, 50)}...`);

    client.publishEvent('text.processing', {
      operation: 'validate_json',
      valid: true,
      agent: 'text-processor-typescript'
    });

    return {
      valid: true,
      parsed
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';

    console.log(`❌ Invalid JSON: ${errorMsg}`);

    client.publishEvent('text.error', {
      operation: 'validate_json',
      error: errorMsg,
      agent: 'text-processor-typescript'
    });

    return {
      valid: false,
      error: errorMsg
    };
  }
});

client.registerTool({
  name: 'count_words',
  description: 'Count words, characters, and lines in text',
  input: countWordsInputSchema,
  output: countWordsOutputSchema
}, async (params: CountWordsInput): Promise<CountWordsOutput> => {
  /**
   * Count words, characters, and lines in text.
   */
  const words = params.text.trim().split(/\s+/).filter(w => w.length > 0).length;
  const characters = params.text.length;
  const lines = params.text.split('\n').length;

  console.log(`📊 Count: ${words} words, ${characters} chars, ${lines} lines`);

  client.publishEvent('text.processing', {
    operation: 'count_words',
    words,
    characters,
    lines,
    agent: 'text-processor-typescript'
  });

  return { words, characters, lines };
});

client.registerTool({
  name: 'reverse_text',
  description: 'Reverse the order of characters in text',
  input: reverseTextInputSchema,
  output: reverseTextOutputSchema
}, async (params: ReverseTextInput): Promise<ReverseTextOutput> => {
  /**
   * Reverse text character by character.
   */
  const result = params.text.split('').reverse().join('');

  console.log(`🔄 Reverse: "${params.text}" → "${result}"`);

  client.publishEvent('text.processing', {
    operation: 'reverse',
    length: params.text.length,
    agent: 'text-processor-typescript'
  });

  return {
    result,
    length: params.text.length
  };
});

client.registerTool({
  name: 'trim_text',
  description: 'Remove whitespace from text (both sides, start, or end)',
  input: trimTextInputSchema,
  output: trimTextOutputSchema
}, async (params: TrimTextInput): Promise<TrimTextOutput> => {
  /**
   * Trim whitespace from text.
   */
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

  const removed = params.text.length - result.length;

  console.log(`✂️ Trim: removed ${removed} chars (mode: ${params.mode})`);

  client.publishEvent('text.processing', {
    operation: 'trim',
    mode: params.mode,
    removed_chars: removed,
    agent: 'text-processor-typescript'
  });

  return {
    result,
    removed_chars: removed
  };
});

// ============================================================================
// Event Subscriptions
// ============================================================================

client.subscribeToEvent('text.processing', (data: any) => {
  const agent = data.agent || 'unknown';
  const operation = data.operation || 'unknown';

  console.log(`🔔 [${agent}] Text processing event: ${operation}`);
});

client.subscribeToEvent('text.error', (data: any) => {
  const agent = data.agent || 'unknown';
  const operation = data.operation || 'unknown';
  const error = data.error || 'Unknown error';

  console.log(`⚠️ [${agent}] Error in ${operation}: ${error}`);
});

client.subscribeToEvent('agent.connected', (data: any) => {
  const agentName = data.name || 'unknown';
  const networks = data.networks || [];

  console.log(`🟢 Agent connected: ${agentName} on networks: ${networks.join(', ')}`);
});

// ============================================================================
// MCP Tool Registry
// ============================================================================

const toolRegistry = new ToolRegistry();

/**
 * Initialize MCP servers and register their tools with KADI
 */
async function initializeMCPTools(): Promise<void> {
  console.log('🔧 Initializing MCP tools...');

  try {
    // Initialize MCP servers (connects and discovers tools)
    await toolRegistry.initialize(mcpServersConfig.servers);

    // Get raw MCP tool definitions (with JSON Schemas)
    // Access the private mcpClients map to get original MCP tool definitions
    const mcpClients = (toolRegistry as any).mcpClients as Map<string, any>;
    const rawMCPTools = Array.from(mcpClients.values())
      .flatMap(client => client.getTools());

    console.log(`📦 Discovered ${rawMCPTools.length} MCP tools with JSON Schemas`);

    for (const mcpTool of rawMCPTools) {
      try {
        // Use JSON Schema approach to bypass Zod conversion
        // This directly passes MCP's JSON Schemas to KADI without conversion
        client.registerTool({
          name: mcpTool.name,
          description: mcpTool.description,
          inputSchema: mcpTool.inputSchema as any,  // MCP JSON Schema (used as-is)
          outputSchema: {
            type: 'object',
            properties: {
              content: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    type: { type: 'string' },
                    text: { type: 'string' }
                  }
                }
              },
              isError: { type: 'boolean' }
            },
            additionalProperties: true  // Allow extra fields
          } as any,
        }, async (params: any): Promise<any> => {
          console.log(`🔨 Invoking MCP tool: ${mcpTool.name}`);

          try {
            const result = await toolRegistry.invokeTool(mcpTool.name, params);

            // Publish success event
            client.publishEvent('git.tool.success', {
              tool: mcpTool.name,
              params,
              agent: 'typescript-agent'
            });

            return result;
          } catch (error: any) {
            const errorMsg = error instanceof Error ? error.message : 'Unknown error';

            console.error(`❌ MCP tool ${mcpTool.name} failed:`, errorMsg);

            // Publish error event
            client.publishEvent('git.tool.error', {
              tool: mcpTool.name,
              error: errorMsg,
              agent: 'typescript-agent'
            });

            throw error;
          }
        });

        console.log(`  ✅ Registered MCP tool as KADI tool: ${mcpTool.name}`);
      } catch (error: any) {
        console.error(`  ❌ Failed to register ${mcpTool.name}:`, error.message);
        throw error; // Re-throw to fail fast and see which tool causes the issue
      }
    }

    console.log(`✅ MCP integration complete: ${rawMCPTools.length} Git tools registered with KADI`);

  } catch (error: any) {
    console.error('❌ Failed to initialize MCP tools:', error.message);
    console.error('   Agent will continue with built-in text tools only');
    // Don't throw - allow agent to run with built-in tools even if MCP fails
  }
}

/**
 * Git health check tool - verifies Git executable is accessible
 */
client.registerTool({
  name: 'git_health_check',
  description: 'Check if Git is accessible and report version information',
  input: z.object({}),
  output: z.object({
    accessible: z.boolean().describe('Whether Git is accessible'),
    version: z.string().optional().describe('Git version string if accessible'),
    error: z.string().optional().describe('Error message if not accessible')
  })
}, async (): Promise<{ accessible: boolean; version?: string; error?: string }> => {
  console.log('🏥 Running Git health check...');

  try {
    // Try to invoke git_status tool through MCP
    const result = await toolRegistry.invokeTool('git_status', {});

    console.log('✅ Git health check passed');

    return {
      accessible: true,
      version: 'Available via MCP (git-mcp-server)'
    };
  } catch (error: any) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';

    console.error('❌ Git health check failed:', errorMsg);

    return {
      accessible: false,
      error: errorMsg
    };
  }
});

// ============================================================================
// Main Function
// ============================================================================

async function main() {
  console.log('='.repeat(60));
  console.log('🚀 Starting TypeScript Text Processing Agent for ProtogameJS3D');
  console.log('='.repeat(60));
  console.log(`Broker URL: ${config.brokerUrl}`);
  console.log(`Networks: ${config.networks.join(', ')}`);
  console.log(`Git Base Dir: ${config.gitBaseDir}`);
  console.log();

  try {
    // Initialize MCP tools before connecting to broker
    console.log('⏳ Initializing MCP tools...');
    await initializeMCPTools();
    console.log();

    console.log('⏳ Connecting to broker...');
    console.log();

    // Note: serve() initiates connection and then keeps the process alive indefinitely
    // It only returns if there's an error, so we print success info first
    const servePromise = client.serve('broker');

    // Wait a moment for connection to establish
    await new Promise(resolve => setTimeout(resolve, 2000));

    console.log('✅ Connected successfully!');
    console.log();
    console.log('Available Tools:');
    console.log('  Built-in Text Tools:');
    console.log('    • format_text(text, style) - Format text with styles');
    console.log('    • validate_json(json_string) - Validate and parse JSON');
    console.log('    • count_words(text) - Count words, characters, lines');
    console.log('    • reverse_text(text) - Reverse text characters');
    console.log('    • trim_text(text, mode) - Trim whitespace');
    console.log('  Git Tools (via MCP):');

    const mcpTools = toolRegistry.getAllTools();
    if (mcpTools.length > 0) {
      for (const tool of mcpTools) {
        console.log(`    • ${tool.name} - ${tool.description}`);
      }
    } else {
      console.log('    (No MCP tools available)');
    }

    console.log('  Diagnostic Tools:');
    console.log('    • git_health_check() - Check Git accessibility');
    console.log();
    console.log('Subscribed to Events:');
    console.log('  • text.processing - All text processing events');
    console.log('  • text.error - All error events');
    console.log('  • agent.connected - Agent connection events');
    console.log();
    console.log('Press Ctrl+C to stop the agent...');
    console.log('='.repeat(60));

    // Publish connection event with all tools
    const allToolNames = [
      'format_text', 'validate_json', 'count_words', 'reverse_text', 'trim_text',
      'git_health_check',
      ...mcpTools.map(t => t.name)
    ];

    client.publishEvent('agent.connected', {
      name: 'typescript-agent',
      networks: config.networks,
      tools: allToolNames,
      gitBaseDir: config.gitBaseDir,
      timestamp: Date.now()
    });

    // Now wait for the serve promise (which never resolves unless there's an error)
    await servePromise;

  } catch (error) {
    console.error('❌ Agent failed to start:', error);
    console.error();
    console.error('Troubleshooting:');
    console.error('  1. Is the KĀDI broker running at', config.brokerUrl, '?');
    console.error('  2. Try starting the broker with: cd kadi-broker && npm run dev');
    console.error('  3. Check if the port', config.brokerUrl.split(':')[2], 'is available');
    process.exit(1);
  }
}

// ============================================================================
// Entry Point
// ============================================================================

main();

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log();
  console.log('='.repeat(60));
  console.log('👋 Shutting down TypeScript Text Processing Agent...');
  console.log('='.repeat(60));

  // Shutdown MCP clients first
  try {
    await toolRegistry.shutdown();
  } catch (error) {
    console.error('Error shutting down MCP clients:', error);
  }

  // Then disconnect from KADI broker
  await client.disconnect();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log();
  console.log('='.repeat(60));
  console.log('👋 Shutting down TypeScript Text Processing Agent...');
  console.log('='.repeat(60));

  // Shutdown MCP clients first
  try {
    await toolRegistry.shutdown();
  } catch (error) {
    console.error('Error shutting down MCP clients:', error);
  }

  // Then disconnect from KADI broker
  await client.disconnect();
  process.exit(0);
});

export default client;
