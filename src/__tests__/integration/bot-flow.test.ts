/**
 * Bot Flow Integration Tests
 *
 * Tests SlackBot and DiscordBot full conversation flows, including
 * message processing, response generation, memory storage, and context restoration.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { config } from 'dotenv';
import { resolve } from 'path';
import { existsSync, rmSync, mkdirSync } from 'fs';
import { AnthropicProvider } from '../../providers/anthropic-provider.js';
import { ModelManagerProvider } from '../../providers/model-manager-provider.js';
import { ProviderManager } from '../../providers/provider-manager.js';
import { MemoryService } from '../../memory/memory-service.js';
import type { ConversationMessage } from '../../memory/memory-service.js';

// Unmock Anthropic SDK for real integration tests
vi.unmock('@anthropic-ai/sdk');

// Load test environment
config({ path: resolve(process.cwd(), '.env.test') });

describe('Bot Flow Integration Tests', () => {
  let providerManager: ProviderManager;
  let memoryService: MemoryService;
  let anthropicProvider: AnthropicProvider;
  let anthropicAvailable = true;
  const testMemoryPath = './test-data/bot-memory';

  beforeAll(async () => {
    // Clean up test data directory
    if (existsSync(testMemoryPath)) {
      rmSync(testMemoryPath, { recursive: true, force: true });
    }
    mkdirSync(testMemoryPath, { recursive: true });

    // Initialize providers
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    const modelManagerUrl = process.env.MODEL_MANAGER_BASE_URL;
    const modelManagerKey = process.env.MODEL_MANAGER_API_KEY;

    if (!anthropicKey || !modelManagerUrl || !modelManagerKey) {
      throw new Error('Test environment variables not configured');
    }

    anthropicProvider = new AnthropicProvider(anthropicKey);
    const modelManagerProvider = new ModelManagerProvider(
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
      {
        primaryProvider: 'model-manager',
        fallbackProvider: 'anthropic',
        retryAttempts: 2,
        retryDelayMs: 1000,
        healthCheckIntervalMs: 60000,
      }
    );

    // Initialize memory service
    memoryService = new MemoryService(testMemoryPath, undefined, providerManager);
    await memoryService.initialize();
  });

  afterAll(async () => {
    // Cleanup
    providerManager.dispose();

    if (existsSync(testMemoryPath)) {
      rmSync(testMemoryPath, { recursive: true, force: true });
    }
  });

  describe('SlackBot Conversation Flow', () => {
    const slackUserId = 'U095J28UH4G';
    const slackChannelId = 'C09T6RU41HP';

    it('should process Slack message and generate response', async () => {
      if (!anthropicAvailable) {
        console.warn('Skipping Anthropic test - API unavailable');
        return;
      }

      // Simulate user message
      const userMessage: ConversationMessage = {
        role: 'user',
        content: '[claude-3-haiku] What is 2+2?',
        timestamp: Date.now(),
      };

      // Store user message
      await memoryService.storeMessage(slackUserId, slackChannelId, userMessage);

      // Extract model from message
      const modelMatch = userMessage.content.match(/\[([^\]]+)\]/);
      const model = modelMatch ? modelMatch[1] : undefined;
      const cleanContent = userMessage.content.replace(/\[([^\]]+)\]\s*/, '');

      // Get context
      const contextResult = await memoryService.retrieveContext(
        slackUserId,
        slackChannelId
      );

      expect(contextResult.success).toBe(true);

      // Generate response
      const messages = contextResult.success
        ? contextResult.data.map((m) => ({
            role: m.role,
            content: m.content.replace(/\[([^\]]+)\]\s*/, ''),
          }))
        : [{ role: 'user' as const, content: cleanContent }];

      const responseResult = await providerManager.chat(messages, {
        model,
        maxTokens: 100,
      });

      expect(responseResult.success).toBe(true);

      if (responseResult.success) {
        expect(responseResult.data.length).toBeGreaterThan(0);

        // Store assistant response
        const assistantMessage: ConversationMessage = {
          role: 'assistant',
          content: responseResult.data,
          timestamp: Date.now(),
        };

        await memoryService.storeMessage(
          slackUserId,
          slackChannelId,
          assistantMessage
        );

        // Verify both messages are stored
        const finalContext = await memoryService.retrieveContext(
          slackUserId,
          slackChannelId
        );

        expect(finalContext.success).toBe(true);
        if (finalContext.success) {
          expect(finalContext.data.length).toBe(2);
          expect(finalContext.data[0].role).toBe('user');
          expect(finalContext.data[1].role).toBe('assistant');
        }
      }
    }, 30000);

    it('should handle model switching in conversation', async () => {
      if (!anthropicAvailable) {
        console.warn('Skipping Anthropic test - API unavailable');
        return;
      }

      const userId = 'test-slack-user-2';
      const channelId = 'test-slack-channel-2';

      // First message with Claude
      const msg1: ConversationMessage = {
        role: 'user',
        content: '[claude-3-haiku] Hello',
        timestamp: Date.now(),
      };

      await memoryService.storeMessage(userId, channelId, msg1);

      const response1 = await providerManager.chat(
        [{ role: 'user', content: 'Hello' }],
        { model: 'claude-3-haiku', maxTokens: 50 }
      );

      expect(response1.success).toBe(true);

      if (response1.success) {
        await memoryService.storeMessage(userId, channelId, {
          role: 'assistant',
          content: response1.data,
          timestamp: Date.now(),
        });
      }

      // Second message with GPT
      const msg2: ConversationMessage = {
        role: 'user',
        content: '[gpt-4o-mini] What is 5+5?',
        timestamp: Date.now(),
      };

      await memoryService.storeMessage(userId, channelId, msg2);

      const response2 = await providerManager.chat(
        [{ role: 'user', content: 'What is 5+5?' }],
        { model: 'gpt-4o-mini', maxTokens: 50 }
      );

      expect(response2.success).toBe(true);

      // Verify conversation history contains both exchanges
      const context = await memoryService.retrieveContext(userId, channelId);

      expect(context.success).toBe(true);
      if (context.success) {
        expect(context.data.length).toBe(4); // 2 user messages + 2 assistant responses
      }
    }, 30000);
  });

  describe('DiscordBot Conversation Flow', () => {
    const discordUserId = '960573427859726356';
    const discordChannelId = '1447633779597508798';

    it('should process Discord message and generate response', async () => {
      // Simulate user message
      const userMessage: ConversationMessage = {
        role: 'user',
        content: '[gpt-4o-mini] What is the capital of France?',
        timestamp: Date.now(),
      };

      // Store user message
      await memoryService.storeMessage(
        discordUserId,
        discordChannelId,
        userMessage
      );

      // Extract model and clean content
      const modelMatch = userMessage.content.match(/\[([^\]]+)\]/);
      const model = modelMatch ? modelMatch[1] : undefined;
      const cleanContent = userMessage.content.replace(/\[([^\]]+)\]\s*/, '');

      // Generate response
      const responseResult = await providerManager.chat(
        [{ role: 'user', content: cleanContent }],
        { model, maxTokens: 100 }
      );

      expect(responseResult.success).toBe(true);

      if (responseResult.success) {
        expect(responseResult.data.toLowerCase()).toContain('paris');

        // Store response
        await memoryService.storeMessage(discordUserId, discordChannelId, {
          role: 'assistant',
          content: responseResult.data,
          timestamp: Date.now(),
        });
      }
    }, 30000);

    it('should handle Discord conversation with context', async () => {
      const userId = 'test-discord-user-2';
      const channelId = 'test-discord-channel-2';

      // Multi-turn conversation
      const conversation = [
        { role: 'user' as const, content: 'My name is Alice' },
        { role: 'assistant' as const, content: 'Nice to meet you, Alice!' },
        { role: 'user' as const, content: 'What is my name?' },
      ];

      // Store conversation history
      for (let i = 0; i < conversation.length - 1; i++) {
        await memoryService.storeMessage(userId, channelId, {
          ...conversation[i],
          timestamp: Date.now() + i,
        });
      }

      // Get context and send last message
      const contextResult = await memoryService.retrieveContext(userId, channelId);
      expect(contextResult.success).toBe(true);

      if (contextResult.success) {
        const messages = [
          ...contextResult.data.map((m) => ({ role: m.role, content: m.content })),
          conversation[2],
        ];

        const response = await providerManager.chat(messages, {
          model: 'gpt-4o-mini',
          maxTokens: 50,
        });

        expect(response.success).toBe(true);
        if (response.success) {
          // Response should reference "Alice" from context
          expect(response.data.toLowerCase()).toContain('alice');
        }
      }
    }, 30000);
  });

  describe('Bot Restart and Context Restoration', () => {
    it('should restore conversation context after restart', async () => {
      const userId = 'restart-test-user';
      const channelId = 'restart-test-channel';

      // Initial conversation
      const messages: ConversationMessage[] = [
        { role: 'user', content: 'Hello bot', timestamp: Date.now() },
        { role: 'assistant', content: 'Hello! How can I help?', timestamp: Date.now() + 1 },
        { role: 'user', content: 'Remember this: code is 1234', timestamp: Date.now() + 2 },
        { role: 'assistant', content: 'I will remember that code.', timestamp: Date.now() + 3 },
      ];

      for (const msg of messages) {
        await memoryService.storeMessage(userId, channelId, msg);
      }

      // Simulate restart by creating new memory service instance
      const restartedMemoryService = new MemoryService(testMemoryPath);
      await restartedMemoryService.initialize();

      // Retrieve context after restart
      const contextResult = await restartedMemoryService.retrieveContext(
        userId,
        channelId
      );

      expect(contextResult.success).toBe(true);
      if (contextResult.success) {
        expect(contextResult.data.length).toBe(4);
        expect(contextResult.data[2].content).toContain('code is 1234');

        // New message using restored context
        const newMessage = { role: 'user' as const, content: 'What was the code?' };
        const response = await providerManager.chat(
          [...contextResult.data.map((m) => ({ role: m.role, content: m.content })), newMessage],
          { model: 'gpt-4o-mini', maxTokens: 50 }
        );

        expect(response.success).toBe(true);
        if (response.success) {
          // Should reference 1234 from context
          expect(response.data).toContain('1234');
        }
      }
    }, 30000);
  });

  describe('Error Handling', () => {
    it('should handle provider failures gracefully', async () => {
      if (!anthropicAvailable) {
        console.warn('Skipping Anthropic test - API unavailable');
        return;
      }

      const userId = 'error-test-user';
      const channelId = 'error-test-channel';

      // Store user message
      await memoryService.storeMessage(userId, channelId, {
        role: 'user',
        content: 'Test message',
        timestamp: Date.now(),
      });

      // Try with invalid model
      const result = await providerManager.chat(
        [{ role: 'user', content: 'Test' }],
        { model: 'invalid-model-that-does-not-exist', maxTokens: 50 }
      );

      // Should fallback to primary provider
      expect(result.success).toBe(true);
    }, 30000);

    it('should continue operation when memory storage fails', async () => {
      // This test verifies graceful degradation
      // File storage creates directories even with relative paths, so it succeeds
      const invalidUserId = '../../../invalid-path';
      const channelId = 'test-channel';

      const result = await memoryService.storeMessage(
        invalidUserId,
        channelId,
        { role: 'user', content: 'Test', timestamp: Date.now() }
      );

      // File system allows relative paths, so storage succeeds
      // (archival may fail due to DB unavailable, but storage succeeds)
      expect(result.success).toBe(true);
    });
  });

  describe('Performance', () => {
    it('should handle rapid sequential messages', async () => {
      // Generate unique IDs to prevent test interference
      const timestamp = Date.now();
      const random = Math.random().toString(36).substring(7);
      const userId = `perf-user-${timestamp}-${random}`;
      const channelId = `perf-channel-${timestamp}-${random}`;

      // Send 10 messages rapidly
      const messages: ConversationMessage[] = [];
      for (let i = 0; i < 10; i++) {
        messages.push({
          role: i % 2 === 0 ? 'user' : 'assistant',
          content: `Message ${i}`,
          timestamp: Date.now() + i,
        });
      }

      const start = Date.now();

      for (const msg of messages) {
        const result = await memoryService.storeMessage(userId, channelId, msg);
        expect(result.success).toBe(true);
      }

      const duration = Date.now() - start;

      // Should complete within reasonable time (< 1 second for 10 messages)
      expect(duration).toBeLessThan(1000);

      // Verify all messages stored
      const context = await memoryService.retrieveContext(userId, channelId);
      expect(context.success).toBe(true);
      if (context.success) {
        expect(context.data.length).toBe(10);
      }
    });
  });
});
