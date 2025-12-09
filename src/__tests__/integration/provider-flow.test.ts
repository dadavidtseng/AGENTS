/**
 * Provider Flow Integration Tests
 *
 * Tests provider selection, fallback mechanisms, and health monitoring
 * with real API calls to test environments.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { config } from 'dotenv';
import { resolve } from 'path';
import { AnthropicProvider } from '../../providers/anthropic-provider.js';
import { ModelManagerProvider } from '../../providers/model-manager-provider.js';
import { ProviderManager } from '../../providers/provider-manager.js';
import type { Message, ProviderConfig } from '../../providers/types.js';

// Unmock Anthropic SDK for real integration tests
vi.unmock('@anthropic-ai/sdk');

// Load test environment
config({ path: resolve(process.cwd(), '.env.test') });

describe('Provider Flow Integration Tests', () => {
  let anthropicProvider: AnthropicProvider;
  let modelManagerProvider: ModelManagerProvider;
  let providerManager: ProviderManager;
  let anthropicAvailable = true;

  const testConfig: ProviderConfig = {
    primaryProvider: 'model-manager',
    fallbackProvider: 'anthropic',
    retryAttempts: 2,
    retryDelayMs: 1000,
    healthCheckIntervalMs: 60000,
  };

  beforeAll(async () => {
    // Initialize providers with test credentials
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    const modelManagerUrl = process.env.MODEL_MANAGER_BASE_URL;
    const modelManagerKey = process.env.MODEL_MANAGER_API_KEY;

    if (!anthropicKey || !modelManagerUrl || !modelManagerKey) {
      throw new Error('Test environment variables not configured');
    }

    anthropicProvider = new AnthropicProvider(anthropicKey);
    modelManagerProvider = new ModelManagerProvider(
      modelManagerUrl,
      modelManagerKey
    );

    // Check if Anthropic API is accessible
    const testResult = await anthropicProvider.chat([
      { role: 'user', content: 'test' }
    ], { maxTokens: 10 });

    if (!testResult.success && (testResult.error.type === 'AUTH_FAILED' || testResult.error.type === 'INVALID_REQUEST')) {
      console.warn('⚠️  Anthropic API key is invalid - skipping Anthropic-dependent integration tests');
      anthropicAvailable = false;
    }

    providerManager = new ProviderManager(
      [anthropicProvider, modelManagerProvider],
      testConfig
    );
  });

  afterAll(() => {
    // Cleanup
    providerManager.dispose();
  });

  beforeEach(async () => {
    // Reset health status before each test
    anthropicProvider.resetHealth();
    modelManagerProvider.resetHealth();
  });

  describe('Provider Selection', () => {
    it('should select Anthropic provider for Claude models', async () => {
      if (!anthropicAvailable) {
        console.warn('Skipping Anthropic test - API unavailable');
        return;
      }

      const messages: Message[] = [
        { role: 'user', content: 'Say "provider test" exactly.' },
      ];

      const result = await providerManager.chat(messages, {
        model: 'claude-3-haiku-20240307',
        maxTokens: 50,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toContain('provider test');
      }
    }, 30000);

    it('should select Model Manager for GPT models', async () => {
      const messages: Message[] = [
        { role: 'user', content: 'Say "model manager test" exactly.' },
      ];

      const result = await providerManager.chat(messages, {
        model: 'gpt-4o-mini',
        maxTokens: 50,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.toLowerCase()).toContain('model manager test');
      }
    }, 30000);

    it('should use primary provider when no model specified', async () => {
      const messages: Message[] = [
        { role: 'user', content: 'Reply with single word: OK' },
      ];

      const result = await providerManager.chat(messages, {
        maxTokens: 10,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.toLowerCase()).toContain('ok');
      }
    }, 30000);
  });

  describe('Fallback Mechanism', () => {
    it('should fallback to secondary provider on primary failure', async () => {
      if (!anthropicAvailable) {
        console.warn('Skipping Anthropic test - API unavailable');
        return;
      }

      // Create manager with invalid primary but valid fallback
      const invalidProvider = new ModelManagerProvider(
        'https://invalid-url-that-does-not-exist.com',
        'invalid-key'
      );

      const fallbackManager = new ProviderManager(
        [invalidProvider, anthropicProvider],
        {
          ...testConfig,
          primaryProvider: 'model-manager',
          fallbackProvider: 'anthropic',
          retryAttempts: 1,
        }
      );

      const messages: Message[] = [
        { role: 'user', content: 'Say "fallback success" exactly.' },
      ];

      const result = await fallbackManager.chat(messages, {
        model: 'gpt-4o-mini', // Primary would fail
        maxTokens: 50,
      });

      // Should succeed using fallback
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toContain('fallback success');
      }

      fallbackManager.dispose();
    }, 30000);
  });

  describe('Health Check Recovery', () => {
    it('should report healthy status for functioning providers', async () => {
      const anthropicHealthy = await anthropicProvider.isHealthy();
      const modelManagerHealthy = await modelManagerProvider.isHealthy();

      expect(anthropicHealthy).toBe(true);
      expect(modelManagerHealthy).toBe(true);
    });

    it('should recover health status after successful request', async () => {
      if (!anthropicAvailable) {
        console.warn('Skipping Anthropic test - API unavailable');
        return;
      }

      // Providers start healthy
      expect(await anthropicProvider.isHealthy()).toBe(true);

      // Make successful request
      const messages: Message[] = [
        { role: 'user', content: 'Hello' },
      ];

      const result = await anthropicProvider.chat(messages, {
        model: 'claude-3-haiku-20240307',
        maxTokens: 20,
      });

      expect(result.success).toBe(true);
      expect(await anthropicProvider.isHealthy()).toBe(true);
    }, 30000);

    it('should track provider health status in manager', async () => {
      const healthStatus = providerManager.getHealthStatus();

      expect(healthStatus.size).toBeGreaterThan(0);
      expect(healthStatus.get('anthropic')?.isHealthy).toBe(true);
      expect(healthStatus.get('model-manager')?.isHealthy).toBe(true);
    });
  });

  describe('Streaming Support', () => {
    it('should stream responses from Anthropic provider', async () => {
      if (!anthropicAvailable) {
        console.warn('Skipping Anthropic test - API unavailable');
        return;
      }

      const messages: Message[] = [
        { role: 'user', content: 'Count from 1 to 3.' },
      ];

      const result = await providerManager.streamChat(messages, {
        model: 'claude-3-haiku-20240307',
        maxTokens: 50,
      });

      expect(result.success).toBe(true);

      if (result.success) {
        let fullResponse = '';
        for await (const chunk of result.data) {
          fullResponse += chunk;
        }
        expect(fullResponse.length).toBeGreaterThan(0);
      }
    }, 30000);

    it('should stream responses from Model Manager provider', async () => {
      const messages: Message[] = [
        { role: 'user', content: 'Count from 1 to 3.' },
      ];

      const result = await providerManager.streamChat(messages, {
        model: 'gpt-4o-mini',
        maxTokens: 50,
      });

      expect(result.success).toBe(true);

      if (result.success) {
        let fullResponse = '';
        for await (const chunk of result.data) {
          fullResponse += chunk;
        }
        expect(fullResponse.length).toBeGreaterThan(0);
      }
    }, 30000);
  });

  describe('Model Discovery', () => {
    it('should retrieve available models from providers', async () => {
      const models = await providerManager.getAvailableModels();

      expect(models.success).toBe(true);
      if (models.success) {
        expect(models.data.length).toBeGreaterThan(0);
        // Should have both Claude and GPT models
        expect(models.data.some((m) => m.includes('claude'))).toBe(true);
      }
    }, 30000);

    it('should list Anthropic models', async () => {
      if (!anthropicAvailable) {
        console.warn('Skipping Anthropic test - API unavailable');
        return;
      }

      const result = await anthropicProvider.getAvailableModels();

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toContain('claude-3-5-sonnet-20241022');
        expect(result.data).toContain('claude-3-haiku-20240307');
      }
    });
  });
});
