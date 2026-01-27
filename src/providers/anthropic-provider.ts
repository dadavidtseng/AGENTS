/**
 * Anthropic Provider Implementation
 *
 * Implements LLMProvider interface for Anthropic Claude models.
 * Provides chat completion, streaming, health checks, and model discovery.
 */

import Anthropic from '@anthropic-ai/sdk';
import type {
  LLMProvider,
  Message,
  ChatOptions,
  ProviderError,
} from './types.js';
import { ProviderErrorType } from './types.js';
import type { Result } from '../common/result.js';
import { ok, err } from '../common/result.js';

/**
 * Anthropic Claude Provider
 *
 * Wraps the Anthropic SDK to provide standardized LLM provider interface.
 * Supports both standard and streaming chat completions.
 */
export class AnthropicProvider implements LLMProvider {
  public readonly name = 'anthropic';
  private client: Anthropic;
  private consecutiveFailures = 0;
  private readonly maxConsecutiveFailures = 3;

  /**
   * Default model configuration
   */
  private readonly defaultModel = 'claude-sonnet-4-5-20250929';
  private readonly defaultMaxTokens = 8096;

  /**
   * Model name mapping for user-friendly aliases
   * Maps shorthand names to full Anthropic model identifiers
   */
  private readonly modelAliases: Record<string, string> = {
    // Claude 4 models (NEW - available in Tier 1)
    'claude-4-sonnet': 'claude-sonnet-4-20250514',
    'claude-sonnet-4': 'claude-sonnet-4-20250514',
    'sonnet-4': 'claude-sonnet-4-20250514',
    'claude-4.5-sonnet': 'claude-sonnet-4-5-20250929',
    'claude-sonnet-4.5': 'claude-sonnet-4-5-20250929',
    'sonnet-4.5': 'claude-sonnet-4-5-20250929',
    'claude-4-opus': 'claude-opus-4-20250514',
    'claude-opus-4': 'claude-opus-4-20250514',
    'opus-4': 'claude-opus-4-20250514',
    'claude-4.5-opus': 'claude-opus-4-5-20251101',
    'claude-opus-4.5': 'claude-opus-4-5-20251101',
    'opus-4.5': 'claude-opus-4-5-20251101',
    'claude-4-haiku': 'claude-haiku-4-20250514',
    'claude-haiku-4': 'claude-haiku-4-20250514',
    'haiku-4': 'claude-haiku-4-20250514',

    // Claude 3.5 models (NOT available in Tier 1)
    'claude-3-5-sonnet': 'claude-3-5-sonnet-20241022',
    'claude-3.5-sonnet': 'claude-3-5-sonnet-20241022',
    'sonnet-3.5': 'claude-3-5-sonnet-20241022',
    'claude-3-5-haiku': 'claude-3-5-haiku-20241022',
    'claude-3.5-haiku': 'claude-3-5-haiku-20241022',
    'haiku-3.5': 'claude-3-5-haiku-20241022',

    // Claude 3 models
    'claude-3-opus': 'claude-3-opus-20240229',
    'claude-3.0-opus': 'claude-3-opus-20240229',
    'opus': 'claude-3-opus-20240229',
    'claude-3-sonnet': 'claude-3-sonnet-20240229',
    'claude-3.0-sonnet': 'claude-3-sonnet-20240229',
    'sonnet': 'claude-3-sonnet-20240229',
    'claude-3-haiku': 'claude-3-haiku-20240307',
    'claude-3.0-haiku': 'claude-3-haiku-20240307',
    'haiku': 'claude-3-haiku-20240307',
  };

  /**
   * Model-specific maximum output token limits
   * Maps model identifiers to their maximum allowed output tokens
   */
  private readonly modelMaxTokens: Record<string, number> = {
    // Claude 4 models (8192 max output tokens) - TESTED WORKING
    'claude-sonnet-4-20250514': 8192,
    'claude-4-sonnet-20250514': 8192,
    'claude-sonnet-4-5-20250929': 8192,
    'claude-opus-4-20250514': 8192,
    'claude-4-opus-20250514': 8192,
    'claude-opus-4-5-20251101': 8192,
    'claude-opus-4-5': 8192,
    'claude-haiku-4-20250514': 8192,

    // Claude 3.7 models (8192 max output tokens) - TESTED WORKING
    'claude-3-7-sonnet-20250219': 8192,

    // Claude 3.5 models (8192 max output tokens) - NOT AVAILABLE
    'claude-3-5-sonnet-20241022': 8192,
    'claude-3-5-haiku-20241022': 8192,

    // Claude 3 models (4096 max output tokens)
    'claude-3-opus-20240229': 4096,
    'claude-3-sonnet-20240229': 4096,
    'claude-3-haiku-20240307': 4096,
  };

  /**
   * Create Anthropic provider instance
   *
   * @param apiKey - Anthropic API key
   */
  constructor(apiKey: string) {
    if (!apiKey || apiKey.trim() === '') {
      throw new Error('Anthropic API key is required');
    }

    // IMPORTANT: Explicitly set baseURL to official Anthropic API
    // This prevents proxies/gateways from intercepting the requests
    this.client = new Anthropic({
      apiKey,
      baseURL: 'https://api.anthropic.com',
    });
  }

  /**
   * Normalize model name using aliases
   *
   * Converts user-friendly model names to actual Anthropic model identifiers.
   * Returns the input model name if no mapping is found (assumes it's already valid).
   *
   * @param model - User-provided model name
   * @returns Normalized Anthropic model identifier
   */
  private normalizeModelName(model: string): string {
    const normalized = this.modelAliases[model.toLowerCase()];
    return normalized || model;
  }

  /**
   * Get appropriate max tokens for a model
   *
   * Returns model-specific token limit or falls back to default.
   * Prevents exceeding model's maximum output token capacity.
   *
   * @param normalizedModel - Normalized model identifier
   * @param requestedMaxTokens - User-requested max tokens (optional)
   * @returns Safe max tokens value for the model
   */
  private getMaxTokensForModel(normalizedModel: string, requestedMaxTokens?: number): number {
    // Get model's maximum allowed tokens
    const modelLimit = this.modelMaxTokens[normalizedModel] || this.defaultMaxTokens;

    // If user didn't specify, use model's limit
    if (!requestedMaxTokens) {
      return modelLimit;
    }

    // If user specified, ensure it doesn't exceed model's limit
    return Math.min(requestedMaxTokens, modelLimit);
  }

  /**
   * Generate chat completion
   *
   * @param messages - Conversation messages
   * @param options - Optional chat configuration
   * @returns Result with response text or error
   */
  /**
   * Convert OpenAI tool format to Anthropic tool format
   *
   * OpenAI format:
   * {
   *   type: "function",
   *   function: {
   *     name: "tool_name",
   *     description: "...",
   *     parameters: { type: "object", properties: {...}, required: [...] }
   *   }
   * }
   *
   * Anthropic format:
   * {
   *   name: "tool_name",
   *   description: "...",
   *   input_schema: { type: "object", properties: {...}, required: [...] }
   * }
   */
  private convertOpenAIToolsToAnthropic(openaiTools: any[]): Anthropic.Tool[] {
    return openaiTools.map((tool) => ({
      name: tool.function.name,
      description: tool.function.description || '',
      input_schema: tool.function.parameters as Anthropic.Tool.InputSchema,
    }));
  }

  /**
   * Convert OpenAI tool_choice to Anthropic tool_choice
   *
   * OpenAI: "auto" | "none" | { type: "function", function: { name: string } }
   * Anthropic: { type: "auto" } | { type: "any" } | { type: "tool", name: string }
   */
  private convertOpenAIToolChoiceToAnthropic(
    toolChoice?: 'auto' | 'none' | { type: 'function'; function: { name: string } }
  ): Anthropic.MessageCreateParams['tool_choice'] {
    if (!toolChoice || toolChoice === 'auto') {
      return { type: 'auto' };
    }

    if (toolChoice === 'none') {
      return undefined; // Anthropic doesn't have explicit "none", just omit tools
    }

    if (typeof toolChoice === 'object' && toolChoice.type === 'function') {
      return {
        type: 'tool',
        name: toolChoice.function.name,
      };
    }

    return { type: 'auto' }; // Fallback
  }

  /**
   * Convert Anthropic tool use response to OpenAI format
   *
   * Returns special format: __TOOL_CALLS__<JSON>
   * This allows the bot to parse and execute tools
   */
  private convertAnthropicToolCallsToOpenAI(content: Anthropic.ContentBlock[]): string | null {
    const toolUseBlocks = content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use'
    );

    if (toolUseBlocks.length === 0) {
      return null;
    }

    // Convert to OpenAI format
    const toolCalls = toolUseBlocks.map((block) => ({
      id: block.id,
      type: 'function' as const,
      function: {
        name: block.name,
        arguments: JSON.stringify(block.input),
      },
    }));

    // Get text content if any
    const textBlock = content.find(
      (block): block is Anthropic.TextBlock => block.type === 'text'
    );
    const message = textBlock ? textBlock.text : '';

    // Return in the format the bot expects
    const toolCallsData = {
      tool_calls: toolCalls,
      message,
    };

    return `__TOOL_CALLS__${JSON.stringify(toolCallsData)}`;
  }

  /**
   * Convert OpenAI message format to Anthropic message format
   *
   * Handles conversion of tool messages (role: 'tool') to Anthropic's tool_result format.
   * OpenAI uses separate tool messages, Anthropic embeds tool results in user messages.
   *
   * OpenAI format:
   * { role: 'tool', content: '{"result": "..."}', tool_call_id: 'call_123' }
   *
   * Anthropic format:
   * { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_123', content: '{"result": "..."}' }] }
   */
  private convertMessagesToAnthropicFormat(messages: Message[]): Anthropic.MessageParam[] {
    const anthropicMessages: Anthropic.MessageParam[] = [];

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];

      // Skip system messages (Anthropic doesn't support them in messages array)
      if (msg.role === 'system') {
        continue;
      }

      // Convert tool messages to Anthropic's tool_result format
      if (msg.role === 'tool') {
        // Tool results should only be included if we're in the same request as the tool_use
        // In subsequent requests (like streaming after tool execution), skip tool results
        // because the corresponding tool_use is not in this request's messages
        
        // Check if there's a previous assistant message with __TOOL_CALLS__ marker
        // If so, this is a subsequent request and we should skip the tool result
        let skipToolResult = false;
        for (let j = i - 1; j >= 0; j--) {
          if (anthropicMessages[j] && anthropicMessages[j].role === 'assistant') {
            const assistantContent = anthropicMessages[j].content;
            if (typeof assistantContent === 'string' && assistantContent.includes('__TOOL_CALLS__')) {
              // This tool result corresponds to a tool call that was already processed
              // Skip it in subsequent requests
              skipToolResult = true;
            }
            break;
          }
        }
        
        if (skipToolResult) {
          continue;
        }

        const toolContent = (msg.content || '').trim();
        const toolCallId = msg.tool_call_id || '';
        
        // Skip tool messages with missing content or ID
        if (!toolContent || !toolCallId) {
          continue;
        }

        anthropicMessages.push({
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: toolCallId,
              content: toolContent,
            },
          ],
        });
        continue;
      }

      // Handle assistant messages with tool_calls
      if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
        // Convert OpenAI tool_calls to Anthropic tool_use format
        const toolUseBlocks: any[] = msg.tool_calls.map((toolCall) => ({
          type: 'tool_use',
          id: toolCall.id,
          name: toolCall.function.name,
          input: JSON.parse(toolCall.function.arguments),
        }));

        // Include text content if present, otherwise just tool_use blocks
        const content = (msg.content || '').trim();
        const contentBlocks: any[] = [];
        
        if (content) {
          contentBlocks.push({
            type: 'text',
            text: content,
          });
        }
        
        contentBlocks.push(...toolUseBlocks);

        anthropicMessages.push({
          role: 'assistant',
          content: contentBlocks,
        });
        continue;
      }

      // Regular user/assistant messages without tool calls
      const content = (msg.content || '').trim();
      
      // Skip messages with empty content
      if (!content) {
        continue;
      }

      anthropicMessages.push({
        role: msg.role as 'user' | 'assistant',
        content,
      });
    }

    return anthropicMessages;
  }

  async chat(
    messages: Message[],
    options?: ChatOptions
  ): Promise<Result<string, ProviderError>> {
    try {
      // Normalize model name to handle user-friendly aliases
      const requestedModel = options?.model || this.defaultModel;
      const normalizedModel = this.normalizeModelName(requestedModel);

      // Get appropriate max tokens for this model
      const maxTokens = this.getMaxTokensForModel(normalizedModel, options?.maxTokens);

      // Convert tools from OpenAI format to Anthropic format if provided
      const anthropicTools = options?.tools
        ? this.convertOpenAIToolsToAnthropic(options.tools)
        : undefined;

      const anthropicToolChoice = options?.tool_choice
        ? this.convertOpenAIToolChoiceToAnthropic(options.tool_choice)
        : undefined;



      const response = await this.client.messages.create({
        model: normalizedModel,
        max_tokens: maxTokens,
        temperature: options?.temperature,
        stop_sequences: options?.stopSequences,
        messages: this.convertMessagesToAnthropicFormat(messages),
        ...(anthropicTools && anthropicTools.length > 0 && { tools: anthropicTools }),
        ...(anthropicToolChoice && { tool_choice: anthropicToolChoice }),
      });

      // Handle error responses that SDK didn't throw
      // Some SDK versions or proxies return errors as response objects
      if ((response as any).type === 'error' || (response as any).error) {
        const errorObj = (response as any).error;
        if (errorObj?.type === 'authentication_error') {
          return err(this.createError(ProviderErrorType.AUTH_FAILED, errorObj.message || 'Authentication failed'));
        }
        if (errorObj?.type === 'rate_limit_error') {
          return err(this.createError(ProviderErrorType.RATE_LIMIT, errorObj.message || 'Rate limit exceeded'));
        }
        if (errorObj?.type === 'invalid_request_error') {
          return err(this.createError(ProviderErrorType.INVALID_REQUEST, errorObj.message || 'Invalid request'));
        }
        return err(this.createError(ProviderErrorType.UNKNOWN, errorObj?.message || 'Unknown error from API'));
      }

      // Validate response structure
      if (!response || !response.content || !Array.isArray(response.content)) {
        return err(this.createError(ProviderErrorType.INVALID_REQUEST, 'Invalid response structure from Anthropic API'));
      }



      // Check if response contains tool calls
      const toolCallsResponse = this.convertAnthropicToolCallsToOpenAI(response.content);
      if (toolCallsResponse) {
        // Reset failure counter on success
        this.consecutiveFailures = 0;
        return ok(toolCallsResponse);
      }

      // Extract text from response
      const textContent = response.content.find((c) => c.type === 'text');
      if (!textContent || textContent.type !== 'text') {
        return err(this.createError(ProviderErrorType.INVALID_REQUEST, 'No text content in response'));
      }

      // Reset failure counter on success
      this.consecutiveFailures = 0;

      return ok(textContent.text);
    } catch (error: any) {
      this.consecutiveFailures++;
      return err(this.handleError(error));
    }
  }

  /**
   * Generate streaming chat completion
   *
   * @param messages - Conversation messages
   * @param options - Optional chat configuration
   * @returns Result with async iterator of text chunks or error
   */
  async streamChat(
    messages: Message[],
    options?: ChatOptions
  ): Promise<Result<AsyncIterable<string>, ProviderError>> {
    try {
      // Normalize model name to handle user-friendly aliases
      const requestedModel = options?.model || this.defaultModel;
      const normalizedModel = this.normalizeModelName(requestedModel);

      // Get appropriate max tokens for this model
      const maxTokens = this.getMaxTokensForModel(normalizedModel, options?.maxTokens);

      const stream = await this.client.messages.stream({
        model: normalizedModel,
        max_tokens: maxTokens,
        temperature: options?.temperature,
        stop_sequences: options?.stopSequences,
        messages: this.convertMessagesToAnthropicFormat(messages),
      });

      // Create async iterator from stream
      const iterator = this.createStreamIterator(stream);

      // Reset failure counter on success
      this.consecutiveFailures = 0;

      return ok(iterator);
    } catch (error: any) {
      this.consecutiveFailures++;
      return err(this.handleError(error));
    }
  }

  /**
   * Check if provider is healthy
   *
   * Uses passive health monitoring based on recent failures
   * instead of making actual API calls to avoid costs and rate limits.
   *
   * @returns True if provider is responding correctly
   */
  async isHealthy(): Promise<boolean> {
    // Passive health check: only monitor consecutive failures
    // Don't make actual API calls to avoid costs and rate limits
    return this.consecutiveFailures < this.maxConsecutiveFailures;
  }

  /**
   * Reset provider health status
   *
   * Clears consecutive failure counter and marks provider as healthy.
   */
  resetHealth(): void {
    this.consecutiveFailures = 0;
  }

  /**
   * Get list of available models
   *
   * @returns Result with array of model IDs or error
   */
  async getAvailableModels(): Promise<Result<string[], ProviderError>> {
    // Return models confirmed to work with the current API key
    // Note: Anthropic SDK doesn't have a models.list() method
    const knownModels = [
      // Claude 4 Opus models (TESTED - WORKING - MOST POWERFUL)
      'claude-opus-4-5-20251101',    // Claude Opus 4.5 (MOST CAPABLE)
      'claude-opus-4-5',             // Claude Opus 4.5 (alias)
      'claude-opus-4-20250514',      // Claude Opus 4
      'claude-4-opus-20250514',      // Claude 4 Opus (alt format)

      // Claude 4 Sonnet models (TESTED - WORKING)
      'claude-sonnet-4-5-20250929',  // Claude Sonnet 4.5
      'claude-sonnet-4-20250514',    // Claude Sonnet 4
      'claude-4-sonnet-20250514',    // Claude 4 Sonnet (alt format)

      // Claude 3.7 Sonnet (TESTED - WORKING)
      'claude-3-7-sonnet-20250219',

      // Claude 3 Haiku (TESTED - WORKING - FASTEST)
      'claude-3-haiku-20240307',

      // Note: Claude 3.5 models and Claude 4 Haiku are NOT available
    ];
    return ok(knownModels);
  }

  /**
   * Create async iterator from Anthropic stream
   */
  private async *createStreamIterator(
    stream: any
  ): AsyncIterable<string> {
    try {
      for await (const chunk of stream) {
        if (chunk.type === 'content_block_delta') {
          const delta = chunk.delta;
          if (delta.type === 'text_delta') {
            yield delta.text;
          }
        }
      }
    } catch (error) {
      // Stream error - will be caught by caller
      throw error;
    }
  }

  /**
   * Handle API errors and convert to ProviderError
   */
  private handleError(error: any): ProviderError {
    // Anthropic SDK errors - check for APIError instance or status property
    // The status is passed as first parameter to APIError constructor
    const statusCode = error.status;

    if (statusCode !== undefined) {
      if (statusCode === 401 || statusCode === 403) {
        return this.createError(ProviderErrorType.AUTH_FAILED, 'Authentication failed');
      }
      if (statusCode === 429) {
        return this.createError(ProviderErrorType.RATE_LIMIT, 'Rate limit exceeded');
      }
      if (statusCode === 404) {
        return this.createError(ProviderErrorType.MODEL_NOT_FOUND, 'Model not found');
      }
      if (statusCode === 400) {
        return this.createError(ProviderErrorType.INVALID_REQUEST, error.message || 'Invalid request');
      }
    }

    // Network errors
    if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
      return this.createError(ProviderErrorType.NETWORK_ERROR, 'Network connection failed');
    }

    // Timeout errors
    if (error.code === 'ETIMEDOUT' || error.name === 'TimeoutError') {
      return this.createError(ProviderErrorType.TIMEOUT, 'Request timeout');
    }

    // Unknown errors
    return this.createError(ProviderErrorType.UNKNOWN, error.message || 'Unknown error occurred');
  }

  /**
   * Create standardized ProviderError
   */
  private createError(type: ProviderErrorType, message: string): ProviderError {
    return {
      type,
      message,
      provider: this.name,
    };
  }
}
