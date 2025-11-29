/**
 * KĀDI Event Publisher for Discord Mentions
 * ==========================================
 *
 * This module publishes Discord @mention events to the KĀDI event bus, migrating
 * from polling-based to event-driven architecture.
 *
 * Architecture:
 * - Publishes to topic: discord.mention.{BOT_USER_ID}
 * - Uses shared KadiEventPublisher from @agents/shared
 * - Graceful degradation pattern (stub mode if broker unavailable)
 * - Fail-fast on publish errors (no retry logic)
 *
 * Flow:
 * 1. Initialize shared KadiEventPublisher with Discord-specific config
 * 2. Connect to KĀDI broker via WebSocket
 * 3. Publish DiscordMentionEvent when mentions are received
 * 4. Events consumed by template-agent-typescript subscribers
 */

import { KadiEventPublisher as SharedPublisher, PublisherConfig } from '@agents/shared';
import type { DiscordMentionEvent } from './types.js';
import type { Config } from './index.js';

/**
 * KĀDI Event Publisher for Discord
 *
 * Thin wrapper around shared KadiEventPublisher with Discord-specific
 * configuration and publishMention() convenience method.
 */
export class KadiEventPublisher {
  private publisher: SharedPublisher;
  private enabled: boolean = false;

  /**
   * Create a new KĀDI Event Publisher for Discord
   *
   * @param config - Configuration object with KADI_BROKER_URL and DISCORD_BOT_USER_ID
   *
   * @example
   * ```typescript
   * const publisher = new KadiEventPublisher({
   *   KADI_BROKER_URL: 'ws://localhost:8080/kadi',
   *   DISCORD_BOT_USER_ID: '1234567890',
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

    // Create Discord-specific publisher configuration
    const publisherConfig: PublisherConfig = {
      brokerUrl: config.KADI_BROKER_URL || '',
      clientName: 'mcp-client-discord',
      networks: ['discord'],
      version: '1.0.0',
      role: 'agent'
    };

    // Instantiate shared publisher with Discord config
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
   * Publish a Discord @mention event to KĀDI broker
   *
   * Publishes to topic: discord.mention.{BOT_USER_ID}
   * Event format matches DiscordMentionEventSchema from types.ts
   *
   * @param mention - Raw Discord mention data
   * @param botUserId - Bot user ID for topic routing
   *
   * @throws {Error} If publish fails (logged but not thrown - fire-and-forget)
   *
   * @example
   * ```typescript
   * await publisher.publishMention(
   *   {
   *     id: '1234567890',
   *     user: '9876543210',
   *     username: 'johndoe',
   *     text: 'Hello bot!',
   *     channel: '1111111111',
   *     channelName: 'general',
   *     guild: '2222222222',
   *     ts: '2025-11-29T12:00:00Z'
   *   },
   *   '3333333333'
   * );
   * ```
   */
  async publishMention(
    mention: {
      id: string;
      user: string;
      username: string;
      text: string;
      channel: string;
      channelName: string;
      guild: string;
      ts: string;
    },
    botUserId: string
  ): Promise<void> {
    if (!this.enabled) {
      return;
    }

    // Construct DiscordMentionEvent with validated fields
    const event: DiscordMentionEvent = {
      id: mention.id,
      user: mention.user,
      username: mention.username,
      text: mention.text,
      channel: mention.channel,
      channelName: mention.channelName,
      guild: mention.guild,
      ts: mention.ts,
      bot_id: botUserId,
      timestamp: new Date().toISOString()
    };

    // Publish to topic: discord.mention.{BOT_USER_ID}
    const topic = `discord.mention.${botUserId}`;

    // Truncate text for logging (don't log full message content)
    const textPreview = mention.text.length > 50
      ? mention.text.substring(0, 50) + '...'
      : mention.text;

    // Delegate to shared publisher with metadata for logging
    await this.publisher.publishEvent(topic, event, {
      eventId: mention.id,
      user: mention.username,
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
