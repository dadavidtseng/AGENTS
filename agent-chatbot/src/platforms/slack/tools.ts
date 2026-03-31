/**
 * Slack Tools Registration
 * ========================
 *
 * Registers slack_send_message and slack_send_reply tools with the KĀDI broker.
 * Uses the shared SlackPlatformClient for Web API calls.
 */

import { z } from '@kadi.build/core';
import type { KadiClient } from '@kadi.build/core';
import type { SlackPlatformClient } from './client.js';
import { logger, MODULE_SLACK_BOT, timer } from 'agents-library';

const sendMessageInput = z.object({
  channel: z.string().describe('Channel ID or name (e.g., #general, C12345)'),
  text: z.string().describe('Message text to send'),
  thread_ts: z.string().optional().describe('Optional thread timestamp to reply in thread'),
});

const sendMessageOutput = z.object({
  success: z.boolean(),
  message: z.string().optional(),
  ts: z.string().optional(),
  channel: z.string().optional(),
  error: z.string().optional(),
});

const sendReplyInput = z.object({
  channel: z.string().describe('Channel ID where the thread exists'),
  thread_ts: z.string().describe('Thread timestamp to reply to'),
  text: z.string().describe('Reply message text'),
});

const sendReplyOutput = z.object({
  success: z.boolean(),
  message: z.string().optional(),
  ts: z.string().optional(),
  channel: z.string().optional(),
  error: z.string().optional(),
});

const addReactionInput = z.object({
  channel: z.string().describe('Channel ID where the message exists'),
  timestamp: z.string().describe('Message timestamp to react to (e.g., "1234567890.123456")'),
  emoji: z.string().describe('Emoji name without colons (e.g., "thumbsup", "white_check_mark", "eyes")'),
});

const addReactionOutput = z.object({
  success: z.boolean(),
  error: z.string().optional(),
});

/**
 * Register Slack tools on the KĀDI client.
 */
export function registerSlackTools(
  client: KadiClient,
  slack: SlackPlatformClient,
  brokerNetworksMap: Record<string, string[]>,
): void {
  const brokers = Object.fromEntries(
    Object.entries(brokerNetworksMap).map(([k, v]) => [k, { networks: v }]),
  );

  client.registerTool(
    {
      name: 'slack_send_message',
      description: 'Send a message to a Slack channel. Can optionally send in a thread.',
      input: sendMessageInput,
      output: sendMessageOutput,
    },
    async (params) => {
      try {
        const result = await slack.sendMessage(params.channel, params.text, params.thread_ts);
        logger.debug(MODULE_SLACK_BOT, `Message sent to ${params.channel} (ts: ${result.ts})`, timer.elapsed('main'));
        return { success: true, message: 'Message sent successfully', ts: result.ts, channel: result.channel };
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        logger.error(MODULE_SLACK_BOT, `send_message error: ${msg}`, timer.elapsed('main'));
        return { success: false, error: msg };
      }
    },
    { brokers },
  );

  client.registerTool(
    {
      name: 'slack_send_reply',
      description: 'Reply in a Slack thread. Maintains conversation context.',
      input: sendReplyInput,
      output: sendReplyOutput,
    },
    async (params) => {
      try {
        const result = await slack.sendReply(params.channel, params.thread_ts, params.text);
        logger.debug(MODULE_SLACK_BOT, `Reply sent in thread ${params.thread_ts}`, timer.elapsed('main'));
        return { success: true, message: 'Reply sent successfully', ts: result.ts, channel: result.channel };
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        logger.error(MODULE_SLACK_BOT, `send_reply error: ${msg}`, timer.elapsed('main'));
        return { success: false, error: msg };
      }
    },
    { brokers },
  );

  client.registerTool(
    {
      name: 'slack_add_reaction',
      description: 'Add an emoji reaction to a Slack message.',
      input: addReactionInput,
      output: addReactionOutput,
    },
    async (params) => {
      try {
        await slack.addReaction(params.channel, params.timestamp, params.emoji);
        logger.debug(MODULE_SLACK_BOT, `Reaction :${params.emoji}: added to ${params.timestamp}`, timer.elapsed('main'));
        return { success: true };
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        logger.error(MODULE_SLACK_BOT, `add_reaction error: ${msg}`, timer.elapsed('main'));
        return { success: false, error: msg };
      }
    },
    { brokers },
  );
}
