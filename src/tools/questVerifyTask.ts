/**
 * quest_verify_task MCP Tool
 * Verifies completed tasks with scoring and revision triggering
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { QuestModel } from '../models/questModel.js';
import { commitQuestChanges } from '../utils/git.js';
import { config } from '../utils/config.js';

/**
 * Tool definition for MCP protocol
 */
export const questVerifyTaskTool: Tool = {
  name: 'quest_verify_task',
  description: 'Verify completed task against criteria with scoring (0-100)',
  inputSchema: {
    type: 'object',
    properties: {
      taskId: {
        type: 'string',
        description: 'Task ID (UUID) to verify',
      },
      score: {
        type: 'number',
        description: 'Verification score (0-100)',
        minimum: 0,
        maximum: 100,
      },
      summary: {
        type: 'string',
        description: 'Verification summary/feedback',
      },
      verifiedBy: {
        type: 'string',
        description: 'Agent or user ID performing verification',
      },
    },
    required: ['taskId', 'score', 'summary', 'verifiedBy'],
  },
};

/**
 * Input parameters for quest_verify_task tool
 */
interface QuestVerifyTaskInput {
  taskId: string;
  score: number;
  summary: string;
  verifiedBy: string;
}

/**
 * Verification result record
 */
interface VerificationResult {
  score: number;
  summary: string;
  verifiedBy: string;
  timestamp: string;
  passed: boolean;
}

/**
 * Find quest and task by task ID
 */
async function findTaskAndQuest(taskId: string): Promise<{ task: any; quest: any } | null> {
  const allQuests = await QuestModel.listAll();
  
  for (const quest of allQuests) {
    const task = quest.tasks.find((t) => t.id === taskId);
    if (task) {
      return { task, quest };
    }
  }
  
  return null;
}

/**
 * Handle quest_verify_task tool call
 */
export async function handleQuestVerifyTask(args: unknown) {
  // Validate input
  const input = args as QuestVerifyTaskInput;
  
  if (!input.taskId) {
    throw new Error('taskId is required');
  }
  
  if (input.score === undefined || input.score === null) {
    throw new Error('score is required');
  }
  
  if (typeof input.score !== 'number') {
    throw new Error('score must be a number');
  }
  
  if (input.score < 0 || input.score > 100) {
    throw new Error('score must be between 0 and 100');
  }
  
  if (!input.summary) {
    throw new Error('summary is required');
  }
  
  if (typeof input.summary !== 'string' || input.summary.trim().length === 0) {
    throw new Error('summary must be a non-empty string');
  }
  
  if (!input.verifiedBy) {
    throw new Error('verifiedBy is required');
  }
  
  // Find task and quest
  const result = await findTaskAndQuest(input.taskId);
  
  if (!result) {
    throw new Error(`Task with ID '${input.taskId}' not found in any quest`);
  }
  
  const { task, quest } = result;
  
  // Validate task status
  if (task.status !== 'completed') {
    throw new Error(
      `Task must be 'completed' to verify (current status: ${task.status})`
    );
  }
  
  // Determine if verification passed (score >= 80)
  const passed = input.score >= 80;
  
  // Create verification result record
  const verificationResult: VerificationResult = {
    score: input.score,
    summary: input.summary,
    verifiedBy: input.verifiedBy,
    timestamp: new Date().toISOString(),
    passed,
  };
  
  // Initialize artifacts if not present
  if (!task.artifacts) {
    task.artifacts = {};
  }
  
  // Store verification history in task metadata
  if (!task.artifacts.verificationHistory) {
    task.artifacts.verificationHistory = [];
  }
  task.artifacts.verificationHistory.push(verificationResult);
  
  // Update task status based on score
  const oldStatus = task.status;
  let newStatus: string;
  
  if (passed) {
    // Score >= 80: keep as completed, mark as verified
    task.status = 'completed';
    task.artifacts.verified = true;
    task.artifacts.verificationScore = input.score;
    newStatus = 'completed';
  } else {
    // Score < 80: mark as needs_revision
    task.status = 'needs_revision' as any; // TypeScript doesn't have this status yet
    task.artifacts.verified = false;
    task.artifacts.verificationScore = input.score;
    task.artifacts.revisionFeedback = input.summary;
    newStatus = 'needs_revision';
  }
  
  // Update timestamp
  task.updatedAt = new Date();
  
  // Save quest
  await QuestModel.save(quest);
  
  // Git commit
  await commitQuestChanges(
    config.questDataDir,
    `chore: verify task ${task.name} - score ${input.score}`,
    `Task ID: ${input.taskId}\nScore: ${input.score}/100\nStatus: ${oldStatus} → ${newStatus}\nVerified by: ${input.verifiedBy}\n\nSummary:\n${input.summary}`
  );
  
  // Return result
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            success: true,
            taskId: input.taskId,
            taskStatus: newStatus,
            score: input.score,
            passed,
            message: passed
              ? `Task verification passed with score ${input.score}/100`
              : `Task needs revision - score ${input.score}/100 (threshold: 80). Feedback: ${input.summary}`,
          },
          null,
          2
        ),
      },
    ],
  };
}
