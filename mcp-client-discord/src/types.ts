/**
 * Type definitions for Discord MCP Client
 * ========================================
 *
 * Event type definitions for KĀDI event publishing.
 */

/**
 * DiscordMentionEvent
 *
 * Represents a Discord @mention event that will be published to
 * the KĀDI event bus topic: discord.mention.{BOT_USER_ID}
 */
export interface DiscordMentionEvent {
  /** Unique Discord message ID */
  id: string;

  /** Discord user ID who mentioned the bot */
  user: string;

  /** Discord username who mentioned the bot */
  username: string;

  /** Message text (with @bot mention removed) */
  text: string;

  /** Discord channel ID where mention occurred */
  channel: string;

  /** Discord channel name where mention occurred */
  channelName: string;

  /** Discord guild (server) ID */
  guild: string;

  /** Message timestamp from Discord */
  ts: string;

  /** Discord bot user ID for event routing */
  bot_id: string;

  /** ISO 8601 datetime string when event was captured and published */
  timestamp: string;
}
