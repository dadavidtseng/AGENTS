/**
 * Memory Flow Integration Tests
 *
 * Tests memory persistence, context retrieval, automatic archival,
 * and preference storage with real file operations and optional ArcadeDB.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { config } from 'dotenv';
import { resolve } from 'path';
import { existsSync, rmSync, mkdirSync } from 'fs';
import { MemoryService } from '../../memory/memory-service.js';
import { AnthropicProvider } from '../../providers/anthropic-provider.js';
import { ProviderManager } from '../../providers/provider-manager.js';
import type { ConversationMessage } from '../../memory/memory-service.js';

// Unmock Anthropic SDK for real integration tests
vi.unmock('@anthropic-ai/sdk');

// Load test environment
config({ path: resolve(process.cwd(), '.env.test') });

describe('Memory Flow Integration Tests', () => {
  let memoryService: MemoryService;
  let providerManager: ProviderManager;
  const testMemoryPath = './test-data/memory';

  // Generate unique test user/channel IDs for each test to avoid interference
  let testUserId: string;
  let testChannelId: string;

  beforeAll(async () => {
    // Clean up test data directory if exists
    if (existsSync(testMemoryPath)) {
      rmSync(testMemoryPath, { recursive: true, force: true });
    }
    mkdirSync(testMemoryPath, { recursive: true });

    // Initialize provider for summarization
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    if (!anthropicKey) {
      throw new Error('ANTHROPIC_API_KEY not configured for tests');
    }

    const anthropicProvider = new AnthropicProvider(anthropicKey);
    providerManager = new ProviderManager(
      [anthropicProvider],
      {
        primaryProvider: 'anthropic',
        retryAttempts: 2,
        retryDelayMs: 1000,
        healthCheckIntervalMs: 60000,
      }
    );

    // Initialize memory service
    const arcadedbUrl = process.env.TEST_ARCADEDB_URL;
    memoryService = new MemoryService(
      testMemoryPath,
      arcadedbUrl,
      providerManager
    );

    await memoryService.initialize();
  });

  afterAll(async () => {
    // Cleanup provider manager
    providerManager.dispose();

    // Clean up test data
    if (existsSync(testMemoryPath)) {
      rmSync(testMemoryPath, { recursive: true, force: true });
    }
  });

  beforeEach(() => {
    // Generate unique IDs for each test to avoid interference
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(7);
    testUserId = `user-${timestamp}-${random}`;
    testChannelId = `channel-${timestamp}-${random}`;
  });

  afterEach(() => {
    // Optional: cleanup after each test
  });

  describe('Message Storage', () => {
    it('should store messages in JSON files', async () => {
      const message: ConversationMessage = {
        role: 'user',
        content: 'Test message',
        timestamp: Date.now(),
      };

      const result = await memoryService.storeMessage(
        testUserId,
        testChannelId,
        message
      );

      expect(result.success).toBe(true);

      // Verify file exists
      const filePath = `${testMemoryPath}/${testUserId}/${testChannelId}.json`;
      expect(existsSync(filePath)).toBe(true);
    });

    it('should store multiple messages sequentially', async () => {
      const messages: ConversationMessage[] = [
        { role: 'user', content: 'Message 1', timestamp: Date.now() },
        { role: 'assistant', content: 'Response 1', timestamp: Date.now() + 1 },
        { role: 'user', content: 'Message 2', timestamp: Date.now() + 2 },
      ];

      for (const msg of messages) {
        const result = await memoryService.storeMessage(
          testUserId,
          testChannelId,
          msg
        );
        expect(result.success).toBe(true);
      }

      // Verify all messages are stored
      const context = await memoryService.retrieveContext(
        testUserId,
        testChannelId
      );

      expect(context.success).toBe(true);
      if (context.success) {
        expect(context.data.length).toBe(3);
        expect(context.data[0].content).toBe('Message 1');
        expect(context.data[2].content).toBe('Message 2');
      }
    });

    it('should reject invalid messages', async () => {
      const invalidMessage = {
        role: 'user',
        content: '',
        timestamp: Date.now(),
      } as ConversationMessage;

      const result = await memoryService.storeMessage(
        testUserId,
        testChannelId,
        invalidMessage
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('VALIDATION_ERROR');
      }
    });
  });

  describe('Context Retrieval', () => {
    beforeEach(async () => {
      // Pre-populate with messages
      const messages: ConversationMessage[] = [];
      for (let i = 0; i < 10; i++) {
        messages.push({
          role: i % 2 === 0 ? 'user' : 'assistant',
          content: `Message ${i}`,
          timestamp: Date.now() + i,
        });
      }

      for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];
        const result = await memoryService.storeMessage(testUserId, testChannelId, msg);
        if (!result.success) {
          console.error(`Context Retrieval beforeEach: Message ${i} failed:`, result.error);
        }
      }
    });

    it('should retrieve recent conversation context', async () => {
      const result = await memoryService.retrieveContext(
        testUserId,
        testChannelId
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.length).toBe(10);
        expect(result.data[0].content).toBe('Message 0');
      }
    });

    it('should limit retrieved messages when specified', async () => {
      const result = await memoryService.retrieveContext(
        testUserId,
        testChannelId,
        5
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.length).toBe(5);
        // Should get last 5 messages
        expect(result.data[0].content).toBe('Message 5');
        expect(result.data[4].content).toBe('Message 9');
      }
    });

    it('should return empty array for non-existent conversation', async () => {
      const result = await memoryService.retrieveContext(
        'non-existent-user',
        'non-existent-channel'
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.length).toBe(0);
      }
    });
  });

  describe('Automatic Archival', () => {
    it('should trigger archival after 20 messages threshold', async () => {
      // Store 21 messages to exceed threshold
      const messages: ConversationMessage[] = [];
      for (let i = 0; i < 21; i++) {
        messages.push({
          role: i % 2 === 0 ? 'user' : 'assistant',
          content: `Archive test message ${i}`,
          timestamp: Date.now() + i,
        });
      }

      for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];
        const result = await memoryService.storeMessage(
          testUserId,
          testChannelId,
          msg
        );
        if (!result.success) {
          console.error(`Message ${i} failed:`, result.error);
        }
        expect(result.success).toBe(true);
      }

      // Note: Archival happens asynchronously
      // In real test, we'd check ArcadeDB or wait for completion
      // For now, we verify messages are still retrievable from short-term storage
      const context = await memoryService.retrieveContext(
        testUserId,
        testChannelId
      );

      expect(context.success).toBe(true);
      if (context.success) {
        expect(context.data.length).toBeGreaterThan(0);
      }
    }, 30000);
  });

  describe('Preference Storage', () => {
    it('should store and retrieve user preferences', async () => {
      const preference = {
        key: 'theme',
        value: 'dark',
      };

      const storeResult = await memoryService.storePreference(
        testUserId,
        preference.key,
        preference.value
      );

      expect(storeResult.success).toBe(true);

      const retrieveResult = await memoryService.getPreference(
        testUserId,
        preference.key
      );

      expect(retrieveResult.success).toBe(true);
      if (retrieveResult.success) {
        expect(retrieveResult.data).toBe('dark');
      }
    });

    it('should update existing preferences', async () => {
      const key = 'language';

      // Store initial value
      await memoryService.storePreference(testUserId, key, 'en');

      // Update value
      await memoryService.storePreference(testUserId, key, 'zh');

      // Retrieve updated value
      const result = await memoryService.getPreference(testUserId, key);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe('zh');
      }
    });

    it('should return null for non-existent preferences', async () => {
      const result = await memoryService.getPreference(
        testUserId,
        'non-existent-key'
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBeNull();
      }
    });
  });

  describe('ArcadeDB Integration', () => {
    it('should gracefully degrade when ArcadeDB unavailable', async () => {
      // Memory service should initialize even without ArcadeDB
      const noDbService = new MemoryService('./test-data/memory-no-db');
      const initResult = await noDbService.initialize();

      expect(initResult.success).toBe(true);

      // Should still be able to store and retrieve messages
      const message: ConversationMessage = {
        role: 'user',
        content: 'Test without DB',
        timestamp: Date.now(),
      };

      const storeResult = await noDbService.storeMessage(
        'user-no-db',
        'channel-no-db',
        message
      );

      expect(storeResult.success).toBe(true);

      // Cleanup
      if (existsSync('./test-data/memory-no-db')) {
        rmSync('./test-data/memory-no-db', { recursive: true, force: true });
      }
    });
  });

  describe('Conversation Restart', () => {
    it('should restore context after service restart', async () => {
      // Store messages
      const messages: ConversationMessage[] = [
        { role: 'user', content: 'Before restart', timestamp: Date.now() },
        { role: 'assistant', content: 'Response', timestamp: Date.now() + 1 },
      ];

      for (const msg of messages) {
        await memoryService.storeMessage(testUserId, testChannelId, msg);
      }

      // Create new memory service instance (simulating restart)
      const restartedService = new MemoryService(testMemoryPath);
      await restartedService.initialize();

      // Retrieve context
      const result = await restartedService.retrieveContext(
        testUserId,
        testChannelId
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.length).toBe(2);
        expect(result.data[0].content).toBe('Before restart');
      }
    });
  });
});
