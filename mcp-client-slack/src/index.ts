/**
 * Slack Event Publisher for KĀDI
 * ================================
 *
 * Pure KĀDI event publisher that listens for Slack @mentions via HTTP Events API
 * and publishes them as real-time events to the KĀDI broker.
 *
 * Architecture:
 * - Slack HTTP Events API: Receives @mention events via HTTP POST (requires public URL)
 * - KĀDI Publisher: Publishes events to broker topics
 * - Event-Driven: No polling, push-based architecture
 *
 * Transport:
 * - Uses ngrok (or similar tunnel) to expose local HTTP server to Slack
 * - More reliable than Socket Mode (stateless HTTP vs persistent WebSocket)
 *
 * Flow:
 * 1. User @mentions bot in Slack channel
 * 2. Slack sends HTTP POST to public URL → ngrok → local HTTP server
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
  SLACK_SIGNING_SECRET: z.string().min(1, 'SLACK_SIGNING_SECRET is required'),
  SLACK_HTTP_PORT: z.coerce.number().int().positive().default(3700),
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
      SLACK_SIGNING_SECRET: process.env.SLACK_SIGNING_SECRET,
      SLACK_HTTP_PORT: process.env.SLACK_HTTP_PORT || '3700',
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
  private port: number = 3700;

  constructor(config: Config, publisher: KadiEventPublisher | null = null) {
    this.publisher = publisher;
    this.port = config.SLACK_HTTP_PORT;

    // Check if token looks valid (not placeholder)
    const hasValidToken = config.SLACK_BOT_TOKEN.startsWith('xoxb-');

    if (hasValidToken) {
      // Initialize Slack Bolt app with HTTP Events API (no Socket Mode)
      this.app = new App({
        token: config.SLACK_BOT_TOKEN,
        signingSecret: config.SLACK_SIGNING_SECRET,
      });

      this.botUserId = config.SLACK_BOT_USER_ID;
      this.registerEventHandlers();
      this.enabled = true;
    } else {
      console.log('⚠️  Slack bot token appears to be a placeholder - running in stub mode');
      console.log('   Set valid SLACK_BOT_TOKEN and SLACK_SIGNING_SECRET to enable Slack integration');
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
    const startTime = Date.now();
    const startMs = new Date().toISOString();

    try {
      console.log(`\n📥 [${startMs}] ===== MENTION RECEIVED FROM SLACK =====`);
      console.log(`   Raw event.ts: ${event.ts}`);
      console.log(`   Raw event.user: ${event.user}`);
      console.log(`   Raw event.channel: ${event.channel}`);

      // Get bot user ID from Slack API (cached after first call)
      if (!this.botUserId && this.app) {
        console.log(`🔍 [+0ms] Bot ID not cached, calling Slack API auth.test()...`);
        const authStart = Date.now();
        const authResult = await this.app.client.auth.test();
        const authDuration = Date.now() - authStart;
        this.botUserId = authResult.user_id as string;
        console.log(`🤖 [+${authDuration}ms] ⭐ BLOCKING CALL COMPLETED: Bot user ID fetched from Slack API`);
        console.log(`   ${this.botUserId}`);
      } else if (this.botUserId) {
        console.log(`🤖 [+0ms] Bot user ID (cached, no API call): ${this.botUserId}`);
      } else {
        console.log(`⚠️  [+0ms] this.app is null! Cannot fetch bot ID`);
      }

      // Remove bot mention tags from text (e.g., <@U12345>)
      console.log(`📝 [+${Date.now() - startTime}ms] Parsing mention text...`);
      const parseStart = Date.now();
      const cleanText = event.text.replace(/<@[A-Z0-9]+>/g, '').trim();
      const parseDuration = Date.now() - parseStart;
      console.log(`📝 [+${parseDuration}ms] Parsed text: "${cleanText}"`);

      // Create mention object
      const mention: SlackMention = {
        id: event.ts,
        user: event.user,
        text: cleanText,
        channel: event.channel,
        thread_ts: event.thread_ts || event.ts,
        ts: event.ts,
      };
      console.log(`✏️  [+${Date.now() - startTime}ms] Mention object created`);

      // Publish to KĀDI event bus (blocking with proper error handling)
      if (this.publisher && this.botUserId) {
        console.log(`📤 [+${Date.now() - startTime}ms] Publishing to KĀDI broker...`);
        const publishStart = Date.now();

        try {
          console.log(`📤 [+${Date.now() - startTime}ms] Awaiting publishMention() call...`);
          await this.publisher.publishMention(mention, this.botUserId);
          const publishDuration = Date.now() - publishStart;
          console.log(`✅ [+${publishDuration}ms] ⭐ BLOCKING CALL COMPLETED: Mention published to KĀDI`);
          console.log(`⏱️  Total time from Slack receive to KĀDI publish: ${Date.now() - startTime}ms\n`);
        } catch (error) {
          const publishDuration = Date.now() - publishStart;
          console.error(`❌ [+${publishDuration}ms] ⭐ BLOCKING CALL FAILED: publishMention threw error`);
          console.error(`   Error: ${error instanceof Error ? error.message : String(error)}`);
          console.warn(`⚠️  Slack mention may not have reached KĀDI broker`);
          console.log(`❌ Failed at total time: ${Date.now() - startTime}ms\n`);
        }
      } else {
        console.warn(`⚠️  [+${Date.now() - startTime}ms] CANNOT PUBLISH: publisher=${!!this.publisher}, botUserId=${this.botUserId}`);
      }

      const handlerDuration = Date.now() - startTime;
      console.log(`💬 [+${handlerDuration}ms] ✅ HANDLER COMPLETE: "${cleanText}" from @${event.user}`);
      if (handlerDuration > 500) {
        console.warn(`⚠️  SLOW HANDLER: Took ${handlerDuration}ms (>500ms threshold)`);
        console.warn(`   This will block Slack from processing the next mention!`);
      }
      console.log();
    } catch (error) {
      const errorTime = Date.now() - startTime;
      console.error(`❌ [+${errorTime}ms] Unhandled error in mention handler:`, error);
      console.error(`❌ Error occurred at: ${errorTime}ms into handler\n`);
    }
  }

  /**
   * Start Slack HTTP Events API listener
   */
  async start(): Promise<void> {
    if (!this.app || !this.enabled) {
      console.log('ℹ️  Slack connection disabled (using stub mode)');
      return;
    }

    console.log(`🚀 [START] Starting Slack HTTP Events API listener on port ${this.port}...`);

    try {
      await this.app.start(this.port);
      console.log(`✅ [START] Slack HTTP listener started on port ${this.port}`);
      console.log('🎧 [START] Ready to receive @mentions from Slack via HTTP Events API');
      console.log(`🎧 [START] Slack should POST events to: http://localhost:${this.port}/slack/events`);
      console.log('🎧 [START] Event handler registered for: app_mention');
    } catch (error) {
      console.error('❌ [START] Failed to start Slack HTTP listener:', error);
      throw error;
    }
  }

  /**
   * Stop Slack app
   */
  async stop(): Promise<void> {
    if (!this.app || !this.enabled) {
      return;
    }

    await this.app.stop();
    console.log('🛑 Slack HTTP listener stopped');
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
    const runStartTime = Date.now();
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('🚀 Starting Slack Event Publisher...');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('📋 Configuration:');
    console.log(`   - Log Level: ${this.config.LOG_LEVEL}`);
    console.log(`   - Broker: ${this.config.KADI_BROKER_URL}`);
    console.log(`   - Bot User ID: ${this.config.SLACK_BOT_USER_ID}`);
    console.log(`   - HTTP Port: ${this.config.SLACK_HTTP_PORT}`);
    console.log(`   - Transport: HTTP Events API (via ngrok)`);
    console.log();

    // Start Slack HTTP Events API listener
    console.log('[STEP 1] Starting Slack HTTP Events API listener...');
    const slackStartTime = Date.now();
    await this.slackManager.start();
    const slackDuration = Date.now() - slackStartTime;
    console.log(`✅ [STEP 1] Slack HTTP listener started (+${slackDuration}ms)`);
    console.log();

    // Connect to KĀDI broker
    console.log('[STEP 2] Connecting to KĀDI broker...');
    const brokerStartTime = Date.now();
    await this.publisher.connect();
    const brokerDuration = Date.now() - brokerStartTime;
    console.log(`✅ [STEP 2] Connected to KĀDI broker (+${brokerDuration}ms)`);
    console.log();

    const totalDuration = Date.now() - runStartTime;
    console.log('═══════════════════════════════════════════════════════════');
    console.log('✅ Slack Event Publisher ready');
    console.log('🎧 Listening for Slack @mentions...');
    console.log('📤 Publishing events to KĀDI broker');
    console.log(`⏱️  Total startup time: ${totalDuration}ms`);
    console.log('═══════════════════════════════════════════════════════════\n');

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
