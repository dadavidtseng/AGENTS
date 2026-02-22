/**
 * Discord Tools Registration
 * ==========================
 *
 * Registers discord_send_message and discord_send_reply tools with the KĀDI broker.
 * Uses the shared DiscordPlatformClient for REST API calls.
 */

import { z } from '@kadi.build/core';
import type { KadiClient } from '@kadi.build/core';
import type { DiscordPlatformClient } from './client.js';

// Input schemas
const sendMessageInput = z.object({
  channel: z.string().describe('Channel ID or name (e.g., general, 1234567890)'),
  text: z.string().describe('Message text to send'),
  message_id: z.string().optional().describe('Optional message ID to reply to'),
});

const sendMessageOutput = z.object({
  success: z.boolean(),
  message: z.string().optional(),
  messageId: z.string().optional(),
  channelId: z.string().optional(),
  error: z.string().optional(),
});

const sendReplyInput = z.object({
  channel: z.string().describe('Channel ID where the message exists'),
  message_id: z.string().describe('Message ID to reply to'),
  text: z.string().describe('Reply message text'),
});

const sendReplyOutput = z.object({
  success: z.boolean(),
  message: z.string().optional(),
  messageId: z.string().optional(),
  channelId: z.string().optional(),
  replyTo: z.string().optional(),
  error: z.string().optional(),
});

/**
 * Register Discord tools on the KĀDI client.
 * Tools are scoped to the 'text' network.
 */
export function registerDiscordTools(
  client: KadiClient,
  discord: DiscordPlatformClient,
): void {
  client.registerTool(
    {
      name: 'discord_send_message',
      description: 'Send a message to a Discord channel. Can optionally reply to a specific message.',
      input: sendMessageInput,
      output: sendMessageOutput,
    },
    async (params) => {
      try {
        const result = await discord.sendMessage(params.channel, params.text, params.message_id);
        console.log(`✅ [Discord] Message sent to ${params.channel} (id: ${result.id})`);
        return { success: true, message: 'Message sent successfully', messageId: result.id, channelId: result.channelId };
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        console.error('❌ [Discord] send_message error:', msg);
        return { success: false, error: msg };
      }
    },
    { brokers: { default: { networks: ['text'] } } },
  );

  client.registerTool(
    {
      name: 'discord_send_reply',
      description: 'Reply to a message in a Discord channel. Maintains conversation context.',
      input: sendReplyInput,
      output: sendReplyOutput,
    },
    async (params) => {
      try {
        const result = await discord.sendReply(params.channel, params.message_id, params.text);
        console.log(`✅ [Discord] Reply sent to ${params.message_id} in ${params.channel}`);
        return { success: true, message: 'Reply sent successfully', messageId: result.id, channelId: result.channelId, replyTo: params.message_id };
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        console.error('❌ [Discord] send_reply error:', msg);
        return { success: false, error: msg };
      }
    },
    { brokers: { default: { networks: ['text'] } } },
  );

  console.log('✅ Registered Discord tools: discord_send_message, discord_send_reply');
}
