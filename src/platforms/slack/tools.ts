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

/**
 * Register Slack tools on the KĀDI client.
 * Tools are scoped to the 'text' network.
 */
export function registerSlackTools(
  client: KadiClient,
  slack: SlackPlatformClient,
): void {
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
        console.log(`✅ [Slack] Message sent to ${params.channel} (ts: ${result.ts})`);
        return { success: true, message: 'Message sent successfully', ts: result.ts, channel: result.channel };
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        console.error('❌ [Slack] send_message error:', msg);
        return { success: false, error: msg };
      }
    },
    { brokers: { default: { networks: ['text'] } } },
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
        console.log(`✅ [Slack] Reply sent in thread ${params.thread_ts}`);
        return { success: true, message: 'Reply sent successfully', ts: result.ts, channel: result.channel };
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        console.error('❌ [Slack] send_reply error:', msg);
        return { success: false, error: msg };
      }
    },
    { brokers: { default: { networks: ['text'] } } },
  );

  console.log('✅ Registered Slack tools: slack_send_message, slack_send_reply');
}
