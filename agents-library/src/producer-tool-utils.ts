/**
 * Producer Tool Utilities
 * ========================
 *
 * Shared utilities for agent-producer to invoke shrimp-task-manager tools
 * via KĀDI broker protocol with consistent error handling and retry logic.
 *
 * Includes Option C orchestration pattern (Claude API streaming with tool invocation)
 * for agent-producer workflow orchestration.
 *
 * Design Principles:
 * - Standardized error classification for retry logic
 * - Configurable timeout with sensible defaults
 * - Type-safe result handling with discriminated unions
 * - Graceful degradation on failure
 * - Streaming-first architecture with tool interruption support
 *
 * @module producer-tool-utils
 */

import Anthropic from '@anthropic-ai/sdk';
import { KadiClient } from '@kadi.build/core';
import { classifyToolError, ErrorType } from './types/tool-schemas.js';
import { validateTopicPattern } from './kadi-event-publisher.js';
import { logger, MODULE_AGENT } from './utils/logger.js';
import { timer } from './utils/timer.js';

// ============================================================================
// Async Response Manager (Singleton)
// ============================================================================

/**
 * Manages pending async tool responses from kadi-broker
 *
 * When a tool returns {status: "pending", requestId: "..."}, this manager
 * subscribes to kadi.ability.response notifications and resolves pending promises.
 */
class AsyncResponseManager {
  private static instance: AsyncResponseManager;
  private pendingResponses = new Map<string, {
    resolve: (value: any) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
  }>();
  private subscribed = false;

  private constructor() {}

  static getInstance(): AsyncResponseManager {
    if (!AsyncResponseManager.instance) {
      AsyncResponseManager.instance = new AsyncResponseManager();
    }
    return AsyncResponseManager.instance;
  }

  /**
   * Subscribe to kadi.ability.response notifications (once per process)
   */
  async subscribeToAbilityResponses(client: KadiClient): Promise<void> {
    if (this.subscribed) {
      return; // Already subscribed
    }

    // Subscribe to kadi.ability.response events via kadi-core v0.6.0 subscribe API
    await client.subscribe('kadi.ability.response', (event: any) => {
      const { requestId, result, error } = event || {};

      const pending = this.pendingResponses.get(requestId);
      if (!pending) {
        // This response is for a different request or already handled
        return;
      }

      // Clear timeout timer
      clearTimeout(pending.timer);
      this.pendingResponses.delete(requestId);

      // Resolve or reject the promise
      if (error) {
        pending.reject(new Error(`Async tool failed: ${error}`));
      } else {
        pending.resolve(result);
      }
    }, { broker: 'default' });

    this.subscribed = true;
    logger.info(MODULE_AGENT, 'AsyncResponseManager: Subscribed to kadi.ability.response notifications', timer.elapsed('main'));
  }

  /**
   * Wait for async ability response from kadi-broker
   */
  waitForResponse(requestId: string, timeout: number): Promise<any> {
    return new Promise((resolve, reject) => {
      // Setup timeout
      const timer = setTimeout(() => {
        this.pendingResponses.delete(requestId);
        reject(new Error(`Timeout waiting for async tool result: ${requestId}`));
      }, timeout);

      // Register promise resolver
      this.pendingResponses.set(requestId, {
        resolve,
        reject,
        timer
      });
    });
  }
}

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Options for invokeShrimTool
 *
 * @property timeout - Timeout in milliseconds (default: 30000)
 * @property targetAgent - Target agent ID (default: 'mcp-server-shrimp-agent-playground')
 */
export interface InvokeOptions {
  /**
   * Timeout in milliseconds
   * @default 30000
   */
  timeout?: number;

  /**
   * Target agent ID that provides the shrimp tools
   * @default 'mcp-server-shrimp-agent-playground'
   */
  targetAgent?: string;

  /**
   * KadiClient instance for async response handling (optional)
   * Required if the tool returns {status: "pending"} and you want to wait for the async result
   */
  client?: KadiClient;
}

/**
 * Structured result from shrimp tool invocation
 *
 * Uses discriminated union pattern for type-safe error handling.
 * Different from types/tool-schemas.ts ToolInvocationResult which is for KĀDI protocol.
 */
export interface ShrimpToolResult {
  /**
   * Success flag - use for type narrowing
   */
  success: boolean;

  /**
   * Result data (present when success=true)
   */
  data?: any;

  /**
   * Error details (present when success=false)
   */
  error?: {
    /**
     * Error classification for retry logic
     */
    type: ErrorType;

    /**
     * Human-readable error message
     */
    message: string;

    /**
     * Original error object (if available)
     */
    original?: Error;
  };
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Invoke shrimp-task-manager tool via KĀDI broker protocol
 *
 * Provides consistent error handling, timeout management, and error classification
 * for tools exposed by shrimp-task-manager MCP server. Uses KĀDI protocol.invokeTool()
 * with standardized response handling.
 *
 * Error Classification:
 * - **Transient errors** (retry recommended):
 *   - Network errors (ECONNREFUSED, ENOTFOUND)
 *   - Timeout errors
 *   - Rate limiting (429)
 *   - Service unavailable (503)
 *
 * - **Permanent errors** (fail-fast):
 *   - Validation errors (400)
 *   - Authentication errors (401, 403)
 *   - Not found errors (404)
 *   - Invalid input errors
 *
 * Response Handling:
 * - Success (200-299): Returns { success: true, data: responseData }
 * - Client error (400-499): Returns { success: false, error: { type: 'permanent', message } }
 * - Server error (500-599): Returns { success: false, error: { type: 'transient', message } }
 * - Network error: Returns { success: false, error: { type: 'transient', message } }
 *
 * @param protocol - KĀDI broker protocol instance (from client.getBrokerProtocol())
 * @param toolName - Name of shrimp tool to invoke (e.g., 'shrimp_plan_task')
 * @param params - Tool input parameters (validated by tool's input schema)
 * @param options - Optional configuration (timeout, targetAgent)
 * @returns Structured result with success flag and data/error
 *
 * @example
 * ```typescript
 * // Success case
 * const result = await invokeShrimTool(
 *   protocol,
 *   'shrimp_plan_task',
 *   { description: 'Implement feature X', requirements: 'Must be async' }
 * );
 *
 * if (result.success) {
 *   console.log('Task planned:', result.data);
 * } else {
 *   if (result.error.type === ErrorType.Transient) {
 *     // Retry with exponential backoff
 *     await retryWithBackoff(() => invokeShrimTool(...));
 *   } else {
 *     // Fail-fast on permanent errors
 *     console.error('Permanent error:', result.error.message);
 *   }
 * }
 * ```
 *
 * @example
 * ```typescript
 * // With custom timeout
 * const result = await invokeShrimTool(
 *   protocol,
 *   'shrimp_execute_task',
 *   { taskId: '123' },
 *   { timeout: 60000 } // 60 seconds
 * );
 * ```
 *
 * @example
 * ```typescript
 * // With custom target agent
 * const result = await invokeShrimTool(
 *   protocol,
 *   'shrimp_split_tasks',
 *   { tasksRaw: JSON.stringify([...]), updateMode: 'append' },
 *   { targetAgent: 'mcp-server-shrimp-custom' }
 * );
 * ```
 */
export async function invokeShrimTool(
  protocol: any,
  toolName: string,
  params: any,
  options?: InvokeOptions
): Promise<ShrimpToolResult> {
  // Extract options with defaults
  const timeout = options?.timeout || 30000;
  const targetAgent = options?.targetAgent || 'mcp-server-shrimp-agent-playground';
  const client = options?.client; // KadiClient for async response subscription

  try {
    // Invoke tool via KĀDI protocol
    const response = await protocol.invokeTool({
      targetAgent,
      toolName,
      toolInput: params,
      timeout
    });

    // Check if response is async pending
    if (response && typeof response === 'object' &&
        response.status === 'pending' && response.requestId) {

      console.log(`⏳ Tool is pending, waiting for async result: ${response.requestId}`);

      // Ensure AsyncResponseManager is subscribed (if client provided)
      if (client) {
        const asyncManager = AsyncResponseManager.getInstance();
        asyncManager.subscribeToAbilityResponses(client);

        // Wait for async response
        try {
          const asyncResult = await asyncManager.waitForResponse(response.requestId, timeout);
          console.log(`Async tool result received for ${response.requestId}`);

          // Return the async result
          return {
            success: true,
            data: asyncResult
          };
        } catch (error: any) {
          console.error(`Async tool timeout: ${error.message}`);
          return {
            success: false,
            error: {
              type: ErrorType.Transient,
              message: error.message,
              original: error instanceof Error ? error : undefined
            }
          };
        }
      } else {
        // No client provided - cannot wait for async result
        return {
          success: false,
          error: {
            type: ErrorType.Permanent,
            message: 'Tool returned pending status but no KadiClient provided for async response handling'
          }
        };
      }
    }

    // Check response status code (if available)
    // KĀDI protocol returns response with status code and data
    const statusCode = response?.status || response?.statusCode || 200;

    if (statusCode >= 200 && statusCode < 300) {
      // Success response (2xx)
      return {
        success: true,
        data: response?.data || response
      };
    } else if (statusCode >= 400 && statusCode < 500) {
      // Client error (4xx) - permanent error
      return {
        success: false,
        error: {
          type: ErrorType.Permanent,
          message: response?.error || response?.message || `Client error: ${statusCode}`
        }
      };
    } else if (statusCode >= 500 && statusCode < 600) {
      // Server error (5xx) - transient error
      return {
        success: false,
        error: {
          type: ErrorType.Transient,
          message: response?.error || response?.message || `Server error: ${statusCode}`
        }
      };
    } else {
      // Unknown status code - treat as permanent error
      return {
        success: false,
        error: {
          type: ErrorType.Permanent,
          message: `Unknown status code: ${statusCode}`
        }
      };
    }

  } catch (error: any) {
    // Network error, timeout, or other exception
    const classification = classifyToolError(error);

    return {
      success: false,
      error: {
        type: classification.type === 'transient' ? ErrorType.Transient : ErrorType.Permanent,
        message: classification.message,
        original: error instanceof Error ? error : undefined
      }
    };
  }
}

/**
 * Type guard to check if result is a success
 *
 * @param result - Tool invocation result
 * @returns True if result is success
 *
 * @example
 * ```typescript
 * if (isToolSuccess(result)) {
 *   console.log('Success:', result.data);
 * }
 * ```
 */
export function isToolSuccess(result: ShrimpToolResult): result is ShrimpToolResult & { success: true; data: any } {
  return result.success === true;
}

/**
 * Type guard to check if result is a failure
 *
 * @param result - Tool invocation result
 * @returns True if result is failure
 *
 * @example
 * ```typescript
 * if (isToolFailure(result)) {
 *   console.error('Failure:', result.error.message);
 * }
 * ```
 */
export function isToolFailure(result: ShrimpToolResult): result is ShrimpToolResult & { success: false; error: { type: ErrorType; message: string } } {
  return result.success === false;
}

// ============================================================================
// Orchestration Type Definitions
// ============================================================================

/**
 * Tool definition for Claude API
 *
 * Matches Anthropic SDK tool definition structure.
 */
export interface ToolDefinition {
  /**
   * Tool name (must be unique)
   */
  name: string;

  /**
   * Human-readable tool description for Claude
   */
  description: string;

  /**
   * Input schema using JSON Schema format
   */
  input_schema: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
}

/**
 * Record of a tool invocation during orchestration
 *
 * Used for debugging and analysis of tool usage patterns.
 */
export interface ToolInvocation {
  /**
   * Tool name that was invoked
   */
  toolName: string;

  /**
   * Input parameters passed to tool
   */
  input: any;

  /**
   * Result returned from tool (success or error)
   */
  result: ShrimpToolResult;

  /**
   * Timestamp when tool was invoked
   */
  timestamp: string;

  /**
   * Duration of tool invocation in milliseconds
   */
  durationMs: number;
}

/**
 * Options for orchestrateWithClaude
 */
export interface OrchestrationOptions {
  /**
   * Maximum tokens for Claude response
   * @default 8000
   */
  max_tokens?: number;

  /**
   * Temperature for Claude response (0-1)
   * @default 1.0
   */
  temperature?: number;

  /**
   * System prompts for Claude
   * @default []
   */
  system?: string[];

  /**
   * Claude model to use
   * @default 'claude-sonnet-4-5-20250929'
   */
  model?: string;

  /**
   * Timeout for tool invocations in milliseconds
   * @default 30000
   */
  toolTimeout?: number;

  /**
   * Target agent for tool invocations
   * @default 'mcp-server-shrimp-agent-playground'
   */
  targetAgent?: string;

  /**
   * KadiClient instance for async response handling (optional)
   * Required if tools return {status: "pending"} and you want to wait for async results
   */
  client?: KadiClient;
}

/**
 * Result from orchestrateWithClaude
 */
export interface OrchestrationResult {
  /**
   * Accumulated text response from Claude
   */
  text: string;

  /**
   * Log of all tool invocations during orchestration
   */
  toolInvocations: ToolInvocation[];

  /**
   * Whether orchestration completed successfully
   */
  success: boolean;

  /**
   * Error message if orchestration failed
   */
  error?: string;
}

// ============================================================================
// Orchestration Utility Functions
// ============================================================================

/**
 * Orchestrate workflow using Claude API streaming with tool invocation (Option C pattern)
 *
 * Implements agent-producer Option C orchestration flow:
 * 1. Stream Claude API response with tool definitions
 * 2. When Claude requests tool use, pause stream
 * 3. Invoke tool via invokeShrimTool() with KĀDI protocol
 * 4. Resume stream with tool_result
 * 5. Accumulate text blocks for final response
 * 6. Log all tool invocations for debugging
 *
 * Streaming Architecture:
 * - Uses Anthropic SDK streaming API for low-latency responses
 * - Handles streaming interruptions gracefully (tool_use blocks)
 * - Accumulates partial text blocks into final response
 * - Maintains tool invocation log for analysis
 *
 * Error Handling:
 * - Tool invocation failures are passed back to Claude as error tool_result
 * - Stream errors are caught and returned in OrchestrationResult
 * - Graceful degradation if tool invocation fails
 *
 * @param anthropic - Anthropic SDK client instance
 * @param protocol - KĀDI broker protocol instance (from client.getBrokerProtocol())
 * @param prompt - User prompt to send to Claude
 * @param availableTools - Array of tool definitions Claude can use
 * @param options - Optional configuration (max_tokens, temperature, system prompts, etc.)
 * @returns Orchestration result with accumulated text and tool invocation log
 *
 * @example
 * ```typescript
 * // Basic usage
 * const result = await orchestrateWithClaude(
 *   anthropic,
 *   protocol,
 *   'Plan a task to implement feature X',
 *   [
 *     {
 *       name: 'shrimp_plan_task',
 *       description: 'Create task plan with requirements',
 *       input_schema: {
 *         type: 'object',
 *         properties: {
 *           description: { type: 'string' },
 *           requirements: { type: 'string' }
 *         },
 *         required: ['description']
 *       }
 *     }
 *   ]
 * );
 *
 * if (result.success) {
 *   console.log('Claude response:', result.text);
 *   console.log('Tools invoked:', result.toolInvocations.length);
 * }
 * ```
 *
 * @example
 * ```typescript
 * // With custom options
 * const result = await orchestrateWithClaude(
 *   anthropic,
 *   protocol,
 *   'Split tasks for feature implementation',
 *   tools,
 *   {
 *     max_tokens: 16000,
 *     temperature: 0.7,
 *     system: ['You are a task planning assistant'],
 *     toolTimeout: 60000
 *   }
 * );
 * ```
 */
export async function orchestrateWithClaude(
  anthropic: Anthropic,
  protocol: any,
  prompt: string,
  availableTools: ToolDefinition[],
  options?: OrchestrationOptions
): Promise<OrchestrationResult> {
  // Extract options with defaults
  const maxTokens = options?.max_tokens || 8000;
  const temperature = options?.temperature || 1.0;
  const system = options?.system || [];
  const model = options?.model || 'claude-sonnet-4-5-20250929';
  const toolTimeout = options?.toolTimeout || 30000;
  const targetAgent = options?.targetAgent || 'mcp-server-shrimp-agent-playground';
  const client = options?.client; // KadiClient for async response handling

  // Initialize result
  const result: OrchestrationResult = {
    text: '',
    toolInvocations: [],
    success: false
  };

  try {
    console.log('Starting Claude API orchestration...');
    console.log(`   Model: ${model}`);
    console.log(`   Max tokens: ${maxTokens}`);
    console.log(`   Temperature: ${temperature}`);
    console.log(`   Available tools: ${availableTools.map(t => t.name).join(', ')}`);

    // Build messages array for Claude API
    const messages: Anthropic.Messages.MessageParam[] = [
      {
        role: 'user',
        content: prompt
      }
    ];

    // Orchestration loop - continue until Claude stops requesting tools
    let continueOrchestration = true;
    let iterationCount = 0;
    const maxIterations = 10; // Prevent infinite loops

    while (continueOrchestration && iterationCount < maxIterations) {
      iterationCount++;
      console.log(`\nOrchestration iteration ${iterationCount}/${maxIterations}`);

      // Stream Claude API response
      const stream = await anthropic.messages.stream({
        model,
        max_tokens: maxTokens,
        temperature,
        system: system.length > 0 ? system.join('\n') : undefined,
        messages,
        tools: availableTools.length > 0 ? availableTools : undefined
      });

      // Accumulate content blocks from stream
      let textAccumulator = '';
      const toolUseBlocks: Array<{ id: string; name: string; input: any }> = [];

      // Process stream events
      for await (const event of stream) {
        if (event.type === 'content_block_delta') {
          // Handle text delta
          if (event.delta.type === 'text_delta') {
            textAccumulator += event.delta.text;
          }
        } else if (event.type === 'content_block_start') {
          // Handle tool use block
          if (event.content_block.type === 'tool_use') {
            console.log(`\nClaude requested tool: ${event.content_block.name}`);
            toolUseBlocks.push({
              id: event.content_block.id,
              name: event.content_block.name,
              input: event.content_block.input
            });
          }
        }
      }

      // Accumulate text to result
      if (textAccumulator.length > 0) {
        result.text += textAccumulator;
        console.log(`\nClaude response: ${textAccumulator.substring(0, 150)}${textAccumulator.length > 150 ? '...' : ''}`);
      }

      // Check if Claude requested tool use
      if (toolUseBlocks.length > 0) {
        console.log(`\nProcessing ${toolUseBlocks.length} tool invocation(s)...`);

        // Build tool results for next iteration
        const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];

        // Invoke each tool
        for (const toolUse of toolUseBlocks) {
          console.log(`\n   → Invoking: ${toolUse.name}`);
          console.log(`     Input: ${JSON.stringify(toolUse.input).substring(0, 100)}...`);

          const startTime = Date.now();

          // Invoke tool via invokeShrimTool
          const toolResult = await invokeShrimTool(
            protocol,
            toolUse.name,
            toolUse.input,
            { timeout: toolTimeout, targetAgent, client }
          );

          const durationMs = Date.now() - startTime;

          // Log tool invocation
          const invocation: ToolInvocation = {
            toolName: toolUse.name,
            input: toolUse.input,
            result: toolResult,
            timestamp: new Date().toISOString(),
            durationMs
          };
          result.toolInvocations.push(invocation);

          console.log(`     Completed in ${durationMs}ms`);
          console.log(`     Success: ${toolResult.success}`);

          // Build tool result for Claude
          if (toolResult.success) {
            toolResults.push({
              type: 'tool_result',
              tool_use_id: toolUse.id,
              content: JSON.stringify(toolResult.data)
            });
          } else {
            // Pass error back to Claude
            toolResults.push({
              type: 'tool_result',
              tool_use_id: toolUse.id,
              content: `Error: ${toolResult.error?.message}`,
              is_error: true
            });
          }
        }

        // Add assistant message with tool use blocks
        messages.push({
          role: 'assistant',
          content: toolUseBlocks.map(tu => ({
            type: 'tool_use' as const,
            id: tu.id,
            name: tu.name,
            input: tu.input
          }))
        });

        // Add user message with tool results
        messages.push({
          role: 'user',
          content: toolResults
        });

        // Continue orchestration loop
        continueOrchestration = true;

      } else {
        // No tool use - orchestration complete
        console.log('\nOrchestration complete (no tool use requested)');
        continueOrchestration = false;
      }
    }

    if (iterationCount >= maxIterations) {
      console.warn('\nOrchestration loop exceeded max iterations - stopping');
      result.error = 'Orchestration loop exceeded maximum iterations';
    }

    result.success = true;
    console.log('\nClaude API orchestration succeeded');
    console.log(`   Total text length: ${result.text.length} characters`);
    console.log(`   Total tool invocations: ${result.toolInvocations.length}`);

    return result;

  } catch (error: any) {
    console.error('\nClaude API orchestration failed');
    console.error(`   Error: ${error.message || String(error)}`);

    result.success = false;
    result.error = error.message || String(error);
    return result;
  }
}

// ============================================================================
// Event Publishing Type Definitions
// ============================================================================

/**
 * Metadata for tool event publication
 *
 * Required fields for standardized tool event structure across agent-producer.
 */
export interface EventMetadata {
  /**
   * Tool name that triggered the event
   */
  toolName: string;

  /**
   * Optional task ID associated with the tool invocation
   */
  taskId?: string;

  /**
   * Agent name publishing the event
   * @default 'producer'
   */
  agentName?: string;
}

// ============================================================================
// Event Publishing Utility Functions
// ============================================================================

/**
 * Publish standardized tool event to KĀDI broker
 *
 * Creates consistent event structure across all agent-producer tools with
 * required metadata fields (timestamp, agentName, toolName, taskId).
 *
 * Topic Pattern: producer.tool.{eventType}
 * - producer.tool.invoked - Tool invocation started
 * - producer.tool.completed - Tool completed successfully
 * - producer.tool.failed - Tool invocation failed
 *
 * Event Structure:
 * ```typescript
 * {
 *   timestamp: string;      // ISO 8601 timestamp
 *   agentName: string;      // 'producer' (default)
 *   toolName: string;       // Tool that was invoked
 *   taskId?: string;        // Optional task ID
 *   ...data                 // Additional event data
 * }
 * ```
 *
 * Validation:
 * - Topic pattern validated using validateTopicPattern()
 * - Ensures backward compatibility with existing event conventions
 *
 * Error Handling:
 * - Invalid topic patterns logged as warnings
 * - Publishing failures logged but do not throw
 * - Graceful degradation if broker unavailable
 *
 * @param client - KĀDI client instance (from KadiClient)
 * @param eventType - Event type suffix (e.g., 'invoked', 'completed', 'failed')
 * @param data - Event data payload (will be merged with metadata)
 * @param metadata - Required metadata (toolName, optional taskId, agentName)
 *
 * @example
 * ```typescript
 * // Publish tool invocation event
 * await publishToolEvent(
 *   client,
 *   'invoked',
 *   { input: { description: 'Plan feature X' } },
 *   { toolName: 'shrimp_plan_task', taskId: 'task-123' }
 * );
 * // Topic: producer.tool.invoked
 * // Payload: { timestamp, agentName: 'producer', toolName, taskId, input: {...} }
 * ```
 *
 * @example
 * ```typescript
 * // Publish tool completion event
 * await publishToolEvent(
 *   client,
 *   'completed',
 *   { result: { success: true, data: {...} }, durationMs: 1500 },
 *   { toolName: 'shrimp_execute_task', taskId: 'task-456' }
 * );
 * // Topic: producer.tool.completed
 * ```
 *
 * @example
 * ```typescript
 * // Publish tool failure event
 * await publishToolEvent(
 *   client,
 *   'failed',
 *   { error: 'Validation failed', errorType: 'permanent' },
 *   { toolName: 'shrimp_split_tasks', taskId: 'task-789' }
 * );
 * // Topic: producer.tool.failed
 * ```
 */
export async function publishToolEvent(
  client: KadiClient,
  eventType: string,
  data: any,
  metadata: EventMetadata
): Promise<void> {
  // Extract metadata with defaults
  const agentName = metadata.agentName || 'producer';
  const toolName = metadata.toolName;
  const taskId = metadata.taskId;

  // Construct topic: producer.tool.{eventType}
  const topic = `producer.tool.${eventType}`;

  // Validate topic pattern
  if (!validateTopicPattern(topic)) {
    console.warn(`Invalid topic pattern: ${topic}`);
    console.warn(`   Expected format: {platform}.{event_type}.{bot_id}`);
    console.warn(`   This may cause routing issues in KĀDI broker`);
  }

  // Build event payload with required metadata
  const eventPayload = {
    timestamp: new Date().toISOString(),
    agentName,
    toolName,
    ...(taskId ? { taskId } : {}),
    ...data
  };

  try {
    console.log(`Publishing tool event`);
    console.log(`   Topic: ${topic}`);
    console.log(`   Tool: ${toolName}`);
    if (taskId) {
      console.log(`   Task ID: ${taskId}`);
    }
    console.log(`   Event type: ${eventType}`);
    console.log(`   Payload keys: ${Object.keys(eventPayload).join(', ')}`);

    // Publish event to KĀDI broker
    await client.publish(topic, eventPayload, { broker: 'default', network: 'global' });

    console.log(`   Event published successfully`);

  } catch (error: any) {
    // Log error but don't throw - graceful degradation
    console.error(`Failed to publish tool event (non-fatal)`);
    console.error(`   Topic: ${topic}`);
    console.error(`   Tool: ${toolName}`);
    console.error(`   Error: ${error.message || String(error)}`);
    // Don't throw - event publishing failure should not crash tool execution
  }
}
