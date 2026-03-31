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
import { logger, MODULE_DISCORD_BOT, timer } from 'agents-library';

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

const addReactionInput = z.object({
  channel: z.string().describe('Channel ID where the message exists'),
  message_id: z.string().describe('Message ID to react to (Discord snowflake)'),
  emoji: z.string().describe('Emoji to react with (Unicode emoji like "👍" or custom emoji name like "thumbsup")'),
});

const addReactionOutput = z.object({
  success: z.boolean(),
  error: z.string().optional(),
});

/**
 * Register Discord tools on the KĀDI client.
 */
export function registerDiscordTools(
  client: KadiClient,
  discord: DiscordPlatformClient,
  brokerNetworksMap: Record<string, string[]>,
): void {
  const brokers = Object.fromEntries(
    Object.entries(brokerNetworksMap).map(([k, v]) => [k, { networks: v }]),
  );

  client.registerTool(
    {
      name: 'discord_send_message',
      description: 'Send a message to a Discord channel. Can optionally reply to a specific message.',
      input: sendMessageInput,
      output: sendMessageOutput,
    },
    async (params) => {
      try {
        // Validate message_id is a proper Discord snowflake (17-20 digit number) — LLMs sometimes hallucinate invalid values
        const messageId = params.message_id && /^\d{17,20}$/.test(params.message_id) ? params.message_id : undefined;
        const result = await discord.sendMessage(params.channel, params.text, messageId);
        logger.debug(MODULE_DISCORD_BOT, `Message sent to ${params.channel} (id: ${result.id})`, timer.elapsed('main'));
        return { success: true, message: 'Message sent successfully', messageId: result.id, channelId: result.channelId };
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        logger.error(MODULE_DISCORD_BOT, `send_message error: ${msg}`, timer.elapsed('main'));
        return { success: false, error: msg };
      }
    },
    { brokers },
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
        logger.debug(MODULE_DISCORD_BOT, `Reply sent to ${params.message_id} in ${params.channel}`, timer.elapsed('main'));
        return { success: true, message: 'Reply sent successfully', messageId: result.id, channelId: result.channelId, replyTo: params.message_id };
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        logger.error(MODULE_DISCORD_BOT, `send_reply error: ${msg}`, timer.elapsed('main'));
        return { success: false, error: msg };
      }
    },
    { brokers },
  );

  client.registerTool(
    {
      name: 'discord_add_reaction',
      description: 'Add an emoji reaction to a Discord message.',
      input: addReactionInput,
      output: addReactionOutput,
    },
    async (params) => {
      try {
        await discord.addReaction(params.channel, params.message_id, params.emoji);
        logger.debug(MODULE_DISCORD_BOT, `Reaction ${params.emoji} added to ${params.message_id}`, timer.elapsed('main'));
        return { success: true };
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        logger.error(MODULE_DISCORD_BOT, `add_reaction error: ${msg}`, timer.elapsed('main'));
        return { success: false, error: msg };
      }
    },
    { brokers },
  );
}
