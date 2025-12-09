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
  private readonly defaultModel = 'claude-3-5-sonnet-20241022';
  private readonly defaultMaxTokens = 8096;

  /**
   * Model name mapping for user-friendly aliases
   * Maps shorthand names to full Anthropic model identifiers
   */
  private readonly modelAliases: Record<string, string> = {
    // Claude 3.5 models
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
    // Claude 3.5 models (8192 max output tokens)
    'claude-3-5-sonnet-20241022': 8192,
    'claude-3-5-haiku-20241022': 8192,

    // Claude 3 models
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

    this.client = new Anthropic({ apiKey });
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

      const response = await this.client.messages.create({
        model: normalizedModel,
        max_tokens: maxTokens,
        temperature: options?.temperature,
        stop_sequences: options?.stopSequences,
        messages: messages.map((msg) => ({
          role: msg.role === 'system' ? 'user' : msg.role,
          content: msg.content,
        })),
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
  ): Promise<Result<AsyncIterator<string>, ProviderError>> {
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
        messages: messages.map((msg) => ({
          role: msg.role === 'system' ? 'user' : msg.role,
          content: msg.content,
        })),
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
    // Return known Claude models
    // Note: Anthropic SDK doesn't have a models.list() method
    const knownModels = [
      'claude-3-5-sonnet-20241022',
      'claude-3-5-haiku-20241022',
      'claude-3-opus-20240229',
      'claude-3-sonnet-20240229',
      'claude-3-haiku-20240307',
    ];
    return ok(knownModels);
  }

  /**
   * Create async iterator from Anthropic stream
   */
  private async *createStreamIterator(
    stream: any
  ): AsyncIterator<string> {
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
