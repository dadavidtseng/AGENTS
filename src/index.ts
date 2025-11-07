/**
 * Text Processing KĀDI Agent in TypeScript
 * =========================================
 *
 * This agent provides text processing and validation tools
 * for ProtogameJS3D using the KĀDI protocol.
 *
 * Features:
 * - Ed25519 cryptographic authentication
 * - Zod schema validation with type inference
 * - Text formatting and transformation tools
 * - JSON validation capabilities
 * - Event pub/sub system
 * - WebSocket communication with KĀDI broker
 *
 * Dependencies:
 * - @kadi.build/core: KĀDI protocol client library
 * - zod: Schema validation and type inference
 *
 * Usage:
 *     npm start
 *     # or
 *     npm run dev (with hot-reload)
 *
 * Environment Variables:
 *     KADI_BROKER_URL: WebSocket URL for KĀDI broker (default: ws://localhost:8080)
 *     KADI_NETWORK: Network to join (default: global,text)
 */

import { KadiClient, z } from '@kadi.build/core';

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
  networks: (process.env.KADI_NETWORK || 'global,text').split(',')
};

// ============================================================================
// KĀDI Client
// ============================================================================

const client = new KadiClient({
  name: 'text-processor',
  version: '1.0.0',
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
// Main Function
// ============================================================================

async function main() {
  console.log('='.repeat(60));
  console.log('🚀 Starting TypeScript Text Processing Agent for ProtogameJS3D');
  console.log('='.repeat(60));
  console.log(`Broker URL: ${config.brokerUrl}`);
  console.log(`Networks: ${config.networks.join(', ')}`);
  console.log();

  try {
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
    console.log('  • format_text(text, style) - Format text with styles');
    console.log('  • validate_json(json_string) - Validate and parse JSON');
    console.log('  • count_words(text) - Count words, characters, lines');
    console.log('  • reverse_text(text) - Reverse text characters');
    console.log('  • trim_text(text, mode) - Trim whitespace');
    console.log();
    console.log('Subscribed to Events:');
    console.log('  • text.processing - All text processing events');
    console.log('  • text.error - All error events');
    console.log('  • agent.connected - Agent connection events');
    console.log();
    console.log('Press Ctrl+C to stop the agent...');
    console.log('='.repeat(60));

    // Publish connection event
    client.publishEvent('agent.connected', {
      name: 'text-processor-typescript',
      networks: config.networks,
      tools: ['format_text', 'validate_json', 'count_words', 'reverse_text', 'trim_text'],
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
  await client.disconnect();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log();
  console.log('='.repeat(60));
  console.log('👋 Shutting down TypeScript Text Processing Agent...');
  console.log('='.repeat(60));
  await client.disconnect();
  process.exit(0);
});

export default client;
