/**
 * Tool Schema Type Definitions
 * ==============================
 *
 * Type definitions for KĀDI tool invocation, validation, and error handling.
 * Provides standardized interfaces for tool schemas, invocation results, and error classification.
 *
 * Design Principles:
 * - Discriminated unions for type-safe result handling
 * - Clear error classification for retry logic
 * - Compatible with @kadi.build/core tool registration
 * - Runtime validation via Zod schemas
 *
 * @module tool-schemas
 */

import { z } from '@kadi.build/core';

// ============================================================================
// Error Classification
// ============================================================================

/**
 * Error type classification for retry logic
 *
 * Discriminates between transient errors (retry allowed) and permanent errors (fail-fast).
 * Used by circuit breaker and exponential backoff retry logic in BaseBot.
 *
 * @example
 * ```typescript
 * function classifyError(error: Error): ErrorType {
 *   const message = error.message.toLowerCase();
 *
 *   // Transient errors - retry allowed
 *   if (message.includes('timeout')) return ErrorType.Transient;
 *   if (message.includes('econnrefused')) return ErrorType.Transient;
 *   if (message.includes('enotfound')) return ErrorType.Transient;
 *   if (message.includes('rate limit')) return ErrorType.Transient;
 *
 *   // Permanent errors - fail-fast
 *   if (message.includes('unauthorized')) return ErrorType.Permanent;
 *   if (message.includes('not found')) return ErrorType.Permanent;
 *   if (message.includes('invalid')) return ErrorType.Permanent;
 *   if (message.includes('validation')) return ErrorType.Permanent;
 *
 *   // Default to permanent to avoid infinite retry loops
 *   return ErrorType.Permanent;
 * }
 * ```
 */
export enum ErrorType {
  /**
   * Transient error - may succeed on retry
   *
   * Includes:
   * - Network errors (ECONNREFUSED, ENOTFOUND)
   * - Timeout errors
   * - Rate limit errors (429)
   * - Temporary service unavailable (503)
   */
  Transient = 'transient',

  /**
   * Permanent error - will not succeed on retry
   *
   * Includes:
   * - Validation errors (400)
   * - Authentication errors (401, 403)
   * - Not found errors (404)
   * - Invalid input errors
   * - Business logic errors
   */
  Permanent = 'permanent'
}

// ============================================================================
// Tool Schema Definition
// ============================================================================

/**
 * Tool schema interface for KĀDI tool registration
 *
 * Defines the structure of a tool including name, description, and Zod schemas
 * for input/output validation. Compatible with @kadi.build/core tool registration.
 *
 * @example
 * ```typescript
 * const sendMessageTool: ToolSchema = {
 *   name: 'send_slack_message',
 *   description: 'Send a message to a Slack channel',
 *   input: z.object({
 *     channel: z.string().describe('Channel ID (e.g., C12345678)'),
 *     text: z.string().describe('Message text to send'),
 *     thread_ts: z.string().optional().describe('Optional thread timestamp for replies')
 *   }),
 *   output: z.object({
 *     ok: z.boolean().describe('Whether the message was sent successfully'),
 *     ts: z.string().describe('Timestamp of the sent message'),
 *     channel: z.string().describe('Channel ID where message was sent')
 *   })
 * };
 * ```
 */
export interface ToolSchema<TInput = any, TOutput = any> {
  /**
   * Tool name (must be unique within agent)
   *
   * Convention: lowercase with underscores (e.g., 'send_slack_message', 'plan_task')
   */
  name: string;

  /**
   * Human-readable tool description
   *
   * Describes what the tool does and when to use it.
   * Used by Claude API for tool selection.
   */
  description: string;

  /**
   * Input schema using Zod
   *
   * Defines and validates the structure of tool input parameters.
   * Use .describe() on each field to provide documentation.
   */
  input: z.ZodType<TInput>;

  /**
   * Output schema using Zod
   *
   * Defines and validates the structure of tool output.
   * Use .describe() on each field to provide documentation.
   */
  output: z.ZodType<TOutput>;
}

// ============================================================================
// Tool Invocation Result (Discriminated Union)
// ============================================================================

/**
 * Success result from tool invocation
 *
 * Represents a successful tool execution with result data.
 * Discriminated by `success: true`.
 *
 * @example
 * ```typescript
 * const result: ToolInvocationSuccess = {
 *   success: true,
 *   result: {
 *     ok: true,
 *     ts: '1234567890.123456',
 *     channel: 'C12345678'
 *   }
 * };
 * ```
 */
export interface ToolInvocationSuccess<T = any> {
  /** Discriminator for type narrowing */
  success: true;

  /** Tool execution result (validated against output schema) */
  result: T;
}

/**
 * Failure result from tool invocation
 *
 * Represents a failed tool execution with error details.
 * Discriminated by `success: false`.
 *
 * @example
 * ```typescript
 * const result: ToolInvocationFailure = {
 *   success: false,
 *   error: new Error('Connection timeout after 10 seconds'),
 *   errorType: ErrorType.Transient
 * };
 * ```
 */
export interface ToolInvocationFailure {
  /** Discriminator for type narrowing */
  success: false;

  /** Error object with message and stack trace */
  error: Error;

  /**
   * Error classification for retry logic (optional)
   *
   * If not provided, retry logic should classify error based on error message.
   */
  errorType?: ErrorType;
}

/**
 * Tool invocation result (discriminated union)
 *
 * Result of a tool execution - either success with result data or failure with error.
 * Use discriminated union pattern for type-safe error handling.
 *
 * @example
 * ```typescript
 * async function invokeTool(toolName: string, input: any): Promise<ToolInvocationResult> {
 *   try {
 *     const result = await protocol.invokeTool({ toolName, toolInput: input });
 *     return { success: true, result };
 *   } catch (error) {
 *     return {
 *       success: false,
 *       error: error instanceof Error ? error : new Error(String(error)),
 *       errorType: classifyError(error)
 *     };
 *   }
 * }
 *
 * // Usage with type narrowing
 * const result = await invokeTool('send_message', { channel: 'C123', text: 'Hello' });
 *
 * if (result.success) {
 *   // TypeScript knows result.result exists
 *   console.log('Message sent:', result.result.ts);
 * } else {
 *   // TypeScript knows result.error exists
 *   if (result.errorType === ErrorType.Transient) {
 *     console.log('Transient error - retrying:', result.error.message);
 *   } else {
 *     console.error('Permanent error - failing:', result.error.message);
 *   }
 * }
 * ```
 */
export type ToolInvocationResult<T = any> = ToolInvocationSuccess<T> | ToolInvocationFailure;

// ============================================================================
// Tool Invocation Parameters
// ============================================================================

/**
 * Parameters for invoking a tool via KĀDI broker protocol
 *
 * Used by BaseBot.invokeToolWithRetry() and protocol.invokeTool().
 *
 * @example
 * ```typescript
 * const params: ToolInvocationParams = {
 *   targetAgent: 'mcp-server-slack',
 *   toolName: 'send_slack_message',
 *   toolInput: {
 *     channel: 'C12345678',
 *     text: 'Hello from KĀDI!'
 *   },
 *   timeout: 10000
 * };
 *
 * const result = await protocol.invokeTool(params);
 * ```
 */
export interface ToolInvocationParams<T = any> {
  /**
   * Target agent ID that provides the tool
   *
   * @example 'mcp-server-slack', 'mcp-server-shrimp-agent-playground'
   */
  targetAgent: string;

  /**
   * Name of the tool to invoke
   *
   * @example 'send_slack_message', 'shrimp_plan_task'
   */
  toolName: string;

  /**
   * Input parameters for the tool (validated against tool's input schema)
   */
  toolInput: T;

  /**
   * Timeout in milliseconds
   *
   * @default 30000 (30 seconds)
   */
  timeout?: number;
}

// ============================================================================
// Zod Schemas for Runtime Validation
// ============================================================================

/**
 * Zod schema for ToolInvocationSuccess
 */
export const ToolInvocationSuccessSchema = z.object({
  success: z.literal(true),
  result: z.any()
});

/**
 * Zod schema for ToolInvocationFailure
 */
export const ToolInvocationFailureSchema = z.object({
  success: z.literal(false),
  error: z.instanceof(Error),
  errorType: z.nativeEnum(ErrorType).optional()
});

/**
 * Zod schema for ToolInvocationResult
 */
export const ToolInvocationResultSchema = z.discriminatedUnion('success', [
  ToolInvocationSuccessSchema,
  ToolInvocationFailureSchema
]);

/**
 * Zod schema for ToolInvocationParams
 */
export const ToolInvocationParamsSchema = z.object({
  targetAgent: z.string().min(1, 'Target agent ID is required'),
  toolName: z.string().min(1, 'Tool name is required'),
  toolInput: z.any(),
  timeout: z.number().positive().optional()
});

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Type guard to check if result is a success
 *
 * @param result - Tool invocation result
 * @returns True if result is ToolInvocationSuccess
 *
 * @example
 * ```typescript
 * if (isToolInvocationSuccess(result)) {
 *   console.log('Success:', result.result);
 * }
 * ```
 */
export function isToolInvocationSuccess<T = any>(
  result: ToolInvocationResult<T>
): result is ToolInvocationSuccess<T> {
  return result.success === true;
}

/**
 * Type guard to check if result is a failure
 *
 * @param result - Tool invocation result
 * @returns True if result is ToolInvocationFailure
 *
 * @example
 * ```typescript
 * if (isToolInvocationFailure(result)) {
 *   console.error('Failure:', result.error.message);
 * }
 * ```
 */
export function isToolInvocationFailure(
  result: ToolInvocationResult
): result is ToolInvocationFailure {
  return result.success === false;
}

// ============================================================================
// Error Classification Helper
// ============================================================================

/**
 * Detailed error classification result
 *
 * Provides comprehensive error information for intelligent retry logic and error handling.
 * Used by BaseBot, producer utilities, and worker agents to decide retry strategies.
 *
 * @example
 * ```typescript
 * const classification = classifyToolError(error);
 *
 * if (classification.retryable) {
 *   console.log(`Transient ${classification.category}: ${classification.message}`);
 *   if (classification.category === 'rate_limit') {
 *     // Use exponential backoff for rate limiting
 *     await retryWithExponentialBackoff(() => operation());
 *   } else {
 *     // Use standard retry for other transient errors
 *     await retryWithBackoff(() => operation());
 *   }
 * } else {
 *   console.error(`Permanent ${classification.category}: ${classification.message}`);
 *   throw error; // Fail-fast
 * }
 * ```
 */
export interface ErrorClassification {
  /**
   * Error type for basic classification
   *
   * - 'transient': Error may succeed on retry (network issues, timeouts, rate limits, 5xx)
   * - 'permanent': Error will not succeed on retry (validation, auth, 4xx except 429)
   */
  type: 'transient' | 'permanent';

  /**
   * Specific error category for fine-grained handling
   *
   * Categories:
   * - Transient: 'network', 'timeout', 'rate_limit', 'server_error', 'service_unavailable'
   * - Permanent: 'validation', 'authentication', 'authorization', 'not_found', 'bad_request', 'unknown'
   */
  category: string;

  /**
   * Human-readable error message
   *
   * Describes what went wrong and provides context for debugging.
   */
  message: string;

  /**
   * Whether the error is retriable
   *
   * True for transient errors, false for permanent errors.
   * Use this flag to decide retry strategy.
   */
  retryable: boolean;

  /**
   * Optional HTTP status code if available
   *
   * Extracted from error message, error object, or HTTP response.
   */
  statusCode?: number;

  /**
   * Optional Node.js error code if available
   *
   * Examples: ECONNREFUSED, ETIMEDOUT, ENOTFOUND, ECONNRESET
   */
  errorCode?: string;
}

/**
 * Classify error as transient or permanent with detailed categorization
 *
 * Analyzes errors from multiple sources (Claude API, KĀDI broker, Node.js) and returns
 * detailed classification for intelligent retry logic. Handles HTTP status codes,
 * Node.js error codes, and error message patterns.
 *
 * **Classification Rules:**
 *
 * **Transient Errors (retry allowed):**
 * - Network errors: ECONNREFUSED, ENOTFOUND, ECONNRESET, ETIMEDOUT
 * - Timeout errors: timeout, ETIMEDOUT
 * - Rate limiting: 429 status code, "rate limit" message (use exponential backoff)
 * - Server errors: 5xx status codes, "service unavailable"
 * - Connection errors: "socket hang up", "connection reset"
 *
 * **Permanent Errors (fail-fast):**
 * - Validation errors: 400 Bad Request, "validation", "invalid"
 * - Authentication: 401 Unauthorized, "unauthorized"
 * - Authorization: 403 Forbidden, "forbidden"
 * - Not found: 404 Not Found, "not found"
 * - Other 4xx client errors (except 429)
 *
 * **Special Cases:**
 * - 429 (Rate Limit): Classified as transient with category 'rate_limit' - use exponential backoff
 * - Unknown errors: Default to permanent to avoid infinite retry loops
 *
 * **Error Source Handling:**
 * - **Claude API errors**: Anthropic SDK error objects with status codes
 * - **KĀDI protocol errors**: Protocol response errors with status/statusCode fields
 * - **Node.js errors**: Error objects with code property (ECONNREFUSED, etc.)
 * - **Generic errors**: Error message pattern matching
 *
 * @param error - Error to classify (Error object, unknown type, or any)
 * @returns Detailed error classification with type, category, message, retryable flag
 *
 * @example
 * ```typescript
 * // Network error (transient)
 * try {
 *   await fetch('http://unavailable-service.com');
 * } catch (error) {
 *   const classification = classifyToolError(error);
 *   // { type: 'transient', category: 'network', message: 'ECONNREFUSED', retryable: true, errorCode: 'ECONNREFUSED' }
 * }
 * ```
 *
 * @example
 * ```typescript
 * // Rate limit error (transient with exponential backoff)
 * try {
 *   await anthropic.messages.create({ ... });
 * } catch (error) {
 *   const classification = classifyToolError(error);
 *   // { type: 'transient', category: 'rate_limit', message: 'Rate limit exceeded', retryable: true, statusCode: 429 }
 *
 *   if (classification.category === 'rate_limit') {
 *     // Use exponential backoff specifically for rate limits
 *     await retryWithExponentialBackoff(() => operation(), { baseDelay: 1000, maxDelay: 60000 });
 *   }
 * }
 * ```
 *
 * @example
 * ```typescript
 * // Validation error (permanent)
 * try {
 *   await invokeTool({ toolName: 'invalid', toolInput: null });
 * } catch (error) {
 *   const classification = classifyToolError(error);
 *   // { type: 'permanent', category: 'validation', message: 'Invalid tool input', retryable: false, statusCode: 400 }
 *
 *   // Don't retry - fail immediately
 *   console.error('Validation failed:', classification.message);
 *   throw error;
 * }
 * ```
 *
 * @example
 * ```typescript
 * // Generic error handling with classification
 * async function executeWithRetry(operation: () => Promise<any>, maxRetries: number = 3) {
 *   let attempt = 0;
 *
 *   while (attempt < maxRetries) {
 *     try {
 *       return await operation();
 *     } catch (error) {
 *       const classification = classifyToolError(error);
 *
 *       console.error(`Attempt ${attempt + 1} failed:`, classification.message);
 *
 *       if (!classification.retryable) {
 *         // Permanent error - fail immediately
 *         throw new Error(`Permanent error (${classification.category}): ${classification.message}`);
 *       }
 *
 *       // Calculate delay based on error category
 *       const delay = classification.category === 'rate_limit'
 *         ? Math.pow(2, attempt) * 1000  // Exponential backoff for rate limits
 *         : 1000;  // Fixed delay for other transient errors
 *
 *       console.log(`Retrying in ${delay}ms...`);
 *       await new Promise(resolve => setTimeout(resolve, delay));
 *
 *       attempt++;
 *     }
 *   }
 *
 *   throw new Error(`Operation failed after ${maxRetries} attempts`);
 * }
 * ```
 */
export function classifyToolError(error: Error | unknown): ErrorClassification {
  // Extract error message for pattern matching
  const errorMessage = error instanceof Error ? error.message : String(error);
  const messageLower = errorMessage.toLowerCase();

  // Extract Node.js error code if available
  const errorCode = (error as any)?.code as string | undefined;

  // Extract HTTP status code from various sources
  let statusCode: number | undefined;

  // Try to extract from error object (Anthropic SDK, KĀDI protocol)
  if (typeof (error as any)?.status === 'number') {
    statusCode = (error as any).status;
  } else if (typeof (error as any)?.statusCode === 'number') {
    statusCode = (error as any).statusCode;
  } else if (typeof (error as any)?.response?.status === 'number') {
    statusCode = (error as any).response.status;
  }

  // Try to extract from error message (e.g., "400 Bad Request", "429 Too Many Requests")
  if (!statusCode) {
    const statusMatch = errorMessage.match(/\b([45]\d{2})\b/);
    if (statusMatch) {
      statusCode = parseInt(statusMatch[1], 10);
    }
  }

  // ============================================================================
  // Transient Error Classification (retry allowed)
  // ============================================================================

  // Rate Limit (429) - Special case: use exponential backoff
  if (statusCode === 429 || messageLower.includes('rate limit') || messageLower.includes('too many requests')) {
    return {
      type: 'transient',
      category: 'rate_limit',
      message: 'Rate limit exceeded - use exponential backoff',
      retryable: true,
      statusCode: statusCode || 429,
      errorCode
    };
  }

  // Network Errors (Node.js error codes)
  if (errorCode === 'ECONNREFUSED') {
    return {
      type: 'transient',
      category: 'network',
      message: 'Connection refused - service may be unavailable',
      retryable: true,
      errorCode
    };
  }

  if (errorCode === 'ENOTFOUND') {
    return {
      type: 'transient',
      category: 'network',
      message: 'DNS lookup failed - hostname not found',
      retryable: true,
      errorCode
    };
  }

  if (errorCode === 'ECONNRESET') {
    return {
      type: 'transient',
      category: 'network',
      message: 'Connection reset by peer',
      retryable: true,
      errorCode
    };
  }

  if (errorCode === 'ETIMEDOUT') {
    return {
      type: 'transient',
      category: 'timeout',
      message: 'Connection timed out',
      retryable: true,
      errorCode
    };
  }

  // Timeout Errors (message patterns)
  if (messageLower.includes('timeout') || messageLower.includes('timed out')) {
    return {
      type: 'transient',
      category: 'timeout',
      message: 'Operation timed out',
      retryable: true,
      statusCode,
      errorCode
    };
  }

  // Server Errors (5xx status codes)
  if (statusCode && statusCode >= 500 && statusCode < 600) {
    return {
      type: 'transient',
      category: 'server_error',
      message: `Server error (${statusCode})`,
      retryable: true,
      statusCode,
      errorCode
    };
  }

  // Service Unavailable (503 or message patterns)
  if (messageLower.includes('service unavailable') || messageLower.includes('unavailable')) {
    return {
      type: 'transient',
      category: 'service_unavailable',
      message: 'Service temporarily unavailable',
      retryable: true,
      statusCode: statusCode || 503,
      errorCode
    };
  }

  // Connection Errors (message patterns)
  if (messageLower.includes('socket hang up') || messageLower.includes('connection reset')) {
    return {
      type: 'transient',
      category: 'network',
      message: 'Connection interrupted',
      retryable: true,
      statusCode,
      errorCode
    };
  }

  // ============================================================================
  // Permanent Error Classification (fail-fast)
  // ============================================================================

  // Bad Request (400)
  if (statusCode === 400 || messageLower.includes('bad request')) {
    return {
      type: 'permanent',
      category: 'bad_request',
      message: 'Bad request - check input parameters',
      retryable: false,
      statusCode: statusCode || 400,
      errorCode
    };
  }

  // Validation Errors
  if (messageLower.includes('validation') || messageLower.includes('invalid')) {
    return {
      type: 'permanent',
      category: 'validation',
      message: 'Validation failed - check input data',
      retryable: false,
      statusCode,
      errorCode
    };
  }

  // Authentication (401)
  if (statusCode === 401 || messageLower.includes('unauthorized') || messageLower.includes('authentication')) {
    return {
      type: 'permanent',
      category: 'authentication',
      message: 'Authentication failed - check API key or credentials',
      retryable: false,
      statusCode: statusCode || 401,
      errorCode
    };
  }

  // Authorization (403)
  if (statusCode === 403 || messageLower.includes('forbidden') || messageLower.includes('permission denied')) {
    return {
      type: 'permanent',
      category: 'authorization',
      message: 'Access forbidden - insufficient permissions',
      retryable: false,
      statusCode: statusCode || 403,
      errorCode
    };
  }

  // Not Found (404)
  if (statusCode === 404 || messageLower.includes('not found')) {
    return {
      type: 'permanent',
      category: 'not_found',
      message: 'Resource not found',
      retryable: false,
      statusCode: statusCode || 404,
      errorCode
    };
  }

  // Other 4xx Client Errors (except 429 which is handled above)
  if (statusCode && statusCode >= 400 && statusCode < 500 && statusCode !== 429) {
    return {
      type: 'permanent',
      category: 'bad_request',
      message: `Client error (${statusCode})`,
      retryable: false,
      statusCode,
      errorCode
    };
  }

  // ============================================================================
  // Default Classification (unknown errors)
  // ============================================================================

  // Default to permanent to avoid infinite retry loops
  // Better to fail-fast on unknown errors than retry indefinitely
  return {
    type: 'permanent',
    category: 'unknown',
    message: errorMessage || 'Unknown error',
    retryable: false,
    statusCode,
    errorCode
  };
}
