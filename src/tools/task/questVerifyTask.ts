/**
 * quest_verify_task MCP Tool
 * Verifies completed tasks with scoring and revision triggering
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { QuestModel } from '../../models/questModel.js';
import { commitQuestChanges } from '../../utils/git.js';
import { config } from '../../utils/config.js';

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
      passed: {
        type: 'boolean',
        description: 'Explicit pass/fail override from the verifying agent. If provided, takes precedence over score-based threshold.',
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
  passed?: boolean;
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

  // Wrap the entire load-modify-save cycle in a per-quest lock
  // to prevent concurrent verifications from corrupting the quest JSON
  return QuestModel.withLock(quest.questId, async () => {
  // Reload quest from disk to get the latest status
  // This ensures we see any status updates made by other tools (e.g., quest_update_task)
  const freshQuest = await QuestModel.load(quest.questId);
  const freshTask = freshQuest.tasks.find((t) => t.id === input.taskId);

  if (!freshTask) {
    throw new Error(`Task with ID '${input.taskId}' not found after reload`);
  }

  // Validate task status using fresh data from disk
  // Accept 'completed', 'in_progress', and 'needs_revision':
  //   - 'completed'/'in_progress': normal verification flow
  //   - 'needs_revision': retry cycle — a previous verification scored low, the task was
  //     retried by the worker, and this is the new completion's verification. The status
  //     may still be 'needs_revision' due to a read-modify-write race on the quest JSON
  //     (concurrent verifications for different tasks in the same quest can overwrite each
  //     other's status changes).
  if (freshTask.status !== 'completed' && freshTask.status !== 'in_progress' && freshTask.status !== 'needs_revision') {
    throw new Error(
      `Task must be 'completed' or 'in_progress' to verify (current status: ${freshTask.status})`
    );
  }

  // Determine if verification passed
  // Use explicit `passed` from verifying agent if provided; otherwise fall back to score threshold
  const passed = input.passed !== undefined ? input.passed : input.score >= 80;

  // Create verification result record
  const verificationResult: VerificationResult = {
    score: input.score,
    summary: input.summary,
    verifiedBy: input.verifiedBy,
    timestamp: new Date().toISOString(),
    passed,
  };

  // Initialize artifacts if not present
  if (!freshTask.artifacts) {
    freshTask.artifacts = {};
  }

  // Store verification history in task metadata
  if (!freshTask.artifacts.verificationHistory) {
    freshTask.artifacts.verificationHistory = [];
  }
  freshTask.artifacts.verificationHistory.push(verificationResult);

  // Update task status based on score
  const oldStatus = freshTask.status;
  let newStatus: string;

  if (passed) {
    // Score >= 80: keep as completed, mark as verified
    freshTask.status = 'completed';
    freshTask.artifacts.verified = true;
    freshTask.artifacts.verificationScore = input.score;
    newStatus = 'completed';
  } else {
    // Score < 80: mark as needs_revision
    freshTask.status = 'needs_revision';
    freshTask.artifacts.verified = false;
    freshTask.artifacts.verificationScore = input.score;
    freshTask.artifacts.revisionFeedback = input.summary;
    newStatus = 'needs_revision';
  }

  // Update timestamp
  freshTask.updatedAt = new Date();

  // Save quest (use freshQuest, not the old quest object)
  await QuestModel.save(freshQuest);
  
  // Git commit
  await commitQuestChanges(
    config.questDataDir,
    `chore: verify task ${freshTask.name} - score ${input.score}`,
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
  }); // end QuestModel.withLock
}
