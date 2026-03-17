/**
 * Discord Listener
 * ================
 *
 * Listens for Discord @mentions via Gateway and publishes events
 * to the KĀDI broker. Uses the shared DiscordPlatformClient.
 */

import type { Message } from 'discord.js';
import type { KadiClient } from '@kadi.build/core';
import type { DiscordPlatformClient } from './client.js';
import type { DiscordMentionEvent, ChatImageAttachment } from '../../shared/types.js';

export class DiscordListener {
  private botUserId: string | null = null;
  private readonly configBotUserId: string;

  constructor(
    private readonly discord: DiscordPlatformClient,
    private readonly kadiClient: KadiClient,
    configBotUserId: string,
    private readonly logLevel: string = 'info',
  ) {
    this.configBotUserId = configBotUserId;
  }

  /**
   * Start listening for @mentions on the Discord Gateway.
   */
  start(): void {
    const { client } = this.discord;

    client.on('ready', () => {
      this.botUserId = client.user?.id ?? null;
      console.log(`🆔 [Discord] Bot User ID: ${this.botUserId}`);
    });

    client.on('messageCreate', async (message: Message) => {
      await this.handleMessage(message);
    });

    console.log('🎧 [Discord] Listening for @mentions via Gateway');
  }

  private async handleMessage(message: Message): Promise<void> {
    try {
      if (message.author.bot) return;

      if (!this.botUserId) {
        console.warn('⚠️  [Discord] Message received but botUserId not initialized yet');
        return;
      }

      if (!message.mentions.has(this.botUserId)) {
        if (this.logLevel === 'debug') {
          console.log(`🔇 [Discord] Message from @${message.author.username} (no mention)`);
        }
        return;
      }

      // Remove bot mention from text
      const cleanText = message.content
        .replace(new RegExp(`<@!?${this.botUserId}>`, 'g'), '')
        .trim();

      const channelName = message.channel.isDMBased()
        ? 'DM'
        : (message.channel.isTextBased() ? (message.channel as any).name || 'unknown' : 'unknown');

      // Extract image attachments (Discord CDN URLs are public)
      const imageAttachments: ChatImageAttachment[] = [];
      for (const [, attachment] of message.attachments) {
        if (attachment.contentType?.startsWith('image/')) {
          imageAttachments.push({
            filename: attachment.name ?? 'unknown',
            contentType: attachment.contentType,
            size: attachment.size,
            url: attachment.url,
          });
        }
      }

      const event: DiscordMentionEvent = {
        id: message.id,
        user: message.author.id,
        username: message.author.username,
        text: cleanText,
        channel: message.channelId,
        channelName,
        guild: message.guildId || 'DM',
        ts: message.createdAt.toISOString(),
        bot_id: this.configBotUserId,
        timestamp: new Date().toISOString(),
        ...(imageAttachments.length > 0 && { attachments: imageAttachments }),
      };

      // Publish to KĀDI broker
      const topic = `discord.mention.${this.configBotUserId}`;
      const textPreview = cleanText.length > 50 ? cleanText.substring(0, 50) + '...' : cleanText;
      const imgInfo = imageAttachments.length > 0 ? ` [${imageAttachments.length} image(s)]` : '';

      await this.kadiClient.publish(topic, event, {
        broker: 'default',
        network: 'text',
      });

      console.log(`💬 [Discord] @${message.author.username} in #${channelName}: "${textPreview}"${imgInfo} → published`);
    } catch (error) {
      console.error('❌ [Discord] Error handling message:', error);
    }
  }
}
