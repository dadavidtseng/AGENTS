/**
 * Task Completion Event Handler for Agent Producer
 * =================================================
 *
 * Subscribes to task.completed events from worker agents on 'utility' network.
 * Verifies task completion, records results, and sends Discord notifications.
 *
 * Flow:
 * 1. Subscribe to task.completed events on 'utility' network
 * 2. Receive event from worker agent with completion details
 * 3. Call quest_verify_task to verify completion
 * 4. Call quest_submit_task_result to record completion
 * 5. Send Discord notification with completion summary
 *
 * Integration:
 * - Uses KadiClient.subscribe() for event subscription
 * - Uses quest_verify_task and quest_submit_task_result via KĀDI broker
 * - Sends notifications to Discord channel where task was assigned
 */

import type { KadiClient } from '@kadi.build/core';
import { logger, MODULE_AGENT, timer } from 'agents-library';

// ============================================================================
// Types
// ============================================================================

interface TaskCompletedEvent {
  taskId: string;
  questId: string;
  role: string;
  status: 'completed';
  filesCreated: string[];
  filesModified: string[];
  commitSha: string;
  timestamp: string;
  agent: string;
}

interface TaskVerificationResult {
  success: boolean;
  taskId: string;
  verified: boolean;
  score: number;
  message: string;
}

// ============================================================================
// Task Verification
// ============================================================================

/**
 * Verify task completion
 *
 * Calls quest_verify_task to verify task completion
 *
 * @param client - KĀDI client instance
 * @param event - Task completed event
 * @returns Verification result
 */
/**
 * Verify task completion using LLM
 *
 * Uses LLM to analyze task completion against verificationCriteria
 * and calculate a verification score (0-100)
 *
 * @param providerManager - Provider manager for LLM access
 * @param event - Task completed event
 * @param verificationCriteria - Verification criteria from task details
 * @param taskDetails - Full task details including description and requirements
 * @returns Verification result with score and summary
 */
async function verifyTaskCompletion(
  providerManager: any,
  event: TaskCompletedEvent,
  verificationCriteria: string,
  taskDetails: any
): Promise<{ score: number; summary: string; feedback: string }> {
  logger.info(
    MODULE_AGENT,
    `Verifying task completion with LLM: ${event.taskId}`,
    timer.elapsed('main')
  );

  try {
    // Build LLM prompt for verification
    const verificationPrompt = `You are a task verification expert. Analyze the following task completion and provide a verification score.

Task Description:
${taskDetails.description || 'No description provided'}

Task Requirements/Implementation Guide:
${taskDetails.implementationGuide || 'No specific requirements provided'}

Completion Details:
- Task ID: ${event.taskId}
- Completed by: ${event.agent}
- Files created: ${event.filesCreated.length} (${event.filesCreated.join(', ')})
- Files modified: ${event.filesModified.length} (${event.filesModified.join(', ')})
- Commit SHA: ${event.commitSha}

Verification Criteria:
${verificationCriteria}

IMPORTANT INSTRUCTIONS:
1. Only verify what was EXPLICITLY required in the task description and requirements above
2. Do NOT add extra requirements or expectations beyond what was specified
3. Do NOT penalize for missing documentation, checksums, or other details unless they were explicitly required
4. Focus on whether the core task objectives were met

Based ONLY on the task description and requirements above, provide:
1. A verification score (0-100) where:
   - 0-79: Task needs revision or retry
   - 80-100: Task is ready for human approval
2. A brief summary of what was accomplished
3. Feedback for improvement (if score < 80) or confirmation (if score >= 80)

Respond in JSON format:
{
  "score": <number 0-100>,
  "summary": "<brief summary of accomplishment>",
  "feedback": "<feedback or confirmation>"
}`;

    // Call LLM for verification
    const llmResult = await providerManager.chat(
      [
        {
          role: 'user',
          content: verificationPrompt,
        },
      ],
      {
        model: undefined, // Use last selected model
      }
    );

    if (!llmResult.success) {
      throw new Error(`LLM verification failed: ${llmResult.error.message}`);
    }

    // Parse LLM response
    const responseText = llmResult.data;
    
    // Extract JSON from response (handle markdown code blocks)
    let jsonText = responseText;
    const jsonMatch = responseText.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
    if (jsonMatch) {
      jsonText = jsonMatch[1];
    }

    const verificationResult = JSON.parse(jsonText);

    logger.info(
      MODULE_AGENT,
      `LLM verification score: ${verificationResult.score}/100`,
      timer.elapsed('main')
    );

    return {
      score: verificationResult.score,
      summary: verificationResult.summary,
      feedback: verificationResult.feedback,
    };
  } catch (error: any) {
    logger.error(
      MODULE_AGENT,
      `Failed to verify task with LLM: ${error.message}`,
      timer.elapsed('main'),
      error
    );
    throw error;
  }
}

/**
 * Submit task completion result
 *
 * Calls quest_submit_task_result to record task completion
 *
 * @param client - KĀDI client instance
 * @param event - Task completed event
 * @returns Submission result
 */
/**
 * Record task verification result
 *
 * Calls quest_verify_task to record the LLM verification score
 *
 * @param client - KĀDI client instance
 * @param event - Task completed event
 * @param score - Verification score (0-100)
 * @param summary - Verification summary
 * @returns Verification result
 */
async function recordTaskVerification(
  client: KadiClient,
  event: TaskCompletedEvent,
  score: number,
  summary: string
): Promise<TaskVerificationResult> {
  logger.info(
    MODULE_AGENT,
    `Recording task verification: ${event.taskId} (score: ${score})`,
    timer.elapsed('main')
  );

  try {
    // Call quest_verify_task tool via KĀDI broker
    const result = await client.invokeRemote<{
      content: Array<{ type: string; text: string }>;
    }>('quest_quest_verify_task', {
      taskId: event.taskId,
      summary,
      score,
      verifiedBy: 'agent-producer',
    });

    // Parse result
    const resultText = result.content[0].text;

    // Log the raw result for debugging
    logger.debug(
      MODULE_AGENT,
      `Raw verification result: ${resultText.substring(0, 200)}`,
      timer.elapsed('main')
    );

    // Check if result is an error message
    if (resultText.startsWith('Error:') || resultText.startsWith('error:')) {
      throw new Error(`Tool returned error: ${resultText}`);
    }

    const verificationData = JSON.parse(resultText) as TaskVerificationResult;

    logger.info(
      MODULE_AGENT,
      `Task verification recorded: ${verificationData.verified ? 'VERIFIED' : 'FAILED'}`,
      timer.elapsed('main')
    );

    return verificationData;
  } catch (error: any) {
    logger.error(
      MODULE_AGENT,
      `Failed to record task verification: ${error.message}`,
      timer.elapsed('main'),
      error
    );
    throw error;
  }
}

// ============================================================================
// Discord Notification
// ============================================================================

/**
 * Send Discord notification for task completion
 *
 * Sends notification to the channel where the task was assigned
 *
 * @param client - KĀDI client instance
 * @param event - Task completed event
 * @param taskName - Task name
 */
/**
 * Send Discord notification for task approval request
 *
 * Sends notification to the channel where the task was assigned,
 * asking for human approval
 *
 * @param client - KĀDI client instance
 * @param event - Task completed event
 * @param taskName - Task name
 * @param score - Verification score
 * @param summary - Verification summary
 */
async function sendApprovalRequest(
  client: KadiClient,
  event: TaskCompletedEvent,
  taskName: string,
  score: number,
  summary: string
): Promise<void> {
  try {
    // Get task channel context from map (if available)
    const { taskChannelMap } = await import('../index.js');
    const channelContext = taskChannelMap.get(event.taskId);

    if (!channelContext || channelContext.type !== 'discord') {
      logger.info(
        MODULE_AGENT,
        'No Discord channel context found for task, skipping approval request',
        timer.elapsed('main')
      );
      return;
    }

    // Build approval request message
    const message = `🔍 Task verification complete - Approval needed!

📋 Task: ${taskName}
🤖 Agent: ${event.agent}
📊 Verification Score: ${score}/100
📁 Files created: ${event.filesCreated.length}
📝 Files modified: ${event.filesModified.length}
🔗 Commit: ${event.commitSha.substring(0, 7)}

✅ Summary: ${summary}

Please review the changes and respond with:
• "approve task ${event.taskId}" to approve
• "reject task ${event.taskId}" to reject and retry
• "request changes for task ${event.taskId}" to provide feedback`;

    // Send Discord message via mcp-server-discord
    await client.invokeRemote('discord_server_send_message', {
      channel: channelContext.channelId,
      text: message,
    });

    logger.info(
      MODULE_AGENT,
      `Approval request sent to Discord channel ${channelContext.channelId}`,
      timer.elapsed('main')
    );
  } catch (error: any) {
    logger.error(
      MODULE_AGENT,
      `Failed to send approval request: ${error.message}`,
      timer.elapsed('main'),
      error
    );
    // Don't throw - notification failure shouldn't block task verification
  }
}

// ============================================================================
// Event Handler
// ============================================================================

/**
 * Handle task.completed event
 *
 * @param client - KĀDI client instance
 * @param event - Task completed event
 */
/**
 * Handle task.completed event
 *
 * Implements the complete verification workflow:
 * 1. Fetch task details and verification criteria
 * 2. Use LLM to calculate verification score (0-100)
 * 3. Record verification with quest_verify_task
 * 4. If score >= 80: Publish task.ready_for_approval and request human approval
 * 5. If score < 80: Publish task.failed and republish task.assigned to retry
 *
 * @param client - KĀDI client instance
 * @param providerManager - Provider manager for LLM access
 * @param event - Task completed event
 */
async function handleTaskCompletedEvent(
  client: KadiClient,
  providerManager: any,
  event: TaskCompletedEvent
): Promise<void> {
  logger.info(
    MODULE_AGENT,
    `Received task.completed event: ${event.taskId} from ${event.agent}`,
    timer.elapsed('main')
  );

  try {
    // Step 1: Fetch task details to get verification criteria
    logger.info(
      MODULE_AGENT,
      'Fetching task details for verification criteria...',
      timer.elapsed('main')
    );

    const taskDetailsResponse = await client.invokeRemote<{
      content: Array<{ type: string; text: string }>;
    }>('quest_quest_query_task', {
      taskId: event.taskId,
    });

    const taskDetailsText = taskDetailsResponse.content[0].text;
    const taskDetailsData = JSON.parse(taskDetailsText);
    const taskDetails = taskDetailsData.task;
    const questId = taskDetailsData.questContext?.questId || event.questId;
    const taskName = taskDetails.name || event.taskId;
    const verificationCriteria = taskDetails.verificationCriteria || 'No specific criteria provided';

    logger.info(
      MODULE_AGENT,
      `Task details fetched: ${taskName}`,
      timer.elapsed('main')
    );

    // Step 2: Use LLM to verify task and calculate score
    const verification = await verifyTaskCompletion(
      providerManager,
      event,
      verificationCriteria,
      taskDetails
    );

    // Step 2.5: Update task status to 'completed' before verification
    // The quest_verify_task tool requires the task to be in 'completed' status
    logger.info(
      MODULE_AGENT,
      `Updating task status to 'completed': ${event.taskId}`,
      timer.elapsed('main')
    );

    try {
      // Check current status and handle retry scenario
      const currentStatus = taskDetails.status;
      
      if (currentStatus === 'needs_revision') {
        logger.info(
          MODULE_AGENT,
          `Task in 'needs_revision' state, transitioning through 'in_progress' first`,
          timer.elapsed('main')
        );
        
        await client.invokeRemote('quest_quest_update_task', {
          questId,
          taskId: event.taskId,
          status: 'in_progress',
          agentId: event.agent,
        });
        
        logger.info(
          MODULE_AGENT,
          `Task status updated to 'in_progress'`,
          timer.elapsed('main')
        );
        
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
      await client.invokeRemote('quest_quest_update_task', {
        questId,
        taskId: event.taskId,
        status: 'completed',
        agentId: event.agent,
      });

      logger.info(
        MODULE_AGENT,
        `Task status updated to 'completed'`,
        timer.elapsed('main')
      );
    } catch (error: any) {
      logger.error(
        MODULE_AGENT,
        `Failed to update task status: ${error.message}`,
        timer.elapsed('main'),
        error
      );
      throw error;
    }

    // Add a small delay to allow database write to complete
    logger.info(
      MODULE_AGENT,
      'Waiting 1000ms for database write to complete...',
      timer.elapsed('main')
    );
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Step 3: Record verification result
    await recordTaskVerification(
      client,
      event,
      verification.score,
      verification.summary
    );

    // Step 4: Score-based decision making
    if (verification.score >= 80) {
      // High score: Request human approval
      logger.info(
        MODULE_AGENT,
        `Task scored ${verification.score}/100 - requesting human approval`,
        timer.elapsed('main')
      );

      // Publish task.ready_for_approval event
      await client.publish(
        'task.ready_for_approval',
        {
          taskId: event.taskId,
          questId: event.questId,
          role: event.role,
          taskName: taskName,
          message: verification.summary,
          completionDetails: {
            filesCreated: event.filesCreated,
            filesModified: event.filesModified,
            commitSha: event.commitSha,
            completedAt: new Date().toISOString(),
          },
          score: verification.score,
          summary: verification.summary,
          agent: event.agent,
        },
        {
          broker: 'default',
          network: 'global',
        }
      );

      logger.info(
        MODULE_AGENT,
        'Published task.ready_for_approval event',
        timer.elapsed('main')
      );

      // Send Discord approval request
      await sendApprovalRequest(
        client,
        event,
        taskName,
        verification.score,
        verification.summary
      );

      logger.info(
        MODULE_AGENT,
        `Task ${event.taskId} awaiting human approval`,
        timer.elapsed('main')
      );
    } else {
      // Low score: Retry task
      logger.info(
        MODULE_AGENT,
        `Task scored ${verification.score}/100 - triggering retry`,
        timer.elapsed('main')
      );

      // Publish task.failed event
      await client.publish(
        'task.failed',
        {
          taskId: event.taskId,
          questId: event.questId,
          role: event.role,
          reason: 'verification_failed',
          score: verification.score,
          feedback: verification.feedback,
          error: `Verification failed with score ${verification.score}/100. ${verification.feedback}`,
          agent: event.agent,
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

      // Republish task.assigned event with feedback for retry
      // IMPORTANT: Match the worker agent's expected schema (description + requirements)
      await client.publish(
        'task.assigned',
        {
          taskId: event.taskId,
          questId: event.questId,
          role: event.role,
          description: taskDetails.description || taskName || 'Task retry',
          requirements: taskDetails.implementationGuide || taskDetails.description || '',
          timestamp: new Date().toISOString(),
          assignedBy: 'system-retry',
          // Optional fields for retry context
          feedback: verification.feedback,
          retryAttempt: (taskDetails.retryAttempt || 0) + 1,
        },
        {
          broker: 'default',
          network: 'global',
        }
      );

      logger.info(
        MODULE_AGENT,
        `Task ${event.taskId} republished for retry with feedback`,
        timer.elapsed('main')
      );

      // Send Discord notification about retry
      try {
        const { taskChannelMap } = await import('../index.js');
        const channelContext = taskChannelMap.get(event.taskId);

        if (channelContext && channelContext.type === 'discord') {
          const retryMessage = `⚠️ Task needs revision

📋 Task: ${taskName}
🤖 Agent: ${event.agent}
📊 Verification Score: ${verification.score}/100

❌ Feedback: ${verification.feedback}

The task has been reassigned to ${event.agent} for retry.`;

          await client.invokeRemote('discord_server_send_message', {
            channel: channelContext.channelId,
            text: retryMessage,
          });

          logger.info(
            MODULE_AGENT,
            'Retry notification sent to Discord',
            timer.elapsed('main')
          );
        }
      } catch (error: any) {
        logger.error(
          MODULE_AGENT,
          `Failed to send retry notification: ${error.message}`,
          timer.elapsed('main'),
          error
        );
        // Don't throw - notification failure shouldn't block retry
      }
    }

    logger.info(
      MODULE_AGENT,
      `Task completion handled successfully: ${event.taskId}`,
      timer.elapsed('main')
    );
  } catch (error: any) {
    logger.error(
      MODULE_AGENT,
      `Failed to handle task.completed event: ${error.message}`,
      timer.elapsed('main'),
      error
    );
  }
}

// ============================================================================
// Event Subscription Setup
// ============================================================================

/**
 * Setup task completion event handler
 *
 * Subscribes to task.completed events on 'utility' network
 *
 * @param client - KĀDI client instance
 */
/**
 * Setup task completion event handler
 *
 * Subscribes to task.completed events on 'global' network
 *
 * @param client - KĀDI client instance
 * @param providerManager - Provider manager for LLM access
 */
/**
 * Setup task completion event handler
 *
 * Subscribes to role-specific task.completed events (artist, designer, programmer)
 *
 * @param client - KĀDI client instance
 * @param providerManager - Provider manager for LLM access
 */
export async function setupTaskCompletionHandler(
  client: KadiClient,
  providerManager: any
): Promise<void> {
  logger.info(
    MODULE_AGENT,
    'Setting up task completion event handler...',
    timer.elapsed('main')
  );

  try {
    // Subscribe to role-specific task.completed events
    const roles = ['artist', 'designer', 'programmer'];
    
    for (const role of roles) {
      const topic = `${role}.task.completed`;
      
      await client.subscribe(
        topic,
        async (event: any) => {
          logger.info(
            MODULE_AGENT,
            `🔔 NEW handler received ${topic} event`,
            timer.elapsed('main')
          );

          // Extract event data from KĀDI envelope
          const eventData = (event as any)?.data || event;

          // Validate event has required fields
          if (!eventData.taskId || !eventData.questId || !eventData.agent) {
            logger.warn(
              MODULE_AGENT,
              `Received invalid ${topic} event (missing required fields)`,
              timer.elapsed('main')
            );
            return;
          }

          // Handle event
          await handleTaskCompletedEvent(client, providerManager, eventData as TaskCompletedEvent);
        },
        {
          broker: 'default',
        }
      );

      logger.info(
        MODULE_AGENT,
        `Subscribed to ${topic} for LLM verification`,
        timer.elapsed('main')
      );
    }

    logger.info(
      MODULE_AGENT,
      'Task completion event handler registered successfully (all roles)',
      timer.elapsed('main')
    );
  } catch (error: any) {
    logger.error(
      MODULE_AGENT,
      `Failed to setup task completion handler: ${error.message}`,
      timer.elapsed('main'),
      error
    );
    throw error;
  }
}
