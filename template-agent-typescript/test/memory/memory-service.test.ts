/**
 * MemoryService Unit Tests
 *
 * Tests hybrid memory system with mocked dependencies
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

describe('MemoryService', () => {
  let service: MemoryService;
  let testDir: string;
  let mockProviderManager: ProviderManager;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Create unique temp directory
    testDir = join(
      tmpdir(),
      `memory-service-test-${Date.now()}-${Math.random().toString(36).substring(7)}`
    );
    await fs.mkdir(testDir, { recursive: true });

    // Mock ProviderManager
    mockProviderManager = {
      chat: vi.fn(),
    } as any;
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
  });

  describe('initialization', () => {
    it('should initialize without ArcadeDB', async () => {
      service = new MemoryService(testDir);

      const result = await service.initialize();

      expect(result.success).toBe(true);
    });

    it('should initialize with ArcadeDB successfully', async () => {
      // Mock successful connection
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: [{ test: 1 }] }),
      });

      service = new MemoryService(
        testDir,
        'http://localhost:2480/testdb',
        mockProviderManager
      );

      const result = await service.initialize();

      expect(result.success).toBe(true);
      expect(mockFetch).toHaveBeenCalled();
    });

    it('should gracefully handle ArcadeDB connection failure', async () => {
      // Mock connection failure
      mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      service = new MemoryService(testDir, 'http://localhost:2480/testdb');

      const result = await service.initialize();

      expect(result.success).toBe(true); // Still succeeds
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('ArcadeDB unavailable')
      );

      consoleWarnSpy.mockRestore();
    });
  });

  describe('short-term memory - storeMessage', () => {
    beforeEach(async () => {
      service = new MemoryService(testDir);
      await service.initialize();
    });

    it('should store message in conversation file', async () => {
      const message: ConversationMessage = {
        role: 'user',
        content: 'Hello!',
        timestamp: Date.now(),
      };

      const result = await service.storeMessage('user1', 'channel1', message);

      expect(result.success).toBe(true);

      // Verify file was created
      const content = await fs.readFile(
        join(testDir, 'user1/channel1.json'),
        'utf-8'
      );
      const messages = JSON.parse(content);
      expect(messages).toHaveLength(1);
      expect(messages[0]).toMatchObject(message);
    });

    it('should append multiple messages', async () => {
      const messages: ConversationMessage[] = [
        { role: 'user', content: 'Message 1', timestamp: Date.now() },
        { role: 'assistant', content: 'Message 2', timestamp: Date.now() },
        { role: 'user', content: 'Message 3', timestamp: Date.now() },
      ];

      for (const msg of messages) {
        await service.storeMessage('user1', 'channel1', msg);
      }

      // Verify all messages stored
      const content = await fs.readFile(
        join(testDir, 'user1/channel1.json'),
        'utf-8'
      );
      const stored = JSON.parse(content);
      expect(stored).toHaveLength(3);
    });

    it('should reject invalid message without role', async () => {
      const invalidMessage = {
        content: 'Hello',
        timestamp: Date.now(),
      } as any;

      const result = await service.storeMessage('user1', 'channel1', invalidMessage);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('VALIDATION_ERROR');
      }
    });

    it('should reject invalid message without content', async () => {
      const invalidMessage = {
        role: 'user',
        timestamp: Date.now(),
      } as any;

      const result = await service.storeMessage('user1', 'channel1', invalidMessage);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('VALIDATION_ERROR');
      }
    });
  });

  describe('short-term memory - retrieveContext', () => {
    beforeEach(async () => {
      service = new MemoryService(testDir);
      await service.initialize();
    });

    it('should retrieve stored messages', async () => {
      const messages: ConversationMessage[] = [
        { role: 'user', content: 'Message 1', timestamp: 1000 },
        { role: 'assistant', content: 'Message 2', timestamp: 2000 },
        { role: 'user', content: 'Message 3', timestamp: 3000 },
      ];

      for (const msg of messages) {
        await service.storeMessage('user1', 'channel1', msg);
      }

      const result = await service.retrieveContext('user1', 'channel1');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toHaveLength(3);
        expect(result.data).toEqual(messages);
      }
    });

    it('should return empty array for non-existent conversation', async () => {
      const result = await service.retrieveContext('user1', 'nonexistent');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual([]);
      }
    });

    it('should respect limit parameter', async () => {
      const messages: ConversationMessage[] = Array.from({ length: 30 }, (_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `Message ${i + 1}`,
        timestamp: 1000 * (i + 1),
      }));

      for (const msg of messages) {
        await service.storeMessage('user1', 'channel1', msg);
      }

      const result = await service.retrieveContext('user1', 'channel1', 10);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toHaveLength(10);
        // Should be last 10 messages
        expect(result.data[0].content).toBe('Message 21');
        expect(result.data[9].content).toBe('Message 30');
      }
    });
  });

  describe('private memory - preferences', () => {
    beforeEach(async () => {
      service = new MemoryService(testDir);
      await service.initialize();
    });

    it('should store and retrieve preference', async () => {
      const storeResult = await service.storePreference('user1', 'theme', 'dark');

      expect(storeResult.success).toBe(true);

      const getResult = await service.getPreference('user1', 'theme');

      expect(getResult.success).toBe(true);
      if (getResult.success) {
        expect(getResult.data).toBe('dark');
      }
    });

    it('should update existing preference', async () => {
      await service.storePreference('user1', 'theme', 'light');
      await service.storePreference('user1', 'theme', 'dark');

      const result = await service.getPreference('user1', 'theme');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe('dark');
      }
    });

    it('should store multiple preferences', async () => {
      await service.storePreference('user1', 'theme', 'dark');
      await service.storePreference('user1', 'language', 'en');
      await service.storePreference('user1', 'notifications', true);

      const themeResult = await service.getPreference('user1', 'theme');
      const langResult = await service.getPreference('user1', 'language');
      const notifResult = await service.getPreference('user1', 'notifications');

      expect(themeResult.success && themeResult.data).toBe('dark');
      expect(langResult.success && langResult.data).toBe('en');
      expect(notifResult.success && notifResult.data).toBe(true);
    });

    it('should return null for non-existent preference', async () => {
      const result = await service.getPreference('user1', 'nonexistent');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBeNull();
      }
    });

    it('should handle complex preference values', async () => {
      const complexValue = {
        nested: { field: 'value' },
        array: [1, 2, 3],
        boolean: true,
      };

      await service.storePreference('user1', 'complex', complexValue);

      const result = await service.getPreference('user1', 'complex');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(complexValue);
      }
    });
  });

  describe('public memory - knowledge', () => {
    beforeEach(async () => {
      service = new MemoryService(testDir);
      await service.initialize();
    });

    it('should store and retrieve knowledge entry', async () => {
      const entry: KnowledgeEntry = {
        id: 'entry1',
        topic: 'TypeScript',
        content: 'TypeScript is a typed superset of JavaScript',
        tags: ['programming', 'typescript'],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const storeResult = await service.storeKnowledge(entry);

      expect(storeResult.success).toBe(true);

      const getResult = await service.getKnowledge('entry1');

      expect(getResult.success).toBe(true);
      if (getResult.success) {
        expect(getResult.data).toMatchObject({
          id: 'entry1',
          topic: 'TypeScript',
          content: entry.content,
        });
      }
    });

    it('should update existing knowledge entry', async () => {
      const entry1: KnowledgeEntry = {
        id: 'entry1',
        topic: 'TypeScript',
        content: 'Old content',
        tags: ['programming'],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const entry2: KnowledgeEntry = {
        ...entry1,
        content: 'New content',
      };

      await service.storeKnowledge(entry1);
      await service.storeKnowledge(entry2);

      const result = await service.getKnowledge('entry1');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data?.content).toBe('New content');
      }
    });

    it('should return null for non-existent knowledge', async () => {
      const result = await service.getKnowledge('nonexistent');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBeNull();
      }
    });
  });

  describe('archival mechanism', () => {
    beforeEach(async () => {
      // Mock successful ArcadeDB connection
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: [{ test: 1 }] }),
      });

      // Mock ProviderManager summarization
      (mockProviderManager.chat as any).mockResolvedValue(
        ok('This is a summary of the conversation')
      );

      service = new MemoryService(
        testDir,
        'http://localhost:2480/testdb',
        mockProviderManager
      );
      await service.initialize();
      mockFetch.mockClear();
    });

    it('should trigger archival when threshold exceeded', async () => {
      // Mock createVertex for archival
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: [{ '@rid': '#10:0' }] }),
      });

      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      // Store 20 messages to trigger archival
      for (let i = 0; i < 20; i++) {
        const message: ConversationMessage = {
          role: i % 2 === 0 ? 'user' : 'assistant',
          content: `Message ${i + 1}`,
          timestamp: Date.now() + i,
        };
        await service.storeMessage('user1', 'channel1', message);
      }

      // Verify archival was triggered
      expect(mockProviderManager.chat).toHaveBeenCalled();
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/query/'),
        expect.objectContaining({
          method: 'POST',
        })
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Archived conversation')
      );

      // Verify trimming - should keep last 10 messages
      const result = await service.retrieveContext('user1', 'channel1');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.length).toBeLessThanOrEqual(10);
      }

      consoleLogSpy.mockRestore();
    });

    it('should not archive if database unavailable', async () => {
      // Create service without database
      const serviceWithoutDb = new MemoryService(testDir);
      await serviceWithoutDb.initialize();

      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      // Store 20 messages
      for (let i = 0; i < 20; i++) {
        const message: ConversationMessage = {
          role: i % 2 === 0 ? 'user' : 'assistant',
          content: `Message ${i + 1}`,
          timestamp: Date.now() + i,
        };
        await serviceWithoutDb.storeMessage('user1', 'channel1', message);
      }

      // Verify warning was logged
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Cannot archive conversation')
      );

      // Messages should still be stored
      const result = await serviceWithoutDb.retrieveContext('user1', 'channel1');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toHaveLength(20);
      }

      consoleWarnSpy.mockRestore();
      await serviceWithoutDb.dispose();
    });

    it('should handle summarization without provider manager', async () => {
      // Mock createVertex for archival
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: [{ '@rid': '#10:0' }] }),
      });

      // Create service without provider manager
      const serviceWithoutProvider = new MemoryService(
        testDir,
        'http://localhost:2480/testdb'
      );

      // Mock connection
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: [{ test: 1 }] }),
      });

      await serviceWithoutProvider.initialize();
      mockFetch.mockClear();

      // Mock archival
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: [{ '@rid': '#10:0' }] }),
      });

      // Store 20 messages
      for (let i = 0; i < 20; i++) {
        const message: ConversationMessage = {
          role: i % 2 === 0 ? 'user' : 'assistant',
          content: `Message ${i + 1}`,
          timestamp: Date.now() + i,
        };
        await serviceWithoutProvider.storeMessage('user1', 'channel1', message);
      }

      // Should still archive with default summary
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/query/'),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('CREATE VERTEX ArchivedConversation'),
        })
      );

      await serviceWithoutProvider.dispose();
    });
  });

  describe('long-term search', () => {
    beforeEach(async () => {
      // Mock successful connection
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: [{ test: 1 }] }),
      });

      service = new MemoryService(testDir, 'http://localhost:2480/testdb');
      await service.initialize();
      mockFetch.mockClear();
    });

    it('should search archived conversations', async () => {
      // Mock search query result
      const mockArchive = {
        c: {
          userId: 'user1',
          channelId: 'channel1',
          summary: 'Discussion about TypeScript features',
          messageCount: 20,
          startTime: 1000,
          endTime: 2000,
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: [mockArchive] }),
      });

      const result = await service.searchLongTerm('user1', 'TypeScript');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toHaveLength(1);
        expect(result.data[0].summary).toContain('TypeScript');
      }

      // Verify Cypher query
      const fetchCall = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchCall[1].body);
      expect(body.language).toBe('cypher');
      expect(body.command).toContain('MATCH (c:ArchivedConversation)');
      expect(body.params.userId).toBe('user1');
      expect(body.params.searchTerm).toBe('TypeScript');
    });

    it('should return error if database unavailable', async () => {
      const serviceWithoutDb = new MemoryService(testDir);
      await serviceWithoutDb.initialize();

      const result = await serviceWithoutDb.searchLongTerm('user1', 'test');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('DATABASE_ERROR');
      }

      await serviceWithoutDb.dispose();
    });

    it('should respect limit parameter', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: [] }),
      });

      await service.searchLongTerm('user1', 'test', 5);

      const fetchCall = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchCall[1].body);
      expect(body.params.limit).toBe(5);
    });
  });

  describe('dispose', () => {
    it('should disconnect from database', async () => {
      // Mock connection
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: [{ test: 1 }] }),
      });

      service = new MemoryService(testDir, 'http://localhost:2480/testdb');
      await service.initialize();

      const result = await service.dispose();

      expect(result.success).toBe(true);
    });

    it('should succeed even without database', async () => {
      service = new MemoryService(testDir);
      await service.initialize();

      const result = await service.dispose();

      expect(result.success).toBe(true);
    });
  });
});
