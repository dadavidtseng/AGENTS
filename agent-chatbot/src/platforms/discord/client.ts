/**
 * Discord Client Wrapper
 * ======================
 *
 * Single discord.js Client instance shared by both listener (Gateway events)
 * and tools (REST API messaging). Eliminates the duplication of having separate
 * Client instances in mcp-client-discord and mcp-server-discord.
 */

import { Client, GatewayIntentBits, Partials, TextChannel, Message } from 'discord.js';
import { logger, MODULE_DISCORD_BOT, timer } from 'agents-library';

export class DiscordPlatformClient {
  readonly client: Client;
  private channelCache: Map<string, string> = new Map();
  private ready = false;
  private guildId?: string;

  constructor(token: string, guildId?: string) {
    this.guildId = guildId;

    // Combined intents: Gateway listening + REST messaging
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
      ],
      partials: [Partials.Channel],
    });

    this.client.on('clientReady', () => {
      this.ready = true;
      logger.info(MODULE_DISCORD_BOT, `Client ready as ${this.client.user?.tag}`, timer.elapsed('main'));
    });

    this.client.on('error', (error) => {
      logger.error(MODULE_DISCORD_BOT, 'Client error', timer.elapsed('main'), error);
    });

    // Login immediately
    this.client.login(token).catch((err) => {
      logger.error(MODULE_DISCORD_BOT, 'Failed to login to Discord', timer.elapsed('main'), err);
    });
  }

  private async waitForReady(): Promise<void> {
    if (this.ready) return;
    let attempts = 0;
    while (!this.ready && attempts < 100) {
      await new Promise(resolve => setTimeout(resolve, 100));
      attempts++;
    }
    if (!this.ready) throw new Error('Discord client not ready after timeout');
  }

  async resolveChannelId(channel: string): Promise<string> {
    await this.waitForReady();

    // Already a snowflake ID
    if (/^\d{17,19}$/.test(channel)) return channel;

    const channelName = channel.replace(/^#/, '');
    if (this.channelCache.has(channelName)) {
      return this.channelCache.get(channelName)!;
    }

    if (this.guildId) {
      const guild = await this.client.guilds.fetch(this.guildId);
      const channels = await guild.channels.fetch();
      for (const [id, ch] of channels) {
        if (ch?.name === channelName) {
          this.channelCache.set(channelName, id);
          return id;
        }
      }
    } else {
      for (const [, guild] of this.client.guilds.cache) {
        const channels = await guild.channels.fetch();
        for (const [id, ch] of channels) {
          if (ch?.name === channelName) {
            this.channelCache.set(channelName, id);
            return id;
          }
        }
      }
    }

    throw new Error(`Channel '${channelName}' not found`);
  }

  async sendMessage(
    channel: string,
    text: string,
    messageId?: string,
  ): Promise<{ id: string; channelId: string }> {
    await this.waitForReady();
    const channelId = await this.resolveChannelId(channel);
    const textChannel = await this.client.channels.fetch(channelId) as TextChannel;

    if (!textChannel?.isTextBased()) {
      throw new Error('Channel is not a text channel');
    }

    let message: Message;
    if (messageId) {
      const target = await textChannel.messages.fetch(messageId);
      message = await target.reply(text);
    } else {
      message = await textChannel.send(text);
    }

    return { id: message.id, channelId: message.channelId };
  }

  async sendReply(
    channel: string,
    messageId: string,
    text: string,
  ): Promise<{ id: string; channelId: string }> {
    return this.sendMessage(channel, text, messageId);
  }

  async addReaction(
    channel: string,
    messageId: string,
    emoji: string,
  ): Promise<void> {
    await this.waitForReady();
    const channelId = await this.resolveChannelId(channel);
    const textChannel = await this.client.channels.fetch(channelId) as TextChannel;
    if (!textChannel?.isTextBased()) {
      throw new Error('Channel is not a text channel');
    }
    const message = await textChannel.messages.fetch(messageId);
    await message.react(emoji);
  }

  destroy(): void {
    this.client.destroy();
    logger.info(MODULE_DISCORD_BOT, 'Client destroyed', timer.elapsed('main'));
  }
}
