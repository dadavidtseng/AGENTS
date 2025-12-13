/**
 * Shared KĀDI Event Publisher Utility
 * ====================================
 *
 * Common publisher logic extracted from mcp-client-slack and mcp-client-discord
 * to eliminate code duplication (DRY principle).
 *
 * Architecture:
 * - Generic event publishing to KĀDI broker
 * - Platform-agnostic connection management
 * - Graceful degradation pattern (stub mode if broker unavailable)
 * - Retry logic with exponential backoff
 *
 * Usage:
 * ```typescript
 * const publisher = new KadiEventPublisher({
 *   brokerUrl: 'ws://localhost:8080/kadi',
 *   clientName: 'mcp-client-slack',
 *   networks: ['slack']
 * });
 * await publisher.connect();
 * await publisher.publishEvent('slack.app_mention.U12345', event);
 * ```
 */

import { KadiClient, z, type AgentRole } from '@kadi.build/core';

/**
 * Validates topic pattern against standard format: {platform}.{event_type}.{bot_id}
 *
 * @param topic - Topic string to validate
 * @returns True if topic matches pattern, false otherwise
 *
 * @example
 * ```typescript
 * validateTopicPattern('slack.app_mention.U12345') // true
 * validateTopicPattern('discord.mention.67890') // true
 * validateTopicPattern('invalid-topic') // false
 * validateTopicPattern('slack.app_mention') // false (missing bot_id)
 * ```
 */
export function validateTopicPattern(topic: string): boolean {
  // Pattern: {platform}.{event_type}.{bot_id}
  // - platform: lowercase letters (e.g., 'slack', 'discord')
  // - event_type: lowercase letters with underscores (e.g., 'app_mention', 'mention')
  // - bot_id: alphanumeric with hyphens/underscores (e.g., 'U12345', 'bot-123')
  const pattern = /^[a-z]+\.[a-z_]+\.[a-zA-Z0-9_-]+$/;
  return pattern.test(topic);
}

/**
 * Configuration interface for KĀDI Event Publisher
 */
export interface PublisherConfig {
  /** KĀDI broker WebSocket URL (e.g., 'ws://localhost:8080/kadi') */
  brokerUrl: string;

  /** Client name for identification in broker logs */
  clientName: string;

  /** Network(s) this publisher belongs to (e.g., ['slack'], ['discord']) */
  networks: string[];

  /** Client version (default: '1.0.0') */
  version?: string;

  /** Client role (default: 'agent') */
  role?: AgentRole;
}

/**
 * Shared KĀDI Event Publisher
 *
 * Provides common event publishing functionality for all MCP clients.
 * Handles connection management, retry logic, graceful degradation,
 * and error handling.
 */
export class KadiEventPublisher {
  private client: KadiClient | null = null;
  private enabled: boolean = false;
  private config: Required<PublisherConfig>;

  /**
   * Create a new KĀDI Event Publisher
   *
   * @param config - Publisher configuration with broker URL, client name, and networks
   *
   * @example
   * ```typescript
   * const publisher = new KadiEventPublisher({
   *   brokerUrl: 'ws://localhost:8080/kadi',
   *   clientName: 'mcp-client-slack',
   *   networks: ['slack']
   * });
   * ```
   */
  constructor(config: PublisherConfig) {
    // Set defaults for optional fields
    this.config = {
      brokerUrl: config.brokerUrl,
      clientName: config.clientName,
      networks: config.networks,
      version: config.version || '1.0.0',
      role: config.role || 'agent'
    };

    // Graceful degradation: Check if broker URL is valid
    const hasValidBrokerUrl =
      config.brokerUrl &&
      (config.brokerUrl.startsWith('ws://') ||
        config.brokerUrl.startsWith('wss://'));

    if (hasValidBrokerUrl) {
      this.enabled = true;
    } else {
      console.log('⚠️  KĀDI broker URL not configured - running in stub mode');
      console.log('   Set KADI_BROKER_URL to enable event publishing');
    }
  }

  /**
   * Create a new KadiClient instance
   * Must be called before each connection attempt to avoid handshake state issues
   *
   * @private
   */
  private createClient(): KadiClient {
    const client = new KadiClient({
      name: this.config.clientName,
      version: this.config.version,
      role: this.config.role,
      broker: this.config.brokerUrl,
      networks: this.config.networks
    });

    // Register a dummy tool to make agent visible in system snapshots
    // This is a test to verify that broker filters agents without tools
    const addNumberInputSchema = z.object({
      a: z.number().describe('First number'),
      b: z.number().describe('Second number')
    });

    client.registerTool(
      {
        name: 'addNumber',
        description: 'Dummy tool for testing - adds two numbers together',
        input: addNumberInputSchema,
        output: z.object({
          result: z.number().describe('Sum of a and b')
        })
      },
      async (params: z.infer<typeof addNumberInputSchema>) => {
        return { result: params.a + params.b };
      }
    );

    return client;
  }

  /**
   * Connect to KĀDI broker with retry logic
   *
   * Establishes WebSocket connection and performs authentication handshake.
   * Retries with exponential backoff when broker is not ready (e.g., during startup).
   * Logs connection status for debugging.
   *
   * Retry schedule: 5 attempts with exponential backoff (1s, 2s, 4s, 8s, 16s)
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
        console.log(`[KĀDI] Publisher: Connected successfully {agentId: ${agentId || 'unknown'}, networks: ${JSON.stringify(this.config.networks)}}`);
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
   * Publish an event to a specific KĀDI broker topic
   *
   * Generic event publishing method. Accepts any event data and publishes
   * it to the specified topic. Validation should be done by the caller.
   *
   * @param topic - Topic pattern (e.g., 'slack.app_mention.U12345', 'discord.mention.67890')
   * @param event - Event data to publish (must be JSON-serializable)
   * @param metadata - Optional metadata for logging (e.g., { eventId, user, textPreview })
   *
   * @throws {Error} If publish fails (fail-fast, no retry)
   *
   * @example
   * ```typescript
   * await publisher.publishEvent(
   *   'slack.app_mention.U12345',
   *   {
   *     id: '1234567890.123456',
   *     user: 'U12345678',
   *     text: 'Hello bot!',
   *     channel: 'C12345678',
   *     bot_id: 'U87654321',
   *     timestamp: '2025-11-29T12:00:00Z'
   *   },
   *   { eventId: '1234567890.123456', user: 'U12345678', textPreview: 'Hello bot!' }
   * );
   * ```
   */
  async publishEvent(
    topic: string,
    event: Record<string, any>,
    metadata?: { eventId?: string; user?: string; textPreview?: string }
  ): Promise<void> {
    // Validate topic pattern
    if (!validateTopicPattern(topic)) {
      console.warn(
        `[KĀDI] Publisher: Topic pattern validation failed {topic: ${topic}, expected: {platform}.{event_type}.{bot_id}}`
      );
    }

    if (!this.client || !this.enabled) {
      console.log('[KĀDI] Publisher: Event publishing disabled, event not published {mode: stub}');
      return;
    }

    try {
      this.client.publishEvent(topic, event);

      // Log with metadata if provided, otherwise generic log
      if (metadata) {
        const logParts = [`topic: ${topic}`];
        if (metadata.eventId) logParts.push(`eventId: ${metadata.eventId}`);
        if (metadata.user) logParts.push(`user: ${metadata.user}`);
        if (metadata.textPreview) logParts.push(`textPreview: "${metadata.textPreview}"`);

        console.log(`[KĀDI] Publisher: Event published successfully {${logParts.join(', ')}}`);
      } else {
        console.log(`[KĀDI] Publisher: Event published successfully {topic: ${topic}}`);
      }
    } catch (error: any) {
      // Fail-fast on publish errors (no retry)
      console.error(`[KĀDI] Publisher: Event publication failed {topic: ${topic}, error: ${error.message || 'Unknown error'}}`);
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

  /**
   * Check if publisher is connected and enabled
   *
   * @returns True if connected to broker and publishing is enabled
   */
  public isConnected(): boolean {
    return this.client !== null && this.enabled;
  }

  /**
   * Get current publisher configuration
   *
   * @returns Current publisher configuration
   */
  public getConfig(): Readonly<Required<PublisherConfig>> {
    return { ...this.config };
  }
}
