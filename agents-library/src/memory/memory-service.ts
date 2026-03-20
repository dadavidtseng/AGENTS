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
   * @param arcadedbPassword - ArcadeDB root password (optional, defaults to 'root')
   * @param providerManager - LLM provider for summarization (optional)
   */
  constructor(
    memoryDataPath: string,
    arcadedbUrl?: string,
    arcadedbPassword?: string,
    private readonly providerManager?: ProviderManager
  ) {
    this.fileStorage = new FileStorageAdapter(memoryDataPath);

    if (arcadedbUrl) {
      this.dbAdapter = new ArcadeDBAdapter(
        arcadedbUrl,
        'root',
        arcadedbPassword || 'root'
      );
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

  /**
   * Store task memory after task completion
   *
   * Saves task context and outcome to both file storage (short-term) and
   * ArcadeDB (long-term graph). Entities are stored as vertices linked to the task.
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

    // Store in ArcadeDB if available (non-blocking for graph enrichment)
    if (this.isDbAvailable && this.dbAdapter) {
      try {
        // Create TaskMemory vertex
        const vertexResult = await this.dbAdapter.createVertex('TaskMemory', {
          taskId: memory.taskId,
          questId: memory.questId,
          agentId: memory.agentId,
          agentRole: memory.agentRole,
          taskType: memory.taskType,
          outcome: memory.outcome,
          description: memory.description,
          context: memory.context,
          result: memory.result,
          duration: memory.duration,
          timestamp: memory.timestamp,
        });

        // Store entities as vertices and link to task
        if (vertexResult.success && memory.entities.length > 0) {
          for (const entity of memory.entities) {
            const entityResult = await this.dbAdapter.createVertex('Entity', {
              name: entity.name,
              entityType: entity.type,
              confidence: entity.confidence,
            });

            if (entityResult.success) {
              await this.dbAdapter.createEdge(
                vertexResult.data,
                entityResult.data,
                'HAS_ENTITY',
                { confidence: entity.confidence }
              );
            }
          }
        }
      } catch (error) {
        // Log but don't fail — file storage is the primary record
        console.warn(
          `[MemoryService] Failed to store task memory in ArcadeDB for ${memory.taskId}: ${error}`
        );
      }
    }

    return ok(undefined);
  }

  /**
   * Store feedback on task approval/rejection
   *
   * Records approval/rejection feedback for learning and quality improvement.
   * Links feedback to the original task memory in the graph.
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

    // Store in ArcadeDB and link to task memory if available
    if (this.isDbAvailable && this.dbAdapter) {
      try {
        const feedbackVertex = await this.dbAdapter.createVertex('TaskFeedback', {
          taskId: feedback.taskId,
          questId: feedback.questId,
          agentId: feedback.agentId,
          approved: feedback.approved,
          score: feedback.score,
          reason: feedback.reason,
          timestamp: feedback.timestamp,
        });

        // Link feedback to task memory
        if (feedbackVertex.success) {
          const taskQuery = `MATCH (t:TaskMemory) WHERE t.taskId = $taskId AND t.questId = $questId RETURN t`;
          const taskResult = await this.dbAdapter.query(taskQuery, {
            taskId: feedback.taskId,
            questId: feedback.questId,
          });

          if (taskResult.success && taskResult.data.length > 0 && taskResult.data[0]['@rid']) {
            await this.dbAdapter.createEdge(
              taskResult.data[0]['@rid'],
              feedbackVertex.data,
              'HAS_FEEDBACK',
              { score: feedback.score }
            );
          }
        }
      } catch (error) {
        console.warn(
          `[MemoryService] Failed to store feedback in ArcadeDB for ${feedback.taskId}: ${error}`
        );
      }
    }

    return ok(undefined);
  }

  /**
   * Recall relevant memories for a given task context
   *
   * Searches both file storage and ArcadeDB for task memories and feedback
   * relevant to the given context. Uses keyword matching on file storage
   * and graph traversal on ArcadeDB when available.
   *
   * @param taskType - Type of the new task
   * @param _description - Description of the new task (used for semantic search in 5.2)
   * @param agentRole - Role of the agent (optional, for filtering)
   * @param limit - Maximum memories to return (default: 5)
   * @returns Result with relevant memories or error
   */
  async recallRelevant(
    taskType: string,
    _description: string,
    agentRole?: string,
    limit: number = 5
  ): Promise<Result<RelevantMemory[], MemoryError>> {
    const memories: RelevantMemory[] = [];

    // Strategy 1: Graph-based recall from ArcadeDB (preferred — richer signals)
    if (this.isDbAvailable && this.dbAdapter) {
      try {
        // Find task memories with matching taskType or agent role
        let cypher: string;
        let params: Record<string, any>;

        if (agentRole) {
          cypher = `
            MATCH (t:TaskMemory)
            WHERE t.taskType = $taskType OR t.agentRole = $agentRole
            RETURN t
            ORDER BY t.timestamp DESC
            LIMIT $limit
          `;
          params = { taskType, agentRole, limit: limit * 2 };
        } else {
          cypher = `
            MATCH (t:TaskMemory)
            WHERE t.taskType = $taskType
            RETURN t
            ORDER BY t.timestamp DESC
            LIMIT $limit
          `;
          params = { taskType, limit: limit * 2 };
        }

        const taskResult = await this.dbAdapter.query(cypher, params);

        if (taskResult.success) {
          for (const row of taskResult.data) {
            const t = row.t || row;
            const rid = t['@rid'];

            // Fetch linked entities for this task
            let entities: ExtractedEntity[] = [];
            if (rid) {
              const entityQuery = `
                MATCH (t)-[:HAS_ENTITY]->(e:Entity)
                WHERE id(t) = $rid
                RETURN e
              `;
              const entityResult = await this.dbAdapter.query(entityQuery, { rid });
              if (entityResult.success) {
                entities = entityResult.data.map((r: any) => ({
                  name: (r.e || r).name,
                  type: (r.e || r).entityType,
                  confidence: (r.e || r).confidence,
                }));
              }
            }

            // Fetch linked feedback
            let feedbackSummary = '';
            if (rid) {
              const fbQuery = `
                MATCH (t)-[:HAS_FEEDBACK]->(f:TaskFeedback)
                WHERE id(t) = $rid
                RETURN f
              `;
              const fbResult = await this.dbAdapter.query(fbQuery, { rid });
              if (fbResult.success && fbResult.data.length > 0) {
                const fb = fbResult.data[0].f || fbResult.data[0];
                feedbackSummary = fb.approved
                  ? ` [Approved, score: ${fb.score}]`
                  : ` [Rejected: ${fb.reason}]`;
              }
            }

            // Compute simple relevance score based on matching criteria
            let relevanceScore = 0.5;
            if (t.taskType === taskType) relevanceScore += 0.3;
            if (agentRole && t.agentRole === agentRole) relevanceScore += 0.1;
            if (t.outcome === 'success') relevanceScore += 0.1;

            memories.push({
              type: 'task',
              taskId: t.taskId,
              summary: `[${t.outcome}] ${t.description}${feedbackSummary}`,
              relevanceScore: Math.min(relevanceScore, 1.0),
              entities,
              timestamp: t.timestamp,
            });
          }
        }
      } catch (error) {
        console.warn(
          `[MemoryService] ArcadeDB recall failed, falling back to file storage: ${error}`
        );
      }
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

              // Skip if already found from ArcadeDB
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
