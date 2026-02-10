/**
 * Task Approval Handler for Agent Producer
 * =========================================
 *
 * Handles Discord commands for task approval workflow:
 * - "approve task {taskId}" - Approve verified task and finalize completion
 * - "reject task {taskId}" - Reject task and trigger retry
 * - "request changes for task {taskId}: feedback" - Request changes with feedback
 *
 * Flow:
 * 1. Parse Discord command to extract action and taskId
 * 2. Verify task has been verified (metadata.verification with score >= 80)
 * 3. Execute appropriate action (approve/reject/request changes)
 * 4. Check if all quest tasks completed after approval
 * 5. Trigger git merge workflow if quest is complete
 *
 * Integration:
 * - Called from Discord bot message handler
 * - Uses quest tools via KĀDI broker
 * - Triggers git operations via mcp-server-git
 */

import type { KadiClient } from '@kadi.build/core';
import { logger, MODULE_AGENT, timer } from 'agents-library';

// ============================================================================
// Types
// ============================================================================

interface TaskApprovalResult {
  success: boolean;
  message: string;
  questCompleted?: boolean;
}

interface Task {
  id: string;
  questId: string;
  name: string;
  status: string;
  assignedAgent?: string;
  metadata?: {
    verification?: {
      score: number;
      summary: string;
      verifiedBy: string;
      timestamp: string;
    };
  };
}

interface Quest {
  questId: string;
  questName: string;
  tasks: Task[];
  status: string;
}

// ============================================================================
// Command Parsing
// ============================================================================

/**
 * Parse task approval command from Discord message
 *
 * Supported commands:
 * - "approve task {taskId}"
 * - "reject task {taskId}"
 * - "request changes for task {taskId}: feedback text"
 *
 * @param message - Discord message text
 * @returns Parsed command or null if not a task approval command
 */
function parseTaskApprovalCommand(message: string): {
  action: 'approve' | 'reject' | 'request_changes';
  taskId: string;
  feedback?: string;
} | null {
  const trimmedMessage = message.trim();

  // Check for "approve task {taskId}"
  if (trimmedMessage.startsWith('approve task ')) {
    const taskId = trimmedMessage.substring('approve task '.length).trim();
    if (taskId) {
      return { action: 'approve', taskId };
    }
  }

  // Check for "reject task {taskId}"
  if (trimmedMessage.startsWith('reject task ')) {
    const taskId = trimmedMessage.substring('reject task '.length).trim();
    if (taskId) {
      return { action: 'reject', taskId };
    }
  }

  // Check for "request changes for task {taskId}: feedback"
  if (trimmedMessage.startsWith('request changes for task ')) {
    const remainder = trimmedMessage.substring('request changes for task '.length);
    const colonIndex = remainder.indexOf(':');
    
    if (colonIndex > 0) {
      const taskId = remainder.substring(0, colonIndex).trim();
      const feedback = remainder.substring(colonIndex + 1).trim();
      
      if (taskId && feedback) {
        return { action: 'request_changes', taskId, feedback };
      }
    }
  }

  return null;
}

// ============================================================================
// Task Verification Check
// ============================================================================

/**
 * Verify task is ready for approval
 *
 * Checks if task has been verified with score >= 80
 *
 * @param client - KĀDI client instance
 * @param taskId - Task ID to verify
 * @returns Task details if verified, throws error otherwise
 */
async function verifyTaskReadyForApproval(
  client: KadiClient,
  taskId: string
): Promise<{ task: Task; quest: Quest }> {
  logger.info(
    MODULE_AGENT,
    `Verifying task is ready for approval: ${taskId}`,
    timer.elapsed('main')
  );

  try {
    // Get task details
    const taskDetailsResponse = await client.invokeRemote<{
      content: Array<{ type: string; text: string }>;
    }>('quest_quest_query_task', {
      taskId,
    });

    const taskDetailsText = taskDetailsResponse.content[0].text;
    const taskData = JSON.parse(taskDetailsText);
    const task = taskData.task as Task;

    // Get full quest details to check all tasks
    const questDetailsResponse = await client.invokeRemote<{
      content: Array<{ type: string; text: string }>;
    }>('quest_quest_query_quest', {
      questId: task.questId,
      detail: 'full',
    });

    const questDetailsText = questDetailsResponse.content[0].text;
    const quest = JSON.parse(questDetailsText) as Quest;

    // Check if task has verification metadata
    if (!task.metadata?.verification) {
      throw new Error(
        `Task ${taskId} has not been verified yet. Please wait for automatic verification to complete.`
      );
    }

    // Check if verification score is >= 80
    if (task.metadata.verification.score < 80) {
      throw new Error(
        `Task ${taskId} verification score is ${task.metadata.verification.score}/100, which is below the approval threshold (80). Task needs improvement before approval.`
      );
    }

    logger.info(
      MODULE_AGENT,
      `Task ${taskId} is ready for approval (score: ${task.metadata.verification.score}/100)`,
      timer.elapsed('main')
    );

    return { task, quest };
  } catch (error: any) {
    logger.error(
      MODULE_AGENT,
      `Failed to verify task readiness: ${error.message}`,
      timer.elapsed('main'),
      error
    );
    throw error;
  }
}

// ============================================================================
// Approval Actions
// ============================================================================

/**
 * Approve task and finalize completion
 *
 * @param client - KĀDI client instance
 * @param task - Task to approve
 * @param quest - Parent quest
 * @returns Approval result
 */
async function approveTask(
  client: KadiClient,
  task: Task,
  quest: Quest
): Promise<TaskApprovalResult> {
  logger.info(
    MODULE_AGENT,
    `Approving task: ${task.id}`,
    timer.elapsed('main')
  );

  try {
    // Call quest_submit_task_result to finalize completion
    await client.invokeRemote('quest_quest_submit_task_result', {
      taskId: task.id,
      agentId: task.assignedAgent || 'unknown',
      artifacts: {},
      summary: task.metadata?.verification?.summary || 'Task approved by human',
    });

    logger.info(
      MODULE_AGENT,
      `Task ${task.id} approved and finalized`,
      timer.elapsed('main')
    );

    // Check if all quest tasks are completed
    const allTasksCompleted = quest.tasks.every(
      (t) => t.status === 'completed' || t.id === task.id
    );

    if (allTasksCompleted) {
      logger.info(
        MODULE_AGENT,
        `All tasks in quest ${quest.questId} are completed - triggering git workflow`,
        timer.elapsed('main')
      );

      // Trigger git merge workflow
      await triggerGitWorkflow(client, quest);

      return {
        success: true,
        message: `✅ Task approved and finalized!\n\n📋 Task: ${task.name}\n🎉 All quest tasks completed!\n\n🔄 Git merge workflow has been triggered to merge all changes.`,
        questCompleted: true,
      };
    }

    return {
      success: true,
      message: `✅ Task approved and finalized!\n\n📋 Task: ${task.name}\n📊 Quest progress: ${quest.tasks.filter((t) => t.status === 'completed').length + 1}/${quest.tasks.length} tasks completed`,
      questCompleted: false,
    };
  } catch (error: any) {
    logger.error(
      MODULE_AGENT,
      `Failed to approve task: ${error.message}`,
      timer.elapsed('main'),
      error
    );
    throw error;
  }
}

/**
 * Reject task and trigger retry
 *
 * @param client - KĀDI client instance
 * @param task - Task to reject
 * @returns Rejection result
 */
async function rejectTask(
  client: KadiClient,
  task: Task
): Promise<TaskApprovalResult> {
  logger.info(
    MODULE_AGENT,
    `Rejecting task: ${task.id}`,
    timer.elapsed('main')
  );

  try {
    // Get full task details for retry
    const taskDetailsResponse = await client.invokeRemote<{
      content: Array<{ type: string; text: string }>;
    }>('quest_quest_query_task', {
      taskId: task.id,
    });

    const taskDetailsText = taskDetailsResponse.content[0].text;
    const taskData = JSON.parse(taskDetailsText);
    const fullTask = taskData.task;

    // Publish task.failed event
    await client.publish(
      'task.failed',
      {
        taskId: task.id,
        questId: task.questId,
        role: fullTask.assignedAgent || 'unknown',
        reason: 'human_rejection',
        feedback: 'Task rejected by human reviewer. Please review the requirements and try again.',
        agent: fullTask.assignedAgent || 'unknown',
        timestamp: new Date().toISOString(),
      },
      {
        broker: 'default',
        network: 'global',
      }
    );

    logger.info(
      MODULE_AGENT,
      'Published task.failed event',
      timer.elapsed('main')
    );

    // Republish task.assigned event for retry
    await client.publish(
      'task.assigned',
      {
        taskId: task.id,
        questId: task.questId,
        role: fullTask.assignedAgent || 'unknown',
        taskName: fullTask.name,
        description: fullTask.description,
        implementationGuide: fullTask.implementationGuide,
        verificationCriteria: fullTask.verificationCriteria,
        dependencies: fullTask.dependencies || [],
        relatedFiles: fullTask.relatedFiles || [],
        feedback: 'Task rejected by human reviewer. Please review the requirements and try again.',
        retryAttempt: (fullTask.metadata?.retryAttempt || 0) + 1,
        timestamp: new Date().toISOString(),
      },
      {
        broker: 'default',
        network: 'global',
      }
    );

    logger.info(
      MODULE_AGENT,
      `Task ${task.id} rejected and republished for retry`,
      timer.elapsed('main')
    );

    return {
      success: true,
      message: `❌ Task rejected and reassigned for retry\n\n📋 Task: ${task.name}\n🔄 The task has been sent back to ${fullTask.assignedAgent} for revision.`,
    };
  } catch (error: any) {
    logger.error(
      MODULE_AGENT,
      `Failed to reject task: ${error.message}`,
      timer.elapsed('main'),
      error
    );
    throw error;
  }
}

/**
 * Request changes for task with feedback
 *
 * @param client - KĀDI client instance
 * @param task - Task to request changes for
 * @param feedback - Feedback for changes
 * @returns Request result
 */
async function requestChanges(
  client: KadiClient,
  task: Task,
  feedback: string
): Promise<TaskApprovalResult> {
  logger.info(
    MODULE_AGENT,
    `Requesting changes for task: ${task.id}`,
    timer.elapsed('main')
  );

  try {
    // Get full task details for retry
    const taskDetailsResponse = await client.invokeRemote<{
      content: Array<{ type: string; text: string }>;
    }>('quest_quest_query_task', {
      taskId: task.id,
    });

    const taskDetailsText = taskDetailsResponse.content[0].text;
    const taskData = JSON.parse(taskDetailsText);
    const fullTask = taskData.task;

    // Publish task.failed event with feedback
    await client.publish(
      'task.failed',
      {
        taskId: task.id,
        questId: task.questId,
        role: fullTask.assignedAgent || 'unknown',
        reason: 'changes_requested',
        feedback: feedback,
        agent: fullTask.assignedAgent || 'unknown',
        timestamp: new Date().toISOString(),
      },
      {
        broker: 'default',
        network: 'global',
      }
    );

    logger.info(
      MODULE_AGENT,
      'Published task.failed event with feedback',
      timer.elapsed('main')
    );

    // Republish task.assigned event with feedback
    await client.publish(
      'task.assigned',
      {
        taskId: task.id,
        questId: task.questId,
        role: fullTask.assignedAgent || 'unknown',
        taskName: fullTask.name,
        description: fullTask.description,
        implementationGuide: fullTask.implementationGuide,
        verificationCriteria: fullTask.verificationCriteria,
        dependencies: fullTask.dependencies || [],
        relatedFiles: fullTask.relatedFiles || [],
        feedback: feedback,
        retryAttempt: (fullTask.metadata?.retryAttempt || 0) + 1,
        timestamp: new Date().toISOString(),
      },
      {
        broker: 'default',
        network: 'global',
      }
    );

    logger.info(
      MODULE_AGENT,
      `Changes requested for task ${task.id} with feedback`,
      timer.elapsed('main')
    );

    return {
      success: true,
      message: `📝 Changes requested for task\n\n📋 Task: ${task.name}\n💬 Feedback: ${feedback}\n\n🔄 The task has been sent back to ${fullTask.assignedAgent} with your feedback.`,
    };
  } catch (error: any) {
    logger.error(
      MODULE_AGENT,
      `Failed to request changes: ${error.message}`,
      timer.elapsed('main'),
      error
    );
    throw error;
  }
}

// ============================================================================
// Git Workflow Trigger
// ============================================================================

/**
 * Trigger git merge workflow when all quest tasks are completed
 *
 * Merges all worker agent branches into main repository
 *
 * @param client - KĀDI client instance
 * @param quest - Completed quest
 */
async function triggerGitWorkflow(
  client: KadiClient,
  quest: Quest
): Promise<void> {
  logger.info(
    MODULE_AGENT,
    `Triggering git workflow for quest ${quest.questId}`,
    timer.elapsed('main')
  );

  try {
    // Get unique agents that worked on this quest
    const uniqueAgents = new Set<string>();
    for (const task of quest.tasks) {
      if (task.assignedAgent) {
        uniqueAgents.add(task.assignedAgent);
      }
    }

    logger.info(
      MODULE_AGENT,
      `Found ${uniqueAgents.size} unique agents: ${Array.from(uniqueAgents).join(', ')}`,
      timer.elapsed('main')
    );

    // For each agent, call git merge to merge their worktree branch
    for (const agentId of uniqueAgents) {
      // Extract role from agent ID (e.g., "agent-artist" -> "artist")
      const roleMatch = agentId.match(/agent-(.+)/);
      const role = roleMatch ? roleMatch[1] : agentId;

      // Construct worktree path: C:/GitHub/agent-playground-{role}
      const worktreePath = `C:/GitHub/agent-playground-${role}`;
      const targetRepo = 'C:/GitHub/agent-playground';

      logger.info(
        MODULE_AGENT,
        `Merging ${agentId} worktree: ${worktreePath} -> ${targetRepo}`,
        timer.elapsed('main')
      );

      try {
        // Call git_git_merge via KĀDI broker
        await client.invokeRemote('git_git_merge', {
          worktreePath,
          targetRepo,
          branch: 'main',
        });

        logger.info(
          MODULE_AGENT,
          `Successfully merged ${agentId} worktree`,
          timer.elapsed('main')
        );
      } catch (error: any) {
        logger.error(
          MODULE_AGENT,
          `Failed to merge ${agentId} worktree: ${error.message}`,
          timer.elapsed('main'),
          error
        );
        // Continue with other agents even if one fails
      }
    }

    // After all merges, push to remote
    logger.info(
      MODULE_AGENT,
      'All worktrees merged, pushing to remote...',
      timer.elapsed('main')
    );

    try {
      await client.invokeRemote('git_git_push', {
        repositoryPath: 'C:/GitHub/agent-playground',
        branch: 'main',
        remote: 'origin',
      });

      logger.info(
        MODULE_AGENT,
        'Successfully pushed to remote',
        timer.elapsed('main')
      );
    } catch (error: any) {
      logger.error(
        MODULE_AGENT,
        `Failed to push to remote: ${error.message}`,
        timer.elapsed('main'),
        error
      );
    }

    logger.info(
      MODULE_AGENT,
      `Git workflow completed for quest ${quest.questId}`,
      timer.elapsed('main')
    );
  } catch (error: any) {
    logger.error(
      MODULE_AGENT,
      `Failed to trigger git workflow: ${error.message}`,
      timer.elapsed('main'),
      error
    );
    throw error;
  }
}

// ============================================================================
// Main Handler
// ============================================================================

/**
 * Handle task approval command from Discord
 *
 * @param client - KĀDI client instance
 * @param message - Discord message text
 * @returns Approval result or null if not a task approval command
 */
export async function handleTaskApproval(
  client: KadiClient,
  message: string
): Promise<TaskApprovalResult | null> {
  // Parse command
  const command = parseTaskApprovalCommand(message);

  if (!command) {
    return null; // Not a task approval command
  }

  logger.info(
    MODULE_AGENT,
    `Processing task approval command: ${command.action} for task ${command.taskId}`,
    timer.elapsed('main')
  );

  try {
    // Verify task is ready for approval
    const { task, quest } = await verifyTaskReadyForApproval(client, command.taskId);

    // Execute appropriate action
    switch (command.action) {
      case 'approve':
        return await approveTask(client, task, quest);

      case 'reject':
        return await rejectTask(client, task);

      case 'request_changes':
        if (!command.feedback) {
          throw new Error('Feedback is required for requesting changes');
        }
        return await requestChanges(client, task, command.feedback);

      default:
        throw new Error(`Unknown action: ${command.action}`);
    }
  } catch (error: any) {
    logger.error(
      MODULE_AGENT,
      `Failed to handle task approval: ${error.message}`,
      timer.elapsed('main'),
      error
    );

    return {
      success: false,
      message: `❌ Error: ${error.message}`,
    };
  }
}
