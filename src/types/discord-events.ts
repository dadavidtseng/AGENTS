/**
 * Event Schema Definitions for KĀDI Event Bus Integration
 * ========================================================
 *
 * This module defines Zod schemas for Discord events that will be published
 * to the KĀDI event bus. These schemas ensure type safety and validation
 * for event-driven communication between mcp-client-discord (publisher)
 * and template-agent-typescript (subscriber).
 */

import { z } from 'zod';

/**
 * DiscordMentionEvent Schema
 *
 * Represents a validated Discord @mention event that will be published to
 * the KĀDI event bus topic: discord.mention.{BOT_USER_ID}
 *
 * This schema adds structured validation and timestamps to Discord mention
 * data for reliable event-driven processing.
 */
export const DiscordMentionEventSchema = z.object({
  /** Unique Discord message ID */
  id: z.string(),

  /** Discord user ID who mentioned the bot */
  user: z.string(),

  /** Discord username who mentioned the bot */
  username: z.string(),

  /** Message text (with @bot mention removed) */
  text: z.string(),

  /** Discord channel ID where mention occurred */
  channel: z.string(),

  /** Discord channel name where mention occurred */
  channelName: z.string(),

  /** Discord guild (server) ID */
  guild: z.string(),

  /** Message timestamp from Discord */
  ts: z.string(),

  /** Discord bot user ID for event routing */
  bot_id: z.string(),

  /** ISO 8601 datetime string when event was captured and published */
  timestamp: z.string().datetime(),
});

/**
 * Inferred TypeScript type from DiscordMentionEventSchema
 *
 * Use this type for type-safe event handling in subscribers.
 * Example:
 * ```typescript
 * import { DiscordMentionEvent } from './types/discord-events';
 *
 * function handleMention(event: DiscordMentionEvent) {
 *   console.log(`Received mention from ${event.username}: ${event.text}`);
 * }
 * ```
 */
export type DiscordMentionEvent = z.infer<typeof DiscordMentionEventSchema>;
