/**
 * Implementation Log Manager
 * Manages CRUD operations for implementation logs
 */

import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import type { ImplementationLogEntry, TaskArtifacts } from '../types/index.js';

const QUEST_DATA_DIR = process.env.QUEST_DATA_DIR || path.join(process.cwd(), '.quest-data');

export class ImplementationLogModel {
  /**
   * Save an implementation log entry
   */
  static async save(log: ImplementationLogEntry): Promise<void> {
    const questDir = path.join(QUEST_DATA_DIR, log.questId);
    const logsDir = path.join(questDir, 'logs');

    // Ensure logs directory exists
    await fs.mkdir(logsDir, { recursive: true });

    const logPath = path.join(logsDir, `${log.logId}.json`);
    const logData = {
      logId: log.logId,
      questId: log.questId,
      taskId: log.taskId,
      taskName: log.taskName,
      summary: log.summary,
      details: log.details,
      artifacts: log.artifacts,
      challenges: log.challenges,
      solutions: log.solutions,
      lessonsLearned: log.lessonsLearned,
      implementedBy: log.implementedBy,
      timestamp: log.timestamp.toISOString(),
    };

    await fs.writeFile(logPath, JSON.stringify(logData, null, 2), 'utf-8');
  }

  /**
   * Load a specific implementation log entry
   */
  static async load(questId: string, logId: string): Promise<ImplementationLogEntry> {
    const logPath = path.join(QUEST_DATA_DIR, questId, 'logs', `${logId}.json`);

    try {
      const content = await fs.readFile(logPath, 'utf-8');
      const data = JSON.parse(content);

      return {
        logId: data.logId,
        questId: data.questId,
        taskId: data.taskId,
        taskName: data.taskName,
        summary: data.summary,
        details: data.details,
        artifacts: data.artifacts,
        challenges: data.challenges,
        solutions: data.solutions,
        lessonsLearned: data.lessonsLearned,
        implementedBy: data.implementedBy,
        timestamp: new Date(data.timestamp),
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(`Implementation log ${logId} not found for quest ${questId}`);
      }
      throw error;
    }
  }

  /**
   * List all implementation logs for a quest
   */
  static async listByQuest(questId: string): Promise<ImplementationLogEntry[]> {
    const logsDir = path.join(QUEST_DATA_DIR, questId, 'logs');

    try {
      const files = await fs.readdir(logsDir);
      const logFiles = files.filter((f) => f.endsWith('.json'));

      const logs = await Promise.all(
        logFiles.map(async (file) => {
          const logId = file.replace('.json', '');
          return await this.load(questId, logId);
        })
      );

      // Sort by timestamp (newest first)
      return logs.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return []; // No logs directory means no logs
      }
      throw error;
    }
  }

  /**
   * Get implementation log for a specific task
   */
  static async getByTaskId(questId: string, taskId: string): Promise<ImplementationLogEntry | null> {
    const logs = await this.listByQuest(questId);
    return logs.find((log) => log.taskId === taskId) || null;
  }

  /**
   * Search implementation logs by keyword
   * Searches in summary, details, task name, and artifact descriptions
   */
  static async search(questId: string, keyword: string): Promise<ImplementationLogEntry[]> {
    const logs = await this.listByQuest(questId);
    const lowerKeyword = keyword.toLowerCase();

    return logs.filter((log) => {
      // Search in text fields
      const textMatch =
        log.summary.toLowerCase().includes(lowerKeyword) ||
        log.details.toLowerCase().includes(lowerKeyword) ||
        log.taskName.toLowerCase().includes(lowerKeyword) ||
        log.challenges?.toLowerCase().includes(lowerKeyword) ||
        log.solutions?.toLowerCase().includes(lowerKeyword) ||
        log.lessonsLearned?.toLowerCase().includes(lowerKeyword);

      if (textMatch) return true;

      // Search in artifacts
      const artifacts = log.artifacts;
      const artifactMatch =
        artifacts.apiEndpoints?.some(
          (ep) =>
            ep.path.toLowerCase().includes(lowerKeyword) ||
            ep.purpose.toLowerCase().includes(lowerKeyword)
        ) ||
        artifacts.components?.some(
          (comp) =>
            comp.name.toLowerCase().includes(lowerKeyword) ||
            comp.purpose.toLowerCase().includes(lowerKeyword)
        ) ||
        artifacts.functions?.some(
          (fn) =>
            fn.name.toLowerCase().includes(lowerKeyword) ||
            fn.purpose.toLowerCase().includes(lowerKeyword)
        ) ||
        artifacts.classes?.some(
          (cls) =>
            cls.name.toLowerCase().includes(lowerKeyword) ||
            cls.purpose.toLowerCase().includes(lowerKeyword)
        ) ||
        artifacts.integrations?.some(
          (integ) =>
            integ.description.toLowerCase().includes(lowerKeyword) ||
            integ.frontendComponent.toLowerCase().includes(lowerKeyword) ||
            integ.backendEndpoint.toLowerCase().includes(lowerKeyword)
        );

      return artifactMatch;
    });
  }

  /**
   * Create a new implementation log entry
   */
  static create(params: {
    questId: string;
    taskId: string;
    taskName: string;
    summary: string;
    details: string;
    artifacts: TaskArtifacts;
    challenges?: string;
    solutions?: string;
    lessonsLearned?: string;
    implementedBy?: string;
  }): ImplementationLogEntry {
    return {
      logId: randomUUID(),
      questId: params.questId,
      taskId: params.taskId,
      taskName: params.taskName,
      summary: params.summary,
      details: params.details,
      artifacts: params.artifacts,
      challenges: params.challenges,
      solutions: params.solutions,
      lessonsLearned: params.lessonsLearned,
      implementedBy: params.implementedBy,
      timestamp: new Date(),
    };
  }
}
