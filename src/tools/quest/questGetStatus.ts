/**
 * quest_get_status Tool
 * Get comprehensive quest progress overview without loading full details
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { QuestModel } from '../../models/questModel.js';
import type { QuestStatus } from '../../types/index.js';

/**
 * Tool definition for MCP protocol
 */
export const questGetStatusTool: Tool = {
  name: 'quest_get_status',
  description: `Display comprehensive quest progress overview without loading full details.

**Usage Guidelines:**
Call when resuming work on a quest or checking overall completion status. Shows which phases are complete and task implementation progress.

**When to Use:**
- Checking quest progress before starting work
- Monitoring multiple quests
- Quick status check without loading full quest details
- Determining next steps in quest workflow

**Returns:**
- Quest metadata (name, description, status)
- Phase completion status (requirements, design, tasks, implementation)
- Task progress metrics (total, completed, pending, in_progress, failed)
- Timestamps (created, last modified)
- Current phase and next steps guidance

**Example Use Cases:**
- "What's the status of quest abc-123?"
- "Show me progress on the authentication quest"
- "Which phase is the payment integration quest in?"`,
  inputSchema: {
    type: 'object',
    properties: {
      questId: {
        type: 'string',
        description: 'Quest identifier (UUID)',
      },
    },
    required: ['questId'],
  },
};

/**
 * Input type for quest_get_status
 */
interface QuestGetStatusInput {
  questId: string;
}

/**
 * Handle quest_get_status tool call
 */
export async function handleQuestGetStatus(args: unknown) {
  // Validate input
  const input = args as QuestGetStatusInput;

  if (!input.questId) {
    throw new Error('questId is required');
  }

  // Load quest
  const quest = await QuestModel.load(input.questId);

  // Calculate phase completion
  const phases = {
    requirements: {
      exists: quest.requirements && quest.requirements.length > 0,
      approved: quest.status !== 'draft' && quest.status !== 'rejected',
      lastModified: quest.updatedAt,
    },
    design: {
      exists: quest.design && quest.design.length > 0,
      approved: quest.status !== 'draft' && quest.status !== 'rejected',
      lastModified: quest.updatedAt,
    },
    tasks: {
      exists: quest.tasks && quest.tasks.length > 0,
      approved: quest.status === 'approved' || quest.status === 'in_progress' || quest.status === 'completed',
      lastModified: quest.updatedAt,
    },
    implementation: {
      exists: quest.tasks.some((t) => t.status === 'in_progress' || t.status === 'completed'),
      inProgress: quest.status === 'in_progress',
    },
  };

  // Calculate task progress metrics
  const taskProgress = {
    total: quest.tasks.length,
    completed: quest.tasks.filter((t) => t.status === 'completed').length,
    pending: quest.tasks.filter((t) => t.status === 'pending').length,
    inProgress: quest.tasks.filter((t) => t.status === 'in_progress').length,
    failed: quest.tasks.filter((t) => t.status === 'failed').length,
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
    {
      name: 'Requirements',
      status: phases.requirements.exists
        ? phases.requirements.approved
          ? 'approved'
          : 'created'
        : 'missing',
      lastModified: phases.requirements.lastModified,
    },
    {
      name: 'Design',
      status: phases.design.exists ? (phases.design.approved ? 'approved' : 'created') : 'missing',
      lastModified: phases.design.lastModified,
    },
    {
      name: 'Tasks',
      status: phases.tasks.exists ? (phases.tasks.approved ? 'approved' : 'created') : 'missing',
      lastModified: phases.tasks.lastModified,
      taskCount: quest.tasks.length,
    },
    {
      name: 'Implementation',
      status: phases.implementation.exists
        ? phases.implementation.inProgress
          ? 'in-progress'
          : 'started'
        : 'not-started',
      progress: taskProgress,
    },
  ];

  // Next steps based on current phase
  const nextSteps: string[] = [];
  switch (currentPhase) {
    case 'draft':
      nextSteps.push('Review requirements and design documents');
      nextSteps.push('Call quest_request_approval to submit for approval');
      break;
    case 'approval':
      nextSteps.push('Wait for approval via Discord/Slack/Dashboard');
      nextSteps.push('Approver will call quest_submit_approval');
      break;
    case 'rejected':
      nextSteps.push('Review rejection feedback in approval history');
      nextSteps.push('Call quest_revise to update requirements/design');
      nextSteps.push('Resubmit for approval');
      break;
    case 'cancelled':
      nextSteps.push('Quest has been cancelled');
      nextSteps.push('Review cancellation reason in metadata');
      break;
    case 'task-splitting':
      nextSteps.push('Call quest_split_tasks to break down into implementation tasks');
      break;
    case 'ready-for-implementation':
      nextSteps.push('Call quest_get_details to view all tasks');
      nextSteps.push('Call quest_assign_tasks to assign tasks to agents');
      nextSteps.push('Agents call quest_update_task_status to start tasks');
      break;
    case 'implementation':
      if (taskProgress.pending > 0) {
        nextSteps.push(`${taskProgress.pending} tasks pending assignment`);
        nextSteps.push('Call quest_assign_tasks to assign pending tasks');
      }
      if (taskProgress.inProgress > 0) {
        nextSteps.push(`${taskProgress.inProgress} tasks in progress`);
        nextSteps.push('Monitor task execution');
      }
      if (taskProgress.failed > 0) {
        nextSteps.push(`${taskProgress.failed} tasks failed - review and retry`);
      }
      if (taskProgress.completed === taskProgress.total && taskProgress.total > 0) {
        nextSteps.push('All tasks completed!');
        nextSteps.push('Call quest_verify_task for final verification');
      }
      break;
    case 'completed':
      nextSteps.push('Quest completed successfully');
      nextSteps.push('All tasks have been verified');
      break;
  }

  // Calculate completion percentage
  const completionPercentage =
    taskProgress.total > 0 ? Math.round((taskProgress.completed / taskProgress.total) * 100) : 0;

  // Return success
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
