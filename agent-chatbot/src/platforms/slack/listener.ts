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
import { logger, MODULE_SLACK_BOT, timer } from 'agents-library';

export interface SlackListenerConfig {
  botToken: string;
  signingSecret: string;
  httpPort: number;
  botUserId: string;
  logLevel: string;
  publishNetwork: string;
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

    logger.debug(MODULE_SLACK_BOT, 'Registered event handler: app_mention', timer.elapsed('main'));
  }

  private async handleMention(event: any): Promise<void> {
    try {
      // Immediate acknowledgement reaction
      try {
        await this.app.client.reactions.add({
          channel: event.channel,
          timestamp: event.ts,
          name: 'eyes',
        });
      } catch {
        logger.debug(MODULE_SLACK_BOT, 'Failed to add 👀 reaction', timer.elapsed('main'));
      }

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
        network: this.config.publishNetwork,
      });

      const textPreview = cleanText.length > 50
        ? cleanText.substring(0, 50) + '...'
        : cleanText;
      const imgInfo = imageAttachments.length > 0 ? ` [${imageAttachments.length} image(s)]` : '';
      logger.info(MODULE_SLACK_BOT, `@${event.user}: "${textPreview}"${imgInfo} → published`, timer.elapsed('main'));
    } catch (error) {
      logger.error(MODULE_SLACK_BOT, 'Error handling mention', timer.elapsed('main'), error as Error);
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
          logger.warn(MODULE_SLACK_BOT, `No file ID for image "${file.name}"`, timer.elapsed('main'));
          continue;
        }

        logger.debug(MODULE_SLACK_BOT, `Downloading image "${file.name}" (id: ${fileId})...`, timer.elapsed('main'));
        const base64 = await this.downloadSlackFile(fileId, file.url_private_download || file.url_private);
        attachments.push({
          filename: file.name ?? 'unknown',
          contentType: file.mimetype,
          size: file.size ?? 0,
          base64,
        });
      } catch (err) {
        logger.warn(MODULE_SLACK_BOT, `Failed to download image "${file.name}": ${err}`, timer.elapsed('main'));
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
        logger.warn(MODULE_SLACK_BOT, `files.info failed: ${info.error}`, timer.elapsed('main'));
      } else {
        logger.debug(MODULE_SLACK_BOT, 'files.info OK — file accessible', timer.elapsed('main'));
        // Use the URL from the API response (most reliable)
        const url = (info.file as any)?.url_private_download || (info.file as any)?.url_private || fallbackUrl;
        return await this.fetchFileWithAuth(url);
      }
    } catch (err: any) {
      logger.warn(MODULE_SLACK_BOT, `files.info error: ${err.data?.error || err.message}`, timer.elapsed('main'));
      if (err.data?.error === 'missing_scope') {
        logger.error(MODULE_SLACK_BOT, "Bot is missing 'files:read' scope! Add it at https://api.slack.com/apps → OAuth & Permissions", timer.elapsed('main'));
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
    logger.debug(MODULE_SLACK_BOT, `Downloaded ${buffer.length} bytes (Content-Type: ${contentType})`, timer.elapsed('main'));
    return buffer.toString('base64');
  }

  async start(): Promise<void> {
    logger.debug(MODULE_SLACK_BOT, `Starting HTTP Events API listener on port ${this.config.httpPort}...`, timer.elapsed('main'));
    await this.app.start(this.config.httpPort);
    logger.debug(MODULE_SLACK_BOT, `HTTP listener started on port ${this.config.httpPort}`, timer.elapsed('main'));
    logger.debug(MODULE_SLACK_BOT, `Events URL: http://localhost:${this.config.httpPort}/slack/events`, timer.elapsed('main'));
  }

  async stop(): Promise<void> {
    await this.app.stop();
    logger.info(MODULE_SLACK_BOT, 'HTTP listener stopped', timer.elapsed('main'));
  }
}
