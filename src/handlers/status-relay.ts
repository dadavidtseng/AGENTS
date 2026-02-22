/**
 * Status Relay Handler — relays agent-lead/agent-quest events to HUMAN
 *
 * Subscribes to events and forwards them as human-readable notifications
 * to the originating Discord/Slack channel.
 *
 * Events handled (per ARCHITECTURE_V2 / QUEST_WORKFLOW_V2):
 * - task.verified           → Per-task completion notification
 * - quest.pr_created        → PR link notification
 * - conflict.escalation     → Merge conflict alert
 * - quest.merged            → PR merged confirmation
 * - quest.completed         → Quest done summary
 *
 * @module handlers/status-relay
 */

import type { KadiClient } from '@kadi.build/core';
import { logger, MODULE_AGENT, timer } from 'agents-library';

// ============================================================================
// Types
// ============================================================================

interface TaskVerifiedPayload {
  questId: string;
  taskId: string;
  isQuestComplete?: boolean;
}

interface PrCreatedPayload {
  questId: string;
  prNumber?: number;
  prUrl: string;
}

interface ConflictEscalationPayload {
  questId: string;
  branch: string;
  targetBranch: string;
  conflictedFiles: string[];
  message: string;
  escalatedBy: string;
}

interface QuestMergedPayload {
  questId: string;
  prId?: string;
}

interface QuestPrRejectedPayload {
  questId: string;
  prId?: string;
}

interface QuestCompletedPayload {
  questId: string;
}

// ============================================================================
// Channel Resolution
// ============================================================================

/**
 * Resolve the Discord/Slack channel for a quest.
 * Checks taskChannelMap first, then falls back to quest conversationContext.
 */
async function resolveChannel(
  client: KadiClient,
  questId: string,
): Promise<{ type: 'discord' | 'slack'; channelId: string; threadTs?: string } | null> {
  // Try quest conversation context
  try {
    const resp = await client.invokeRemote<{
      content: Array<{ type: string; text: string }>;
    }>('quest_quest_query_quest', { questId, detail: 'full' });
    const questData = JSON.parse(resp.content[0].text);
    const ctx = questData.conversationContext;
    if (ctx?.channelId) {
      return {
        type: ctx.platform || 'discord',
        channelId: ctx.channelId,
        threadTs: ctx.threadTs,
      };
    }
  } catch {
    // No quest context available
  }

  // Fall back to taskChannelMap (any task in this quest)
  try {
    const { taskChannelMap } = await import('../index.js');
    for (const [, ctx] of taskChannelMap) {
      if (ctx.channelId && (ctx.type === 'discord' || ctx.type === 'slack')) {
        return { type: ctx.type, channelId: ctx.channelId, threadTs: ctx.threadTs };
      }
    }
  } catch {
    // No channel map available
  }

  return null;
}

/**
 * Send a message to the resolved channel (Discord or Slack).
 */
async function sendNotification(
  client: KadiClient,
  channel: { type: 'discord' | 'slack'; channelId: string; threadTs?: string },
  text: string,
): Promise<void> {
  if (channel.type === 'discord') {
    await client.invokeRemote('discord_send_message', {
      channel: channel.channelId,
      text,
    });
  } else {
    await client.invokeRemote('slack_send_message', {
      channel: channel.channelId,
      text,
      ...(channel.threadTs && { thread_ts: channel.threadTs }),
    });
  }
}

// ============================================================================
// Event Handlers
// ============================================================================

async function handleTaskVerified(client: KadiClient, event: unknown): Promise<void> {
  const data = ((event as any)?.data || event) as TaskVerifiedPayload;
  if (!data.questId) return;

  logger.info(MODULE_AGENT, `Task ${data.taskId} verified for quest ${data.questId}`, timer.elapsed('main'));

  const channel = await resolveChannel(client, data.questId);
  if (!channel) return;

  const msg = data.isQuestComplete
    ? `✅ **Task Verified** — All tasks complete!\n\n📦 Quest: ${data.questId}\n📋 Task: ${data.taskId}\n\nPR creation is in progress...`
    : `✅ **Task Verified**\n\n📦 Quest: ${data.questId}\n📋 Task: ${data.taskId}`;

  await sendNotification(client, channel, msg);
}

async function handlePrCreated(client: KadiClient, event: unknown): Promise<void> {
  const data = ((event as any)?.data || event) as PrCreatedPayload;
  if (!data.questId) return;

  logger.info(MODULE_AGENT, `PR created for quest ${data.questId}: ${data.prUrl}`, timer.elapsed('main'));

  const channel = await resolveChannel(client, data.questId);
  if (!channel) return;

  const prLabel = data.prNumber ? `PR #${data.prNumber}` : 'Pull Request';
  const msg = `🔗 **${prLabel} Created**\n\n📦 Quest: ${data.questId}\n🔗 ${data.prUrl}\n\nPlease review and merge when ready.`;

  await sendNotification(client, channel, msg);
}

async function handleConflictEscalation(client: KadiClient, event: unknown): Promise<void> {
  const data = ((event as any)?.data || event) as ConflictEscalationPayload;
  if (!data.questId) return;

  logger.warn(MODULE_AGENT, `Merge conflict escalated for quest ${data.questId}`, timer.elapsed('main'));

  const channel = await resolveChannel(client, data.questId);
  if (!channel) return;

  const fileList = data.conflictedFiles.map(f => `  • ${f}`).join('\n');
  const msg = `⚠️ **Merge Conflict — Manual Resolution Required**\n\n📦 Quest: ${data.questId}\n🔀 ${data.branch} → ${data.targetBranch}\n📁 Conflicted files:\n${fileList}\n\n${data.message}\n\nPlease resolve the conflicts manually and push the result.`;

  await sendNotification(client, channel, msg);
}

async function handleQuestMerged(client: KadiClient, event: unknown): Promise<void> {
  const data = ((event as any)?.data || event) as QuestMergedPayload;
  if (!data.questId) return;

  logger.info(MODULE_AGENT, `Quest ${data.questId} PR merged`, timer.elapsed('main'));

  const channel = await resolveChannel(client, data.questId);
  if (!channel) return;

  const msg = `🎉 **PR Merged**\n\n📦 Quest: ${data.questId}\n\nThe pull request has been merged into main.`;

  await sendNotification(client, channel, msg);
}

async function handleQuestCompleted(client: KadiClient, event: unknown): Promise<void> {
  const data = ((event as any)?.data || event) as QuestCompletedPayload;
  if (!data.questId) return;

  logger.info(MODULE_AGENT, `Quest ${data.questId} completed`, timer.elapsed('main'));

  const channel = await resolveChannel(client, data.questId);
  if (!channel) return;

  const msg = `🏁 **Quest Completed**\n\n📦 Quest: ${data.questId}\n\nAll tasks verified, PR merged, and quest finalized.`;

  await sendNotification(client, channel, msg);
}

async function handleQuestPrRejected(client: KadiClient, event: unknown): Promise<void> {
  const data = ((event as any)?.data || event) as QuestPrRejectedPayload;
  if (!data.questId) return;

  logger.warn(MODULE_AGENT, `Quest ${data.questId} PR rejected`, timer.elapsed('main'));

  const channel = await resolveChannel(client, data.questId);
  if (!channel) return;

  const msg = `❌ **PR Rejected**\n\n📦 Quest: ${data.questId}\n\nThe pull request was closed without merging.\nWould you like to abandon this quest or rework it?`;

  await sendNotification(client, channel, msg);
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Subscribe to agent-lead and agent-quest status events and relay to HUMAN.
 *
 * @param client - Connected KadiClient instance
 */
export async function setupStatusRelay(client: KadiClient): Promise<void> {
  logger.info(MODULE_AGENT, 'Setting up status relay subscriptions...', timer.elapsed('main'));

  const sub = async (topic: string, handler: (c: KadiClient, e: unknown) => Promise<void>) => {
    await client.subscribe(topic, async (event: unknown) => {
      try { await handler(client, event); }
      catch (err: any) { logger.error(MODULE_AGENT, `Status relay error (${topic}): ${err.message}`, timer.elapsed('main'), err); }
    });
  };

  await sub('task.verified', handleTaskVerified);
  await sub('quest.pr_created', handlePrCreated);
  await sub('conflict.escalation', handleConflictEscalation);
  await sub('quest.merged', handleQuestMerged);
  await sub('quest.pr_rejected', handleQuestPrRejected);
  await sub('quest.completed', handleQuestCompleted);

  logger.info(MODULE_AGENT, 'Status relay subscriptions active', timer.elapsed('main'));
}
