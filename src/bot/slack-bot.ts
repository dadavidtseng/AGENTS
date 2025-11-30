/**
 * Slack Bot Integration for Agent_TypeScript with Resilience
 * ===========================================================
 *
 * Subscribes to Slack @mention events via KĀDI event bus and responds using Claude API.
 * Extends BaseBot for circuit breaker, retry logic, and metrics tracking.
 *
 * Flow:
 * 1. Subscribe to slack.app_mention.{BOT_USER_ID} events
 * 2. For each mention, call Claude API with user message
 * 3. Execute any tool calls Claude requests via KADI broker
 * 4. Reply to Slack thread via MCP_Slack_Server
 *
 * Resilience Features (inherited from BaseBot):
 * - Exponential backoff retry (3 attempts with 1s, 2s, 4s delays)
 * - Circuit breaker (opens after 5 failures, resets after 1 minute)
 * - Timeout metrics tracking
 */

import Anthropic from '@anthropic-ai/sdk';
import type { KadiClient } from '@kadi.build/core';
import { BaseBot } from '@agents/shared';
import { SlackMentionEventSchema } from './types/slack-events.js';

// ============================================================================
// Types
// ============================================================================

interface SlackMention {
  id: string;
  user: string;
  text: string;
  channel: string;
  thread_ts: string;
  ts: string;
}

interface SlackBotConfig {
  client: KadiClient;
  anthropicApiKey: string;
  botUserId: string;
}

// ============================================================================
// Slack Bot Manager extending BaseBot
// ============================================================================

export class SlackBot extends BaseBot {
  constructor(config: SlackBotConfig) {
    super(config);
  }

  /**
   * Start event subscription for Slack mentions
   *
   * Overrides BaseBot.start() to initialize protocol and subscribe to Slack events.
   */
  start(): void {
    console.log('🤖 Starting Slack bot with event-driven architecture...');

    // Initialize protocol from BaseBot
    this.initializeProtocol();

    // Subscribe to Slack mention events
    this.subscribeToMentions();
  }

  /**
   * Stop event subscription
   *
   * Overrides BaseBot.stop() to cleanup Slack-specific resources.
   */
  stop(): void {
    // Unsubscribe from events if needed
    console.log('🛑 Slack bot stopped');
  }

  /**
   * Handle Slack mention event
   *
   * Implements BaseBot.handleMention() abstract method.
   * Processes Slack-specific mention format and delegates to processMention().
   *
   * @param event - Slack mention event from KĀDI
   */
  protected async handleMention(event: any): Promise<void> {
    // Convert to SlackMention format
    const slackMention: SlackMention = {
      id: event.id,
      user: event.user,
      text: event.text,
      channel: event.channel,
      thread_ts: event.thread_ts,
      ts: event.ts,
    };

    await this.processMention(slackMention);
  }

  /**
   * Subscribe to Slack mention events via KĀDI event bus
   */
  private subscribeToMentions(): void {
    const topic = `slack.app_mention.${this.botUserId}`;

    console.log(`[KĀDI] Subscriber: Registering subscription {topic: ${topic}, botUserId: ${this.botUserId}}`);

    try {
      this.client.subscribeToEvent(topic, async (event: unknown) => {
        // Check circuit breaker before processing (from BaseBot)
        if (this.checkCircuitBreaker()) {
          console.warn('[KĀDI] Subscriber: Event processing skipped {reason: circuit breaker OPEN}');
          return;
        }

        // Extract event data from KĀDI envelope
        // KĀDI wraps events in: { eventName, data, timestamp, source, metadata }
        const eventData = (event as any)?.data || event;

        // Validate event payload with schema
        const validationResult = SlackMentionEventSchema.safeParse(eventData);

        if (!validationResult.success) {
          const errorDetails = validationResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
          console.error(`[KĀDI] Subscriber: Event validation failed {errors: [${errorDetails}]}`);
          return;
        }

        const mention = validationResult.data;

        // Truncate text for logging (don't log full message content)
        const textPreview = mention.text.length > 50
          ? mention.text.substring(0, 50) + '...'
          : mention.text;

        console.log(`[KĀDI] Subscriber: Event received {mentionId: ${mention.id}, user: ${mention.user}, channel: ${mention.channel}, textPreview: "${textPreview}", timestamp: ${mention.timestamp}}`);

        // Process mention using handleMention
        await this.handleMention(mention);
      });

      console.log(`[KĀDI] Subscriber: Subscription registered successfully {topic: ${topic}}`);
    } catch (error: any) {
      console.error(`[KĀDI] Subscriber: Subscription registration failed {topic: ${topic}, error: ${error.message || 'Unknown error'}}`);
    }
  }

  /**
   * Process a single Slack mention with Claude API
   */
  private async processMention(mention: SlackMention): Promise<void> {
    try {
      console.log(`💬 Processing mention from @${mention.user}: "${mention.text}"`);

      // Get list of available KADI tools (dynamically from client and broker)
      const availableTools = await this.getAvailableTools();

      // Call Claude API
      let response = await this.anthropic.messages.create({
        model: process.env.BOT_CLAUDE_MODEL || 'claude-3-haiku-20240307',
        max_tokens: parseInt(process.env.BOT_CLAUDE_MAX_TOKENS || '4096'),
        tools: availableTools,
        messages: [
          {
            role: 'user',
            content: mention.text,
          },
        ],
      });

      // Handle tool use loop
      let conversationMessages: any[] = [
        { role: 'user', content: mention.text },
      ];

      while (response.stop_reason === 'tool_use') {
        // Extract tool calls
        const toolBlocks = response.content.filter((block) => block.type === 'tool_use');

        // Add assistant response to conversation
        conversationMessages.push({
          role: 'assistant',
          content: response.content,
        });

        // Execute tool calls
        const toolResults = [];
        for (const toolBlock of toolBlocks) {
          if (toolBlock.type !== 'tool_use') continue;

          const result = await this.executeKadiTool(
            toolBlock.name,
            toolBlock.input as Record<string, unknown>
          );

          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolBlock.id,
            content: JSON.stringify(result),
          });
        }

        // Add tool results to conversation
        conversationMessages.push({
          role: 'user',
          content: toolResults,
        });

        // Get next Claude response
        response = await this.anthropic.messages.create({
          model: process.env.BOT_CLAUDE_MODEL || 'claude-3-haiku-20240307',
          max_tokens: parseInt(process.env.BOT_CLAUDE_MAX_TOKENS || '4096'),
          tools: availableTools,
          messages: conversationMessages,
        });
      }

      // Extract final text response
      const finalText = response.content
        .filter((block) => block.type === 'text')
        .map((block: any) => block.text)
        .join('\n');

      // Reply to Slack
      await this.sendSlackReply(mention.channel, mention.thread_ts, finalText);

      console.log(`✅ Replied to @${mention.user}`);
    } catch (error: any) {
      console.error(`❌ Error processing mention from @${mention.user}:`, error);

      // Send error message to Slack
      await this.sendSlackReply(
        mention.channel,
        mention.thread_ts,
        'Sorry, I encountered an error processing your message. Please try again later.'
      );
    }
  }

  /**
   * Execute a KADI tool via broker
   */
  private async executeKadiTool(
    toolName: string,
    input: Record<string, unknown>
  ): Promise<any> {
    if (!this.protocol) {
      return { success: false, error: 'Protocol not initialized' };
    }

    try {
      console.log(`🔧 Executing tool: ${toolName}`);

      // Determine target agent based on tool name
      const targetAgent = this.resolveTargetAgent(toolName);

      const result = await this.protocol.invokeTool({
        targetAgent,
        toolName,
        toolInput: input,
        timeout: 30000,
      });

      // Handle the result - MCP tools return results in various formats
      // Some return { result: string }, some return { content: [...] }, some return plain values
      if (result && typeof result === 'object') {
        // MCP tools often return { content: [{ type: 'text', text: '...' }] }
        if (Array.isArray(result.content)) {
          const textContent = result.content
            .filter((item: any) => item.type === 'text')
            .map((item: any) => item.text)
            .join('\n');
          return textContent || JSON.stringify(result);
        }

        // Some tools return { result: { ... } }
        if (result.result !== undefined) {
          return result.result;
        }

        // Return the whole result object as fallback
        return result;
      }

      return result;
    } catch (error: any) {
      console.error(`❌ Tool execution failed (${toolName}):`, error);

      // Extract useful error message for Claude
      const errorMessage = error.message || String(error);
      return `Error executing tool: ${errorMessage}`;
    }
  }

  /**
   * Send reply to Slack via MCP_Slack_Server
   *
   * Handles Slack's 4,000 character limit by splitting long messages
   * into multiple sequential replies in the same thread.
   */
  private async sendSlackReply(
    channel: string,
    thread_ts: string,
    text: string
  ): Promise<void> {
    if (!this.protocol) {
      console.error('❌ Cannot send Slack reply: protocol not initialized');
      return;
    }

    const MAX_SLACK_MESSAGE_LENGTH = 4000;

    // If message fits in one reply, send directly
    if (text.length <= MAX_SLACK_MESSAGE_LENGTH) {
      await this.invokeToolWithRetry({
        targetAgent: 'slack-server',
        toolName: 'slack_send_reply',
        toolInput: {
          channel,
          thread_ts,
          text,
        },
        timeout: parseInt(process.env.BOT_TOOL_TIMEOUT_MS || '10000'),
      });
      return;
    }

    // Split long message into chunks
    console.log(`📄 Message too long (${text.length} chars), splitting into chunks...`);

    const chunks = this.splitMessage(text, MAX_SLACK_MESSAGE_LENGTH);

    console.log(`📤 Sending ${chunks.length} message chunks to Slack`);

    // Send all chunks as threaded replies
    for (let i = 0; i < chunks.length; i++) {
      await this.invokeToolWithRetry({
        targetAgent: 'slack-server',
        toolName: 'slack_send_reply',
        toolInput: {
          channel,
          thread_ts,
          text: chunks[i],
        },
        timeout: parseInt(process.env.BOT_TOOL_TIMEOUT_MS || '10000'),
      });

      // Small delay between messages to avoid rate limiting
      if (i < chunks.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
  }

  /**
   * Split message into chunks that respect Slack's character limit
   *
   * Tries to split on newlines to keep formatting intact.
   *
   * @param text - Full message text
   * @param maxLength - Maximum length per chunk (default: 4000)
   * @returns Array of message chunks
   */
  private splitMessage(text: string, maxLength: number = 4000): string[] {
    const chunks: string[] = [];
    let currentChunk = '';

    // Split by lines to preserve formatting
    const lines = text.split('\n');

    for (const line of lines) {
      // If single line exceeds limit, force-split it
      if (line.length > maxLength) {
        // Save current chunk if not empty
        if (currentChunk) {
          chunks.push(currentChunk);
          currentChunk = '';
        }

        // Force-split the long line
        let remainingLine = line;
        while (remainingLine.length > maxLength) {
          chunks.push(remainingLine.substring(0, maxLength));
          remainingLine = remainingLine.substring(maxLength);
        }
        currentChunk = remainingLine + '\n';
        continue;
      }

      // Check if adding this line would exceed limit
      if (currentChunk.length + line.length + 1 > maxLength) {
        // Save current chunk and start new one
        chunks.push(currentChunk.trim());
        currentChunk = line + '\n';
      } else {
        // Add line to current chunk
        currentChunk += line + '\n';
      }
    }

    // Add final chunk if not empty
    if (currentChunk.trim()) {
      chunks.push(currentChunk.trim());
    }

    return chunks;
  }

  /**
   * Query broker for tools available on connected networks
   *
   * Uses KĀDI broker's kadi.ability.list API to discover tools available
   * on the networks this agent is connected to (global, text, git, slack, discord).
   *
   * @returns Array of network tools in Anthropic format
   */
  private async queryNetworkTools(): Promise<Anthropic.Tool[]> {
    try {
      const networks = this.client.config.networks || [];

      // Get broker protocol to access connection
      const protocol = this.client.getBrokerProtocol();

      // Query broker for tools on connected networks
      const result = await (protocol as any).connection.sendRequest({
        jsonrpc: '2.0',
        method: 'kadi.ability.list',
        params: {
          networks,
          includeProviders: false  // We don't need provider info for Claude
        },
        id: `tools_${Date.now()}`
      }) as {
        tools: Array<{
          name: string;
          description?: string;
          inputSchema?: any;
        }>;
      };

      console.log(`🔍 Discovered ${result.tools.length} network tools from broker`);

      // Convert to Anthropic format
      return result.tools.map((tool: any) => ({
        name: tool.name,
        description: tool.description || '',
        input_schema: (tool.inputSchema || { type: 'object' }) as Anthropic.Tool.InputSchema
      }));
    } catch (error) {
      console.error('❌ Failed to query network tools from broker:', error);
      return [];  // Fallback to empty array on error
    }
  }

  /**
   * Get available KADI tools formatted for Claude API
   *
   * Combines tools from two sources:
   * 1. Local tools: Registered directly on this agent via client.registerTool()
   * 2. Network tools: Available via broker on connected networks
   *
   * This enables dynamic discovery - when broker tools change, they're
   * automatically available to Claude without code changes.
   */
  private async getAvailableTools(): Promise<Anthropic.Tool[]> {
    // 1. Get locally registered tools (tools on THIS agent)
    const localTools = this.client.getAllRegisteredTools().map(tool => ({
      name: tool.definition.name,
      description: tool.definition.description || '',
      input_schema: tool.definition.inputSchema as Anthropic.Tool.InputSchema
    }));

    // 2. Query broker for tools available on connected networks
    const networkTools = await this.queryNetworkTools();

    // 3. Deduplicate: prefer local tools over network tools (local tools are authoritative)
    const localToolNames = new Set(localTools.map(t => t.name));
    const uniqueNetworkTools = networkTools.filter(t => !localToolNames.has(t.name));

    // 4. Combine and return (local tools first, then unique network tools)
    console.log(`📋 Available tools: ${localTools.length} local + ${uniqueNetworkTools.length} network (${networkTools.length - uniqueNetworkTools.length} duplicates removed) = ${localTools.length + uniqueNetworkTools.length} total`);

    return [...localTools, ...uniqueNetworkTools];
  }

  /**
   * Resolve target agent for a tool name
   */
  private resolveTargetAgent(toolName: string): string {
    // Simple prefix-based routing
    if (toolName.startsWith('format_') || toolName.startsWith('count_') || toolName.startsWith('validate_') || toolName.startsWith('reverse_') || toolName.startsWith('trim_') || toolName.startsWith('echo')) {
      return 'template-agent-typescript'; // This agent's own tools
    }
    if (toolName.startsWith('slack_')) {
      return 'slack-server';
    }
    if (toolName.startsWith('git_')) {
      return 'git';
    }

    // Default: assume it's a tool on this agent
    return 'template-agent-typescript';
  }
}
