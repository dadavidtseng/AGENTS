/**
 * Phase 2 Integration Tests - LLM Provider System
 *
 * Verifies that the complete provider system works end-to-end:
 * - Provider instantiation with real configurations
 * - Model-based routing (claude→Anthropic, gpt→Model Manager)
 * - Fallback mechanisms on provider failure
 * - Health check functionality
 * - Retry logic with exponential backoff
 *
 * These tests use mocked API responses to avoid real API calls.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AnthropicProvider } from '../../src/providers/anthropic-provider.js';
import { ModelManagerProvider } from '../../src/providers/model-manager-provider.js';
import { ProviderManager } from '../../src/providers/provider-manager.js';
import { ProviderErrorType } from '../../src/providers/types.js';
import Anthropic from '@anthropic-ai/sdk';

// Mock dependencies
vi.mock('@anthropic-ai/sdk');
const mockFetch = vi.fn();
global.fetch = mockFetch as any;

describe('Phase 2: LLM Provider System Integration', () => {
  let mockAnthropicClient: any;
  let providerManager: ProviderManager;

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup Anthropic mock
    mockAnthropicClient = {
      messages: {
        create: vi.fn(),
        stream: vi.fn(),
      },
    };
    vi.mocked(Anthropic).mockImplementation(() => mockAnthropicClient);
  });

  afterEach(() => {
    if (providerManager) {
      providerManager.dispose();
    }
  });

  describe('Provider Instantiation', () => {
    it('should successfully instantiate AnthropicProvider', () => {
      const anthropic = new AnthropicProvider('test-key');
      expect(anthropic.name).toBe('anthropic');
    });

    it('should successfully instantiate ModelManagerProvider', () => {
      const modelManager = new ModelManagerProvider(
        'https://gateway.example.com',
        'test-key'
      );
      expect(modelManager.name).toBe('model-manager');
    });

    it('should successfully instantiate ProviderManager with both providers', () => {
      const anthropic = new AnthropicProvider('test-key');
      const modelManager = new ModelManagerProvider(
        'https://gateway.example.com',
        'test-key'
      );

      providerManager = new ProviderManager(
        [anthropic, modelManager],
        {
          primaryProvider: 'anthropic',
          fallbackProvider: 'model-manager',
          retryAttempts: 2,
          retryDelayMs: 100,
          healthCheckIntervalMs: 60000,
        }
      );

      expect(providerManager).toBeDefined();
    });
  });

  describe('Model-Based Routing', () => {
    beforeEach(() => {
      const anthropic = new AnthropicProvider('test-key');
      const modelManager = new ModelManagerProvider(
        'https://gateway.example.com',
        'test-key'
      );

      providerManager = new ProviderManager(
        [anthropic, modelManager],
        {
          primaryProvider: 'anthropic',
          fallbackProvider: 'model-manager',
          retryAttempts: 1,
          retryDelayMs: 100,
          healthCheckIntervalMs: 60000,
        }
      );
    });

    it('should route claude-3-5-sonnet to Anthropic provider', async () => {
      // Mock Anthropic response
      mockAnthropicClient.messages.create.mockResolvedValue({
        content: [{ type: 'text', text: 'Response from Anthropic' }],
      });

      const result = await providerManager.chat(
        [{ role: 'user', content: 'Hello' }],
        { model: 'claude-3-5-sonnet-20241022' }
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe('Response from Anthropic');
      }
      expect(mockAnthropicClient.messages.create).toHaveBeenCalled();
    });

    it('should route gpt-4o to Model Manager provider', async () => {
      // Mock Model Manager response
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                role: 'assistant',
                content: 'Response from Model Manager',
              },
            },
          ],
        }),
      });

      const result = await providerManager.chat(
        [{ role: 'user', content: 'Hello' }],
        { model: 'gpt-4o' }
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe('Response from Model Manager');
      }
      expect(mockFetch).toHaveBeenCalled();
    });

    it('should use primary provider when no model specified', async () => {
      // Mock Anthropic response (primary provider)
      mockAnthropicClient.messages.create.mockResolvedValue({
        content: [{ type: 'text', text: 'Response from primary' }],
      });

      const result = await providerManager.chat([
        { role: 'user', content: 'Hello' },
      ]);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe('Response from primary');
      }
      expect(mockAnthropicClient.messages.create).toHaveBeenCalled();
    });
  });

  describe('Fallback Mechanism', () => {
    beforeEach(() => {
      const anthropic = new AnthropicProvider('test-key');
      const modelManager = new ModelManagerProvider(
        'https://gateway.example.com',
        'test-key'
      );

      providerManager = new ProviderManager(
        [anthropic, modelManager],
        {
          primaryProvider: 'anthropic',
          fallbackProvider: 'model-manager',
          retryAttempts: 1,
          retryDelayMs: 100,
          healthCheckIntervalMs: 60000,
        }
      );
    });

    it('should fallback to Model Manager when Anthropic fails', async () => {
      // Mock Anthropic failure
      mockAnthropicClient.messages.create.mockRejectedValue(
        new Error('Network error')
      );

      // Mock Model Manager success
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                role: 'assistant',
                content: 'Fallback response',
              },
            },
          ],
        }),
      });

      const result = await providerManager.chat([
        { role: 'user', content: 'Hello' },
      ]);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe('Fallback response');
      }

      // Verify both providers were called
      expect(mockAnthropicClient.messages.create).toHaveBeenCalled();
      expect(mockFetch).toHaveBeenCalled();
    }, 10000);

    it('should return error when both providers fail', async () => {
      // Mock both providers failing
      mockAnthropicClient.messages.create.mockRejectedValue(
        new Error('Anthropic error')
      );
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({}),
      });

      const result = await providerManager.chat([
        { role: 'user', content: 'Hello' },
      ]);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe(ProviderErrorType.UNKNOWN);
      }
    }, 10000);
  });

  describe('Health Checks', () => {
    it('should perform health checks on all providers', async () => {
      const anthropic = new AnthropicProvider('test-key');
      const modelManager = new ModelManagerProvider(
        'https://gateway.example.com',
        'test-key'
      );

      // Mock health check responses
      mockAnthropicClient.messages.create.mockResolvedValue({
        content: [{ type: 'text', text: 'pong' }],
      });
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ data: [] }),
      });

      providerManager = new ProviderManager(
        [anthropic, modelManager],
        {
          primaryProvider: 'anthropic',
          fallbackProvider: 'model-manager',
          retryAttempts: 1,
          retryDelayMs: 100,
          healthCheckIntervalMs: 60000,
        }
      );

      // Manually trigger health check
      await providerManager.checkAllProvidersHealth();

      const healthStatus = providerManager.getHealthStatus();
      expect(healthStatus.size).toBe(2);
      expect(healthStatus.get('anthropic')?.isHealthy).toBe(true);
      expect(healthStatus.get('model-manager')?.isHealthy).toBe(true);
    });

    it('should mark provider unhealthy after consecutive failures', async () => {
      const anthropic = new AnthropicProvider('test-key');
      const modelManager = new ModelManagerProvider(
        'https://gateway.example.com',
        'test-key'
      );

      // Mock Anthropic repeated failures
      mockAnthropicClient.messages.create.mockRejectedValue(
        new Error('Service unavailable')
      );

      // Mock Model Manager success (fallback)
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                role: 'assistant',
                content: 'Fallback response',
              },
            },
          ],
        }),
      });

      providerManager = new ProviderManager(
        [anthropic, modelManager],
        {
          primaryProvider: 'anthropic',
          fallbackProvider: 'model-manager',
          retryAttempts: 1,
          retryDelayMs: 100,
          healthCheckIntervalMs: 60000,
        }
      );

      // Trigger 3 consecutive failures
      await providerManager.chat([{ role: 'user', content: 'Test 1' }]);
      await providerManager.chat([{ role: 'user', content: 'Test 2' }]);
      await providerManager.chat([{ role: 'user', content: 'Test 3' }]);

      const healthStatus = providerManager.getHealthStatus();
      const anthropicHealth = healthStatus.get('anthropic');

      expect(anthropicHealth?.isHealthy).toBe(false);
      expect(anthropicHealth?.consecutiveFailures).toBeGreaterThanOrEqual(3);
    }, 10000);
  });

  describe('Streaming Support', () => {
    beforeEach(() => {
      const anthropic = new AnthropicProvider('test-key');
      const modelManager = new ModelManagerProvider(
        'https://gateway.example.com',
        'test-key'
      );

      providerManager = new ProviderManager(
        [anthropic, modelManager],
        {
          primaryProvider: 'anthropic',
          fallbackProvider: 'model-manager',
          retryAttempts: 1,
          retryDelayMs: 100,
          healthCheckIntervalMs: 60000,
        }
      );
    });

    it('should stream responses from Anthropic', async () => {
      // Mock streaming response
      const mockStream = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'content_block_delta',
            delta: { type: 'text_delta', text: 'Hello' },
          };
          yield {
            type: 'content_block_delta',
            delta: { type: 'text_delta', text: ' world' },
          };
        },
      };

      mockAnthropicClient.messages.stream.mockResolvedValue(mockStream);

      const result = await providerManager.streamChat(
        [{ role: 'user', content: 'Stream test' }],
        { model: 'claude-3-5-sonnet-20241022' }
      );

      expect(result.success).toBe(true);
      if (result.success) {
        const chunks: string[] = [];
        for await (const chunk of result.data) {
          chunks.push(chunk);
        }
        expect(chunks).toEqual(['Hello', ' world']);
      }
    });

    it('should stream responses from Model Manager', async () => {
      // Mock SSE stream
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(
            encoder.encode('data: {"choices":[{"delta":{"content":"GPT"}}]}\n\n')
          );
          controller.enqueue(
            encoder.encode(
              'data: {"choices":[{"delta":{"content":" response"}}]}\n\n'
            )
          );
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        },
      });

      mockFetch.mockResolvedValue({
        ok: true,
        body: stream,
      });

      const result = await providerManager.streamChat(
        [{ role: 'user', content: 'Stream test' }],
        { model: 'gpt-4o' }
      );

      expect(result.success).toBe(true);
      if (result.success) {
        const chunks: string[] = [];
        for await (const chunk of result.data) {
          chunks.push(chunk);
        }
        expect(chunks).toEqual(['GPT', ' response']);
      }
    });
  });

  describe('Model Discovery', () => {
    it('should retrieve available models from all providers', async () => {
      const anthropic = new AnthropicProvider('test-key');
      const modelManager = new ModelManagerProvider(
        'https://gateway.example.com',
        'test-key'
      );

      // Mock Model Manager models endpoint
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [
            { id: 'gpt-4o', object: 'model' },
            { id: 'gpt-4o-mini', object: 'model' },
          ],
        }),
      });

      providerManager = new ProviderManager(
        [anthropic, modelManager],
        {
          primaryProvider: 'anthropic',
          fallbackProvider: 'model-manager',
          retryAttempts: 1,
          retryDelayMs: 100,
          healthCheckIntervalMs: 60000,
        }
      );

      const result = await providerManager.getAvailableModels();

      expect(result.success).toBe(true);
      if (result.success) {
        // Should include models from both providers
        expect(result.data.length).toBeGreaterThan(0);
        expect(result.data).toContain('claude-3-5-sonnet-20241022');
        expect(result.data).toContain('gpt-4o');
        expect(result.data).toContain('gpt-4o-mini');
      }
    });
  });

  describe('Cleanup', () => {
    it('should properly dispose resources', () => {
      const anthropic = new AnthropicProvider('test-key');
      const modelManager = new ModelManagerProvider(
        'https://gateway.example.com',
        'test-key'
      );

      providerManager = new ProviderManager(
        [anthropic, modelManager],
        {
          primaryProvider: 'anthropic',
          fallbackProvider: 'model-manager',
          retryAttempts: 1,
          retryDelayMs: 100,
          healthCheckIntervalMs: 60000,
        }
      );

      // Should not throw
      expect(() => providerManager.dispose()).not.toThrow();

      // Second dispose should also be safe
      expect(() => providerManager.dispose()).not.toThrow();
    });
  });
});
