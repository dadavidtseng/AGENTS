/**
 * Slack Listener
 * ==============
 *
 * Listens for Slack @mentions via Bolt HTTP Events API and publishes
 * events to the KĀDI broker. Uses ngrok (or similar) for public URL.
 */

import { App } from '@slack/bolt';
import type { KadiClient } from '@kadi.build/core';
import type { SlackMentionEvent } from '../../shared/types.js';

export interface SlackListenerConfig {
  botToken: string;
  signingSecret: string;
  httpPort: number;
  botUserId: string;
  logLevel: string;
}

export class SlackListener {
  private app: App;
  private readonly config: SlackListenerConfig;

  constructor(
    config: SlackListenerConfig,
    private readonly kadiClient: KadiClient,
  ) {
    this.config = config;

    this.app = new App({
      token: config.botToken,
      signingSecret: config.signingSecret,
    });

    this.registerEventHandlers();
  }

  private registerEventHandlers(): void {
    this.app.event('app_mention', async ({ event }) => {
      await this.handleMention(event);
    });

    console.log('✅ Registered Slack event handler: app_mention');
  }

  private async handleMention(event: any): Promise<void> {
    try {
      // Remove bot mention tags from text
      const cleanText = event.text.replace(/<@[A-Z0-9]+>/g, '').trim();

      const mentionEvent: SlackMentionEvent = {
        id: event.ts,
        user: event.user,
        text: cleanText,
        channel: event.channel,
        thread_ts: event.thread_ts || event.ts,
        ts: event.ts,
        bot_id: this.config.botUserId,
        timestamp: new Date().toISOString(),
      };

      // Publish to KĀDI broker
      const topic = `slack.app_mention.${this.config.botUserId}`;

      await this.kadiClient.publish(topic, mentionEvent, {
        broker: 'default',
        network: 'text',
      });

      const textPreview = cleanText.length > 50
        ? cleanText.substring(0, 50) + '...'
        : cleanText;
      console.log(`💬 [Slack] @${event.user}: "${textPreview}" → published`);
    } catch (error) {
      console.error('❌ [Slack] Error handling mention:', error);
    }
  }

  async start(): Promise<void> {
    console.log(`🚀 [Slack] Starting HTTP Events API listener on port ${this.config.httpPort}...`);
    await this.app.start(this.config.httpPort);
    console.log(`✅ [Slack] HTTP listener started on port ${this.config.httpPort}`);
    console.log(`🎧 [Slack] Events URL: http://localhost:${this.config.httpPort}/slack/events`);
  }

  async stop(): Promise<void> {
    await this.app.stop();
    console.log('🛑 [Slack] HTTP listener stopped');
  }
}
