/**
 * Phase 3 Integration Tests - Hybrid Memory System
 *
 * Verifies that the hybrid memory system works correctly:
 * - File storage (FileStorageAdapter)
 * - Database storage (ArcadeDBAdapter)
 * - Memory orchestration (MemoryService)
 * - Automatic archival with LLM summarization
 * - Graceful degradation when database unavailable
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  MemoryService,
  type ConversationMessage,
  type KnowledgeEntry,
} from '../../src/memory/memory-service.js';
import type { ProviderManager } from '../../src/providers/provider-manager.js';
import { ok } from '../../src/common/result.js';

// Mock fetch globally for ArcadeDB
const mockFetch = vi.fn();
global.fetch = mockFetch as any;

describe('Phase 3: Hybrid Memory System Integration', () => {
  let service: MemoryService;
  let testDir: string;
  let mockProviderManager: ProviderManager;
  let consoleLogSpy: any;
  let consoleWarnSpy: any;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Create unique temp directory
    testDir = join(
      tmpdir(),
      `phase3-test-${Date.now()}-${Math.random().toString(36).substring(7)}`
    );
    await fs.mkdir(testDir, { recursive: true });

    // Mock ProviderManager with summarization capability
    mockProviderManager = {
      chat: vi.fn().mockResolvedValue(
        ok('This conversation discussed TypeScript features and best practices.')
      ),
    } as any;

    // Spy on console for verification
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(async () => {
    // Cleanup
    if (service) {
      await service.dispose();
    }

    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }

    consoleLogSpy.mockRestore();
    consoleWarnSpy.mockRestore();
  });

  describe('Complete Hybrid Memory System Flow', () => {
    it('should initialize with ArcadeDB and handle full memory lifecycle', async () => {
      // Step 1: Mock successful ArcadeDB connection
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: [{ test: 1 }] }),
      });

      service = new MemoryService(
        testDir,
        'http://localhost:2480/testdb',
        mockProviderManager
      );

      const initResult = await service.initialize();

      expect(initResult.success).toBe(true);
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('ArcadeDB connected successfully')
      );

      // Step 2: Store 25 messages (exceeds 20 threshold)
      console.log('\n=== Storing 25 messages to trigger archival ===');

      // Mock archival vertex creation
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: [{ '@rid': '#10:0' }] }),
      });

      for (let i = 1; i <= 25; i++) {
        const message: ConversationMessage = {
          role: i % 2 === 1 ? 'user' : 'assistant',
          content: `Message ${i}: ${i % 2 === 1 ? 'Question' : 'Answer'} about TypeScript`,
          timestamp: Date.now() + i * 1000,
        };

        await service.storeMessage('user1', 'channel1', message);

        if (i === 20) {
          console.log('--- Archival threshold reached at 20 messages ---');
        }
      }

      // Step 3: Verify archival was triggered
      expect(mockProviderManager.chat).toHaveBeenCalled();

      const summarizationCall = (mockProviderManager.chat as any).mock.calls[0][0];
      expect(summarizationCall[0].content).toContain('Summarize the following conversation');

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Archived conversation user1/channel1')
      );

      // Step 4: Verify database vertex creation with correct parameters
      const createVertexCall = mockFetch.mock.calls.find((call) =>
        call[1]?.body?.includes('CREATE VERTEX ArchivedConversation')
      );

      expect(createVertexCall).toBeDefined();

      const vertexBody = JSON.parse(createVertexCall![1].body);
      expect(vertexBody.params.userId).toBe('user1');
      expect(vertexBody.params.channelId).toBe('channel1');
      expect(vertexBody.params.messageCount).toBe(20);
      expect(vertexBody.params.summary).toContain('TypeScript');

      // Step 5: Verify file was trimmed to last 10 messages
      const contextResult = await service.retrieveContext('user1', 'channel1');

      expect(contextResult.success).toBe(true);
      if (contextResult.success) {
        expect(contextResult.data.length).toBeLessThanOrEqual(15); // 5 remaining + new 5 messages
        console.log(`File contains ${contextResult.data.length} messages after archival and trim`);
      }
    });

    it('should handle preferences and knowledge storage independently', async () => {
      // Initialize without database (file-only mode)
      service = new MemoryService(testDir);
      await service.initialize();

      // Test preference storage
      console.log('\n=== Testing preference storage ===');

      await service.storePreference('user1', 'theme', 'dark');
      await service.storePreference('user1', 'language', 'en');
      await service.storePreference('user1', 'notifications', true);

      const themeResult = await service.getPreference('user1', 'theme');
      const langResult = await service.getPreference('user1', 'language');
      const notifResult = await service.getPreference('user1', 'notifications');

      expect(themeResult.success && themeResult.data).toBe('dark');
      expect(langResult.success && langResult.data).toBe('en');
      expect(notifResult.success && notifResult.data).toBe(true);

      console.log('✓ Preferences stored and retrieved successfully');

      // Test knowledge storage
      console.log('\n=== Testing public knowledge storage ===');

      const entry1: KnowledgeEntry = {
        id: 'ts-types',
        topic: 'TypeScript Types',
        content: 'TypeScript provides static type checking for JavaScript',
        tags: ['typescript', 'types', 'programming'],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const entry2: KnowledgeEntry = {
        id: 'node-modules',
        topic: 'Node.js Modules',
        content: 'Node.js uses CommonJS and ES modules',
        tags: ['nodejs', 'modules', 'javascript'],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      await service.storeKnowledge(entry1);
      await service.storeKnowledge(entry2);

      const retrievedEntry1 = await service.getKnowledge('ts-types');
      const retrievedEntry2 = await service.getKnowledge('node-modules');

      expect(retrievedEntry1.success && retrievedEntry1.data?.topic).toBe('TypeScript Types');
      expect(retrievedEntry2.success && retrievedEntry2.data?.topic).toBe('Node.js Modules');

      console.log('✓ Knowledge entries stored and retrieved successfully');
    });

    it('should demonstrate graceful degradation when database unavailable', async () => {
      // Step 1: Mock database connection failure
      mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

      console.log('\n=== Testing graceful degradation ===');

      service = new MemoryService(
        testDir,
        'http://localhost:2480/testdb',
        mockProviderManager
      );

      const initResult = await service.initialize();

      // Should still initialize successfully
      expect(initResult.success).toBe(true);
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('ArcadeDB unavailable')
      );
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Continuing with short-term storage only')
      );

      console.log('✓ Service initialized despite database failure');

      // Step 2: Verify file storage still works
      const message: ConversationMessage = {
        role: 'user',
        content: 'Test message in file-only mode',
        timestamp: Date.now(),
      };

      const storeResult = await service.storeMessage('user1', 'channel1', message);
      expect(storeResult.success).toBe(true);

      const retrieveResult = await service.retrieveContext('user1', 'channel1');
      expect(retrieveResult.success).toBe(true);
      if (retrieveResult.success) {
        expect(retrieveResult.data).toHaveLength(1);
        expect(retrieveResult.data[0].content).toBe('Test message in file-only mode');
      }

      console.log('✓ File storage working in degraded mode');

      // Step 3: Store 25 messages to verify archival warning
      for (let i = 1; i <= 25; i++) {
        const msg: ConversationMessage = {
          role: i % 2 === 1 ? 'user' : 'assistant',
          content: `Message ${i}`,
          timestamp: Date.now() + i * 1000,
        };
        await service.storeMessage('user2', 'channel2', msg);
      }

      // Should warn about inability to archive
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Cannot archive conversation')
      );
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Database unavailable')
      );

      console.log('✓ Archival warning logged in degraded mode');

      // Step 4: Verify search returns appropriate error
      const searchResult = await service.searchLongTerm('user1', 'test');

      expect(searchResult.success).toBe(false);
      if (!searchResult.success) {
        expect(searchResult.error.type).toBe('DATABASE_ERROR');
        expect(searchResult.error.message).toContain('Long-term storage unavailable');
      }

      console.log('✓ Search returns appropriate error in degraded mode');
    });
  });

  describe('File System Verification', () => {
    it('should create correct directory structure', async () => {
      service = new MemoryService(testDir);
      await service.initialize();

      // Store messages for multiple users and channels
      await service.storeMessage('user1', 'channel1', {
        role: 'user',
        content: 'Hello',
        timestamp: Date.now(),
      });

      await service.storeMessage('user1', 'channel2', {
        role: 'user',
        content: 'Hi',
        timestamp: Date.now(),
      });

      await service.storeMessage('user2', 'channel1', {
        role: 'user',
        content: 'Hey',
        timestamp: Date.now(),
      });

      // Store preferences
      await service.storePreference('user1', 'theme', 'dark');
      await service.storePreference('user2', 'theme', 'light');

      // Store knowledge
      await service.storeKnowledge({
        id: 'test',
        topic: 'Test',
        content: 'Test content',
        tags: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      // Verify directory structure
      const user1Exists = await fs
        .access(join(testDir, 'user1'))
        .then(() => true)
        .catch(() => false);
      const user2Exists = await fs
        .access(join(testDir, 'user2'))
        .then(() => true)
        .catch(() => false);
      const publicExists = await fs
        .access(join(testDir, 'public'))
        .then(() => true)
        .catch(() => false);

      expect(user1Exists).toBe(true);
      expect(user2Exists).toBe(true);
      expect(publicExists).toBe(true);

      // Verify files
      const user1Channel1 = await fs
        .access(join(testDir, 'user1/channel1.json'))
        .then(() => true)
        .catch(() => false);
      const user1Channel2 = await fs
        .access(join(testDir, 'user1/channel2.json'))
        .then(() => true)
        .catch(() => false);
      const user1Prefs = await fs
        .access(join(testDir, 'user1/preferences.json'))
        .then(() => true)
        .catch(() => false);
      const publicKnowledge = await fs
        .access(join(testDir, 'public/knowledge.json'))
        .then(() => true)
        .catch(() => false);

      expect(user1Channel1).toBe(true);
      expect(user1Channel2).toBe(true);
      expect(user1Prefs).toBe(true);
      expect(publicKnowledge).toBe(true);

      console.log('✓ Correct directory structure created');
    });
  });

  describe('Performance and Edge Cases', () => {
    it('should handle sequential message storage', async () => {
      service = new MemoryService(testDir);
      await service.initialize();

      const startTime = Date.now();

      // Store 15 messages sequentially (avoids file write conflicts)
      for (let i = 0; i < 15; i++) {
        await service.storeMessage('user1', 'channel1', {
          role: i % 2 === 0 ? 'user' : 'assistant',
          content: `Sequential message ${i}`,
          timestamp: Date.now() + i,
        });
      }

      const duration = Date.now() - startTime;

      console.log(`✓ Stored 15 messages sequentially in ${duration}ms`);

      // Verify all messages stored
      const result = await service.retrieveContext('user1', 'channel1', 20);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.length).toBe(15);
      }
    });

    it('should handle special characters in user/channel IDs', async () => {
      service = new MemoryService(testDir);
      await service.initialize();

      const specialUserId = 'user-123_test@domain';
      const specialChannelId = 'channel.456-test_room';

      await service.storeMessage(specialUserId, specialChannelId, {
        role: 'user',
        content: 'Test with special IDs',
        timestamp: Date.now(),
      });

      const result = await service.retrieveContext(specialUserId, specialChannelId);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toHaveLength(1);
      }

      console.log('✓ Special characters in IDs handled correctly');
    });
  });
});
