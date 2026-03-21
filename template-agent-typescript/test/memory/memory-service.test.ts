/**
 * MemoryService Unit Tests
 *
 * Tests hybrid memory system with mocked dependencies.
 * MemoryService now uses KĀDI memory tools (memory-store, memory-recall, memory-relate)
 * via KadiClient.invokeRemote() instead of direct ArcadeDB connections.
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

/**
 * Create a mock KadiClient with invokeRemote that can be controlled per-test.
 */
function createMockKadiClient(invokeRemoteImpl?: (...args: any[]) => any) {
  return {
    invokeRemote: vi.fn(invokeRemoteImpl ?? (async () => ({ results: [] }))),
    readAgentJson: vi.fn(() => ({ name: 'test-agent', tools: [] })),
  } as any;
}

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
    it('should initialize without KadiClient', async () => {
      service = new MemoryService(testDir);

      const result = await service.initialize();

      expect(result.success).toBe(true);
      expect(service.isKadiAvailable()).toBe(false);
    });

    it('should initialize with KĀDI memory tools available', async () => {
      const mockClient = createMockKadiClient();

      service = new MemoryService(testDir, mockClient, mockProviderManager, 'test-agent');

      const result = await service.initialize();

      expect(result.success).toBe(true);
      expect(service.isKadiAvailable()).toBe(true);
      // Should have probed with memory-recall
      expect(mockClient.invokeRemote).toHaveBeenCalledWith(
        'memory-recall',
        expect.objectContaining({ query: '__probe__', limit: 1 }),
        expect.objectContaining({ timeout: 5000 }),
      );
    });

    it('should gracefully handle KĀDI tools unavailable', async () => {
      const mockClient = createMockKadiClient(async () => {
        throw new Error('Connection refused');
      });

      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      service = new MemoryService(testDir, mockClient);

      const result = await service.initialize();

      expect(result.success).toBe(true); // Still succeeds
      expect(service.isKadiAvailable()).toBe(false);
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('KADI memory tools unavailable')
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
    it('should trigger archival when threshold exceeded and KĀDI available', async () => {
      const mockClient = createMockKadiClient();

      // Mock ProviderManager summarization
      (mockProviderManager.chat as any).mockResolvedValue(
        ok('This is a summary of the conversation')
      );

      service = new MemoryService(testDir, mockClient, mockProviderManager, 'test-agent');
      await service.initialize();

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

      // Verify archival was triggered via KĀDI memory-store
      expect(mockProviderManager.chat).toHaveBeenCalled();
      expect(mockClient.invokeRemote).toHaveBeenCalledWith(
        'memory-store',
        expect.objectContaining({
          topics: ['archived-conversation'],
          agent: 'test-agent',
          skipExtraction: true,
        }),
        expect.any(Object),
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

    it('should not archive if KĀDI tools unavailable', async () => {
      // Create service without KadiClient
      const serviceWithoutKadi = new MemoryService(testDir);
      await serviceWithoutKadi.initialize();

      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      // Store 20 messages
      for (let i = 0; i < 20; i++) {
        const message: ConversationMessage = {
          role: i % 2 === 0 ? 'user' : 'assistant',
          content: `Message ${i + 1}`,
          timestamp: Date.now() + i,
        };
        await serviceWithoutKadi.storeMessage('user1', 'channel1', message);
      }

      // Verify warning was logged
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Cannot archive conversation')
      );

      // Messages should still be stored
      const result = await serviceWithoutKadi.retrieveContext('user1', 'channel1');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toHaveLength(20);
      }

      consoleWarnSpy.mockRestore();
      await serviceWithoutKadi.dispose();
    });
  });

  describe('long-term search', () => {
    it('should search via KĀDI memory-recall', async () => {
      const mockClient = createMockKadiClient(async (tool: string, params: any) => {
        if (tool === 'memory-recall' && params.query !== '__probe__') {
          return {
            results: [{
              content: '[archived-conversation] Discussion about TypeScript features',
              metadata: {
                userId: 'user1',
                channelId: 'channel1',
                messageCount: 20,
                startTime: 1000,
                endTime: 2000,
              },
              score: 0.9,
            }],
          };
        }
        return { results: [] };
      });

      service = new MemoryService(testDir, mockClient, undefined, 'test-agent');
      await service.initialize();

      const result = await service.searchLongTerm('user1', 'TypeScript');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toHaveLength(1);
        expect(result.data[0].summary).toContain('TypeScript');
      }
    });

    it('should return error if KĀDI tools unavailable', async () => {
      const serviceWithoutKadi = new MemoryService(testDir);
      await serviceWithoutKadi.initialize();

      const result = await serviceWithoutKadi.searchLongTerm('user1', 'test');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('DATABASE_ERROR');
      }

      await serviceWithoutKadi.dispose();
    });
  });

  describe('storeTaskMemory', () => {
    it('should store task memory in file and invoke KĀDI memory-store', async () => {
      const mockClient = createMockKadiClient();

      service = new MemoryService(testDir, mockClient, undefined, 'test-agent');
      await service.initialize();

      const result = await service.storeTaskMemory({
        taskId: 'task-1',
        questId: 'quest-1',
        agentId: 'agent-worker-artist',
        agentRole: 'artist',
        taskType: 'art',
        description: 'Create artwork',
        outcome: 'success',
        context: 'Art task context',
        result: 'Artwork created',
        entities: [{ name: 'artwork', type: 'topic', confidence: 0.9 }],
        duration: 5000,
        timestamp: Date.now(),
      });

      expect(result.success).toBe(true);

      // Verify file storage
      const content = await fs.readFile(
        join(testDir, 'tasks/quest-1/task-1.json'),
        'utf-8'
      );
      const stored = JSON.parse(content);
      expect(stored.taskId).toBe('task-1');

      // Verify KĀDI memory-store was called (fire-and-forget)
      // Allow async fire-and-forget to execute
      await new Promise(resolve => setTimeout(resolve, 50));
      expect(mockClient.invokeRemote).toHaveBeenCalledWith(
        'memory-store',
        expect.objectContaining({
          topics: ['art', 'artist'],
          skipExtraction: true,
          conversationId: 'quest-1',
        }),
        expect.any(Object),
      );
    });

    it('should validate required fields', async () => {
      service = new MemoryService(testDir);
      await service.initialize();

      const result = await service.storeTaskMemory({
        taskId: '',
        questId: 'quest-1',
        agentId: 'agent-1',
      } as any);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('VALIDATION_ERROR');
      }
    });
  });

  describe('recallRelevant', () => {
    it('should recall from KĀDI when available', async () => {
      const mockClient = createMockKadiClient(async (tool: string, params: any) => {
        if (tool === 'memory-recall' && params.query !== '__probe__') {
          return {
            results: [{
              content: '[success] Created artwork for task task-1',
              metadata: { taskId: 'task-1', taskType: 'art' },
              score: 0.85,
              entities: [{ name: 'artwork', type: 'topic' }],
              timestamp: new Date().toISOString(),
            }],
          };
        }
        return { results: [] };
      });

      service = new MemoryService(testDir, mockClient, undefined, 'test-agent');
      await service.initialize();

      const result = await service.recallRelevant('art', 'Create artwork', 'artist', 3);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.length).toBeGreaterThan(0);
        expect(result.data[0].summary).toContain('artwork');
      }
    });

    it('should fall back to file storage when KĀDI unavailable', async () => {
      service = new MemoryService(testDir);
      await service.initialize();

      // Pre-populate file storage with a task memory
      await service.storeTaskMemory({
        taskId: 'task-file-1',
        questId: 'quest-1',
        agentId: 'agent-1',
        agentRole: 'artist',
        taskType: 'art',
        description: 'File-based task memory',
        outcome: 'success',
        context: 'test',
        result: 'done',
        entities: [],
        duration: 1000,
        timestamp: Date.now(),
      });

      const result = await service.recallRelevant('art', 'Create artwork', 'artist', 5);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.length).toBeGreaterThan(0);
        expect(result.data[0].taskId).toBe('task-file-1');
      }
    });
  });

  describe('dispose', () => {
    it('should mark KĀDI as unavailable', async () => {
      const mockClient = createMockKadiClient();
      service = new MemoryService(testDir, mockClient, undefined, 'test-agent');
      await service.initialize();

      expect(service.isKadiAvailable()).toBe(true);

      const result = await service.dispose();

      expect(result.success).toBe(true);
      expect(service.isKadiAvailable()).toBe(false);
    });

    it('should succeed even without KadiClient', async () => {
      service = new MemoryService(testDir);
      await service.initialize();

      const result = await service.dispose();

      expect(result.success).toBe(true);
    });
  });
});
