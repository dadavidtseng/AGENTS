/**
 * Model Manager Provider Implementation
 *
 * Implements LLMProvider interface for OpenAI-compatible Model Manager Gateway.
 * Uses native fetch API with timeout handling and proper error mapping.
 */

import https from 'https';
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
 * OpenAI Chat Completion API Types
 */
interface OpenAIChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: {
      name: string;
      arguments: string;
    };
  }>;
}

interface OpenAIChatRequest {
  model: string;
  messages: OpenAIChatMessage[];
  max_completion_tokens?: number;
  temperature?: number;
  stop?: string[];
  stream?: boolean;
  tools?: Array<{
    type: 'function';
    function: {
      name: string;
      description: string;
      parameters: any;
    };
  }>;
  tool_choice?: 'auto' | 'none' | { type: 'function'; function: { name: string } };
}

interface OpenAIChatResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string | null;
      tool_calls?: Array<{
        id: string;
        type: 'function';
        function: {
          name: string;
          arguments: string;
        };
      }>;
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

interface OpenAIModelsResponse {
  object: string;
  data: Array<{
    id: string;
    object: string;
    created: number;
    owned_by: string;
  }>;
}

interface OpenAIStreamChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: {
      role?: string;
      content?: string;
    };
    finish_reason: string | null;
  }>;
}

/**
 * Model Manager Provider
 *
 * Communicates with OpenAI-compatible Model Manager Gateway.
 * Uses fetch API for HTTP requests with timeout and error handling.
 */
export class ModelManagerProvider implements LLMProvider {
  public readonly name = 'model-manager';
  private consecutiveFailures = 0;
  private readonly maxConsecutiveFailures = 3;

  /**
   * Default configuration
   */
  private readonly defaultModel = 'gpt-5-mini';
  private readonly defaultMaxTokens = 4096;

  /**
   * HTTPS agent with disabled SSL verification
   * Required for self-signed certificates in development/staging environments
   */
  private readonly httpsAgent = new https.Agent({
    rejectUnauthorized: false,
  });

  /**
   * Create Model Manager provider instance
   *
   * @param baseURL - Base URL of Model Manager Gateway (e.g., 'https://gateway.example.com')
   * @param apiKey - API key for authentication
   * @param timeoutMs - Request timeout in milliseconds (default: 30000)
   */
  constructor(
    private readonly baseURL: string,
    private readonly apiKey: string,
    private readonly timeoutMs: number = 90000
  ) {
    if (!baseURL || baseURL.trim() === '') {
      throw new Error('Model Manager base URL is required');
    }
    if (!apiKey || apiKey.trim() === '') {
      throw new Error('Model Manager API key is required');
    }

    // Remove trailing slash from baseURL
    this.baseURL = baseURL.replace(/\/$/, '');
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
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      // Build OpenAI messages array, prepending system prompt if provided
      const openaiMessages = [
        ...(options?.system ? [{ role: 'system' as const, content: options.system }] : []),
        ...messages.map((msg) => ({
          role: msg.role,
          content: msg.content,
          ...(msg.tool_call_id && { tool_call_id: msg.tool_call_id }),
          ...(msg.tool_calls && { tool_calls: msg.tool_calls }),
        })),
      ];

      const requestBody: OpenAIChatRequest = {
        model: options?.model || this.defaultModel,
        messages: openaiMessages,
        max_completion_tokens: options?.maxTokens || this.defaultMaxTokens,
        temperature: options?.temperature,
        stop: options?.stopSequences,
        stream: false,
        ...(options?.tools && { tools: options.tools }),
        ...(options?.tool_choice && { tool_choice: options.tool_choice }),
      };

      const response = await fetch(`${this.baseURL}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
        // @ts-ignore - Node.js fetch accepts agent option
        agent: this.httpsAgent,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        this.consecutiveFailures++;
        return err(await this.handleHTTPError(response));
      }

      const data = (await response.json()) as OpenAIChatResponse;

      // Extract response
      const choice = data.choices[0];
      if (!choice || !choice.message) {
        this.consecutiveFailures++;
        return err(
          this.createError(
            ProviderErrorType.INVALID_REQUEST,
            'No message in response'
          )
        );
      }

      const message = choice.message;

      // Check if LLM wants to call tools
      if (message.tool_calls && message.tool_calls.length > 0) {
        // Return tool calls as a special JSON format that the bot can parse
        // Format: __TOOL_CALLS__<JSON>
        const toolCallsData = {
          tool_calls: message.tool_calls,
          message: message.content || ''
        };
        
        const result = `__TOOL_CALLS__${JSON.stringify(toolCallsData)}`;
        
        this.consecutiveFailures = 0;
        return ok(result);
      }

      // Regular text response
      // Allow empty string as valid response, only error if content is null/undefined
      if (message.content === null || message.content === undefined) {
        this.consecutiveFailures++;
        return err(
          this.createError(
            ProviderErrorType.INVALID_REQUEST,
            'No content in response'
          )
        );
      }

      // Reset failure counter on success
      this.consecutiveFailures = 0;

      return ok(message.content);
    } catch (error: any) {
      clearTimeout(timeoutId);
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
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      // Build OpenAI messages array, prepending system prompt if provided
      const openaiStreamMessages = [
        ...(options?.system ? [{ role: 'system' as const, content: options.system }] : []),
        ...messages.map((msg) => ({
          role: msg.role,
          content: msg.content,
          ...(msg.tool_call_id && { tool_call_id: msg.tool_call_id }),
          ...(msg.tool_calls && { tool_calls: msg.tool_calls }),
        })),
      ];

      const requestBody: OpenAIChatRequest = {
        model: options?.model || this.defaultModel,
        messages: openaiStreamMessages,
        max_completion_tokens: options?.maxTokens || this.defaultMaxTokens,
        temperature: options?.temperature,
        stop: options?.stopSequences,
        stream: true,
      };

      const response = await fetch(`${this.baseURL}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
        // @ts-ignore - Node.js fetch accepts agent option
        agent: this.httpsAgent,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        this.consecutiveFailures++;
        return err(await this.handleHTTPError(response));
      }

      if (!response.body) {
        this.consecutiveFailures++;
        return err(
          this.createError(
            ProviderErrorType.INVALID_REQUEST,
            'No response body for streaming'
          )
        );
      }

      // Create async iterator from stream
      const iterator = this.createStreamIterator(response.body);

      // Reset failure counter on success
      this.consecutiveFailures = 0;

      return ok(iterator);
    } catch (error: any) {
      clearTimeout(timeoutId);
      this.consecutiveFailures++;
      return err(this.handleError(error));
    }
  }

  /**
   * Check if provider is healthy
   *
   * @returns True if provider is responding correctly
   */
  async isHealthy(): Promise<boolean> {
    // Passive health check: only monitor consecutive failures
    // Don't make actual API calls to avoid costs and false positives from slow admin endpoints
    // 
    // This approach is consistent with AnthropicProvider and provides more accurate
    // health status by reflecting actual chat request success/failure rather than
    // administrative endpoint availability.
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
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.baseURL}/v1/models`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
        signal: controller.signal,
        // @ts-ignore - Node.js fetch accepts agent option
        agent: this.httpsAgent,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        return err(await this.handleHTTPError(response));
      }

      const data = (await response.json()) as OpenAIModelsResponse;
      const modelIds = data.data.map((model) => model.id);

      return ok(modelIds);
    } catch (error: any) {
      clearTimeout(timeoutId);
      return err(this.handleError(error));
    }
  }

  /**
   * Create async iterator from ReadableStream
   */
  private async *createStreamIterator(
    stream: ReadableStream<Uint8Array>
  ): AsyncIterable<string> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed === 'data: [DONE]') continue;

          if (trimmed.startsWith('data: ')) {
            try {
              const jsonStr = trimmed.substring(6);
              const chunk = JSON.parse(jsonStr) as OpenAIStreamChunk;
              const delta = chunk.choices[0]?.delta;
              if (delta?.content !== undefined && delta?.content !== null) {
                yield delta.content;
              }
            } catch (e) {
              // Skip malformed JSON chunks
              continue;
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Handle HTTP error responses
   */
  private async handleHTTPError(response: Response): Promise<ProviderError> {
    const status = response.status;

    // Try to extract error message from response body
    let errorMessage = `HTTP ${status}`;
    try {
      const errorData = (await response.json()) as any;
      if (errorData.error?.message) {
        errorMessage = errorData.error.message;
      }
    } catch (e) {
      // If JSON parsing fails, use status text
      errorMessage = response.statusText || errorMessage;
    }

    // Map HTTP status codes to ProviderErrorType
    if (status === 401 || status === 403) {
      return this.createError(
        ProviderErrorType.AUTH_FAILED,
        `Authentication failed: ${errorMessage}`
      );
    }
    if (status === 429) {
      return this.createError(
        ProviderErrorType.RATE_LIMIT,
        `Rate limit exceeded: ${errorMessage}`
      );
    }
    if (status === 404) {
      return this.createError(
        ProviderErrorType.MODEL_NOT_FOUND,
        `Model not found: ${errorMessage}`
      );
    }
    if (status >= 400 && status < 500) {
      return this.createError(
        ProviderErrorType.INVALID_REQUEST,
        `Invalid request: ${errorMessage}`
      );
    }
    if (status >= 500) {
      return this.createError(
        ProviderErrorType.UNKNOWN,
        `Server error: ${errorMessage}`
      );
    }

    return this.createError(ProviderErrorType.UNKNOWN, errorMessage);
  }

  /**
   * Handle general errors (network, timeout, etc.)
   */
  private handleError(error: any): ProviderError {
    // Abort/timeout errors
    if (error.name === 'AbortError') {
      return this.createError(
        ProviderErrorType.TIMEOUT,
        `Request timeout after ${this.timeoutMs}ms`
      );
    }

    // Network errors
    if (
      error.code === 'ENOTFOUND' ||
      error.code === 'ECONNREFUSED' ||
      error.message?.includes('fetch failed')
    ) {
      return this.createError(
        ProviderErrorType.NETWORK_ERROR,
        'Network connection failed'
      );
    }

    // Unknown errors
    return this.createError(
      ProviderErrorType.UNKNOWN,
      error.message || 'Unknown error occurred'
    );
  }

  /**
   * Create standardized ProviderError
   */
  private createError(
    type: ProviderErrorType,
    message: string
  ): ProviderError {
    return {
      type,
      message,
      provider: this.name,
    };
  }
}
