/**
 * Quest Model - CRUD operations for quest data with Git versioning
 * File-based storage with in-place updates following Shrimp pattern
 */

import { randomUUID } from 'crypto';
import { readdir, readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { Quest, ConversationContext, Task, ApprovalDecision } from '../types/index.js';
import { commitQuestChanges } from '../utils/git.js';
import { config } from '../utils/config.js';
import { broadcastQuestCreated, broadcastQuestUpdated } from '../dashboard/events.js';

/**
 * Parameters for creating a new quest
 */
export interface CreateQuestParams {
  /** Human-readable quest name */
  questName: string;
  /** Brief description */
  description: string;
  /** Requirements document (markdown) */
  requirements: string;
  /** Design document (markdown) */
  design: string;
  /** Conversation context for approval routing */
  conversationContext: ConversationContext;
}

/**
 * Quest Model - Handles all quest persistence operations
 */
export class QuestModel {
  /**
   * Create a new quest with file-based storage
   * 
   * @param params - Quest creation parameters
   * @returns Newly created Quest object
   * 
   * @example
   * const quest = await QuestModel.create({
   *   questName: 'User Authentication',
   *   description: 'Implement JWT-based auth',
   *   requirements: '# Requirements\n...',
   *   design: '# Design\n...',
   *   conversationContext: {
   *     platform: 'discord',
   *     channelId: '123',
   *     userId: 'user-456'
   *   }
   * });
   */
  static async create(params: CreateQuestParams): Promise<Quest> {
    const questId = randomUUID();
    const now = new Date();

    // Create quest directory
    const questDir = join(config.questDataDir, 'quests', questId);
    await mkdir(questDir, { recursive: true });

    // Create quest object
    const quest: Quest = {
      questId,
      questName: params.questName,
      description: params.description,
      status: 'draft',
      requirements: params.requirements,
      design: params.design,
      tasks: [],
      approvalHistory: [],
      conversationContext: params.conversationContext,
      createdAt: now,
      updatedAt: now,
      revisionNumber: 1,
    };

    // Write files
    await writeFile(join(questDir, 'requirements.md'), params.requirements, 'utf-8');
    await writeFile(join(questDir, 'design.md'), params.design, 'utf-8');
    await writeFile(join(questDir, 'tasks.json'), JSON.stringify([], null, 2), 'utf-8');
    await writeFile(join(questDir, 'approval-history.json'), JSON.stringify([], null, 2), 'utf-8');

    // Write metadata
    const metadata = {
      questId,
      questName: params.questName,
      description: params.description,
      status: 'draft',
      conversationContext: params.conversationContext,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      revisionNumber: 1,
    };
    await writeFile(join(questDir, 'metadata.json'), JSON.stringify(metadata, null, 2), 'utf-8');

    // Git commit
    await commitQuestChanges(
      config.questDataDir,
      `feat: create quest ${params.questName}`,
      `Quest ID: ${questId}\nStatus: draft`
    );

    // Broadcast quest created event (after commit succeeds)
    await broadcastQuestCreated(quest);

    return quest;
  }

  /**
   * Load a quest from file storage
   * 
   * @param questId - Quest identifier (UUID)
   * @returns Quest object with all data
   * @throws Error if quest not found
   * 
   * @example
   * const quest = await QuestModel.load('abc-123-def');
   */
  static async load(questId: string): Promise<Quest> {
    const questDir = join(config.questDataDir, 'quests', questId);

    try {
      // Read all files
      const [requirements, design, tasksJson, approvalHistoryJson, metadataJson] = await Promise.all([
        readFile(join(questDir, 'requirements.md'), 'utf-8'),
        readFile(join(questDir, 'design.md'), 'utf-8'),
        readFile(join(questDir, 'tasks.json'), 'utf-8'),
        readFile(join(questDir, 'approval-history.json'), 'utf-8'),
        readFile(join(questDir, 'metadata.json'), 'utf-8'),
      ]);

      // Parse JSON
      const tasks: Task[] = JSON.parse(tasksJson);
      const approvalHistory: ApprovalDecision[] = JSON.parse(approvalHistoryJson);
      const metadata = JSON.parse(metadataJson);

      // Construct Quest object
      const quest: Quest = {
        questId: metadata.questId,
        questName: metadata.questName,
        description: metadata.description,
        status: metadata.status,
        requirements,
        design,
        tasks,
        approvalHistory,
        conversationContext: metadata.conversationContext,
        createdAt: new Date(metadata.createdAt),
        updatedAt: new Date(metadata.updatedAt),
        revisionNumber: metadata.revisionNumber,
        ...(metadata.metadata && { metadata: metadata.metadata }),
      };

      return quest;
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        throw new Error(`Quest not found: ${questId}`);
      }
      throw error;
    }
  }

  /**
   * Save quest changes to file storage (in-place update)
   * Does NOT create git commit - caller decides when to commit
   * 
   * @param quest - Quest object to save
   * 
   * @example
   * quest.status = 'approved';
   * await QuestModel.save(quest);
   * await commitQuestChanges(config.questDataDir, 'chore: approve quest');
   */
  static async save(quest: Quest): Promise<void> {
    // Update timestamp
    quest.updatedAt = new Date();

    const questDir = join(config.questDataDir, 'quests', quest.questId);

    // Write files (in place, not versioned)
    await Promise.all([
      writeFile(join(questDir, 'requirements.md'), quest.requirements, 'utf-8'),
      writeFile(join(questDir, 'design.md'), quest.design, 'utf-8'),
      writeFile(join(questDir, 'tasks.json'), JSON.stringify(quest.tasks, null, 2), 'utf-8'),
      writeFile(join(questDir, 'approval-history.json'), JSON.stringify(quest.approvalHistory, null, 2), 'utf-8'),
    ]);

    // Update metadata
    const metadata = {
      questId: quest.questId,
      questName: quest.questName,
      description: quest.description,
      status: quest.status,
      conversationContext: quest.conversationContext,
      createdAt: quest.createdAt.toISOString(),
      updatedAt: quest.updatedAt.toISOString(),
      revisionNumber: quest.revisionNumber,
      ...(quest.metadata && { metadata: quest.metadata }),
    };
    await writeFile(join(questDir, 'metadata.json'), JSON.stringify(metadata, null, 2), 'utf-8');

    // Broadcast quest updated event (after file writes succeed)
    await broadcastQuestUpdated(quest.questId, quest.status);
  }

  /**
   * List all quests in the system
   * 
   * @returns Array of all quests, sorted by creation date (newest first)
   * 
   * @example
   * const allQuests = await QuestModel.listAll();
   * console.log(`Found ${allQuests.length} quests`);
   */
  static async listAll(): Promise<Quest[]> {
    const questsDir = join(config.questDataDir, 'quests');

    try {
      // Ensure directory exists
      await mkdir(questsDir, { recursive: true });

      // Read all quest directories
      const entries = await readdir(questsDir, { withFileTypes: true });
      const questIds = entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);

      // Load all quests
      const quests = await Promise.all(
        questIds.map(async (questId) => {
          try {
            return await QuestModel.load(questId);
          } catch (error) {
            console.warn(`[QuestModel] Failed to load quest ${questId}:`, error);
            return null;
          }
        })
      );

      // Filter out failed loads and sort by createdAt (descending)
      return quests
        .filter((quest): quest is Quest => quest !== null)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        // Directory doesn't exist yet, return empty array
        return [];
      }
      throw error;
    }
  }

  /**
   * Revise quest requirements and design (in-place update)
   * Increments revision number and creates git commit
   * 
   * @param questId - Quest to revise
   * @param feedback - Revision feedback/reason
   * @param newRequirements - Updated requirements document
   * @param newDesign - Updated design document
   * @returns Updated quest object
   * 
   * @example
   * const revised = await QuestModel.revise(
   *   'quest-123',
   *   'Added authentication requirements',
   *   '# Requirements\n...',
   *   '# Design\n...'
   * );
   */
  static async revise(
    questId: string,
    feedback: string,
    newRequirements: string,
    newDesign: string
  ): Promise<Quest> {
    // Load existing quest
    const quest = await QuestModel.load(questId);

    // Update in place
    quest.requirements = newRequirements;
    quest.design = newDesign;
    quest.revisionNumber += 1;

    // Save changes
    await QuestModel.save(quest);

    // Git commit
    await commitQuestChanges(
      config.questDataDir,
      `feat: revise quest ${quest.questName} (revision #${quest.revisionNumber})`,
      `Feedback: ${feedback}`
    );

    return quest;
  }
}
