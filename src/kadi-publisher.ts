/**
 * KĀDI Event Publisher for Slack Mentions
 * =======================================
 *
 * This module publishes Slack @mention events to the KĀDI event bus, migrating
 * from polling-based to event-driven architecture.
 *
 * Architecture:
 * - Publishes to topic: slack.app_mention.{BOT_USER_ID}
 * - Uses KadiClient from @kadi.build/core
 * - Graceful degradation pattern (stub mode if broker unavailable)
 * - Fail-fast on publish errors (no retry logic)
 *
 * Flow:
 * 1. Initialize KadiClient with broker URL and bot user ID
 * 2. Connect to KĀDI broker via WebSocket
 * 3. Publish SlackMentionEvent when mentions are received
 * 4. Events consumed by template-agent-typescript subscribers
 */

import { KadiClient } from '@kadi.build/core';
import type { SlackMentionEvent } from './types.js';
import type { Config } from './index.js';

/**
 * KĀDI Event Publisher
 *
 * Publishes Slack @mention events to the KĀDI broker using event-driven
 * publish-subscribe pattern. Replaces the polling-based queue mechanism
 * with real-time event delivery.
 */
export class KadiEventPublisher {
  private client: KadiClient | null = null;
  private enabled: boolean = false;
  private brokerUrl: string = '';

  /**
   * Create a new KĀDI Event Publisher
   *
   * @param config - Configuration object with KADI_BROKER_URL and SLACK_BOT_USER_ID
   *
   * @example
   * ```typescript
   * const publisher = new KadiEventPublisher({
   *   KADI_BROKER_URL: 'ws://localhost:8080',
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
      this.brokerUrl = config.KADI_BROKER_URL;
      this.enabled = true;
    } else {
      console.log('⚠️  KĀDI broker URL not configured - running in stub mode');
      console.log('   Set KADI_BROKER_URL to enable event publishing');
    }
  }

  /**
   * Create a new KadiClient instance
   * Must be called before each connection attempt to avoid handshake state issues
   */
  private createClient(): KadiClient {
    return new KadiClient({
      name: 'mcp-client-slack',
      version: '1.0.0',
      role: 'agent',
      broker: this.brokerUrl,
      networks: ['slack']
    });
  }

  /**
   * Connect to KĀDI broker with retry logic
   *
   * Establishes WebSocket connection and performs authentication handshake.
   * Retries with exponential backoff when broker is not ready (e.g., during startup).
   * Logs connection status for debugging.
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
    if (!this.enabled) {
      console.log('[KĀDI] Publisher: Event publishing disabled {mode: stub}');
      return;
    }

    const maxRetries = 5;
    const baseDelayMs = 1000;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      console.log(`[KĀDI] Publisher: Attempting connection to broker (attempt ${attempt}/${maxRetries})...`);

      // Create a fresh client for each attempt to avoid handshake state issues
      this.client = this.createClient();

      try {
        const agentId = await this.client.connect();
        console.log(`[KĀDI] Publisher: Connected successfully {agentId: ${agentId || 'unknown'}, networks: ['slack']}`);
        return; // Success - exit retry loop
      } catch (error: any) {
        const isLastAttempt = attempt === maxRetries;

        // Disconnect failed client to clean up resources
        try {
          await this.client.disconnect();
        } catch {
          // Ignore disconnect errors
        }

        if (isLastAttempt) {
          console.error(`[KĀDI] Publisher: Connection failed after ${maxRetries} attempts {error: ${error.message || 'Unknown error'}}`);
          this.client = null; // Clear client on final failure
          throw error; // Fail-fast after all retries exhausted
        }

        // Exponential backoff: 1s, 2s, 4s, 8s, 16s
        const delayMs = baseDelayMs * Math.pow(2, attempt - 1);
        console.warn(`[KĀDI] Publisher: Connection failed, retrying in ${delayMs}ms... {error: ${error.message || 'Unknown error'}}`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
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
    if (!this.client || !this.enabled) {
      console.log('[KĀDI] Publisher: Event publishing disabled, mention not published {mode: stub}');
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

    try {
      this.client.publishEvent(topic, event);
      console.log(`[KĀDI] Publisher: Event published successfully {topic: ${topic}, mentionId: ${mention.id}, user: ${mention.user}, textPreview: "${textPreview}"}`);
    } catch (error: any) {
      // Fail-fast on publish errors (no retry)
      console.error(`[KĀDI] Publisher: Event publication failed {topic: ${topic}, mentionId: ${mention.id}, error: ${error.message || 'Unknown error'}}`);
      throw error;
    }
  }

  /**
   * Disconnect from KĀDI broker
   *
   * Performs cleanup and gracefully closes WebSocket connection.
   * Safe to call multiple times (idempotent).
   *
   * @example
   * ```typescript
   * await publisher.disconnect();
   * console.log('Disconnected from KĀDI broker');
   * ```
   */
  async disconnect(): Promise<void> {
    if (!this.client || !this.enabled) {
      return;
    }

    console.log('[KĀDI] Publisher: Disconnecting from broker...');

    try {
      await this.client.disconnect();
      console.log('[KĀDI] Publisher: Disconnected successfully');
    } catch (error: any) {
      console.error(`[KĀDI] Publisher: Disconnection failed {error: ${error.message || 'Unknown error'}}`);
      // Don't throw - best effort cleanup
    }
  }
}
