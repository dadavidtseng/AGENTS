/**
 * Slack Client Wrapper
 * ====================
 *
 * Wraps Slack WebClient for message sending with channel name resolution.
 * Shared by both tools (outbound) and listener (the Bolt app handles inbound).
 */

import { WebClient } from '@slack/web-api';

export class SlackPlatformClient {
  readonly webClient: WebClient;
  private channelCache: Map<string, string> = new Map();

  constructor(token: string) {
    this.webClient = new WebClient(token);
  }

  async resolveChannelId(channel: string): Promise<string> {
    // Already an ID (starts with C or D)
    if (channel.startsWith('C') || channel.startsWith('D')) {
      return channel;
    }

    const channelName = channel.replace(/^#/, '');

    if (this.channelCache.has(channelName)) {
      return this.channelCache.get(channelName)!;
    }

    const result = await this.webClient.conversations.list({
      types: 'public_channel,private_channel',
      limit: 1000,
    });

    if (!result.channels) {
      throw new Error('Failed to fetch channels');
    }

    for (const ch of result.channels) {
      if (ch.name && ch.id) {
        this.channelCache.set(ch.name, ch.id);
      }
    }

    const channelId = this.channelCache.get(channelName);
    if (!channelId) {
      throw new Error(`Channel '#${channelName}' not found`);
    }

    return channelId;
  }

  async sendMessage(
    channel: string,
    text: string,
    threadTs?: string,
  ): Promise<{ ts: string; channel: string }> {
    const channelId = await this.resolveChannelId(channel);

    const result = await this.webClient.chat.postMessage({
      channel: channelId,
      text,
      thread_ts: threadTs,
    });

    if (!result.ok || !result.ts) {
      throw new Error('Message send failed');
    }

    return { ts: result.ts, channel: result.channel || channelId };
  }

  async sendReply(
    channel: string,
    threadTs: string,
    text: string,
  ): Promise<{ ts: string; channel: string }> {
    return this.sendMessage(channel, text, threadTs);
  }
}
