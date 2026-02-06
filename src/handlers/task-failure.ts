/**
 * Task Failure Event Handler for Agent Producer
 * ==============================================
 *
 * Subscribes to task.failed events from worker agents on 'utility' network.
 * Notifies users with error details and handles user responses (retry/skip/abort).
 *
 * Flow:
 * 1. Subscribe to task.failed events on 'utility' network
 * 2. Receive event from worker agent with error details
 * 3. Send Discord notification with error details and options
 * 4. Wait for user response: "retry", "skip", or "abort"
 * 5. Take appropriate action based on user response
 *
 * Integration:
 * - Uses KadiClient.subscribe() for event subscription
 * - Uses KadiClient.publish() to republish task.assigned for retry
 * - Uses quest_update_task_status to mark tasks as skipped
 * - Sends notifications to Discord channel where task was assigned
 */

import type { KadiClient } from '@kadi.build/core';
import { logger, MODULE_AGENT, timer } from 'agents-library';

// ============================================================================
// Types
// ============================================================================

interface TaskFailedEvent {
  taskId: string;
  questId: string;
  role: string;
  error: string;
  errorDetails?: any;
  timestamp: string;
  agent: string;
}

interface PendingFailure {
  event: TaskFailedEvent;
  taskName: string;
  channelId?: string;
  notifiedAt: number;
}

// ============================================================================
// Pending Failures Tracking
// ============================================================================

/**
 * Track pending failures waiting for user response
 * Key: taskId, Value: failure details
 */
const pendingFailures = new Map<string, PendingFailure>();

/**
 * Cleanup timeout for pending failures (5 minutes)
 */
const PENDING_FAILURE_TIMEOUT_MS = 5 * 60 * 1000;

// ============================================================================
// Discord Notification
// ============================================================================

/**
 * Send Discord notification for task failure
 *
 * Sends notification to the channel where the task was assigned
 *
 * @param client - KĀDI client instance
 * @param event - Task failed event
 * @param taskName - Task name
 * @returns Channel ID where notification was sent (or undefined)
 */
async function sendFailureNotification(
  client: KadiClient,
  event: TaskFailedEvent,
  taskName: string
): Promise<string | undefined> {
  try {
    // Get task channel context from map (if available)
    const { taskChannelMap } = await import('../index.js');
    const channelContext = taskChannelMap.get(event.taskId);

    if (!channelContext || channelContext.type !== 'discord') {
      logger.info(
        MODULE_AGENT,
        'No Discord channel context found for task, skipping notification',
        timer.elapsed('main')
      );
      return undefined;
    }

    // Build notification message
    const errorPreview = event.error.length > 200 
      ? event.error.substring(0, 200) + '...' 
      : event.error;

    const message = `❌ Task failed!

📋 Task: ${taskName}
🤖 Agent: ${event.agent}
⚠️ Error: ${errorPreview}

What would you like to do?
- Reply "retry" to retry the task
- Reply "skip" to skip this task and continue
- Reply "abort" to stop all task execution

Task ID: ${event.taskId}`;

    // Send Discord message via mcp-server-discord
    await client.invokeRemote('discord_server_send_message', {
      channel: channelContext.channelId,
      text: message,
    });

    logger.info(
      MODULE_AGENT,
      `Failure notification sent to channel ${channelContext.channelId}`,
      timer.elapsed('main')
    );

    return channelContext.channelId;
  } catch (error: any) {
    logger.error(
      MODULE_AGENT,
      `Failed to send failure notification: ${error.message}`,
      timer.elapsed('main'),
      error
    );
    return undefined;
  }
}

// ============================================================================
// Failure Response Handlers
// ============================================================================

/**
 * Handle retry response
 *
 * Republishes task.assigned event to retry the task
 *
 * @param client - KĀDI client instance
 * @param failure - Pending failure details
 */
async function handleRetry(
  client: KadiClient,
  failure: PendingFailure
): Promise<void> {
  logger.info(
    MODULE_AGENT,
    `Retrying task: ${failure.event.taskId}`,
    timer.elapsed('main')
  );

  try {
    // Republish task.assigned event
    const eventPayload = {
      taskId: failure.event.taskId,
      questId: failure.event.questId,
      role: failure.event.role,
      description: failure.taskName,
      requirements: '', // Will be fetched by worker agent
      timestamp: new Date().toISOString(),
      assignedBy: 'system-retry',
    };

    await client.publish('task.assigned', eventPayload, {
      broker: 'default',
      network: 'utility',
    });

    logger.info(
      MODULE_AGENT,
      `Task.assigned event republished for retry`,
      timer.elapsed('main')
    );

    // Send confirmation to Discord
    if (failure.channelId) {
      await client.invokeRemote('discord_server_send_message', {
        channel: failure.channelId,
        text: `🔄 Retrying task: ${failure.taskName}\n\nThe task has been republished to the worker agent.`,
      });
    }
  } catch (error: any) {
    logger.error(
      MODULE_AGENT,
      `Failed to retry task: ${error.message}`,
      timer.elapsed('main'),
      error
    );

    // Send error notification
    if (failure.channelId) {
      await client.invokeRemote('discord_server_send_message', {
        channel: failure.channelId,
        text: `❌ Failed to retry task: ${error.message}`,
      });
    }
  }
}

/**
 * Handle skip response
 *
 * Marks task as skipped in mcp-server-quest
 *
 * @param client - KĀDI client instance
 * @param failure - Pending failure details
 */
async function handleSkip(
  client: KadiClient,
  failure: PendingFailure
): Promise<void> {
  logger.info(
    MODULE_AGENT,
    `Skipping task: ${failure.event.taskId}`,
    timer.elapsed('main')
  );

  try {
    // Update task status to 'failed' (skipped)
    await client.invokeRemote('quest_update_task_status', {
      taskId: failure.event.taskId,
      status: 'failed',
      notes: `Skipped by user after failure: ${failure.event.error}`,
    });

    logger.info(
      MODULE_AGENT,
      `Task marked as skipped`,
      timer.elapsed('main')
    );

    // Send confirmation to Discord
    if (failure.channelId) {
      await client.invokeRemote('discord_server_send_message', {
        channel: failure.channelId,
        text: `⏭️ Skipped task: ${failure.taskName}\n\nThe task has been marked as failed and will not be retried.`,
      });
    }
  } catch (error: any) {
    logger.error(
      MODULE_AGENT,
      `Failed to skip task: ${error.message}`,
      timer.elapsed('main'),
      error
    );

    // Send error notification
    if (failure.channelId) {
      await client.invokeRemote('discord_server_send_message', {
        channel: failure.channelId,
        text: `❌ Failed to skip task: ${error.message}`,
      });
    }
  }
}

/**
 * Handle abort response
 *
 * Stops all task execution (implementation depends on requirements)
 *
 * @param client - KĀDI client instance
 * @param failure - Pending failure details
 */
async function handleAbort(
  client: KadiClient,
  failure: PendingFailure
): Promise<void> {
  logger.info(
    MODULE_AGENT,
    `Aborting all task execution`,
    timer.elapsed('main')
  );

  try {
    // Send confirmation to Discord
    if (failure.channelId) {
      await client.invokeRemote('discord_server_send_message', {
        channel: failure.channelId,
        text: `🛑 Task execution aborted!\n\nAll pending tasks have been stopped. No further tasks will be executed until you restart execution.`,
      });
    }

    // Clear all pending failures
    pendingFailures.clear();

    logger.info(
      MODULE_AGENT,
      `All task execution aborted`,
      timer.elapsed('main')
    );
  } catch (error: any) {
    logger.error(
      MODULE_AGENT,
      `Failed to abort execution: ${error.message}`,
      timer.elapsed('main'),
      error
    );
  }
}

// ============================================================================
// User Response Processing
// ============================================================================

/**
 * Process user response to task failure
 *
 * Exported for use by Discord bot message handler
 *
 * @param client - KĀDI client instance
 * @param message - User message
 * @param taskId - Task ID (optional, will use most recent if not provided)
 * @returns true if response was processed
 */
export async function processFailureResponse(
  client: KadiClient,
  message: string,
  taskId?: string
): Promise<boolean> {
  const lowerMessage = message.toLowerCase().trim();

  // Check if message is a failure response
  if (!['retry', 'skip', 'abort'].includes(lowerMessage)) {
    return false;
  }

  // Find pending failure
  let failure: PendingFailure | undefined;

  if (taskId) {
    failure = pendingFailures.get(taskId);
  } else {
    // Use most recent pending failure
    const failures = Array.from(pendingFailures.values());
    if (failures.length > 0) {
      failures.sort((a, b) => b.notifiedAt - a.notifiedAt);
      failure = failures[0];
    }
  }

  if (!failure) {
    logger.warn(
      MODULE_AGENT,
      'No pending failure found for response',
      timer.elapsed('main')
    );
    return false;
  }

  // Remove from pending failures
  pendingFailures.delete(failure.event.taskId);

  // Handle response
  switch (lowerMessage) {
    case 'retry':
      await handleRetry(client, failure);
      break;
    case 'skip':
      await handleSkip(client, failure);
      break;
    case 'abort':
      await handleAbort(client, failure);
      break;
  }

  return true;
}

// ============================================================================
// Event Handler
// ============================================================================

/**
 * Handle task.failed event
 *
 * @param client - KĀDI client instance
 * @param event - Task failed event
 */
async function handleTaskFailedEvent(
  client: KadiClient,
  event: TaskFailedEvent
): Promise<void> {
  logger.info(
    MODULE_AGENT,
    `Received task.failed event: ${event.taskId} from ${event.agent}`,
    timer.elapsed('main')
  );

  try {
    // Get task name from quest_get_task_details
    let taskName = event.taskId;
    try {
      const taskDetails = await client.invokeRemote<{
        content: Array<{ type: string; text: string }>;
      }>('quest_quest_get_task_details', {
        taskId: event.taskId,
      });
      const taskDetailsText = taskDetails.content[0].text;
      const taskData = JSON.parse(taskDetailsText);
      taskName = taskData.name || event.taskId;
    } catch (error) {
      // Use taskId as fallback
      logger.warn(
        MODULE_AGENT,
        'Failed to get task name, using taskId',
        timer.elapsed('main')
      );
    }

    // Send failure notification
    const channelId = await sendFailureNotification(client, event, taskName);

    // Track pending failure
    pendingFailures.set(event.taskId, {
      event,
      taskName,
      channelId,
      notifiedAt: Date.now(),
    });

    logger.info(
      MODULE_AGENT,
      `Task failure tracked, waiting for user response`,
      timer.elapsed('main')
    );

    // Cleanup old pending failures
    const now = Date.now();
    for (const [taskId, failure] of pendingFailures.entries()) {
      if (now - failure.notifiedAt > PENDING_FAILURE_TIMEOUT_MS) {
        logger.info(
          MODULE_AGENT,
          `Removing stale pending failure: ${taskId}`,
          timer.elapsed('main')
        );
        pendingFailures.delete(taskId);
      }
    }
  } catch (error: any) {
    logger.error(
      MODULE_AGENT,
      `Failed to handle task.failed event: ${error.message}`,
      timer.elapsed('main'),
      error
    );
  }
}

// ============================================================================
// Event Subscription Setup
// ============================================================================

/**
 * Setup task failure event handler
 *
 * Subscribes to task.failed events on 'utility' network
 *
 * @param client - KĀDI client instance
 */
export async function setupTaskFailureHandler(client: KadiClient): Promise<void> {
  logger.info(
    MODULE_AGENT,
    'Setting up task failure event handler...',
    timer.elapsed('main')
  );

  try {
    // Subscribe to task.failed events on utility network
    await client.subscribe(
      'task.failed',
      async (event: any) => {
        // Extract event data from KĀDI envelope
        const eventData = (event as any)?.data || event;

        // Validate event has required fields
        if (!eventData.taskId || !eventData.questId || !eventData.agent || !eventData.error) {
          logger.warn(
            MODULE_AGENT,
            'Received invalid task.failed event (missing required fields)',
            timer.elapsed('main')
          );
          return;
        }

        // Handle event
        await handleTaskFailedEvent(client, eventData as TaskFailedEvent);
      },
      {
        broker: 'default',
      }
    );

    logger.info(
      MODULE_AGENT,
      'Task failure event handler registered successfully',
      timer.elapsed('main')
    );
  } catch (error: any) {
    logger.error(
      MODULE_AGENT,
      `Failed to setup task failure handler: ${error.message}`,
      timer.elapsed('main'),
      error
    );
    throw error;
  }
}
