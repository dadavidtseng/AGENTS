/**
 * quest_query_quest MCP Tool
 * Query quest information with configurable detail level.
 * Merges former quest_get_status (summary) and quest_get_details (full) tools.
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { QuestModel } from '../../models/questModel.js';
import type { QuestStatus } from '../../types/index.js';

/**
 * Tool definition for MCP protocol
 */
export const questQueryQuestTool: Tool = {
  name: 'quest_query_quest',
  description: `Query quest information with configurable detail level.

**Parameters:**
- questId (required): Quest identifier (UUID)
- detail (optional): Level of detail to return
  - "summary" (default): Progress overview with phases, metrics, and next steps
  - "full": Complete quest data including requirements, design, tasks, and approval history

**When to Use:**
- detail="summary": Quick status check, monitoring progress, determining next steps
- detail="full": Need to read requirements/design, review tasks, or inspect approval history`,
  inputSchema: {
    type: 'object',
    properties: {
      questId: {
        type: 'string',
        description: 'Quest identifier (UUID)',
      },
      detail: {
        type: 'string',
        enum: ['summary', 'full'],
        description: 'Detail level: "summary" for progress overview, "full" for complete quest data (default: summary)',
      },
    },
    required: ['questId'],
  },
};

/**
 * Input type for quest_query_quest
 */
interface QuestQueryQuestInput {
  questId: string;
  detail?: 'summary' | 'full';
}

/**
 * Handle quest_query_quest tool call
 */
export async function handleQuestQueryQuest(args: unknown) {
  const input = args as QuestQueryQuestInput;

  if (!input.questId) {
    throw new Error('questId is required');
  }

  const detail = input.detail || 'summary';

  // Load quest
  let quest;
  try {
    quest = await QuestModel.load(input.questId);
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes('ENOENT') || error.message.includes('does not exist')) {
        throw new Error(`Quest with ID '${input.questId}' not found`);
      }
      throw new Error(`Failed to load quest: ${error.message}`);
    }
    throw new Error(`Failed to load quest: ${String(error)}`);
  }

  // Full detail mode — return complete quest data
  if (detail === 'full') {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              questId: quest.questId,
              questName: quest.questName,
              description: quest.description,
              status: quest.status,
              requirements: quest.requirements,
              design: quest.design,
              tasks: quest.tasks.map((task) => ({
                ...task,
                createdAt: typeof task.createdAt === 'string'
                  ? task.createdAt
                  : task.createdAt.toISOString(),
                updatedAt: typeof task.updatedAt === 'string'
                  ? task.updatedAt
                  : task.updatedAt.toISOString(),
              })),
              approvalHistory: quest.approvalHistory.map((approval) => ({
                ...approval,
                timestamp: typeof approval.timestamp === 'string'
                  ? approval.timestamp
                  : approval.timestamp.toISOString(),
              })),
              conversationContext: quest.conversationContext,
              createdAt: typeof quest.createdAt === 'string'
                ? quest.createdAt
                : quest.createdAt.toISOString(),
              updatedAt: typeof quest.updatedAt === 'string'
                ? quest.updatedAt
                : quest.updatedAt.toISOString(),
              revisionNumber: quest.revisionNumber,
            },
            null,
            2
          ),
        },
      ],
    };
  }

  // Summary mode — return progress overview
  return buildSummaryResponse(quest);
}

/**
 * Build summary response with phases, metrics, and next steps
 * (Migrated from former quest_get_status tool)
 */
function buildSummaryResponse(quest: any) {
  // Calculate phase completion
  const phases = {
    requirements: {
      exists: quest.requirements && quest.requirements.length > 0,
      approved: quest.status !== 'draft' && quest.status !== 'rejected',
    },
    design: {
      exists: quest.design && quest.design.length > 0,
      approved: quest.status !== 'draft' && quest.status !== 'rejected',
    },
    tasks: {
      exists: quest.tasks && quest.tasks.length > 0,
      approved: quest.status === 'approved' || quest.status === 'in_progress' || quest.status === 'completed',
    },
    implementation: {
      exists: quest.tasks.some((t: any) => t.status === 'in_progress' || t.status === 'completed'),
      inProgress: quest.status === 'in_progress',
    },
  };

  // Task progress metrics
  const taskProgress = {
    total: quest.tasks.length,
    completed: quest.tasks.filter((t: any) => t.status === 'completed').length,
    pending: quest.tasks.filter((t: any) => t.status === 'pending').length,
    inProgress: quest.tasks.filter((t: any) => t.status === 'in_progress').length,
    failed: quest.tasks.filter((t: any) => t.status === 'failed').length,
  };

  // Determine current phase
  let currentPhase = 'not-started';
  let overallStatus = 'not-started';

  if (quest.status === 'draft') {
    currentPhase = 'draft';
    overallStatus = 'awaiting-approval-request';
  } else if (quest.status === 'pending_approval') {
    currentPhase = 'approval';
    overallStatus = 'pending-approval';
  } else if (quest.status === 'rejected') {
    currentPhase = 'rejected';
    overallStatus = 'rejected';
  } else if (quest.status === 'cancelled') {
    currentPhase = 'cancelled';
    overallStatus = 'cancelled';
  } else if (quest.status === 'approved' && quest.tasks.length === 0) {
    currentPhase = 'task-splitting';
    overallStatus = 'ready-for-task-splitting';
  } else if (quest.status === 'approved' && quest.tasks.length > 0) {
    currentPhase = 'ready-for-implementation';
    overallStatus = 'ready-to-start';
  } else if (quest.status === 'in_progress') {
    currentPhase = 'implementation';
    if (taskProgress.pending > 0 || taskProgress.inProgress > 0) {
      overallStatus = 'implementing';
    } else if (taskProgress.failed > 0) {
      overallStatus = 'has-failures';
    } else {
      overallStatus = 'all-tasks-completed';
    }
  } else if (quest.status === 'completed') {
    currentPhase = 'completed';
    overallStatus = 'completed';
  }

  // Phase details
  const phaseDetails = [
    { name: 'Requirements', status: phases.requirements.exists ? (phases.requirements.approved ? 'approved' : 'created') : 'missing' },
    { name: 'Design', status: phases.design.exists ? (phases.design.approved ? 'approved' : 'created') : 'missing' },
    { name: 'Tasks', status: phases.tasks.exists ? (phases.tasks.approved ? 'approved' : 'created') : 'missing', taskCount: quest.tasks.length },
    { name: 'Implementation', status: phases.implementation.exists ? (phases.implementation.inProgress ? 'in-progress' : 'started') : 'not-started', progress: taskProgress },
  ];

  // Next steps
  const nextSteps: string[] = [];
  switch (currentPhase) {
    case 'draft':
      nextSteps.push('Review requirements and design documents');
      nextSteps.push('Call quest_request_quest_approval to submit for approval');
      break;
    case 'approval':
      nextSteps.push('Wait for approval via Discord/Slack/Dashboard');
      nextSteps.push('Approver will call quest_submit_approval');
      break;
    case 'rejected':
      nextSteps.push('Review rejection feedback in approval history');
      nextSteps.push('Call quest_update_quest to update requirements/design');
      nextSteps.push('Resubmit for approval');
      break;
    case 'cancelled':
      nextSteps.push('Quest has been cancelled');
      break;
    case 'task-splitting':
      nextSteps.push('Call quest_split_task to break down into implementation tasks');
      break;
    case 'ready-for-implementation':
      nextSteps.push('Call quest_query_quest with detail="full" to view all tasks');
      nextSteps.push('Call quest_assign_task to assign tasks to agents');
      break;
    case 'implementation':
      if (taskProgress.pending > 0) nextSteps.push(`${taskProgress.pending} tasks pending assignment`);
      if (taskProgress.inProgress > 0) nextSteps.push(`${taskProgress.inProgress} tasks in progress`);
      if (taskProgress.failed > 0) nextSteps.push(`${taskProgress.failed} tasks failed - review and retry`);
      if (taskProgress.completed === taskProgress.total && taskProgress.total > 0) {
        nextSteps.push('All tasks completed!');
        nextSteps.push('Call quest_verify_task for final verification');
      }
      break;
    case 'completed':
      nextSteps.push('Quest completed successfully');
      break;
  }

  const completionPercentage = taskProgress.total > 0
    ? Math.round((taskProgress.completed / taskProgress.total) * 100)
    : 0;

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            success: true,
            questId: quest.questId,
            questName: quest.questName,
            description: quest.description,
            status: quest.status,
            currentPhase,
            overallStatus,
            completionPercentage,
            createdAt: quest.createdAt,
            lastModified: quest.updatedAt,
            revisionNumber: quest.revisionNumber,
            phases: phaseDetails,
            taskProgress,
            approvalCount: quest.approvalHistory.length,
            nextSteps,
            message: `Quest "${quest.questName}" is in ${currentPhase} phase (${overallStatus}). ${completionPercentage}% complete.`,
          },
          null,
          2
        ),
      },
    ],
  };
}
