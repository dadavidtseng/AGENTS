/**
 * Memory Service - Hybrid Storage Orchestration
 *
 * Orchestrates hybrid memory system:
 * - Short-term: Conversation context in JSON files (FileStorageAdapter)
 * - Long-term: KĀDI memory tools via broker (memory-store, memory-recall, memory-relate)
 * - Private: User preferences in JSON files
 * - Public: Shared knowledge base in JSON files
 *
 * Features:
 * - Automatic archival when conversation exceeds 20 messages
 * - LLM-based summarization before archival
 * - Graceful degradation if KĀDI memory tools unavailable
 */

import type { Result } from '../common/result.js';
import { ok, err } from '../common/result.js';

import { FileStorageAdapter } from './file-storage-adapter.js';
import type { ProviderManager } from '../providers/provider-manager.js';

// KadiClient type — import only the type to avoid hard dependency
import type { KadiClient } from '@kadi.build/core';

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
 * Extracted entity from task context (topics, tools, patterns, technologies)
 */
export interface ExtractedEntity {
  name: string;
  type: 'topic' | 'tool' | 'pattern' | 'technology' | 'agent' | 'error';
  confidence: number;
}

/**
 * Task memory entry stored after task completion
 */
export interface TaskMemory {
  taskId: string;
  questId: string;
  agentId: string;
  agentRole: string;
  taskType: string;
  description: string;
  outcome: 'success' | 'failure';
  context: string;
  result: string;
  entities: ExtractedEntity[];
  duration: number;
  timestamp: number;
}

/**
 * Feedback stored on task approval/rejection
 */
export interface TaskFeedback {
  taskId: string;
  questId: string;
  agentId: string;
  approved: boolean;
  score: number;
  reason: string;
  timestamp: number;
}

/**
 * Relevant memory recalled for context injection
 */
export interface RelevantMemory {
  type: 'task' | 'feedback';
  taskId: string;
  summary: string;
  relevanceScore: number;
  entities: ExtractedEntity[];
  timestamp: number;
}

/**
 * Format recalled memories into a concise text block for LLM prompt injection.
 *
 * Groups by type (task memories first, then feedback), truncates each entry
 * to 200 chars, and caps the total output at `maxChars`.
 *
 * @param memories - Array of recalled memories from MemoryService.recallRelevant()
 * @param maxChars - Maximum total characters for the formatted output (default 2000)
 * @returns Formatted string, or empty string if no memories
 */
export function formatMemoryContext(memories: RelevantMemory[], maxChars: number = 2000): string {
  if (!memories || memories.length === 0) return '';

  // Group by type: task memories first, then feedback
  const taskMemories = memories.filter(m => m.type === 'task');
  const feedbackMemories = memories.filter(m => m.type === 'feedback');
  const ordered = [...taskMemories, ...feedbackMemories];

  const lines: string[] = [];
  let totalLength = 0;

  for (const mem of ordered) {
    const label = mem.type === 'task' ? 'TASK' : 'FEEDBACK';
    const relevance = Math.round(mem.relevanceScore * 100);
    const summary = mem.summary.length > 200
      ? mem.summary.slice(0, 197) + '...'
      : mem.summary;
    const line = `- [${label}] (relevance: ${relevance}%) ${summary}`;

    if (totalLength + line.length + 1 > maxChars) break;
    lines.push(line);
    totalLength += line.length + 1; // +1 for newline
  }

  return lines.join('\n');
}

/**
 * Memory Service
 *
 * Manages hybrid memory storage:
 * - File storage for short-term context (always available)
 * - KĀDI memory tools via broker for long-term graph memory (optional)
 *
 * When a KadiClient is provided, the service uses `invokeRemote` to call
 * ability-memory tools (memory-store, memory-recall, memory-relate) through
 * the broker. This replaces the previous direct ArcadeDB connection.
 */
export class MemoryService {
  private fileStorage: FileStorageAdapter;
  private kadiClient: KadiClient | null = null;
  private kadiAvailable: boolean = false;
  private readonly archiveThreshold: number = 20;
  private readonly agentId: string;

  /**
   * Create Memory Service
   *
   * @param memoryDataPath - Base directory for file storage
   * @param kadiClient - KadiClient for invoking KĀDI memory tools (optional)
   * @param providerManager - LLM provider for summarization (optional)
   * @param agentId - Agent identifier for memory scoping (optional, defaults to 'unknown')
   */
  constructor(
    memoryDataPath: string,
    kadiClient?: KadiClient,
    private readonly providerManager?: ProviderManager,
    agentId?: string,
  ) {
    this.fileStorage = new FileStorageAdapter(memoryDataPath);
    this.kadiClient = kadiClient ?? null;
    this.agentId = agentId ?? 'unknown';
  }

  /**
   * Initialize memory service
   *
   * Probes KĀDI memory tools with a lightweight memory-recall call.
   * If the probe fails (ability-memory not running, broker down, etc.),
   * the service falls back to file storage only.
   *
   * @returns Result indicating initialization success
   */
  async initialize(): Promise<Result<void, MemoryError>> {
    if (this.kadiClient) {
      try {
        // Lightweight probe: recall with an empty query, limit 1, 5s timeout
        await this.kadiClient.invokeRemote('memory-recall', {
          query: '__probe__',
          limit: 1,
          agent: this.agentId,
        }, { timeout: 5000 });

        this.kadiAvailable = true;
        console.log('[MemoryService] KADI memory tools available');
      } catch (error: any) {
        console.warn(
          `[MemoryService] KADI memory tools unavailable: ${error.message || String(error)}. ` +
          'Continuing with file storage only.'
        );
        this.kadiAvailable = false;
      }
    } else {
      console.log('[MemoryService] KadiClient not configured, using file storage only');
    }

    return ok(undefined);
  }

  /**
   * Check if KĀDI memory tools are available
   */
  isKadiAvailable(): boolean {
    return this.kadiAvailable;
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
   * Summarizes conversation using LLM and stores via KĀDI memory-store.
   * Trims short-term storage to keep only recent messages.
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
    // Skip if KĀDI unavailable
    if (!this.kadiAvailable || !this.kadiClient) {
      console.warn(
        `[MemoryService] Cannot archive conversation for ${userId}/${channelId}: ` +
        'KADI memory tools unavailable'
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

    // Store via KĀDI memory-store (fire-and-forget)
    try {
      await this.kadiClient.invokeRemote('memory-store', {
        content: `[archived-conversation] ${summary}\n\nUser: ${userId}, Channel: ${channelId}\nMessages: ${messages.length}\nPeriod: ${new Date(messages[0].timestamp).toISOString()} - ${new Date(messages[messages.length - 1].timestamp).toISOString()}`,
        topics: ['archived-conversation'],
        entities: [
          { name: userId, type: 'person' },
          { name: channelId, type: 'concept' },
        ],
        metadata: {
          userId,
          channelId,
          messageCount: messages.length,
          startTime: messages[0].timestamp,
          endTime: messages[messages.length - 1].timestamp,
        },
        agent: this.agentId,
        skipExtraction: true,
      }, { timeout: 10000 });

      console.log(
        `[MemoryService] Archived conversation ${userId}/${channelId} ` +
        `(${messages.length} messages) via KADI memory-store`
      );
    } catch (error: any) {
      console.error(
        `[MemoryService] Failed to archive conversation: ${error.message || String(error)}`
      );
      return;
    }

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
   * Queries KĀDI memory-recall for archived conversations matching criteria
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
    if (!this.kadiAvailable || !this.kadiClient) {
      return err({
        type: 'DATABASE_ERROR',
        message: 'Long-term storage unavailable',
      });
    }

    try {
      const result = await this.kadiClient.invokeRemote<any>('memory-recall', {
        query: `${searchTerm} user:${userId}`,
        mode: 'hybrid',
        topics: ['archived-conversation'],
        limit,
        agent: this.agentId,
      }, { timeout: 10000 });

      // Map memory-recall results to ArchivedSummary format
      const results = result?.results || result?.content?.[0]?.text
        ? JSON.parse(result.content[0].text).results || []
        : [];

      const summaries: ArchivedSummary[] = results.map((r: any) => ({
        userId: r.metadata?.userId || userId,
        channelId: r.metadata?.channelId || 'unknown',
        summary: r.content || r.summary || '',
        messageCount: r.metadata?.messageCount || 0,
        startTime: r.metadata?.startTime || 0,
        endTime: r.metadata?.endTime || 0,
      }));

      return ok(summaries);
    } catch (error: any) {
      return err({
        type: 'DATABASE_ERROR',
        message: `Search failed: ${error.message || String(error)}`,
        originalError: error,
      });
    }
  }

  /**
   * Store task memory after task completion
   *
   * Saves task context and outcome to both file storage (short-term) and
   * KĀDI memory-store (long-term graph). Fire-and-forget for KĀDI call.
   *
   * @param memory - Task memory entry
   * @returns Result indicating success or error
   */
  async storeTaskMemory(memory: TaskMemory): Promise<Result<void, MemoryError>> {
    // Validate required fields
    if (!memory.taskId || !memory.questId || !memory.agentId) {
      return err({
        type: 'VALIDATION_ERROR',
        message: 'TaskMemory must have taskId, questId, and agentId',
      });
    }

    // Store in file storage (always available)
    const taskMemoryPath = `tasks/${memory.questId}/${memory.taskId}.json`;
    const writeResult = await this.fileStorage.writeJSON(taskMemoryPath, memory);

    if (!writeResult.success) {
      return err({
        type: 'FILE_ERROR',
        message: `Failed to store task memory: ${writeResult.error.message}`,
        originalError: writeResult.error,
      });
    }

    console.log(`[MemoryService] Stored task memory to file for ${memory.taskId} (quest: ${memory.questId})`);

    // Append to task index for fast lookup
    const indexPath = `tasks/${memory.questId}/index.json`;
    const indexEntry = {
      taskId: memory.taskId,
      agentId: memory.agentId,
      agentRole: memory.agentRole,
      taskType: memory.taskType,
      outcome: memory.outcome,
      timestamp: memory.timestamp,
    };
    await this.fileStorage.appendToJSONArray(indexPath, indexEntry);

    // Store via KĀDI memory-store if available (fire-and-forget)
    if (this.kadiAvailable && this.kadiClient) {
      console.log(`[MemoryService] Sending task memory to KADI for ${memory.taskId}...`);
      this.kadiClient.invokeRemote('memory-store', {
        content: `[${memory.outcome}] ${memory.description}\n\nContext: ${memory.context}\n\nResult: ${memory.result}`,
        topics: [memory.taskType, memory.agentRole],
        entities: memory.entities.map(e => ({ name: e.name, type: e.type })),
        metadata: {
          taskId: memory.taskId,
          questId: memory.questId,
          agentId: memory.agentId,
          agentRole: memory.agentRole,
          taskType: memory.taskType,
          outcome: memory.outcome,
          duration: memory.duration,
        },
        conversationId: memory.questId,
        agent: this.agentId,
        skipExtraction: true,
      }, { timeout: 10000 }).then((result: any) => {
        const parsed = result?.content?.[0]?.text ? JSON.parse(result.content[0].text) : result;
        if (parsed?.stored === false) {
          console.warn(`[MemoryService] KADI memory-store returned error for ${memory.taskId}: ${parsed.error}`);
        } else {
          console.log(`[MemoryService] Stored task memory via KADI for ${memory.taskId} (rid: ${parsed?.rid || 'unknown'})`);
        }
      }).catch((error: any) => {
        console.warn(
          `[MemoryService] Failed to store task memory via KADI for ${memory.taskId}: ${error.message || String(error)}`
        );
      });
    } else {
      console.log(`[MemoryService] KADI unavailable, task memory stored to file only for ${memory.taskId}`);
    }

    return ok(undefined);
  }

  /**
   * Store feedback on task approval/rejection
   *
   * Records approval/rejection feedback for learning and quality improvement.
   * Links feedback to the original task memory via memory-relate.
   *
   * @param feedback - Task feedback entry
   * @returns Result indicating success or error
   */
  async storeFeedback(feedback: TaskFeedback): Promise<Result<void, MemoryError>> {
    // Validate required fields
    if (!feedback.taskId || !feedback.questId) {
      return err({
        type: 'VALIDATION_ERROR',
        message: 'TaskFeedback must have taskId and questId',
      });
    }

    // Store in file storage
    const feedbackPath = `feedback/${feedback.questId}/${feedback.taskId}.json`;
    const writeResult = await this.fileStorage.writeJSON(feedbackPath, feedback);

    if (!writeResult.success) {
      return err({
        type: 'FILE_ERROR',
        message: `Failed to store feedback: ${writeResult.error.message}`,
        originalError: writeResult.error,
      });
    }

    console.log(`[MemoryService] Stored feedback to file for ${feedback.taskId} (approved: ${feedback.approved})`);

    // Store via KĀDI and link to task memory if available (fire-and-forget)
    if (this.kadiAvailable && this.kadiClient) {
      console.log(`[MemoryService] Sending feedback to KADI for ${feedback.taskId}...`);
      const client = this.kadiClient;

      (async () => {
        try {
          // Store feedback as memory
          const feedbackResult = await client.invokeRemote<any>('memory-store', {
            content: `[feedback] Task ${feedback.taskId}: ${feedback.approved ? 'approved' : 'rejected'} (score: ${feedback.score})\nReason: ${feedback.reason}`,
            topics: ['task-feedback'],
            entities: [
              { name: feedback.agentId, type: 'concept' },
              { name: feedback.taskId, type: 'concept' },
            ],
            metadata: {
              taskId: feedback.taskId,
              questId: feedback.questId,
              agentId: feedback.agentId,
              approved: feedback.approved,
              score: feedback.score,
            },
            conversationId: feedback.questId,
            agent: this.agentId,
            skipExtraction: true,
          }, { timeout: 10000 });

          // Try to find the original task memory and link to it
          // Use agent: '*' because the task was likely stored by a different agent
          const taskRecall = await client.invokeRemote<any>('memory-recall', {
            query: `task ${feedback.taskId}`,
            mode: 'keyword',
            limit: 1,
            agent: '*',
          }, { timeout: 5000 });

          // Extract RIDs and relate if both exist
          const feedbackRid = feedbackResult?.rid || feedbackResult?.content?.[0]?.text;
          const taskResults = taskRecall?.results || [];
          const taskRid = taskResults[0]?.rid;

          if (feedbackRid && taskRid) {
            await client.invokeRemote('memory-relate', {
              fromRid: taskRid,
              toRid: feedbackRid,
              relationship: 'has_feedback',
              weight: feedback.score / 100,
            }, { timeout: 5000 });
          }

          console.log(`[MemoryService] Stored feedback via KADI for ${feedback.taskId} (approved: ${feedback.approved})`);
        } catch (error: any) {
          console.warn(
            `[MemoryService] Failed to store feedback via KADI for ${feedback.taskId}: ${error.message || String(error)}`
          );
        }
      })();
    } else {
      console.log(`[MemoryService] KADI unavailable, feedback stored to file only for ${feedback.taskId}`);
    }

    return ok(undefined);
  }

  /**
   * Recall relevant memories for a given task context
   *
   * Uses KĀDI memory-recall with hybrid search when available,
   * falls back to file-based keyword matching.
   *
   * @param taskType - Type of the new task
   * @param description - Description of the new task (used for semantic search)
   * @param agentRole - Role of the agent (optional, for filtering)
   * @param limit - Maximum memories to return (default: 5)
   * @param crossAgentIds - Agent IDs for cross-agent recall (optional).
   *   Pass ['*'] for all agents, or ['agent-worker', 'agent-qa'] for specific agents.
   *   Default (undefined) uses only this agent's own memories.
   * @returns Result with relevant memories or error
   */
  async recallRelevant(
    taskType: string,
    description: string,
    agentRole?: string,
    limit: number = 5,
    crossAgentIds?: string[],
  ): Promise<Result<RelevantMemory[], MemoryError>> {
    const memories: RelevantMemory[] = [];

    // Strategy 1: KĀDI memory-recall (preferred — semantic + graph search)
    if (this.kadiAvailable && this.kadiClient) {
      try {
        const topics = [taskType];
        if (agentRole) topics.push(agentRole);

        console.log(`[MemoryService] Recalling memories for "${taskType}" (topics: ${topics.join(', ')})...`);

        // Determine agent filter for cross-agent recall
        let agentParam: string | string[] = this.agentId;
        if (crossAgentIds) {
          if (crossAgentIds.includes('*')) {
            agentParam = '*';
          } else {
            agentParam = [this.agentId, ...crossAgentIds];
          }
        }

        const result = await this.kadiClient.invokeRemote<any>('memory-recall', {
          query: description,
          mode: 'hybrid',
          topics,
          limit: limit * 2, // Fetch extra for filtering
          agent: agentParam,
        }, { timeout: 10000 });

        // Parse results — handle both structured and text content responses
        let results: any[] = [];
        if (result?.results) {
          results = result.results;
        } else if (result?.content?.[0]?.text) {
          try {
            const parsed = JSON.parse(result.content[0].text);
            results = parsed.results || [];
          } catch {
            // Not JSON, skip
          }
        }

        console.log(`[MemoryService] KADI recall returned ${results.length} result(s) for "${taskType}"`);

        for (const r of results) {
          const content = r.content || r.summary || '';
          const metadata = r.metadata || {};

          // Determine type from content prefix or metadata
          const type: 'task' | 'feedback' = content.startsWith('[feedback]') ? 'feedback' : 'task';

          memories.push({
            type,
            taskId: metadata.taskId || 'unknown',
            summary: content,
            relevanceScore: r.score ?? r.importance ?? 0.5,
            entities: (r.entities || []).map((e: any) => ({
              name: e.name,
              type: e.type || 'topic',
              confidence: e.confidence ?? 1.0,
            })),
            timestamp: r.timestamp ? new Date(r.timestamp).getTime() : Date.now(),
          });
        }
      } catch (error: any) {
        console.warn(
          `[MemoryService] KADI recall failed, falling back to file storage: ${error.message || String(error)}`
        );
      }
    } else {
      console.log(`[MemoryService] KADI unavailable, using file-only recall for "${taskType}"`);
    }

    // Strategy 2: File-based recall (fallback or supplement)
    if (memories.length < limit) {
      try {
        // Scan task index files for matching task types
        const questDirs = await this.fileStorage.listFiles('tasks');
        if (questDirs.success && questDirs.data) {
          for (const questDir of questDirs.data) {
            const indexPath = `tasks/${questDir}/index.json`;
            const indexResult = await this.fileStorage.readJSON<any[]>(indexPath);

            if (!indexResult.success || !indexResult.data) continue;

            for (const entry of indexResult.data) {
              // Filter by taskType or agentRole
              if (entry.taskType !== taskType && (!agentRole || entry.agentRole !== agentRole)) {
                continue;
              }

              // Skip if already found from KĀDI
              if (memories.some(m => m.taskId === entry.taskId)) continue;

              // Read full task memory
              const taskPath = `tasks/${questDir}/${entry.taskId}.json`;
              const taskResult = await this.fileStorage.readJSON<TaskMemory>(taskPath);

              if (!taskResult.success || !taskResult.data) continue;

              const task = taskResult.data;
              let relevanceScore = 0.4; // File-based gets slightly lower base score
              if (task.taskType === taskType) relevanceScore += 0.3;
              if (agentRole && task.agentRole === agentRole) relevanceScore += 0.1;
              if (task.outcome === 'success') relevanceScore += 0.1;

              memories.push({
                type: 'task',
                taskId: task.taskId,
                summary: `[${task.outcome}] ${task.description}`,
                relevanceScore: Math.min(relevanceScore, 1.0),
                entities: task.entities || [],
                timestamp: task.timestamp,
              });
            }
          }
        }
      } catch (error) {
        console.warn(`[MemoryService] File-based recall failed: ${error}`);
      }
    }

    // Sort by relevance and limit
    memories.sort((a, b) => b.relevanceScore - a.relevanceScore);
    return ok(memories.slice(0, limit));
  }

  /**
   * Dispose of memory service
   *
   * Marks KĀDI as unavailable and performs cleanup.
   * No persistent connection to close (broker manages connection lifecycle).
   *
   * @returns Result indicating success or error
   */
  async dispose(): Promise<Result<void, MemoryError>> {
    this.kadiAvailable = false;
    this.kadiClient = null;
    return ok(undefined);
  }
}
