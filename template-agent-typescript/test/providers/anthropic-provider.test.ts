/**
 * AnthropicProvider Unit Tests
 *
 * Tests the Anthropic provider implementation with mocked SDK.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AnthropicProvider } from '../../src/providers/anthropic-provider.js';
import Anthropic from '@anthropic-ai/sdk';

// Mock the Anthropic SDK but preserve APIError class
vi.mock('@anthropic-ai/sdk', async () => {
  const actual = await vi.importActual<typeof import('@anthropic-ai/sdk')>('@anthropic-ai/sdk');

  // Create a mock constructor that can be used to instantiate the client
  const MockAnthropic = vi.fn();

  // Attach the actual APIError class to the mock constructor
  MockAnthropic.APIError = actual.default.APIError;

  return {
    default: MockAnthropic,
  };
});

describe('AnthropicProvider', () => {
  let provider: AnthropicProvider;
  let mockClient: any;

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();

    // Create mock client
    mockClient = {
      messages: {
        create: vi.fn(),
        stream: vi.fn(),
      },
      models: {
        list: vi.fn(),
      },
    };

    // Mock Anthropic constructor
    vi.mocked(Anthropic).mockImplementation(() => mockClient);

    // Create provider instance
    provider = new AnthropicProvider('test-api-key');
  });

  describe('constructor', () => {
    it('should create provider with valid API key', () => {
      expect(provider.name).toBe('anthropic');
    });

    it('should throw error with empty API key', () => {
      expect(() => new AnthropicProvider('')).toThrow('Anthropic API key is required');
    });

    it('should throw error with whitespace API key', () => {
      expect(() => new AnthropicProvider('   ')).toThrow('Anthropic API key is required');
    });
  });

  describe('chat', () => {
    it('should return successful response', async () => {
      // Mock successful response
      mockClient.messages.create.mockResolvedValue({
        content: [{ type: 'text', text: 'Hello, world!' }],
      });

      const result = await provider.chat([
        { role: 'user', content: 'Say hello' },
      ]);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe('Hello, world!');
      }
    });

    it('should use default model and maxTokens', async () => {
      mockClient.messages.create.mockResolvedValue({
        content: [{ type: 'text', text: 'Response' }],
      });

      await provider.chat([{ role: 'user', content: 'Test' }]);

      expect(mockClient.messages.create).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'claude-3-5-sonnet-20241022',
          max_tokens: 8192, // Claude 3.5 models support 8192 max output tokens
        })
      );
    });

    it('should use custom options', async () => {
      mockClient.messages.create.mockResolvedValue({
        content: [{ type: 'text', text: 'Response' }],
      });

      await provider.chat(
        [{ role: 'user', content: 'Test' }],
        {
          model: 'claude-3-haiku-20240307',
          maxTokens: 200,
          temperature: 0.5,
          stopSequences: ['END'],
        }
      );

      expect(mockClient.messages.create).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'claude-3-haiku-20240307',
          max_tokens: 200,
          temperature: 0.5,
          stop_sequences: ['END'],
        })
      );
    });

    it('should handle authentication errors', async () => {
      // Create proper Anthropic.APIError instance
      const apiError = new Anthropic.APIError(401, { message: 'Unauthorized' }, 'Unauthorized', {});
      mockClient.messages.create.mockRejectedValue(apiError);

      const result = await provider.chat([{ role: 'user', content: 'Test' }]);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('AUTH_FAILED');
        expect(result.error.provider).toBe('anthropic');
      }
    });

    it('should handle rate limit errors', async () => {
      const apiError = new Anthropic.APIError(429, { message: 'Rate limit' }, 'Rate limit', {});
      mockClient.messages.create.mockRejectedValue(apiError);

      const result = await provider.chat([{ role: 'user', content: 'Test' }]);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('RATE_LIMIT');
      }
    });

    it('should handle model not found errors', async () => {
      const apiError = new Anthropic.APIError(404, { message: 'Not found' }, 'Not found', {});
      mockClient.messages.create.mockRejectedValue(apiError);

      const result = await provider.chat([{ role: 'user', content: 'Test' }]);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('MODEL_NOT_FOUND');
      }
    });

    it('should handle invalid request errors', async () => {
      const apiError = new Anthropic.APIError(400, { message: 'Bad request' }, 'Bad request', {});
      mockClient.messages.create.mockRejectedValue(apiError);

      const result = await provider.chat([{ role: 'user', content: 'Test' }]);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('INVALID_REQUEST');
      }
    });

    it('should handle network errors', async () => {
      mockClient.messages.create.mockRejectedValue(
        Object.assign(new Error('Network error'), { code: 'ENOTFOUND' })
      );

      const result = await provider.chat([{ role: 'user', content: 'Test' }]);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('NETWORK_ERROR');
      }
    });

    it('should handle timeout errors', async () => {
      mockClient.messages.create.mockRejectedValue(
        Object.assign(new Error('Timeout'), { code: 'ETIMEDOUT' })
      );

      const result = await provider.chat([{ role: 'user', content: 'Test' }]);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('TIMEOUT');
      }
    });

    it('should handle missing text content', async () => {
      mockClient.messages.create.mockResolvedValue({
        content: [{ type: 'image', data: 'base64data' }],
      });

      const result = await provider.chat([{ role: 'user', content: 'Test' }]);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('INVALID_REQUEST');
        expect(result.error.message).toContain('No text content');
      }
    });
  });

  describe('streamChat', () => {
    it('should return streaming response', async () => {
      // Mock stream
      const mockStream = {
        async *[Symbol.asyncIterator]() {
          yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello' } };
          yield { type: 'content_block_delta', delta: { type: 'text_delta', text: ', ' } };
          yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'world!' } };
        },
      };

      mockClient.messages.stream.mockResolvedValue(mockStream);

      const result = await provider.streamChat([
        { role: 'user', content: 'Say hello' },
      ]);

      expect(result.success).toBe(true);
      if (result.success) {
        const chunks: string[] = [];
        const iterator = result.data;
        let next = await iterator.next();
        while (!next.done) {
          chunks.push(next.value);
          next = await iterator.next();
        }
        expect(chunks).toEqual(['Hello', ', ', 'world!']);
      }
    });

    it('should handle stream errors', async () => {
      mockClient.messages.stream.mockRejectedValue(
        Object.assign(new Error('Stream error'), { status: 500 })
      );

      const result = await provider.streamChat([{ role: 'user', content: 'Test' }]);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('UNKNOWN');
      }
    });
  });

  describe('isHealthy', () => {
    it('should return true when no failures have occurred', async () => {
      const healthy = await provider.isHealthy();

      expect(healthy).toBe(true);
    });

    it('should return true after successful chat', async () => {
      mockClient.messages.create.mockResolvedValue({
        content: [{ type: 'text', text: 'Response' }],
      });

      await provider.chat([{ role: 'user', content: 'Test' }]);
      const healthy = await provider.isHealthy();

      expect(healthy).toBe(true);
    });

    it('should return false after too many consecutive failures', async () => {
      // Simulate 3 consecutive failures
      mockClient.messages.create.mockRejectedValue(new Error('Failure'));

      await provider.chat([{ role: 'user', content: 'Test' }]);
      await provider.chat([{ role: 'user', content: 'Test' }]);
      await provider.chat([{ role: 'user', content: 'Test' }]);

      // Health check should now return false (passive check based on failure count)
      const healthy = await provider.isHealthy();

      expect(healthy).toBe(false);
    });

    it('should return true again after resetHealth', async () => {
      // Simulate failures
      mockClient.messages.create.mockRejectedValue(new Error('Failure'));
      await provider.chat([{ role: 'user', content: 'Test' }]);
      await provider.chat([{ role: 'user', content: 'Test' }]);
      await provider.chat([{ role: 'user', content: 'Test' }]);

      // Reset health
      provider.resetHealth();

      const healthy = await provider.isHealthy();
      expect(healthy).toBe(true);
    });
  });

  describe('getAvailableModels', () => {
    it('should return list of known Claude models', async () => {
      const result = await provider.getAvailableModels();

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toContain('claude-3-5-sonnet-20241022');
        expect(result.data).toContain('claude-3-haiku-20240307');
        expect(result.data.length).toBeGreaterThan(0);
      }
    });
  });
});
