/**
 * agent-producer - KĀDI Agent for Multi-Agent Orchestration
 * ===========================================================
 *
 * Purpose:
 * Agent orchestrator that coordinates worker agents (artist, designer, programmer)
 * via KĀDI event-driven protocol. Provides tools accessible from Claude Code/Desktop
 * and Slack/Discord channels through KĀDI broker.
 *
 * Architecture:
 * - KĀDI Agent: Registers tools with broker via kadiClient.registerTool()
 * - MCP Upstream: Forwards task management to mcp-shrimp-task-manager via kadiClient.load()
 * - Event Publisher: Publishes task assignment events to worker agents
 *
 * Tools:
 * - plan_task: Create and assign tasks to worker agents
 * - list_active_tasks: Query current task status
 * - get_task_status: Get detailed task information
 * - assign_task: Assign validated tasks to worker agents
 * - approve_completion: Approve task completion and trigger git merge
 *
 * Event Flow:
 * 1. User calls tool (via Claude Code/Desktop or Slack/Discord)
 * 2. agent-producer validates and forwards to mcp-shrimp-task-manager
 * 3. agent-producer publishes '{role}.task.assigned' event via KĀDI
 * 4. Worker agent receives event, executes task, commits to playground
 * 5. Worker agent publishes '{role}.task.completed' event
 * 6. agent-producer receives completion, awaits user approval
 *
 * @module agent-producer
 * @version 1.0.0
 * @license MIT
 */

import 'dotenv/config';
import { KadiClient, z } from '@kadi.build/core';
import { ClaudeOrchestrator } from './helpers/claude-orchestrator.js';
import { createPlanTaskHandler, planTaskInputSchema, planTaskOutputSchema } from './tools/plan-task.js';
import { createListActiveTasksHandler, listActiveTasksInputSchema, listActiveTasksOutputSchema } from './tools/list-tasks.js';
import { createGetTaskStatusHandler, getTaskStatusInputSchema, getTaskStatusOutputSchema } from './tools/task-status.js';
import { createAssignTaskHandler, assignTaskInputSchema, assignTaskOutputSchema } from './tools/assign-task.js';
import { setupTaskCompletionNotifier } from './handlers/task-completion-notifier.js';

// ============================================================================
// Tool Schemas (Imported from tool modules)
// ============================================================================

// planTaskInputSchema, planTaskOutputSchema - imported from ./tools/plan-task.js
// listActiveTasksInputSchema, listActiveTasksOutputSchema - imported from ./tools/list-tasks.js
// getTaskStatusInputSchema, getTaskStatusOutputSchema - imported from ./tools/task-status.js
// assignTaskInputSchema, assignTaskOutputSchema - imported from ./tools/assign-task.js

/**
 * Input schema for approve_completion tool
 */
const approveCompletionInputSchema = z.object({
  taskId: z.string().describe('Task ID to approve'),
  summary: z.string().describe('Summary of completion verification and approval'),
  score: z.number().min(0).max(100).describe('Quality score (0-100)')
});

/**
 * Output schema for approve_completion tool
 */
const approveCompletionOutputSchema = z.object({
  taskId: z.string(),
  status: z.string(),
  message: z.string().describe('Approval confirmation message')
});

// ============================================================================
// Type Inference from Schemas
// ============================================================================

// PlanTaskInput, PlanTaskOutput - imported from ./tools/plan-task.js
// ListActiveTasksInput, ListActiveTasksOutput - imported from ./tools/list-tasks.js
// GetTaskStatusInput, GetTaskStatusOutput - imported from ./tools/task-status.js
type ApproveCompletionInput = z.infer<typeof approveCompletionInputSchema>;
type ApproveCompletionOutput = z.infer<typeof approveCompletionOutputSchema>;

// ============================================================================
// Configuration
// ============================================================================

const config = {
  brokerUrl: process.env.KADI_BROKER_URL || 'ws://localhost:8080',
  networks: ['global', 'slack', 'discord', 'utility']
};

// ============================================================================
// KĀDI Client
// ============================================================================

/**
 * KĀDI protocol client instance
 *
 * This client handles:
 * - WebSocket connection to broker
 * - Tool registration with broker
 * - Event publishing to worker agents
 * - MCP upstream calls to mcp-shrimp-task-manager
 */
const client = new KadiClient({
  name: 'agent-producer',
  version: '1.0.0',
  role: 'agent',
  broker: config.brokerUrl,
  networks: config.networks
});

// Add error handler to prevent crashes from subscription timeouts
client.on('error', (error: Error) => {
  console.error('⚠️  KĀDI Client Error (non-fatal):', error.message);
  // Log but don't crash - these are often transient issues
});

// ============================================================================
// Channel Context Tracking
// ============================================================================

/**
 * Maps task IDs to their originating channel context
 * Used to send notifications back to the channel where the task was assigned
 */
export const taskChannelMap = new Map<string, {
  type: 'slack' | 'discord' | 'desktop';
  channelId?: string;
  userId?: string;
  threadTs?: string; // Slack thread timestamp for replying in thread
}>();

// ============================================================================
// Claude Orchestrator (for Option C workflow)
// ============================================================================

/**
 * Claude API orchestrator for intelligent task planning
 *
 * Provides AI-driven task refinement by orchestrating the complete shrimp workflow:
 * plan → analyze → reflect → split
 */
let orchestrator: ClaudeOrchestrator | null = null;

// Initialize orchestrator if ANTHROPIC_API_KEY is available
if (process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY !== 'YOUR_ANTHROPIC_API_KEY_HERE') {
  orchestrator = new ClaudeOrchestrator({
    client,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  });
  console.log('✅ Claude orchestrator initialized for Option C workflow');
} else {
  console.log('⏭️  Claude orchestrator disabled (set ANTHROPIC_API_KEY to enable Option C workflow)');
}

// ============================================================================
// Tool Definitions
// ============================================================================

/**
 * Plan Task Tool Registration
 *
 * Note: Tool registration uses imported schemas and handler factory
 */
const planTaskHandler = await createPlanTaskHandler(client, orchestrator);
client.registerTool({
  name: 'plan_task',
  description: 'Create and assign a task to worker agents (artist, designer, or programmer). Uses AI-driven workflow orchestration for intelligent task planning with Claude API refinement.',
  input: planTaskInputSchema,
  output: planTaskOutputSchema
}, planTaskHandler);

/**
 * List Active Tasks Tool Registration
 *
 * Note: Tool registration uses imported schemas and handler factory
 */
const listActiveTasksHandler = await createListActiveTasksHandler(client);
client.registerTool({
  name: 'list_active_tasks',
  description: `List all active tasks across all worker agents with optional status filtering. Queries mcp-shrimp-task-manager for current task state.

IMPORTANT OUTPUT FORMAT:
When presenting results to users, ALWAYS format the task list as follows:
1. Display tasks in numerical order (sorted by task ID)
2. Use this exact format for each task:
   [Task ID] - [Task Name]
3. Include a header showing the total count
4. Example format:

   Active Tasks (Total: 3):
   1. 08532952-04c1-4afb-93bd-ed674446bfd8 - Implement Monitoring and Auditing
   2. 14bc4c95-fd88-4680-957f-5185ad522501 - Create placeholder task for testing purposes
   3. 5166ce3c-fdc6-42f6-a1e6-d9975ba38bdc - Placeholder Task for Testing

Do NOT summarize or paraphrase - show the complete numbered list with IDs and names.`,
  input: listActiveTasksInputSchema,
  output: listActiveTasksOutputSchema
}, listActiveTasksHandler);

/**
 * Get Task Status Tool Registration
 *
 * Note: Tool registration uses imported schemas and handler factory
 */
const getTaskStatusHandler = await createGetTaskStatusHandler(client);
client.registerTool({
  name: 'get_task_status',
  description: 'Get detailed status of a specific task including worker agent progress, file operations, and error logs. Queries mcp-shrimp-task-manager for task details.',
  input: getTaskStatusInputSchema,
  output: getTaskStatusOutputSchema
}, getTaskStatusHandler);

/**
 * Assign Task Tool Registration
 *
 * Note: Tool registration uses imported schemas and handler factory
 */
const assignTaskHandler = await createAssignTaskHandler(client);
client.registerTool({
  name: 'assign_task',
  description: 'Assign a task to a worker agent (artist, designer, or programmer). Validates task existence and publishes KĀDI event for worker agent to receive and execute. Supports explicit role assignment or auto-detection from task metadata.',
  input: assignTaskInputSchema,
  output: assignTaskOutputSchema
}, assignTaskHandler);

/**
 * Approve Completion Tool
 *
 * Approves task completion and triggers final verification via mcp-shrimp-task-manager.
 * Publishes approval notification event.
 *
 * @param params - Task ID to approve with completion summary and score
 * @returns Approval confirmation
 */
client.registerTool({
  name: 'approve_completion',
  description: 'Approve task completion and trigger final git merge. Validates completion criteria via mcp-shrimp-task-manager and publishes approval notification.',
  input: approveCompletionInputSchema,
  output: approveCompletionOutputSchema
}, async (params: ApproveCompletionInput): Promise<ApproveCompletionOutput> => {
  console.log(`✅ Approving task completion: ${params.taskId} (score: ${params.score})`);
  console.log(`🔍 [DEBUG] approve_completion params:`, JSON.stringify(params, null, 2));

  try {
    // Get broker protocol for direct tool invocation
    const protocol = client.getBrokerProtocol();

    const toolInput = {
      taskId: params.taskId,
      summary: params.summary,
      score: params.score
    };
    console.log(`🔍 [DEBUG] Calling shrimp_verify_task with:`, JSON.stringify(toolInput, null, 2));

    // Forward to shrimp_verify_task via broker protocol
    const result: any = await protocol.invokeTool({
      targetAgent: 'mcp-server-shrimp-agent-playground',
      toolName: 'shrimp_verify_task',
      toolInput: toolInput,
      timeout: 30000
    });

    console.log(`🔍 [DEBUG] shrimp_verify_task result:`, JSON.stringify(result, null, 2));

    // Check if shrimp returned an error
    if (result.isError) {
      const errorText = Array.isArray(result.content)
        ? result.content.filter((item: any) => item.type === 'text').map((item: any) => item.text).join('\n')
        : String(result.content || result);

      console.error(`❌ Shrimp verification failed: ${errorText}`);

      // Publish failure event
      client.publishEvent('task.approval.failed', {
        taskId: params.taskId,
        error: errorText,
        agent: 'agent-producer'
      });

      throw new Error(`Task verification failed: ${errorText}`);
    }

    console.log(`✅ Task ${params.taskId} approved successfully`);

    // Publish approval event
    client.publishEvent('task.approved', {
      taskId: params.taskId,
      score: params.score,
      agent: 'agent-producer'
    });
    console.log(`📤 Published task.approved event`);

    return {
      taskId: params.taskId,
      status: result.status || 'approved',
      message: `Task ${params.taskId} approved with score ${params.score}`
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`❌ Failed to approve task: ${errorMsg}`);

    // Publish error event
    client.publishEvent('task.approval.failed', {
      taskId: params.taskId,
      error: errorMsg,
      agent: 'agent-producer'
    });

    throw new Error(`Failed to approve task: ${errorMsg}`);
  }
});

// ============================================================================
// Task Completion Event Handlers
// ============================================================================

/**
 * Setup event handlers for task completion notifications
 * Subscribes to {role}.task.completed events from worker agents
 */
async function setupTaskCompletionHandlers(client: KadiClient): Promise<void> {
  const roles = ['artist', 'designer', 'programmer'];
  for (const role of roles) {
    const topic = `${role}.task.completed`;
    await client.subscribeToEvent(topic, async (event: any) => {
      await handleTaskCompletion(event, role, client);
    });
    console.log(`✅ Subscribed to ${topic}`);
  }
}

/**
 * Handle task completion event from worker agent
 * Validates completion criteria and publishes ready-for-approval event
 */
async function handleTaskCompletion(event: any, role: string, client: KadiClient): Promise<void> {
  try {
    const { taskId, filesCreated, filesModified, commitSha } = event.data || {};

    console.log(`📥 Received ${role}.task.completed event`, {
      taskId,
      filesCreated: filesCreated?.length || 0,
      filesModified: filesModified?.length || 0,
      commitSha: commitSha?.substring(0, 7)
    });

    // Validate task exists and get current status
    // Use mcp-shrimp-task-manager directly to avoid circular calls
    const protocol = client.getBrokerProtocol();
    const taskStatusRaw: any = await protocol.invokeTool({
      targetAgent: 'mcp-server-shrimp-agent-playground',
      toolName: 'shrimp_get_task_detail',
      toolInput: { taskId },
      timeout: 30000
    });

    console.log(`🔍 [DEBUG] Task status raw result:`, JSON.stringify(taskStatusRaw, null, 2));

    // Parse task details from markdown format
    const detailContent = Array.isArray(taskStatusRaw.content)
      ? taskStatusRaw.content.filter((item: any) => item.type === 'text').map((item: any) => item.text).join('\n')
      : String(taskStatusRaw);

    const nameMatch = detailContent.match(/###\s+([^\n]+)/);
    const statusMatch = detailContent.match(/\*\*Status:\*\*\s*(\w+)/i);

    if (!nameMatch || !statusMatch) {
      console.error(`❌ Failed to parse task status for ${taskId}`);
      client.publishEvent('task.completion.processing.failed', {
        taskId,
        role,
        error: 'Task status parsing failed',
        agent: 'agent-producer'
      });
      return;
    }

    const taskStatus = {
      taskId,
      description: nameMatch[1].trim(),
      status: statusMatch[1].toLowerCase()
    };

    // Validate completion criteria
    const isValid = validateTaskCompletion({
      taskId,
      commitSha,
      filesCreated,
      filesModified,
      taskStatus
    });

    if (isValid) {
      // Get channel context from map (if available)
      const channelContext = taskChannelMap.get(taskId);

      // Publish ready for approval event with channel context
      client.publishEvent('task.ready_for_approval', {
        taskId,
        role,
        taskName: taskStatus.description,
        message: `✅ ${taskStatus.description} completed by ${role} agent`,
        completionDetails: {
          filesCreated: filesCreated || [],
          filesModified: filesModified || [],
          commitSha,
          completedAt: new Date().toISOString()
        },
        channel: channelContext || { type: 'desktop' }, // Default to desktop if no context
        agent: 'agent-producer'
      });
      console.log(`✅ Task ${taskId} ready for user approval${channelContext ? ` (notifying via ${channelContext.type})` : ' (desktop notification)'}`);
    } else {
      // Publish review failed event
      client.publishEvent('task.review.failed', {
        taskId,
        role,
        reason: 'Completion criteria not met',
        agent: 'agent-producer'
      });
      console.error(`❌ Task ${taskId} failed automated review`);
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`❌ Failed to process ${role}.task.completed event:`, errorMsg);

    client.publishEvent('task.completion.processing.failed', {
      taskId: event.data?.taskId,
      role,
      error: errorMsg,
      agent: 'agent-producer'
    });
  }
}

/**
 * Validate task completion data meets requirements
 * Checks for commit SHA, file changes, and task status
 */
function validateTaskCompletion(data: any): boolean {
  const checks = {
    hasCommit: !!data.commitSha,
    hasFileChanges: (data.filesCreated?.length > 0) || (data.filesModified?.length > 0),
    statusValid: data.taskStatus?.status !== 'completed'
  };

  const passed = Object.values(checks).every(check => check);

  if (!passed) {
    console.warn(`⚠️  Task completion validation failed:`, checks);
  }

  return passed;
}

// ============================================================================
// Main Application Entry Point
// ============================================================================

/**
 * Main application entry point
 * Connects to KĀDI broker and starts serving tools
 */
async function main() {
  try {
    console.log('[agent-producer] Connecting to KĀDI broker...');
    console.log(`[agent-producer] Broker URL: ${config.brokerUrl}`);
    console.log(`[agent-producer] Networks: ${config.networks.join(', ')}`);
    console.log('[agent-producer] Registered tools:');
    console.log('  - plan_task: Create and assign tasks to worker agents');
    console.log('  - list_active_tasks: List all active tasks');
    console.log('  - get_task_status: Get detailed task status');
    console.log('  - assign_task: Assign tasks to worker agents');
    console.log('  - approve_completion: Approve task completion');
    console.log();

    // CRITICAL: serve() is blocking - all logs must come BEFORE this line
    // Connect to broker and start serving tool invocations
    // The broker will route tool calls to this agent based on network membership

    // Start Slack Bot after connection is established (async after serve starts)
    const shouldEnableSlackBot = (process.env.ENABLE_SLACK_BOT === 'true' || process.env.ENABLE_SLACK_BOT === undefined) &&
                                  process.env.ANTHROPIC_API_KEY &&
                                  process.env.ANTHROPIC_API_KEY !== 'YOUR_ANTHROPIC_API_KEY_HERE';
    if (shouldEnableSlackBot) {
      console.log('🔄 Slack bot will start after broker connection...');
      console.log();

      // Give serve() a moment to establish connection, then start Slack bot
      setTimeout(async () => {
        try {
          const { SlackBot } = await import('./bot/slack-bot.js');
          const slackBot = new SlackBot({
            client,
            anthropicApiKey: process.env.ANTHROPIC_API_KEY!,
            botUserId: process.env.SLACK_BOT_USER_ID!,
          });
          slackBot.start();
          console.log('✅ Slack bot started (subscribed to Slack mention events)');
        } catch (error) {
          console.error('❌ Failed to start Slack bot:', error);
        }
      }, 2000); // Wait 2 seconds for broker connection
    } else {
      console.log('⏭️  Slack bot disabled (set ENABLE_SLACK_BOT=true and configure ANTHROPIC_API_KEY to enable)');
      console.log();
    }

    // Start Discord Bot after connection is established (async after serve starts)
    const shouldEnableDiscordBot = (process.env.ENABLE_DISCORD_BOT === 'true' || process.env.ENABLE_DISCORD_BOT === undefined) &&
                                    process.env.ANTHROPIC_API_KEY &&
                                    process.env.ANTHROPIC_API_KEY !== 'YOUR_ANTHROPIC_API_KEY_HERE';
    if (shouldEnableDiscordBot) {
      console.log('🔄 Discord bot will start after broker connection...');
      console.log();

      // Give serve() a moment to establish connection, then start Discord bot
      setTimeout(async () => {
        try {
          const { DiscordBot } = await import('./bot/discord-bot.js');
          const discordBot = new DiscordBot({
            client,
            anthropicApiKey: process.env.ANTHROPIC_API_KEY!,
            botUserId: process.env.DISCORD_BOT_USER_ID!,
          });
          discordBot.start();
          console.log('✅ Discord bot started (subscribed to Discord mention events)');
        } catch (error) {
          console.error('❌ Failed to start Discord bot:', error);
        }
      }, 2000); // Wait 2 seconds for broker connection
    } else {
      console.log('⏭️  Discord bot disabled (set ENABLE_DISCORD_BOT=true and configure ANTHROPIC_API_KEY to enable)');
      console.log();
    }

    // Setup task completion event handlers after bots are initialized
    setTimeout(async () => {
      try {
        await setupTaskCompletionHandlers(client);
        console.log('✅ Task completion event handlers registered');
      } catch (error) {
        console.error('❌ Failed to setup task completion handlers:', error);
      }
    }, 2000);

    // Setup task completion notifier for user notifications
    setTimeout(async () => {
      try {
        await setupTaskCompletionNotifier(client);
        console.log('✅ Task completion notifier registered');
      } catch (error) {
        console.error('❌ Failed to setup task completion notifier:', error);
      }
    }, 2000);

    // Connect to KĀDI broker and start serving (BLOCKING - never returns)
    await client.serve('broker');
  } catch (error) {
    console.error('[agent-producer] ❌ Fatal error:', error);
    process.exit(1);
  }
}

// Start the application
main().catch(console.error);
