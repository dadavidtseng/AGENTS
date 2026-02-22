/**
 * Shared Types for agent-chatbot
 * ===============================
 *
 * Event type definitions for KĀDI event publishing across platforms.
 */

/**
 * Discord @mention event published to topic: discord.mention.{BOT_USER_ID}
 */
export interface DiscordMentionEvent {
  /** Unique Discord message ID */
  id: string;
  /** Discord user ID who mentioned the bot */
  user: string;
  /** Discord username */
  username: string;
  /** Message text (with @bot mention removed) */
  text: string;
  /** Discord channel ID */
  channel: string;
  /** Discord channel name */
  channelName: string;
  /** Discord guild (server) ID */
  guild: string;
  /** Message timestamp from Discord */
  ts: string;
  /** Discord bot user ID for event routing */
  bot_id: string;
  /** ISO 8601 datetime when event was captured */
  timestamp: string;
}

/**
 * Slack @mention event published to topic: slack.app_mention.{BOT_USER_ID}
 */
export interface SlackMentionEvent {
  /** Slack event ID */
  id: string;
  /** Slack user ID who mentioned the bot */
  user: string;
  /** Message text (with @bot mention removed) */
  text: string;
  /** Slack channel ID */
  channel: string;
  /** Slack thread timestamp (if in thread) */
  thread_ts?: string;
  /** Slack event timestamp */
  ts: string;
  /** Slack bot user ID for event routing */
  bot_id: string;
  /** ISO 8601 datetime when event was captured */
  timestamp: string;
}
