/**
 * KĀDI Event Publisher for Slack Mentions
 * =======================================
 *
 * This module publishes Slack @mention events to the KĀDI event bus, migrating
 * from polling-based to event-driven architecture.
 *
 * Architecture:
 * - Publishes to topic: slack.app_mention.{BOT_USER_ID}
 * - Uses shared KadiEventPublisher from @agents/shared
 * - Graceful degradation pattern (stub mode if broker unavailable)
 * - Fail-fast on publish errors (no retry logic)
 *
 * Flow:
 * 1. Initialize shared KadiEventPublisher with Slack-specific config
 * 2. Connect to KĀDI broker via WebSocket
 * 3. Publish SlackMentionEvent when mentions are received
 * 4. Events consumed by template-agent-typescript subscribers
 */

import { KadiEventPublisher as SharedPublisher, PublisherConfig } from '@agents/shared';
import type { SlackMentionEvent } from './types.js';
import type { Config } from './index.js';

/**
 * KĀDI Event Publisher for Slack
 *
 * Thin wrapper around shared KadiEventPublisher with Slack-specific
 * configuration and publishMention() convenience method.
 */
export class KadiEventPublisher {
  private publisher: SharedPublisher;
  private enabled: boolean = false;

  /**
   * Create a new KĀDI Event Publisher for Slack
   *
   * @param config - Configuration object with KADI_BROKER_URL and SLACK_BOT_USER_ID
   *
   * @example
   * ```typescript
   * const publisher = new KadiEventPublisher({
   *   KADI_BROKER_URL: 'ws://localhost:8080/kadi',
   *   SLACK_BOT_USER_ID: 'U12345678',
   *   ...otherConfig
   * });
   * await publisher.connect();
   * ```
   */
  constructor(config: Config) {
    // Graceful degradation: Check if broker URL is valid
    const hasValidBrokerUrl =
      config.KADI_BROKER_URL &&
      (config.KADI_BROKER_URL.startsWith('ws://') ||
        config.KADI_BROKER_URL.startsWith('wss://'));

    if (hasValidBrokerUrl) {
      this.enabled = true;
    }

    // Create Slack-specific publisher configuration
    const publisherConfig: PublisherConfig = {
      brokerUrl: config.KADI_BROKER_URL || '',
      clientName: 'mcp-client-slack',
      networks: ['slack'],
      version: '1.0.0',
      role: 'agent'
    };

    // Instantiate shared publisher with Slack config
    this.publisher = new SharedPublisher(publisherConfig);
  }

  /**
   * Connect to KĀDI broker with retry logic
   *
   * Delegates to shared publisher connect() method.
   *
   * @throws {Error} If connection fails after all retries
   *
   * @example
   * ```typescript
   * await publisher.connect();
   * console.log('Connected to KĀDI broker');
   * ```
   */
  async connect(): Promise<void> {
    return this.publisher.connect();
  }

  /**
   * Publish a Slack @mention event to KĀDI broker
   *
   * Publishes to topic: slack.app_mention.{BOT_USER_ID}
   * Event format matches SlackMentionEventSchema from types.ts
   *
   * @param mention - Raw Slack mention data from SlackMention interface
   * @param botUserId - Bot user ID for topic routing
   *
   * @throws {Error} If publish fails (logged but not thrown - fire-and-forget)
   *
   * @example
   * ```typescript
   * await publisher.publishMention(
   *   {
   *     id: '1234567890.123456',
   *     user: 'U12345678',
   *     text: 'Hello bot!',
   *     channel: 'C12345678',
   *     thread_ts: '1234567890.123456',
   *     ts: '1234567890.123456'
   *   },
   *   'U87654321'
   * );
   * ```
   */
  async publishMention(
    mention: {
      id: string;
      user: string;
      text: string;
      channel: string;
      thread_ts: string;
      ts: string;
    },
    botUserId: string
  ): Promise<void> {
    if (!this.enabled) {
      return;
    }

    // Construct SlackMentionEvent with validated fields
    const event: SlackMentionEvent = {
      id: mention.id,
      user: mention.user,
      text: mention.text,
      channel: mention.channel,
      thread_ts: mention.thread_ts,
      ts: mention.ts,
      bot_id: botUserId,
      timestamp: new Date().toISOString()
    };

    // Publish to topic: slack.app_mention.{BOT_USER_ID}
    const topic = `slack.app_mention.${botUserId}`;

    // Truncate text for logging (don't log full message content)
    const textPreview = mention.text.length > 50
      ? mention.text.substring(0, 50) + '...'
      : mention.text;

    // Delegate to shared publisher with metadata for logging
    await this.publisher.publishEvent(topic, event, {
      eventId: mention.id,
      user: mention.user,
      textPreview
    });
  }

  /**
   * Disconnect from KĀDI broker
   *
   * Delegates to shared publisher disconnect() method.
   *
   * @example
   * ```typescript
   * await publisher.disconnect();
   * console.log('Disconnected from KĀDI broker');
   * ```
   */
  async disconnect(): Promise<void> {
    return this.publisher.disconnect();
  }
}
