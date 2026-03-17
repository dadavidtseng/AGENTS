/**
 * ModelManagerProvider Unit Tests
 *
 * Tests the Model Manager provider implementation with mocked fetch API.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ModelManagerProvider } from '../../src/providers/model-manager-provider.js';

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch as any;

describe('ModelManagerProvider', () => {
  let provider: ModelManagerProvider;
  const baseURL = 'https://gateway.example.com';
  const apiKey = 'test-api-key';

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new ModelManagerProvider(baseURL, apiKey, 5000);
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  describe('constructor', () => {
    it('should create provider with valid parameters', () => {
      expect(provider.name).toBe('model-manager');
    });

    it('should throw error with empty base URL', () => {
      expect(() => new ModelManagerProvider('', apiKey)).toThrow(
        'Model Manager base URL is required'
      );
    });

    it('should throw error with whitespace base URL', () => {
      expect(() => new ModelManagerProvider('   ', apiKey)).toThrow(
        'Model Manager base URL is required'
      );
    });

    it('should throw error with empty API key', () => {
      expect(() => new ModelManagerProvider(baseURL, '')).toThrow(
        'Model Manager API key is required'
      );
    });

    it('should throw error with whitespace API key', () => {
      expect(() => new ModelManagerProvider(baseURL, '   ')).toThrow(
        'Model Manager API key is required'
      );
    });

    it('should remove trailing slash from base URL', () => {
      const providerWithSlash = new ModelManagerProvider(
        'https://example.com/',
        apiKey
      );
      expect(providerWithSlash).toBeDefined();
    });
  });

  describe('chat', () => {
    it('should return successful response', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                role: 'assistant',
                content: 'Hello, world!',
              },
            },
          ],
        }),
      });

      const result = await provider.chat([
        { role: 'user', content: 'Say hello' },
      ]);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe('Hello, world!');
      }

      expect(mockFetch).toHaveBeenCalledWith(
        'https://gateway.example.com/v1/chat/completions',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            Authorization: 'Bearer test-api-key',
          }),
        })
      );
    });

    it('should use default model and maxTokens', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { role: 'assistant', content: 'Response' } }],
        }),
      });

      await provider.chat([{ role: 'user', content: 'Test' }]);

      const callArgs = mockFetch.mock.calls[0];
      const requestBody = JSON.parse(callArgs[1].body);

      expect(requestBody.model).toBe('gpt-4o-mini');
      expect(requestBody.max_completion_tokens).toBe(4096); // OpenAI uses max_completion_tokens
    });

    it('should use custom options', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { role: 'assistant', content: 'Response' } }],
        }),
      });

      await provider.chat(
        [{ role: 'user', content: 'Test' }],
        {
          model: 'gpt-4',
          maxTokens: 200,
          temperature: 0.5,
          stopSequences: ['END'],
        }
      );

      const callArgs = mockFetch.mock.calls[0];
      const requestBody = JSON.parse(callArgs[1].body);

      expect(requestBody.model).toBe('gpt-4');
      expect(requestBody.max_completion_tokens).toBe(200); // OpenAI uses max_completion_tokens
      expect(requestBody.temperature).toBe(0.5);
      expect(requestBody.stop).toEqual(['END']);
    });

    it('should handle authentication errors', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({
          error: { message: 'Invalid API key' },
        }),
      });

      const result = await provider.chat([{ role: 'user', content: 'Test' }]);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('AUTH_FAILED');
        expect(result.error.provider).toBe('model-manager');
      }
    });

    it('should handle rate limit errors', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 429,
        json: async () => ({
          error: { message: 'Rate limit exceeded' },
        }),
      });

      const result = await provider.chat([{ role: 'user', content: 'Test' }]);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('RATE_LIMIT');
      }
    });

    it('should handle model not found errors', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({
          error: { message: 'Model not found' },
        }),
      });

      const result = await provider.chat([{ role: 'user', content: 'Test' }]);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('MODEL_NOT_FOUND');
      }
    });

    it('should handle invalid request errors', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({
          error: { message: 'Bad request' },
        }),
      });

      const result = await provider.chat([{ role: 'user', content: 'Test' }]);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('INVALID_REQUEST');
      }
    });

    it('should handle server errors', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: async () => ({}),
      });

      const result = await provider.chat([{ role: 'user', content: 'Test' }]);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('UNKNOWN');
      }
    });

    it('should handle timeout errors', async () => {
      mockFetch.mockRejectedValue({
        name: 'AbortError',
        message: 'The operation was aborted',
      });

      const result = await provider.chat([{ role: 'user', content: 'Test' }]);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('TIMEOUT');
      }
    });

    it('should handle network errors', async () => {
      mockFetch.mockRejectedValue({
        code: 'ENOTFOUND',
        message: 'getaddrinfo ENOTFOUND',
      });

      const result = await provider.chat([{ role: 'user', content: 'Test' }]);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('NETWORK_ERROR');
      }
    });

    it('should handle missing content in response', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { role: 'assistant' } }],
        }),
      });

      const result = await provider.chat([{ role: 'user', content: 'Test' }]);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('INVALID_REQUEST');
        expect(result.error.message).toContain('No content in response');
      }
    });

    it('should handle empty choices array', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [],
        }),
      });

      const result = await provider.chat([{ role: 'user', content: 'Test' }]);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('INVALID_REQUEST');
      }
    });
  });

  describe('streamChat', () => {
    it('should return streaming response', async () => {
      // Mock ReadableStream
      const encoder = new TextEncoder();
      const chunks = [
        'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":", "}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"world!"}}]}\n\n',
        'data: [DONE]\n\n',
      ];

      const stream = new ReadableStream({
        start(controller) {
          chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
          controller.close();
        },
      });

      mockFetch.mockResolvedValue({
        ok: true,
        body: stream,
      });

      const result = await provider.streamChat([
        { role: 'user', content: 'Say hello' },
      ]);

      expect(result.success).toBe(true);
      if (result.success) {
        const textChunks: string[] = [];
        const iterator = result.data;
        let next = await iterator.next();
        while (!next.done) {
          textChunks.push(next.value);
          next = await iterator.next();
        }
        expect(textChunks).toEqual(['Hello', ', ', 'world!']);
      }
    });

    it('should handle stream errors', async () => {
      mockFetch.mockRejectedValue({
        name: 'AbortError',
        message: 'Timeout',
      });

      const result = await provider.streamChat([
        { role: 'user', content: 'Test' },
      ]);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('TIMEOUT');
      }
    });

    it('should handle missing response body', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        body: null,
      });

      const result = await provider.streamChat([
        { role: 'user', content: 'Test' },
      ]);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('INVALID_REQUEST');
        expect(result.error.message).toContain('No response body');
      }
    });
  });

  describe('isHealthy', () => {
    it('should return true when API is healthy', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ data: [] }),
      });

      const healthy = await provider.isHealthy();

      expect(healthy).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://gateway.example.com/v1/models',
        expect.objectContaining({
          method: 'GET',
        })
      );
    });

    it('should return false when API call fails', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
      });

      const healthy = await provider.isHealthy();

      expect(healthy).toBe(false);
    });

    it('should return false on network error', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      const healthy = await provider.isHealthy();

      expect(healthy).toBe(false);
    });

    it('should return false after too many consecutive failures', async () => {
      // Simulate 3 consecutive failures
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({}),
      });

      await provider.chat([{ role: 'user', content: 'Test' }]);
      await provider.chat([{ role: 'user', content: 'Test' }]);
      await provider.chat([{ role: 'user', content: 'Test' }]);

      // Reset mock for health check
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ data: [] }),
      });

      const healthy = await provider.isHealthy();

      expect(healthy).toBe(false);
    });
  });

  describe('getAvailableModels', () => {
    it('should return list of models', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          object: 'list',
          data: [
            { id: 'gpt-4', object: 'model', created: 1234567890, owned_by: 'openai' },
            { id: 'gpt-3.5-turbo', object: 'model', created: 1234567890, owned_by: 'openai' },
          ],
        }),
      });

      const result = await provider.getAvailableModels();

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(['gpt-4', 'gpt-3.5-turbo']);
      }
    });

    it('should handle errors', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({
          error: { message: 'Unauthorized' },
        }),
      });

      const result = await provider.getAvailableModels();

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('AUTH_FAILED');
      }
    });
  });
});
