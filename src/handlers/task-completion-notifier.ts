/**
 * Task Completion Notifier
 * ========================
 *
 * Handles sending task completion notifications to users via their current channel.
 * Supports Slack, Discord, and Claude Desktop (console log).
 *
 * This module listens to task.ready_for_approval events (published by task completion
 * event handlers) and routes notifications to the appropriate channel based on where
 * the user initiated the task.
 */

import { KadiClient } from '@kadi.build/core';
import { logger, MODULE_AGENT, timer } from 'agents-library';

/**
 * Task completion notification data
 */
export interface TaskCompletionData {
  taskId: string;
  role: string;
  taskName: string;
  message: string;
  completionDetails: {
    filesCreated: string[];
    filesModified: string[];
    commitSha: string;
    completedAt: string;
  };
  channel?: {
    type: 'slack' | 'discord' | 'desktop';
    channelId?: string;
    userId?: string;
    threadTs?: string; // Slack thread timestamp for replying in thread
  };
}

/**
 * Track recently notified tasks to prevent duplicates
 * Key: taskId, Value: timestamp
 */
const recentlyNotified = new Map<string, number>();
const DEDUP_WINDOW_MS = 5000; // 5 second deduplication window

/**
 * Setup notification handler for task completion
 * Subscribes to task.ready_for_approval events and routes to appropriate channel
 */
export async function setupTaskCompletionNotifier(client: KadiClient): Promise<void> {
  await client.subscribe('task.ready_for_approval', async (event: any) => {
    try {
      const data: TaskCompletionData = event.data;

      // Check if we've recently sent a notification for this task
      const now = Date.now();
      const lastNotified = recentlyNotified.get(data.taskId);

      if (lastNotified && (now - lastNotified) < DEDUP_WINDOW_MS) {
        logger.info(MODULE_AGENT, `Skipping duplicate notification for task ${data.taskId} (sent ${now - lastNotified}ms ago)`, timer.elapsed('main'));
        return;
      }

      // Record this notification
      recentlyNotified.set(data.taskId, now);

      // Clean up old entries (older than dedup window)
      for (const [taskId, timestamp] of recentlyNotified.entries()) {
        if (now - timestamp > DEDUP_WINDOW_MS) {
          recentlyNotified.delete(taskId);
        }
      }

      logger.info(MODULE_AGENT, `Sending task completion notification for task ${data.taskId}`, timer.elapsed('main'));
      await sendCompletionNotification(client, data);
    } catch (error) {
      logger.error(MODULE_AGENT, 'Failed to send task completion notification', timer.elapsed('main'), error as Error | string);
    }
  });

  logger.info(MODULE_AGENT, 'Subscribed to task.ready_for_approval events', timer.elapsed('main'));
}

/**
 * Send completion notification to appropriate channel
 */
async function sendCompletionNotification(
  client: KadiClient,
  data: TaskCompletionData
): Promise<void> {
  // Determine channel type from context (default to desktop if not specified)
  const channelType = data.channel?.type || 'desktop';

  switch (channelType) {
    case 'slack':
      await sendSlackNotification(client, data);
      break;
    case 'discord':
      await sendDiscordNotification(client, data);
      break;
    case 'desktop':
      sendDesktopNotification(data);
      break;
    default:
      logger.warn(MODULE_AGENT, `Unknown channel type: ${channelType}, defaulting to desktop`, timer.elapsed('main'));
      sendDesktopNotification(data);
  }
}

/**
 * Send notification to Slack channel
 */
async function sendSlackNotification(
  client: KadiClient,
  data: TaskCompletionData
): Promise<void> {
  try {
    const message = formatNotificationMessage(data);

    const toolInput: any = {
      channel: data.channel?.channelId || 'general',
      text: message
    };

    // If we have a thread timestamp, reply in thread
    if (data.channel?.threadTs) {
      toolInput.thread_ts = data.channel.threadTs;
    }

    await client.invokeRemote('slack_send_message', toolInput, {
      timeout: 10000
    });

    logger.info(MODULE_AGENT, `Sent Slack notification for task ${data.taskId}${data.channel?.threadTs ? ' (in thread)' : ''}`, timer.elapsed('main'));
  } catch (error) {
    logger.error(MODULE_AGENT, `Failed to send Slack notification`, timer.elapsed('main'), error as Error | string);
    // Fallback to desktop notification
    sendDesktopNotification(data);
  }
}

/**
 * Send notification to Discord channel
 */
async function sendDiscordNotification(
  client: KadiClient,
  data: TaskCompletionData
): Promise<void> {
  try {
    const message = formatNotificationMessage(data);

    await client.invokeRemote('discord_send_message', {
      channel: data.channel?.channelId || 'general',
      content: message  // Discord uses 'content' not 'text'
    }, {
      timeout: 10000
    });

    logger.info(MODULE_AGENT, `Sent Discord notification for task ${data.taskId}`, timer.elapsed('main'));
  } catch (error) {
    logger.error(MODULE_AGENT, `Failed to send Discord notification`, timer.elapsed('main'), error as Error | string);
    // Fallback to desktop notification
    sendDesktopNotification(data);
  }
}

/**
 * Send notification to Claude Desktop (console log)
 */
function sendDesktopNotification(data: TaskCompletionData): void {
  logger.info(MODULE_AGENT, '\n' + '='.repeat(80), timer.elapsed('main'));
  logger.info(MODULE_AGENT, '📋 TASK COMPLETION NOTIFICATION', timer.elapsed('main'));
  logger.info(MODULE_AGENT, '='.repeat(80), timer.elapsed('main'));
  logger.info(MODULE_AGENT, formatNotificationMessage(data), timer.elapsed('main'));
  logger.info(MODULE_AGENT, '='.repeat(80) + '\n', timer.elapsed('main'));
}

/**
 * Format notification message with task details
 */
function formatNotificationMessage(data: TaskCompletionData): string {
  const { taskId, role, taskName, completionDetails } = data;
  const { filesCreated, filesModified, commitSha, completedAt } = completionDetails;

  const lines = [
    `✅ Task Completed - Ready for Approval`,
    ``,
    `**Task ID:** ${taskId}`,
    `**Task Name:** ${taskName}`,
    `**Completed By:** ${role} agent`,
    `**Completed At:** ${new Date(completedAt).toLocaleString()}`,
    ``,
    `**Changes:**`,
  ];

  if (filesCreated.length > 0) {
    lines.push(`  📄 Files Created: ${filesCreated.length}`);
    filesCreated.forEach(file => lines.push(`     - ${file}`));
  }

  if (filesModified.length > 0) {
    lines.push(`  📝 Files Modified: ${filesModified.length}`);
    filesModified.forEach(file => lines.push(`     - ${file}`));
  }

  lines.push(``);
  lines.push(`**Git Commit:** ${commitSha.substring(0, 7)}`);
  lines.push(``);
  lines.push(`**Next Steps:**`);
  lines.push(`To approve this task, use: \`approve_completion\``);
  lines.push(`  - Task ID: ${taskId}`);
  lines.push(`  - Summary: (your review summary)`);
  lines.push(`  - Score: (0-100, recommended: 80+)`);

  return lines.join('\n');
}
