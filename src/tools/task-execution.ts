/**
 * Task Execution Tool Registration
 *
 * Triggers task execution by publishing task.assigned events to worker agents.
 * Converts the handler logic from task-execution.ts into a KĀDI tool that can be
 * called by the Discord bot's LLM.
 *
 * Flow:
 * 1. Get quest ID (use provided or find latest with assigned tasks)
 * 2. Get all assigned tasks for the quest
 * 3. Publish task.assigned event for each task to 'utility' network
 * 4. Return summary of triggered tasks
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
 * Task assigned event payload
 */
interface TaskAssignedEvent {
  taskId: string;
  questId: string;
  role: string;
  description: string;
  requirements: string;
  timestamp: string;
  assignedBy: string;
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
      // Get all assigned tasks
      const result = await client.invokeRemote<{
        content: Array<{ type: string; text: string }>;
      }>('quest_quest_query_task', {
        questId,
        status: 'assigned'
      });

      const resultText = result.content[0].text;
      const tasksData = JSON.parse(resultText);

      return tasksData.tasks || [];
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
 * Publish task.assigned event for a single task
 */
export async function publishTaskAssignedEvent(
  client: KadiClient,
  task: Task,
  questId: string,
  assignedBy: string
): Promise<void> {
  try {
    const role = task.assignedTo?.replace('agent-', '') || 'unknown';

    // Update task status to 'in_progress' before publishing event
    logger.info(
      MODULE_AGENT,
      `Updating task ${task.taskId} status to 'in_progress'`,
      timer.elapsed('main')
    );

    await client.invokeRemote('quest_quest_update_task', {
      questId,
      taskId: task.taskId,
      status: 'in_progress',
      agentId: task.assignedTo || 'unknown',
    });

    logger.info(
      MODULE_AGENT,
      `Task ${task.taskId} status updated to 'in_progress'`,
      timer.elapsed('main')
    );

    const eventPayload: TaskAssignedEvent = {
      taskId: task.taskId,
      questId,
      role,
      description: task.description,
      requirements: task.implementationGuide || task.description,
      timestamp: new Date().toISOString(),
      assignedBy
    };

    await client.publish('task.assigned', eventPayload, {
      broker: 'default',
      network: 'global'
    });

    logger.info(
      MODULE_AGENT,
      `Published task.assigned event for task ${task.taskId} (${task.name})`,
      timer.elapsed('main')
    );
  } catch (error: any) {
    logger.error(
      MODULE_AGENT,
      `Failed to publish task.assigned event for task ${task.taskId}: ${error.message}`,
      timer.elapsed('main'),
      error
    );
    throw error;
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
   * Triggers task execution by publishing task.assigned events to worker agents.
   * Can execute all assigned tasks in a quest or a specific task.
   *
   * @param params - Input parameters matching TaskExecutionInput schema
   * @returns Execution result with triggered task count
   *
   * @example
   * ```typescript
   * // Execute all assigned tasks in latest quest
   * const result = await client.invokeTool('task_execution', {});
   *
   * // Execute all assigned tasks in specific quest
   * const result = await client.invokeTool('task_execution', {
   *   questId: 'quest-123'
   * });
   *
   * // Execute specific task
   * const result = await client.invokeTool('task_execution', {
   *   questId: 'quest-123',
   *   taskId: 'task-456'
   * });
   * ```
   */
  client.registerTool({
    name: 'task_execution',
    description: 'Trigger task execution by publishing task.assigned events to worker agents. Can execute all assigned tasks in a quest or a specific task.',
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

      // Step 2: Get assigned tasks — prefer explicit taskIds to avoid race condition
      let assignedTasks: Task[];
      if (params.taskIds && params.taskIds.length > 0) {
        // Fetch each task by ID directly (avoids race condition with assign_task)
        logger.info(MODULE_AGENT, `Using explicit taskIds: ${params.taskIds.join(', ')}`, timer.elapsed('main'));
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
        `Found ${assignedTasks.length} assigned task(s)`,
        timer.elapsed('main')
      );

      // Step 3: Publish task.assigned events
      logger.info(
        MODULE_AGENT,
        `Publishing task.assigned events to 'global' network...`,
        timer.elapsed('main')
      );

      let publishedCount = 0;
      const triggeredTaskIds: string[] = [];

      // Import taskChannelMap for storing channel context
      const { taskChannelMap } = await import('../index.js');

      // Resolve channel context: ALWAYS prefer quest's conversationContext (LLM-provided _context is unreliable)
      let resolvedContext: typeof params._context | undefined = undefined;
      if (questId) {
        try {
          const questResult = await client.invokeRemote<{
            content: Array<{ type: string; text: string }>;
          }>('quest_quest_query_quest', {
            questId,
            detail: 'full',
          });
          const questData = JSON.parse(questResult.content[0].text);
          const ctx = questData.conversationContext;
          if (ctx?.channelId) {
            resolvedContext = {
              type: ctx.platform || 'discord',
              channelId: ctx.channelId,
              userId: ctx.userId,
              threadTs: ctx.threadTs,
            };
            logger.info(
              MODULE_AGENT,
              `Resolved channel context from quest conversationContext: ${ctx.platform || 'discord'} channel ${ctx.channelId}`,
              timer.elapsed('main')
            );
          }
        } catch {
          logger.warn(MODULE_AGENT, `Could not resolve channel context from quest`, timer.elapsed('main'));
        }
      }
      // Only fall back to _context if quest lookup failed (e.g. direct bot invocation without quest)
      if (!resolvedContext && params._context?.channelId) {
        resolvedContext = params._context;
        logger.info(
          MODULE_AGENT,
          `Using caller-provided _context as fallback: ${params._context.type} channel ${params._context.channelId}`,
          timer.elapsed('main')
        );
      }

      for (const task of assignedTasks) {
        try {
          await publishTaskAssignedEvent(client, task, questId, 'discord-bot');
          publishedCount++;
          triggeredTaskIds.push(task.taskId);

          // Store channel context for later use by failure/rejection handlers
          if (resolvedContext) {
            taskChannelMap.set(task.taskId, {
              type: resolvedContext.type,
              channelId: resolvedContext.channelId,
              userId: resolvedContext.userId,
              threadTs: resolvedContext.threadTs,
            });

            logger.info(
              MODULE_AGENT,
              `Stored channel context for task ${task.taskId}: ${resolvedContext.type} channel ${resolvedContext.channelId}`,
              timer.elapsed('main')
            );
          }
        } catch (error) {
          logger.warn(
            MODULE_AGENT,
            `Skipping task ${task.taskId} due to publish error`,
            timer.elapsed('main')
          );
        }
      }

      // Step 4: Return result
      if (publishedCount === 0) {
        return {
          success: false,
          message: 'Failed to publish task execution events. Please check the logs.',
          tasksTriggered: 0,
          questId,
          taskIds: []
        };
      }

      const workerAgents = [...new Set(assignedTasks.map(t => t.assignedTo))].join(', ');

      return {
        success: true,
        message: `✅ Task execution triggered successfully!\n\n📊 Execution Summary:\n- Tasks triggered: ${publishedCount}\n- Events published to: 'utility' network\n- Worker agents notified: ${workerAgents}\n\n🚀 Worker agents will now execute the tasks.`,
        tasksTriggered: publishedCount,
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

          await client.invokeRemote('discord_server_send_message', {
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
