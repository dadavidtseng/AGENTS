/**
 * Slack Listener
 * ==============
 *
 * Listens for Slack @mentions via Bolt HTTP Events API and publishes
 * events to the KĀDI broker. Uses ngrok (or similar) for public URL.
 */

import { App } from '@slack/bolt';
import type { KadiClient } from '@kadi.build/core';
import type { SlackMentionEvent, ChatImageAttachment } from '../../shared/types.js';

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

      // Extract image attachments from Slack files
      const imageAttachments = await this.extractImageAttachments(event.files);

      const mentionEvent: SlackMentionEvent = {
        id: event.ts,
        user: event.user,
        text: cleanText,
        channel: event.channel,
        thread_ts: event.thread_ts || event.ts,
        ts: event.ts,
        bot_id: this.config.botUserId,
        timestamp: new Date().toISOString(),
        ...(imageAttachments.length > 0 && { attachments: imageAttachments }),
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
      const imgInfo = imageAttachments.length > 0 ? ` [${imageAttachments.length} image(s)]` : '';
      console.log(`💬 [Slack] @${event.user}: "${textPreview}"${imgInfo} → published`);
    } catch (error) {
      console.error('❌ [Slack] Error handling mention:', error);
    }
  }

  /**
   * Extract image attachments from Slack event files.
   * Downloads each image using the Slack Web API and base64-encodes it.
   */
  private async extractImageAttachments(files?: any[]): Promise<ChatImageAttachment[]> {
    if (!files || files.length === 0) return [];

    const attachments: ChatImageAttachment[] = [];

    for (const file of files) {
      if (!file.mimetype?.startsWith('image/')) continue;

      try {
        // Use Slack Web API to verify file access and get download URL
        const fileId = file.id;
        if (!fileId) {
          console.warn(`⚠️  [Slack] No file ID for image "${file.name}"`);
          continue;
        }

        console.log(`📥 [Slack] Downloading image "${file.name}" (id: ${fileId})...`);
        const base64 = await this.downloadSlackFile(fileId, file.url_private_download || file.url_private);
        attachments.push({
          filename: file.name ?? 'unknown',
          contentType: file.mimetype,
          size: file.size ?? 0,
          base64,
        });
      } catch (err) {
        console.warn(`⚠️  [Slack] Failed to download image "${file.name}":`, err);
      }
    }

    return attachments;
  }

  /**
   * Download a Slack file. First tries files.info API to verify access,
   * then downloads the binary content with proper auth.
   */
  private async downloadSlackFile(fileId: string, fallbackUrl: string): Promise<string> {
    // Strategy 1: Use Slack Web API files.info to verify access
    try {
      const info = await this.app.client.files.info({ file: fileId });
      if (!info.ok) {
        console.warn(`⚠️  [Slack] files.info failed: ${info.error}`);
      } else {
        console.log(`✅ [Slack] files.info OK — file accessible`);
        // Use the URL from the API response (most reliable)
        const url = (info.file as any)?.url_private_download || (info.file as any)?.url_private || fallbackUrl;
        return await this.fetchFileWithAuth(url);
      }
    } catch (err: any) {
      console.warn(`⚠️  [Slack] files.info error: ${err.data?.error || err.message}`);
      if (err.data?.error === 'missing_scope') {
        console.error(`❌ [Slack] Bot is missing 'files:read' scope! Add it at https://api.slack.com/apps → OAuth & Permissions`);
      }
    }

    // Strategy 2: Direct fetch with Bearer (fallback)
    return await this.fetchFileWithAuth(fallbackUrl);
  }

  /**
   * Fetch a file URL with Bearer token auth.
   */
  private async fetchFileWithAuth(url: string): Promise<string> {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${this.config.botToken}` },
      redirect: 'follow',
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('text/html')) {
      throw new Error(`Slack returned HTML instead of image. Bot needs 'files:read' scope. URL: ${url.substring(0, 60)}...`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    console.log(`✅ [Slack] Downloaded ${buffer.length} bytes (Content-Type: ${contentType})`);
    return buffer.toString('base64');
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
