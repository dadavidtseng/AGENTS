/**
 * Memory Service - Hybrid Storage Orchestration
 *
 * Orchestrates hybrid memory system:
 * - Short-term: Conversation context in JSON files (FileStorageAdapter)
 * - Long-term: Summarized history in ArcadeDB (ArcadeDBAdapter)
 * - Private: User preferences in JSON files
 * - Public: Shared knowledge base in JSON files
 *
 * Features:
 * - Automatic archival when conversation exceeds 20 messages
 * - LLM-based summarization before archival
 * - Graceful degradation if ArcadeDB unavailable
 */

import type { Result } from '../common/result.js';
import { ok, err } from '../common/result.js';
import type { FileError, DatabaseError } from '../common/types.js';
import { FileErrorType, DatabaseErrorType } from '../common/types.js';
import { FileStorageAdapter } from './file-storage-adapter.js';
import { ArcadeDBAdapter } from './arcadedb-adapter.js';
import type { ProviderManager } from '../providers/provider-manager.js';

/**
 * Message in conversation history
 */
export interface ConversationMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
}

/**
 * Conversation context with metadata
 */
export interface ConversationContext {
  userId: string;
  channelId: string;
  messages: ConversationMessage[];
  lastUpdated: number;
}

/**
 * User preference storage
 */
export interface UserPreference {
  key: string;
  value: any;
  updatedAt: number;
}

/**
 * Knowledge base entry
 */
export interface KnowledgeEntry {
  id: string;
  topic: string;
  content: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

/**
 * Archived conversation summary
 */
export interface ArchivedSummary {
  userId: string;
  channelId: string;
  summary: string;
  messageCount: number;
  startTime: number;
  endTime: number;
}

/**
 * Memory Service Error
 */
export interface MemoryError {
  type: 'FILE_ERROR' | 'DATABASE_ERROR' | 'PROVIDER_ERROR' | 'VALIDATION_ERROR';
  message: string;
  originalError?: unknown;
}

/**
 * Memory Service
 *
 * Manages hybrid memory storage with automatic archival and graceful degradation
 */
export class MemoryService {
  private fileStorage: FileStorageAdapter;
  private dbAdapter: ArcadeDBAdapter | null = null;
  private isDbAvailable: boolean = false;
  private readonly archiveThreshold: number = 20;

  /**
   * Create Memory Service
   *
   * @param memoryDataPath - Base directory for file storage
   * @param arcadedbUrl - ArcadeDB connection URL (optional)
   * @param providerManager - LLM provider for summarization (optional)
   */
  constructor(
    private readonly memoryDataPath: string,
    private readonly arcadedbUrl?: string,
    private readonly providerManager?: ProviderManager
  ) {
    this.fileStorage = new FileStorageAdapter(memoryDataPath);

    if (arcadedbUrl) {
      this.dbAdapter = new ArcadeDBAdapter(arcadedbUrl);
    }
  }

  /**
   * Initialize memory service
   *
   * Attempts to connect to ArcadeDB, logs warning if unavailable but continues
   *
   * @returns Result indicating initialization success
   */
  async initialize(): Promise<Result<void, MemoryError>> {
    if (this.dbAdapter) {
      const result = await this.dbAdapter.connect();

      if (!result.success) {
        console.warn(
          `[MemoryService] ArcadeDB unavailable: ${result.error.message}. ` +
          'Continuing with short-term storage only.'
        );
        this.isDbAvailable = false;
      } else {
        this.isDbAvailable = true;
        console.log('[MemoryService] ArcadeDB connected successfully');
      }
    } else {
      console.log('[MemoryService] ArcadeDB not configured, using file storage only');
    }

    return ok(undefined);
  }

  /**
   * Store message in conversation history
   *
   * Appends message to short-term storage and checks if archival is needed
   *
   * @param userId - User identifier
   * @param channelId - Channel/conversation identifier
   * @param message - Message to store
   * @returns Result indicating success or error
   */
  async storeMessage(
    userId: string,
    channelId: string,
    message: ConversationMessage
  ): Promise<Result<void, MemoryError>> {
    // Validate message
    if (!message.role || !message.content) {
      return err({
        type: 'VALIDATION_ERROR',
        message: 'Message must have role and content',
      });
    }

    // Append to conversation file
    const conversationPath = `${userId}/${channelId}.json`;
    const result = await this.fileStorage.appendToJSONArray(conversationPath, message);

    if (!result.success) {
      return err({
        type: 'FILE_ERROR',
        message: `Failed to store message: ${result.error.message}`,
        originalError: result.error,
      });
    }

    // Check if archival is needed
    await this.checkArchiveThreshold(userId, channelId);

    return ok(undefined);
  }

  /**
   * Retrieve conversation context
   *
   * Reads recent messages from short-term storage
   *
   * @param userId - User identifier
   * @param channelId - Channel/conversation identifier
   * @param limit - Maximum number of messages to retrieve (default: 20)
   * @returns Result with conversation messages or error
   */
  async retrieveContext(
    userId: string,
    channelId: string,
    limit: number = 20
  ): Promise<Result<ConversationMessage[], MemoryError>> {
    const conversationPath = `${userId}/${channelId}.json`;
    const result = await this.fileStorage.readJSON<ConversationMessage[]>(conversationPath);

    if (!result.success) {
      return err({
        type: 'FILE_ERROR',
        message: `Failed to retrieve context: ${result.error.message}`,
        originalError: result.error,
      });
    }

    // Handle no conversation history
    if (result.data === null) {
      return ok([]);
    }

    // Return last N messages
    const messages = result.data;
    const recentMessages = messages.slice(-limit);
    return ok(recentMessages);
  }

  /**
   * Store user preference
   *
   * Saves preference to user's preference file
   *
   * @param userId - User identifier
   * @param key - Preference key
   * @param value - Preference value
   * @returns Result indicating success or error
   */
  async storePreference(
    userId: string,
    key: string,
    value: any
  ): Promise<Result<void, MemoryError>> {
    const preferencePath = `${userId}/preferences.json`;

    // Read existing preferences
    const readResult = await this.fileStorage.readJSON<Record<string, UserPreference>>(preferencePath);

    if (!readResult.success) {
      return err({
        type: 'FILE_ERROR',
        message: `Failed to read preferences: ${readResult.error.message}`,
        originalError: readResult.error,
      });
    }

    const preferences = readResult.data || {};

    // Update preference
    preferences[key] = {
      key,
      value,
      updatedAt: Date.now(),
    };

    // Write back
    const writeResult = await this.fileStorage.writeJSON(preferencePath, preferences);

    if (!writeResult.success) {
      return err({
        type: 'FILE_ERROR',
        message: `Failed to write preferences: ${writeResult.error.message}`,
        originalError: writeResult.error,
      });
    }

    return ok(undefined);
  }

  /**
   * Get user preference
   *
   * Retrieves preference value from user's preference file
   *
   * @param userId - User identifier
   * @param key - Preference key
   * @returns Result with preference value or null if not found
   */
  async getPreference(
    userId: string,
    key: string
  ): Promise<Result<any | null, MemoryError>> {
    const preferencePath = `${userId}/preferences.json`;
    const result = await this.fileStorage.readJSON<Record<string, UserPreference>>(preferencePath);

    if (!result.success) {
      return err({
        type: 'FILE_ERROR',
        message: `Failed to read preferences: ${result.error.message}`,
        originalError: result.error,
      });
    }

    if (result.data === null || !(key in result.data)) {
      return ok(null);
    }

    return ok(result.data[key].value);
  }

  /**
   * Store knowledge in public knowledge base
   *
   * Adds entry to shared knowledge base
   *
   * @param entry - Knowledge entry
   * @returns Result indicating success or error
   */
  async storeKnowledge(entry: KnowledgeEntry): Promise<Result<void, MemoryError>> {
    const knowledgePath = 'public/knowledge.json';

    // Read existing knowledge base
    const readResult = await this.fileStorage.readJSON<Record<string, KnowledgeEntry>>(knowledgePath);

    if (!readResult.success) {
      return err({
        type: 'FILE_ERROR',
        message: `Failed to read knowledge base: ${readResult.error.message}`,
        originalError: readResult.error,
      });
    }

    const knowledge = readResult.data || {};

    // Add/update entry
    knowledge[entry.id] = {
      ...entry,
      updatedAt: Date.now(),
    };

    // Write back
    const writeResult = await this.fileStorage.writeJSON(knowledgePath, knowledge);

    if (!writeResult.success) {
      return err({
        type: 'FILE_ERROR',
        message: `Failed to write knowledge base: ${writeResult.error.message}`,
        originalError: writeResult.error,
      });
    }

    return ok(undefined);
  }

  /**
   * Get knowledge from public knowledge base
   *
   * Retrieves entry by ID
   *
   * @param id - Knowledge entry ID
   * @returns Result with knowledge entry or null if not found
   */
  async getKnowledge(id: string): Promise<Result<KnowledgeEntry | null, MemoryError>> {
    const knowledgePath = 'public/knowledge.json';
    const result = await this.fileStorage.readJSON<Record<string, KnowledgeEntry>>(knowledgePath);

    if (!result.success) {
      return err({
        type: 'FILE_ERROR',
        message: `Failed to read knowledge base: ${result.error.message}`,
        originalError: result.error,
      });
    }

    if (result.data === null || !(id in result.data)) {
      return ok(null);
    }

    return ok(result.data[id]);
  }

  /**
   * Check if conversation exceeds archival threshold
   *
   * If threshold exceeded, triggers archival to long-term storage
   *
   * @param userId - User identifier
   * @param channelId - Channel identifier
   */
  private async checkArchiveThreshold(userId: string, channelId: string): Promise<void> {
    const conversationPath = `${userId}/${channelId}.json`;
    const result = await this.fileStorage.readJSON<ConversationMessage[]>(conversationPath);

    if (!result.success || result.data === null) {
      return;
    }

    const messages = result.data;

    if (messages.length >= this.archiveThreshold) {
      await this.archiveToLongTerm(userId, channelId, messages);
    }
  }

  /**
   * Archive conversation to long-term storage
   *
   * Summarizes conversation using LLM and stores in ArcadeDB
   * Trims short-term storage to keep only recent messages
   *
   * @param userId - User identifier
   * @param channelId - Channel identifier
   * @param messages - Messages to archive
   */
  private async archiveToLongTerm(
    userId: string,
    channelId: string,
    messages: ConversationMessage[]
  ): Promise<void> {
    // Skip if database unavailable
    if (!this.isDbAvailable || !this.dbAdapter) {
      console.warn(
        `[MemoryService] Cannot archive conversation for ${userId}/${channelId}: ` +
        'Database unavailable'
      );
      return;
    }

    // Generate summary using LLM
    let summary: string;

    if (this.providerManager) {
      const summaryResult = await this.summarizeConversation(messages);
      summary = summaryResult.success ? summaryResult.data : 'Summary generation failed';
    } else {
      summary = `Conversation with ${messages.length} messages`;
    }

    // Create archived summary
    const archivedSummary: ArchivedSummary = {
      userId,
      channelId,
      summary,
      messageCount: messages.length,
      startTime: messages[0].timestamp,
      endTime: messages[messages.length - 1].timestamp,
    };

    // Store in ArcadeDB as vertex
    const vertexResult = await this.dbAdapter.createVertex('ArchivedConversation', archivedSummary);

    if (!vertexResult.success) {
      console.error(
        `[MemoryService] Failed to archive conversation: ${vertexResult.error.message}`
      );
      return;
    }

    console.log(
      `[MemoryService] Archived conversation ${userId}/${channelId} ` +
      `(${messages.length} messages) with @rid ${vertexResult.data}`
    );

    // Trim short-term storage to keep last 10 messages
    const conversationPath = `${userId}/${channelId}.json`;
    await this.fileStorage.trimJSONArray(conversationPath, 10);
  }

  /**
   * Summarize conversation using LLM
   *
   * @param messages - Messages to summarize
   * @returns Result with summary text
   */
  private async summarizeConversation(
    messages: ConversationMessage[]
  ): Promise<Result<string, MemoryError>> {
    if (!this.providerManager) {
      return err({
        type: 'PROVIDER_ERROR',
        message: 'Provider manager not available for summarization',
      });
    }

    // Build conversation text
    const conversationText = messages
      .map(m => `${m.role}: ${m.content}`)
      .join('\n');

    // Generate summary
    const result = await this.providerManager.chat([
      {
        role: 'user',
        content: `Summarize the following conversation in 2-3 sentences:\n\n${conversationText}`,
      },
    ]);

    if (!result.success) {
      return err({
        type: 'PROVIDER_ERROR',
        message: `Summarization failed: ${result.error.message}`,
        originalError: result.error,
      });
    }

    return ok(result.data);
  }

  /**
   * Search long-term storage
   *
   * Queries ArcadeDB for archived conversations matching criteria
   *
   * @param userId - User identifier
   * @param searchTerm - Search term for summary content
   * @param limit - Maximum results to return (default: 10)
   * @returns Result with archived summaries or error
   */
  async searchLongTerm(
    userId: string,
    searchTerm: string,
    limit: number = 10
  ): Promise<Result<ArchivedSummary[], MemoryError>> {
    if (!this.isDbAvailable || !this.dbAdapter) {
      return err({
        type: 'DATABASE_ERROR',
        message: 'Long-term storage unavailable',
      });
    }

    // Query ArcadeDB using Cypher
    const cypher = `
      MATCH (c:ArchivedConversation)
      WHERE c.userId = $userId AND c.summary CONTAINS $searchTerm
      RETURN c
      ORDER BY c.endTime DESC
      LIMIT $limit
    `;

    const result = await this.dbAdapter.query(cypher, { userId, searchTerm, limit });

    if (!result.success) {
      return err({
        type: 'DATABASE_ERROR',
        message: `Search failed: ${result.error.message}`,
        originalError: result.error,
      });
    }

    // Extract ArchivedSummary from results
    const summaries: ArchivedSummary[] = result.data.map((row: any) => row.c);
    return ok(summaries);
  }

  /**
   * Dispose of memory service
   *
   * Disconnects from ArcadeDB and performs cleanup
   *
   * @returns Result indicating success or error
   */
  async dispose(): Promise<Result<void, MemoryError>> {
    if (this.dbAdapter && this.isDbAvailable) {
      const result = await this.dbAdapter.disconnect();

      if (!result.success) {
        return err({
          type: 'DATABASE_ERROR',
          message: `Failed to disconnect: ${result.error.message}`,
          originalError: result.error,
        });
      }

      this.isDbAvailable = false;
    }

    return ok(undefined);
  }
}
