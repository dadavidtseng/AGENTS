/**
 * Task Execution Tool Registration
 *
 * Triggers task execution by publishing quest.tasks_ready to agent-lead.
 * Agent-lead then handles task assignment to worker agents based on role.
 *
 * Flow:
 * 1. Get quest ID (use provided or find latest with assigned tasks)
 * 2. Publish quest.tasks_ready event for agent-lead to pick up
 * 3. Return summary
 */

import { z } from '@kadi.build/core';
import type { KadiClient } from '@kadi.build/core';
import { logger, MODULE_AGENT, timer } from 'agents-library';

/**
 * Channel context for notifications
 */
export const channelContextSchema = z.object({
  type: z.enum(['discord', 'slack', 'desktop']).describe('Channel type'),
  channelId: z.string().optional().describe('Channel ID for notifications'),
  userId: z.string().optional().describe('User ID who triggered the task'),
  guildId: z.string().optional().describe('Guild/Server ID (Discord)'),
  threadTs: z.string().optional().describe('Thread timestamp (Slack)')
});

/**
 * Input schema for task_execution tool
 */
export const taskExecutionInputSchema = z.object({
  questId: z.string().optional().describe('Quest ID (optional, will use latest quest with assigned tasks if not provided)'),
  taskId: z.string().optional().describe('Specific task ID to execute (optional, will execute all assigned tasks if not provided)'),
  taskIds: z.array(z.string()).optional().describe('Explicit list of assigned task IDs to execute (preferred over re-querying by status)'),
  _context: channelContextSchema.optional().describe('Optional channel context for notifications (automatically injected by Discord/Slack bots)')
});

/**
 * Output schema for task_execution tool
 */
export const taskExecutionOutputSchema = z.object({
  success: z.boolean().describe('Whether task execution was triggered successfully'),
  message: z.string().describe('Human-readable result message'),
  tasksTriggered: z.number().describe('Number of tasks triggered'),
  questId: z.string().optional().describe('Quest ID that was processed'),
  taskIds: z.array(z.string()).describe('List of task IDs that were triggered')
});

/** Inferred TypeScript type for task_execution input */
export type TaskExecutionInput = z.infer<typeof taskExecutionInputSchema>;

/** Inferred TypeScript type for task_execution output */
export type TaskExecutionOutput = z.infer<typeof taskExecutionOutputSchema>;

/**
 * Task data structure
 */
export interface Task {
  taskId: string;
  name: string;
  description: string;
  status: string;
  assignedTo?: string;
  implementationGuide?: string;
  verificationCriteria?: string;
  dependencies?: string[];
  relatedFiles?: string[];
}

/**
 * Get latest quest with assigned tasks
 */
async function getLatestQuestWithAssignedTasks(client: KadiClient): Promise<string | null> {
  try {
    const result = await client.invokeRemote<{
      content: Array<{ type: string; text: string }>;
    }>('quest_quest_list_quest', {});

    const resultText = result.content[0].text;
    const questsData = JSON.parse(resultText);

    const activeQuests = questsData.quests?.filter(
      (q: any) => q.status === 'approved' || q.status === 'in_progress'
    );

    if (activeQuests && activeQuests.length > 0) {
      activeQuests.sort((a: any, b: any) => {
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });
      return activeQuests[0].questId;
    }

    return null;
  } catch (error: any) {
    logger.error(
      MODULE_AGENT,
      `Failed to get latest quest: ${error.message}`,
      timer.elapsed('main'),
      error
    );
    return null;
  }
}

/**
 * Get assigned tasks for quest
 */
export async function getAssignedTasks(client: KadiClient, questId: string, taskId?: string): Promise<Task[]> {
  try {
    if (taskId) {
      // Get specific task details
      const result = await client.invokeRemote<{
        content: Array<{ type: string; text: string }>;
      }>('quest_quest_query_task', {
        questId,
        taskId
      });

      const resultText = result.content[0].text;
      
      // Parse task details from JSON format
      let taskData: any;
      try {
        taskData = JSON.parse(resultText);
      } catch (parseError) {
        logger.warn(MODULE_AGENT, `Failed to parse task details JSON for ${taskId}`, timer.elapsed('main'));
        return [];
      }

      // Extract task from response
      const taskInfo = taskData.task || taskData;
      
      if (!taskInfo || !taskInfo.id) {
        logger.warn(MODULE_AGENT, `Task data missing or invalid for ${taskId}`, timer.elapsed('main'));
        return [];
      }

      const task: Task = {
        taskId: taskInfo.id,
        name: taskInfo.name || taskInfo.title || 'Unknown Task',
        description: taskInfo.description || taskInfo.name || 'No description',
        status: (taskInfo.status || 'unknown').toLowerCase(),
        assignedTo: taskInfo.assignedAgent || taskInfo.assignedTo || taskInfo.assigned_to,
        implementationGuide: taskInfo.implementationGuide || taskInfo.implementation_guide || resultText,
        verificationCriteria: taskInfo.verificationCriteria || taskInfo.verification_criteria,
        dependencies: taskInfo.dependencies,
        relatedFiles: taskInfo.relatedFiles || taskInfo.related_files
      };

      // Only return if task is assigned or in progress
      if (task.status === 'assigned' || task.status === 'in_progress') {
        return [task];
      }
      
      logger.info(MODULE_AGENT, `Task ${taskId} has status '${task.status}', not assigned or in_progress`, timer.elapsed('main'));
      return [];
    } else {
      // Get all in-progress tasks (quest_assign_task sets status to 'in_progress', not 'assigned')
      const result = await client.invokeRemote<{
        content: Array<{ type: string; text: string }>;
      }>('quest_quest_query_task', {
        questId,
        status: 'in_progress'
      });

      const resultText = result.content[0].text;
      const tasksData = JSON.parse(resultText);

      // Map raw API objects to Task interface
      // quest_query_task returns: taskId, taskName, taskDescription, assignedAgent
      const rawTasks: any[] = tasksData.tasks || [];
      return rawTasks.map((taskInfo: any) => ({
        taskId: taskInfo.taskId || taskInfo.id,
        name: taskInfo.taskName || taskInfo.name || taskInfo.title || 'Unknown Task',
        description: taskInfo.taskDescription || taskInfo.description || 'No description',
        status: (taskInfo.status || 'unknown').toLowerCase(),
        assignedTo: taskInfo.assignedAgent || taskInfo.assignedTo || taskInfo.assigned_to,
        implementationGuide: taskInfo.implementationGuide || taskInfo.implementation_guide,
        verificationCriteria: taskInfo.verificationCriteria || taskInfo.verification_criteria,
        dependencies: taskInfo.dependencies,
        relatedFiles: taskInfo.relatedFiles || taskInfo.related_files
      } as Task));
    }
  } catch (error: any) {
    logger.error(
      MODULE_AGENT,
      `Failed to get assigned tasks: ${error.message}`,
      timer.elapsed('main'),
      error
    );
    return [];
  }
}

/**
 * Register task_execution tool
 *
 * @param client - KĀDI client instance
 */
export function registerTaskExecutionTool(client: KadiClient): void {
  /**
   * Task Execution Tool
   *
   * Publishes quest.tasks_ready for agent-lead to pick up and assign to workers.
   */
  client.registerTool({
    name: 'task_execution',
    description: 'Trigger task execution by publishing quest.tasks_ready for agent-lead to assign tasks to worker agents.',
    input: taskExecutionInputSchema,
    output: taskExecutionOutputSchema
  }, async (params: TaskExecutionInput): Promise<TaskExecutionOutput> => {
    logger.info(MODULE_AGENT, 'Handling task execution trigger', timer.elapsed('main'));

    try {
      // Step 1: Get quest ID
      let questId: string | undefined = params.questId;
      if (!questId) {
        const foundQuestId = await getLatestQuestWithAssignedTasks(client);
        if (!foundQuestId) {
          return {
            success: false,
            message: 'No active quest found with assigned tasks. Please create and approve a quest first.',
            tasksTriggered: 0,
            questId: undefined,
            taskIds: []
          };
        }
        questId = foundQuestId;
      }

      logger.info(MODULE_AGENT, `Using quest ID: ${questId}`, timer.elapsed('main'));

      // Step 2: Verify there are assigned tasks
      let assignedTasks: Task[];
      if (params.taskIds && params.taskIds.length > 0) {
        const taskResults = await Promise.all(
          params.taskIds.map(id => getAssignedTasks(client, questId!, id))
        );
        assignedTasks = taskResults.flat();
      } else if (params.taskId) {
        assignedTasks = await getAssignedTasks(client, questId, params.taskId);
      } else {
        assignedTasks = await getAssignedTasks(client, questId);
      }

      if (assignedTasks.length === 0) {
        return {
          success: false,
          message: params.taskId
            ? `Task ${params.taskId} not found or not in assigned status.`
            : 'No assigned tasks found for the quest. Please assign tasks first.',
          tasksTriggered: 0,
          questId,
          taskIds: []
        };
      }

      logger.info(
        MODULE_AGENT,
        `Found ${assignedTasks.length} assigned task(s) — publishing quest.tasks_ready`,
        timer.elapsed('main')
      );

      // Step 3: Store channel context for later notifications
      const { taskChannelMap } = await import('../index.js');
      let resolvedContext: typeof params._context | undefined = undefined;

      try {
        const questResult = await client.invokeRemote<{
          content: Array<{ type: string; text: string }>;
        }>('quest_quest_query_quest', { questId, detail: 'full' });
        const questData = JSON.parse(questResult.content[0].text);
        const ctx = questData.conversationContext;
        if (ctx?.channelId) {
          resolvedContext = {
            type: ctx.platform || 'discord',
            channelId: ctx.channelId,
            userId: ctx.userId,
            threadTs: ctx.threadTs,
          };
        }
      } catch {
        // Fall back to caller-provided context
      }

      if (!resolvedContext && params._context?.channelId) {
        resolvedContext = params._context;
      }

      if (resolvedContext) {
        for (const task of assignedTasks) {
          taskChannelMap.set(task.taskId, {
            type: resolvedContext.type,
            channelId: resolvedContext.channelId,
            userId: resolvedContext.userId,
            threadTs: resolvedContext.threadTs,
          });
        }
      }

      // Step 4: Publish quest.tasks_ready — agent-lead handles assignment
      await client.publish('quest.tasks_ready', {
        questId,
      }, { broker: 'default', network: 'producer' });

      logger.info(MODULE_AGENT, `Published quest.tasks_ready for ${questId}`, timer.elapsed('main'));

      const triggeredTaskIds = assignedTasks.map(t => t.taskId);

      return {
        success: true,
        message: `✅ Task execution triggered!\n\n📊 Summary:\n- Quest: ${questId}\n- Tasks ready: ${assignedTasks.length}\n- Event: quest.tasks_ready published\n\n🚀 Agent-lead will assign tasks to worker agents.`,
        tasksTriggered: assignedTasks.length,
        questId,
        taskIds: triggeredTaskIds
      };
    } catch (error: any) {
      logger.error(
        MODULE_AGENT,
        `Failed to handle task execution: ${error.message}`,
        timer.elapsed('main'),
        error
      );
      return {
        success: false,
        message: `❌ Failed to trigger task execution: ${error.message}`,
        tasksTriggered: 0,
        taskIds: []
      };
    }
  });
}


/**
 * Subscribe to task.rejected events from worker agents
 *
 * When a worker agent rejects a task due to capability mismatch,
 * this handler:
 * 1. Updates the task status to 'rejected' via quest_quest_update_task
 * 2. Notifies the human via Discord with the rejection reason
 *
 * @param client - KĀDI client for broker communication
 */
export async function subscribeToTaskRejections(client: KadiClient): Promise<void> {
  const topic = 'task.rejected';

  logger.info(MODULE_AGENT, `📡 Subscribing to ${topic} events...`, timer.elapsed('main'));

  await client.subscribe(topic, async (event: unknown) => {
    try {
      const eventData = (event as any)?.data || event;

      logger.info(MODULE_AGENT, '', timer.elapsed('main'));
      logger.info(MODULE_AGENT, '🚫 Task rejection received', timer.elapsed('main'));
      logger.info(MODULE_AGENT, `   Raw event: ${JSON.stringify(eventData).substring(0, 300)}`, timer.elapsed('main'));

      const { taskId, questId, reason, agent } = eventData as {
        taskId: string;
        questId?: string;
        reason: string;
        agent: string;
      };

      logger.info(MODULE_AGENT, `   Task ID: ${taskId}`, timer.elapsed('main'));
      logger.info(MODULE_AGENT, `   Agent: ${agent}`, timer.elapsed('main'));
      logger.info(MODULE_AGENT, `   Reason: ${reason}`, timer.elapsed('main'));

      // Step 1: Update task status to 'rejected'
      if (questId) {
        try {
          await client.invokeRemote('quest_quest_update_task', {
            questId,
            taskId,
            status: 'rejected',
            agentId: agent,
          });
          logger.info(MODULE_AGENT, `   ✅ Task status updated to 'rejected'`, timer.elapsed('main'));
        } catch (updateError: any) {
          logger.warn(
            MODULE_AGENT,
            `   ⚠️  Failed to update task status: ${updateError.message}`,
            timer.elapsed('main'),
          );
        }
      }

      // Step 2: Notify human via Discord
      // Try taskChannelMap first, then fall back to quest conversation context
      const { taskChannelMap } = await import('../index.js');
      let channelId: string | undefined;

      const channelCtx = taskChannelMap.get(taskId);
      if (channelCtx?.channelId && channelCtx.type === 'discord') {
        channelId = channelCtx.channelId;
      }

      // Fall back to quest conversation context
      if (!channelId && questId) {
        try {
          const questResult = await client.invokeRemote<{
            content: Array<{ type: string; text: string }>;
          }>('quest_quest_query_quest', {
            questId,
            detail: 'full',
          });
          const questData = JSON.parse(questResult.content[0].text);
          const ctx = questData.conversationContext;
          if (ctx?.channelId && /^\d{17,20}$/.test(ctx.channelId)) {
            channelId = ctx.channelId;
          }
        } catch {
          // Ignore — no channel context available
        }
      }

      if (channelId) {
        try {
          const message = `⚠️ **Task Rejected by ${agent}**\n\n` +
            `**Task ID:** \`${taskId}\`\n` +
            (questId ? `**Quest ID:** \`${questId}\`\n` : '') +
            `**Reason:** ${reason}\n\n` +
            `The task has been unassigned and can be reassigned to a suitable agent.`;

          await client.invokeRemote('discord_send_message', {
            channel: channelId,
            text: message,
          });
          logger.info(MODULE_AGENT, `   ✅ Discord notification sent`, timer.elapsed('main'));
        } catch (discordError: any) {
          logger.warn(
            MODULE_AGENT,
            `   ⚠️  Failed to send Discord notification: ${discordError.message}`,
            timer.elapsed('main'),
          );
        }
      } else {
        logger.warn(
          MODULE_AGENT,
          `   ⚠️  No Discord channel found for task ${taskId} — skipping notification`,
          timer.elapsed('main'),
        );
      }

      logger.info(MODULE_AGENT, '', timer.elapsed('main'));
    } catch (error: any) {
      logger.error(
        MODULE_AGENT,
        `Error handling task.rejected event: ${error.message}`,
        timer.elapsed('main'),
        error,
      );
    }
  }, { broker: 'default' });

  logger.info(MODULE_AGENT, `   ✅ Subscribed to ${topic} events`, timer.elapsed('main'));
}
