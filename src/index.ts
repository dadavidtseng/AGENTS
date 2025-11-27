/**
 * Slack Event Publisher for KĀDI
 * ================================
 *
 * Pure KĀDI event publisher that listens for Slack @mentions via Socket Mode
 * and publishes them as real-time events to the KĀDI broker.
 *
 * Architecture:
 * - Slack Socket Mode: Receives @mention events in real-time
 * - KĀDI Publisher: Publishes events to broker topics
 * - Event-Driven: No polling, push-based architecture
 *
 * Flow:
 * 1. User @mentions bot in Slack channel
 * 2. Socket Mode receives app_mention event
 * 3. Event published to topic: slack.app_mention.{BOT_USER_ID}
 * 4. Subscribers receive event in real-time via KĀDI broker
 */

import { App } from '@slack/bolt';
import { z } from 'zod';
import * as dotenv from 'dotenv';
import { KadiEventPublisher } from './kadi-publisher.js';

// Load environment variables
dotenv.config();

// ============================================================================
// Configuration & Validation
// ============================================================================

const ConfigSchema = z.object({
  SLACK_BOT_TOKEN: z.string().min(1, 'SLACK_BOT_TOKEN is required'),
  SLACK_APP_TOKEN: z.string().min(1, 'SLACK_APP_TOKEN is required'),
  KADI_BROKER_URL: z
    .string()
    .url('KADI_BROKER_URL must be a valid WebSocket URL')
    .describe('KĀDI broker WebSocket URL'),
  SLACK_BOT_USER_ID: z
    .string()
    .regex(/^U[A-Z0-9]+$/, 'SLACK_BOT_USER_ID must be a valid Slack user ID (format: U*)')
    .describe('Slack bot user ID for event routing'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export type Config = z.infer<typeof ConfigSchema>;

function loadConfig(): Config {
  try {
    return ConfigSchema.parse({
      SLACK_BOT_TOKEN: process.env.SLACK_BOT_TOKEN,
      SLACK_APP_TOKEN: process.env.SLACK_APP_TOKEN,
      KADI_BROKER_URL: process.env.KADI_BROKER_URL,
      SLACK_BOT_USER_ID: process.env.SLACK_BOT_USER_ID,
      LOG_LEVEL: process.env.LOG_LEVEL || 'info',
    });
  } catch (error) {
    console.error('❌ Configuration validation failed:', error);
    throw new Error('Missing or invalid environment variables. Check .env file.');
  }
}

// ============================================================================
// Types
// ============================================================================

/**
 * Slack mention event representation
 */
interface SlackMention {
  /** Unique mention ID (timestamp) */
  id: string;
  /** User who mentioned the bot */
  user: string;
  /** Message text (with @bot mention removed) */
  text: string;
  /** Channel where mention occurred */
  channel: string;
  /** Thread timestamp for replies */
  thread_ts: string;
  /** Event timestamp */
  ts: string;
}

// ============================================================================
// Slack Manager
// ============================================================================

class SlackManager {
  private app: App | null = null;
  private publisher: KadiEventPublisher | null = null;
  private enabled: boolean = false;
  private botUserId: string = '';

  constructor(config: Config, publisher: KadiEventPublisher | null = null) {
    this.publisher = publisher;

    // Check if tokens look valid (not placeholders)
    const hasValidTokens =
      config.SLACK_BOT_TOKEN.startsWith('xoxb-') &&
      config.SLACK_APP_TOKEN.startsWith('xapp-');

    if (hasValidTokens) {
      // Initialize Slack Bolt app with Socket Mode
      this.app = new App({
        token: config.SLACK_BOT_TOKEN,
        appToken: config.SLACK_APP_TOKEN,
        socketMode: true,
      });

      this.botUserId = config.SLACK_BOT_USER_ID;
      this.registerEventHandlers();
      this.enabled = true;
    } else {
      console.log('⚠️  Slack tokens appear to be placeholders - running in stub mode');
      console.log('   Set valid SLACK_BOT_TOKEN and SLACK_APP_TOKEN to enable Slack integration');
    }
  }

  /**
   * Register Slack event handlers
   */
  private registerEventHandlers(): void {
    if (!this.app) return;

    // Listen for @mentions of the bot
    this.app.event('app_mention', async ({ event }) => {
      await this.handleMention(event);
    });

    console.log('✅ Registered Slack event handlers');
  }

  /**
   * Handle incoming @mention event
   */
  private async handleMention(event: any): Promise<void> {
    try {
      // Get bot user ID from Slack API (cached after first call)
      if (!this.botUserId && this.app) {
        const authResult = await this.app.client.auth.test();
        this.botUserId = authResult.user_id as string;
        console.log(`🤖 Bot user ID: ${this.botUserId}`);
      }

      // Remove bot mention tags from text (e.g., <@U12345>)
      const cleanText = event.text.replace(/<@[A-Z0-9]+>/g, '').trim();

      // Create mention object
      const mention: SlackMention = {
        id: event.ts,
        user: event.user,
        text: cleanText,
        channel: event.channel,
        thread_ts: event.thread_ts || event.ts, // Use thread_ts if in thread, else start new thread
        ts: event.ts,
      };

      // Publish to KĀDI event bus (non-blocking)
      if (this.publisher && this.botUserId) {
        this.publisher.publishMention(mention, this.botUserId).catch((error) => {
          console.error('[KĀDI] Failed to publish mention event:', error);
          // Don't block Slack processing on publish failure
        });
      }

      console.log(`💬 Received mention: "${cleanText}" from @${event.user}`);
    } catch (error) {
      console.error('❌ Error handling mention:', error);
    }
  }

  /**
   * Start Slack Socket Mode listener
   */
  async start(): Promise<void> {
    if (!this.app || !this.enabled) {
      console.log('ℹ️  Slack connection disabled (using stub mode)');
      return;
    }

    await this.app.start();
    console.log('✅ Slack Socket Mode listener started');
  }

  /**
   * Stop Slack app
   */
  async stop(): Promise<void> {
    if (!this.app || !this.enabled) {
      return;
    }

    await this.app.stop();
    console.log('🛑 Slack Socket Mode listener stopped');
  }
}

// ============================================================================
// Slack Event Publisher (Main Application)
// ============================================================================

class SlackEventPublisher {
  private slackManager: SlackManager;
  private publisher: KadiEventPublisher;
  private config: Config;

  constructor() {
    this.config = loadConfig();
    this.publisher = new KadiEventPublisher(this.config);
    this.slackManager = new SlackManager(this.config, this.publisher);
  }

  /**
   * Start the event publisher
   */
  async run(): Promise<void> {
    console.log('🚀 Starting Slack Event Publisher...');
    console.log('📋 Configuration:');
    console.log(`   - Log Level: ${this.config.LOG_LEVEL}`);
    console.log(`   - Broker: ${this.config.KADI_BROKER_URL}`);

    // Start Slack Socket Mode
    await this.slackManager.start();

    // Connect to KĀDI broker
    await this.publisher.connect();

    console.log('✅ Slack Event Publisher ready');
    console.log('🎧 Listening for Slack @mentions...');
    console.log('📤 Publishing events to KĀDI broker');

    // Keep process alive and handle graceful shutdown
    process.on('SIGINT', async () => {
      console.log('\n🛑 Shutting down gracefully...');
      await this.slackManager.stop();
      await this.publisher.disconnect();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      console.log('\n🛑 Received SIGTERM, shutting down...');
      await this.slackManager.stop();
      await this.publisher.disconnect();
      process.exit(0);
    });
  }
}

// ============================================================================
// Main Entry Point
// ============================================================================

async function main(): Promise<void> {
  try {
    const publisher = new SlackEventPublisher();
    await publisher.run();
  } catch (error) {
    console.error('💥 Fatal error:', error);
    process.exit(1);
  }
}

main();
