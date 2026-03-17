/**
 * Event Schema Definitions for KĀDI Event Bus Integration
 * ========================================================
 *
 * This module defines Zod schemas for Slack events that will be published
 * to the KĀDI event bus. These schemas ensure type safety and validation
 * for event-driven communication between mcp-client-slack (publisher)
 * and template-agent-typescript (subscriber).
 */

import { z } from 'zod';

/**
 * SlackMentionEvent Schema
 *
 * Represents a validated Slack @mention event that will be published to
 * the KĀDI event bus topic: slack.app_mention.{BOT_USER_ID}
 *
 * This schema adds structured validation and timestamps to the raw SlackMention
 * interface for reliable event-driven processing.
 */
/** Image attachment from a chat message */
const ChatImageAttachmentSchema = z.object({
  filename: z.string(),
  contentType: z.string(),
  size: z.number(),
  url: z.string().optional(),
  base64: z.string().optional(),
});

export const SlackMentionEventSchema = z.object({
  /** Unique mention ID (event timestamp from Slack) */
  id: z.string(),

  /** Slack user ID who mentioned the bot */
  user: z.string(),

  /** Message text (with @bot mention removed) */
  text: z.string(),

  /** Slack channel ID where mention occurred */
  channel: z.string(),

  /** Thread timestamp for replies (or message ts if not in thread) */
  thread_ts: z.string(),

  /** Event timestamp from Slack */
  ts: z.string(),

  /** Slack bot user ID for event routing */
  bot_id: z.string(),

  /** ISO 8601 datetime string when event was captured and published */
  timestamp: z.string().datetime(),

  /** Image attachments from the message */
  attachments: z.array(ChatImageAttachmentSchema).optional(),
});

/**
 * Inferred TypeScript type from SlackMentionEventSchema
 *
 * Use this type for type-safe event handling in subscribers.
 * Example:
 * ```typescript
 * import { SlackMentionEvent } from './types/slack-events';
 *
 * function handleMention(event: SlackMentionEvent) {
 *   console.log(`Received mention from ${event.user}: ${event.text}`);
 * }
 * ```
 */
export type SlackMentionEvent = z.infer<typeof SlackMentionEventSchema>;
