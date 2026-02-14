/**
 * Quest Approval Tool Registrations
 *
 * Three tools for quest-level approval decisions:
 * - quest_approve: Approve a quest plan
 * - quest_request_revision: Request revision of a quest plan
 * - quest_reject: Reject a quest plan
 *
 * Each tool calls mcp-server-quest's quest_submit_approval via KĀDI broker
 * with the appropriate decision type.
 *
 * Workflow context:
 * - Step 10a: HUMAN approves quest → quest_approve
 * - Step 10b: HUMAN requests revision → quest_request_revision
 * - Step 10c: HUMAN rejects quest → quest_reject
 */

import { z } from '@kadi.build/core';
import type { KadiClient } from '@kadi.build/core';
import { logger, MODULE_AGENT, timer } from 'agents-library';
import type { LlmOrchestrator } from '../services/llm-orchestrator.js';

// --- Lazy-injected orchestrator (set after providerManager is ready) ---

let orchestrator: LlmOrchestrator | null = null;

/**
 * Inject the LlmOrchestrator instance.
 * Called from tools/index.ts after providerManager is initialized.
 */
export function setQuestApprovalOrchestrator(o: LlmOrchestrator): void {
  orchestrator = o;
}

// --- Shared schemas ---

const approvalOutputSchema = z.object({
  success: z.boolean().describe('Whether the approval action succeeded'),
  message: z.string().describe('Human-readable result message'),
  questId: z.string().describe('Quest ID that was acted upon'),
  decision: z.string().describe('Decision that was submitted'),
});

type ApprovalOutput = z.infer<typeof approvalOutputSchema>;

// --- Helper ---

/**
 * Submit an approval decision to mcp-server-quest via KĀDI broker.
 * The KĀDI broker prefixes tool names with the server name, so
 * quest_submit_approval becomes quest_quest_submit_approval.
 */
async function submitQuestApproval(
  client: KadiClient,
  questId: string,
  decision: 'approved' | 'revision_requested' | 'rejected',
  feedback: string,
  userId: string,
  platform: string,
): Promise<ApprovalOutput> {
  try {
    const result = await client.invokeRemote<{
      content: Array<{ type: string; text: string }>;
    }>('quest_quest_submit_approval', {
      questId,
      decision,
      approvedBy: userId,
      approvedVia: platform,
      feedback: feedback || undefined,
      timestamp: new Date().toISOString(),
    });

    const resultText = result.content[0].text;
    const data = JSON.parse(resultText);

    return {
      success: true,
      message: data.message || `Quest ${decision} successfully`,
      questId,
      decision,
    };
  } catch (error: any) {
    logger.error(
      MODULE_AGENT,
      `Failed to submit quest approval (${decision}): ${error.message}`,
      timer.elapsed('main'),
      error
    );
    return {
      success: false,
      message: `Failed to ${decision} quest: ${error.message}`,
      questId,
      decision,
    };
  }
}

/**
 * Validate that a string is a Discord snowflake (numeric ID, 17-20 digits).
 * Prevents LLM from using hallucinated channel names like "#general".
 */
function isValidDiscordSnowflake(value: string): boolean {
  return /^\d{17,20}$/.test(value);
}

/**
 * Query quest record to get conversation context (channelId, platform, userId).
 * Used to determine where to send Discord notifications after approval decisions.
 * Only returns channelId if it's a valid Discord snowflake.
 */
async function getQuestConversationContext(
  client: KadiClient,
  questId: string,
): Promise<{ channelId: string; platform: string; userId: string } | null> {
  try {
    const result = await client.invokeRemote<{
      content: Array<{ type: string; text: string }>;
    }>('quest_quest_query_quest', {
      questId,
      detail: 'full',
    });

    const resultText = result.content[0].text;
    const data = JSON.parse(resultText);
    const ctx = data.conversationContext;

    if (ctx?.channelId && isValidDiscordSnowflake(ctx.channelId)) {
      return {
        channelId: ctx.channelId,
        platform: ctx.platform || 'unknown',
        userId: ctx.userId || 'unknown',
      };
    }

    if (ctx?.channelId) {
      logger.warn(
        MODULE_AGENT,
        `Invalid channelId "${ctx.channelId}" for quest ${questId} — not a Discord snowflake, skipping notification`,
        timer.elapsed('main'),
      );
    }

    return null;
  } catch (error: any) {
    logger.warn(
      MODULE_AGENT,
      `Failed to query quest context for ${questId}: ${error.message}`,
      timer.elapsed('main'),
    );
    return null;
  }
}

// --- Tool 1: quest_approve ---

const questApproveInputSchema = z.object({
  questId: z.string().describe('Quest ID to approve'),
  feedback: z.string().optional().describe('Optional approval comments'),
  userId: z.string().optional().describe('User ID who approved (default: dashboard)'),
  platform: z.enum(['discord', 'slack', 'dashboard']).optional().describe('Platform (default: dashboard)'),
});

type QuestApproveInput = z.infer<typeof questApproveInputSchema>;

export function registerQuestApproveTool(client: KadiClient): void {
  client.registerTool({
    name: 'quest_approve',
    description: 'Approve a quest plan. The quest must be in pending_approval status. After approval, the quest moves to approved status and is ready for task splitting.',
    input: questApproveInputSchema,
    output: approvalOutputSchema,
  }, async (params: QuestApproveInput): Promise<ApprovalOutput> => {
    logger.info(MODULE_AGENT, `Approving quest ${params.questId}`, timer.elapsed('main'));

    // Step 1: Record the approval decision
    const result = await submitQuestApproval(
      client,
      params.questId,
      'approved',
      params.feedback || '',
      params.userId || 'dashboard-user',
      params.platform || 'dashboard',
    );

    // Step 2: Invoke LLM to act on the approval (split tasks, assign, etc.)
    if (result.success && orchestrator) {
      logger.info(MODULE_AGENT, `[QuestApprove] Invoking LLM to proceed after approval of quest ${params.questId}`, timer.elapsed('main'));

      // Query quest for conversation context (channelId for Discord notification)
      const ctx = await getQuestConversationContext(client, params.questId);
      const notifyInstruction = ctx?.channelId
        ? `\n\nAfter completing all workflow steps, notify the user by calling discord_server_send_message with ONLY these parameters: channel="${ctx.channelId}", text="<your summary>". Do NOT pass any other parameters.`
        : '';

      const llmResult = await orchestrator.run({
        messages: [{
          role: 'user',
          content: `Quest "${params.questId}" has been APPROVED by the human reviewer.${params.feedback ? ` Feedback: "${params.feedback}"` : ''}

First, assess the quest complexity by calling quest_quest_plan_task with questId="${params.questId}" and a brief description. READ the returned prompt carefully — it contains the quest's requirements and design documents.

Then choose ONE of the following paths based on complexity:

═══════════════════════════════════════════════════════════════
PATH A — SIMPLE QUEST (single file/config change, one repo, one agent role)
═══════════════════════════════════════════════════════════════
1. Call quest_quest_list_agents to discover available worker roles.
2. Call quest_quest_split_task with questId="${params.questId}" and a MINIMAL task array.
   RULES:
   - Same agent + same repo = ONE task. Never split sequential git operations
     (branch, edit, commit, push) into separate tasks.
   - Each task must include a clear description, implementationGuide, and verificationCriteria.
3. Call quest_quest_assign_task to assign tasks.

═══════════════════════════════════════════════════════════════
PATH B — COMPLEX QUEST (multiple features, multiple agents/repos, architectural decisions)
═══════════════════════════════════════════════════════════════
1. Call quest_quest_analyze_task with a summary and initialConcept based on the planning prompt.
2. Call quest_quest_reflect_task with the analysis results.
3. Call quest_quest_list_agents to discover available worker roles.
4. Call quest_quest_split_task with questId="${params.questId}" and the task array derived from analysis.
   RULES:
   - Only create tasks for roles that have registered agents.
   - Same agent + same repo = ONE task, unless truly independent parallel workstreams.
   - When creating multiple tasks, ALWAYS set explicit dependencies between sequential tasks.
     Tasks without dependencies will be dispatched in parallel.
   - Include globalAnalysisResult from the analysis and reflection steps.
5. Call quest_quest_assign_task to assign tasks.

After tasks are created and assigned, follow the nextStep instructions in the assign response.${notifyInstruction}`,
        }],
      });

      if (llmResult.success && llmResult.response) {
        result.message += ` | LLM follow-up: ${llmResult.response.substring(0, 200)}`;
      }
    } else if (!orchestrator) {
      logger.warn(MODULE_AGENT, '[QuestApprove] Orchestrator not yet injected — skipping LLM follow-up', timer.elapsed('main'));
    }

    return result;
  });
}

// --- Tool 2: quest_request_revision ---

const questRequestRevisionInputSchema = z.object({
  questId: z.string().describe('Quest ID to request revision for'),
  feedback: z.string().describe('Revision feedback explaining what needs to change'),
  userId: z.string().optional().describe('User ID who requested revision (default: dashboard)'),
  platform: z.enum(['discord', 'slack', 'dashboard']).optional().describe('Platform (default: dashboard)'),
});

type QuestRequestRevisionInput = z.infer<typeof questRequestRevisionInputSchema>;

export function registerQuestRequestRevisionTool(client: KadiClient): void {
  client.registerTool({
    name: 'quest_request_revision',
    description: 'Request revision of a quest plan. The quest must be in pending_approval status. Feedback is required to explain what needs to change. The quest returns to draft status for revision.',
    input: questRequestRevisionInputSchema,
    output: approvalOutputSchema,
  }, async (params: QuestRequestRevisionInput): Promise<ApprovalOutput> => {
    logger.info(MODULE_AGENT, `Requesting revision for quest ${params.questId}`, timer.elapsed('main'));

    if (!params.feedback || params.feedback.trim().length === 0) {
      return {
        success: false,
        message: 'Feedback is required when requesting revision',
        questId: params.questId,
        decision: 'revision_requested',
      };
    }

    // Step 1: Record the revision decision
    const result = await submitQuestApproval(
      client,
      params.questId,
      'revision_requested',
      params.feedback,
      params.userId || 'dashboard-user',
      params.platform || 'dashboard',
    );

    // Step 2: Invoke LLM to revise the quest based on feedback
    if (result.success && orchestrator) {
      logger.info(MODULE_AGENT, `[QuestRevision] Invoking LLM to revise quest ${params.questId}`, timer.elapsed('main'));

      // Query quest for conversation context (channelId for Discord notification)
      const ctx = await getQuestConversationContext(client, params.questId);
      const notifyInstruction = ctx?.channelId
        ? `\n\nAfter revising and re-submitting, notify the user by calling discord_server_send_message with ONLY these parameters: channel="${ctx.channelId}", text="<your message explaining the quest was revised and re-submitted>". Do NOT pass any other parameters.`
        : '';

      const llmResult = await orchestrator.run({
        messages: [{
          role: 'user',
          content: `Quest "${params.questId}" has been sent back for REVISION by the human reviewer.\n\nRevision feedback: "${params.feedback}"\n\nPlease revise the quest based on this feedback using quest_update_quest, then re-submit for approval using quest_request_quest_approval.${notifyInstruction}`,
        }],
      });

      if (llmResult.success && llmResult.response) {
        result.message += ` | LLM follow-up: ${llmResult.response.substring(0, 200)}`;
      }
    } else if (!orchestrator) {
      logger.warn(MODULE_AGENT, '[QuestRevision] Orchestrator not yet injected — skipping LLM follow-up', timer.elapsed('main'));
    }

    return result;
  });
}

// --- Tool 3: quest_reject ---

const questRejectInputSchema = z.object({
  questId: z.string().describe('Quest ID to reject'),
  feedback: z.string().describe('Rejection reason'),
  userId: z.string().optional().describe('User ID who rejected (default: dashboard)'),
  platform: z.enum(['discord', 'slack', 'dashboard']).optional().describe('Platform (default: dashboard)'),
});

type QuestRejectInput = z.infer<typeof questRejectInputSchema>;

export function registerQuestRejectTool(client: KadiClient): void {
  client.registerTool({
    name: 'quest_reject',
    description: 'Reject a quest plan. The quest must be in pending_approval status. Feedback is required to explain the rejection reason. The quest moves to rejected status.',
    input: questRejectInputSchema,
    output: approvalOutputSchema,
  }, async (params: QuestRejectInput): Promise<ApprovalOutput> => {
    logger.info(MODULE_AGENT, `Rejecting quest ${params.questId}`, timer.elapsed('main'));

    if (!params.feedback || params.feedback.trim().length === 0) {
      return {
        success: false,
        message: 'Feedback is required when rejecting a quest',
        questId: params.questId,
        decision: 'rejected',
      };
    }

    // Step 1: Record the rejection decision
    const result = await submitQuestApproval(
      client,
      params.questId,
      'rejected',
      params.feedback,
      params.userId || 'dashboard-user',
      params.platform || 'dashboard',
    );

    // Step 2: Invoke LLM to acknowledge rejection and notify
    if (result.success && orchestrator) {
      logger.info(MODULE_AGENT, `[QuestReject] Invoking LLM to handle rejection of quest ${params.questId}`, timer.elapsed('main'));

      // Query quest for conversation context (channelId for Discord notification)
      const ctx = await getQuestConversationContext(client, params.questId);
      const notifyInstruction = ctx?.channelId
        ? `\n\nNotify the user by calling discord_server_send_message with ONLY these parameters: channel="${ctx.channelId}", text="<your message explaining the quest was rejected and the reason>". Do NOT pass any other parameters.`
        : '';

      const llmResult = await orchestrator.run({
        messages: [{
          role: 'user',
          content: `Quest "${params.questId}" has been REJECTED by the human reviewer.\n\nRejection reason: "${params.feedback}"\n\nAcknowledge the rejection. No further action is needed on this quest.${notifyInstruction}`,
        }],
      });

      if (llmResult.success && llmResult.response) {
        result.message += ` | LLM follow-up: ${llmResult.response.substring(0, 200)}`;
      }
    } else if (!orchestrator) {
      logger.warn(MODULE_AGENT, '[QuestReject] Orchestrator not yet injected — skipping LLM follow-up', timer.elapsed('main'));
    }

    return result;
  });
}
