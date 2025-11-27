/**
 * Slack Bot Integration for Agent_TypeScript with Resilience
 * ===========================================================
 *
 * Subscribes to Slack @mention events via KĀDI event bus and responds using Claude API.
 * Includes retry logic, circuit breaker, and timeout metrics.
 *
 * Flow:
 * 1. Subscribe to slack.app_mention.{BOT_USER_ID} events
 * 2. For each mention, call Claude API with user message
 * 3. Execute any tool calls Claude requests via KADI broker
 * 4. Reply to Slack thread via MCP_Slack_Server
 *
 * Resilience Features:
 * - Exponential backoff retry (3 attempts with 1s, 2s, 4s delays)
 * - Circuit breaker (opens after 5 failures, resets after 1 minute)
 * - Timeout metrics tracking
 */

import Anthropic from '@anthropic-ai/sdk';
import type { KadiClient } from '@kadi.build/core';
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
// Slack Bot Manager with Resilience
// ============================================================================

export class SlackBot {
  private client: KadiClient;
  private protocol: any = null;
  private anthropic: Anthropic;
  private botUserId: string;

  // Circuit breaker state (retained for processMention error handling)
  private failureCount = 0;
  private lastFailureTime = 0;
  private readonly maxFailures = 5;
  private readonly resetTimeMs = 60000; // 1 minute
  private isCircuitOpen = false;

  // Retry configuration (retained for tool invocation)
  private readonly maxRetries = 3;
  private readonly baseDelayMs = 1000;

  // Timeout metrics (retained for monitoring)
  private totalRequests = 0;
  private timeoutCount = 0;
  private successCount = 0;

  constructor(config: SlackBotConfig) {
    this.client = config.client;
    // Don't get protocol here - will be initialized in start()
    this.anthropic = new Anthropic({ apiKey: config.anthropicApiKey });
    this.botUserId = config.botUserId;
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Check circuit breaker state and reset if needed
   */
  private checkCircuitBreaker(): boolean {
    const now = Date.now();

    // Reset circuit if enough time has passed
    if (this.isCircuitOpen && (now - this.lastFailureTime) > this.resetTimeMs) {
      console.log('🔧 Circuit breaker reset - attempting recovery');
      this.isCircuitOpen = false;
      this.failureCount = 0;
    }

    return this.isCircuitOpen;
  }

  /**
   * Record failure and update circuit breaker
   */
  private recordFailure(_error: any): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    this.timeoutCount++;

    if (this.failureCount >= this.maxFailures && !this.isCircuitOpen) {
      this.isCircuitOpen = true;
      console.error(`⚡ Circuit breaker OPEN after ${this.failureCount} failures`);
      console.error(`   Will retry after ${this.resetTimeMs / 1000} seconds`);
    }

    // Log timeout metrics every 10 requests
    if (this.totalRequests % 10 === 0) {
      this.logMetrics();
    }
  }

  /**
   * Record success and reset failure counter
   */
  private recordSuccess(): void {
    if (this.failureCount > 0) {
      console.log(`✅ Request succeeded - resetting failure count (was ${this.failureCount})`);
    }
    this.failureCount = 0;
    this.successCount++;
  }

  /**
   * Log timeout and success metrics
   */
  private logMetrics(): void {
    const successRate = this.totalRequests > 0
      ? ((this.successCount / this.totalRequests) * 100).toFixed(1)
      : '0.0';
    const timeoutRate = this.totalRequests > 0
      ? ((this.timeoutCount / this.totalRequests) * 100).toFixed(1)
      : '0.0';

    console.log('📊 Slack Bot Metrics:');
    console.log(`   Total Requests: ${this.totalRequests}`);
    console.log(`   Successes: ${this.successCount} (${successRate}%)`);
    console.log(`   Timeouts: ${this.timeoutCount} (${timeoutRate}%)`);
    console.log(`   Circuit Breaker: ${this.isCircuitOpen ? 'OPEN' : 'CLOSED'}`);
  }

  /**
   * Invoke tool with retry logic and exponential backoff
   */
  private async invokeToolWithRetry(
    params: {
      targetAgent: string;
      toolName: string;
      toolInput: any;
      timeout: number;
    },
    retryCount = 0
  ): Promise<any> {
    this.totalRequests++;

    try {
      const result = await this.protocol.invokeTool(params);
      this.recordSuccess();
      return result;
    } catch (error: any) {
      const isTimeout = error.message?.includes('timeout');
      const isNetworkError = error.message?.includes('ECONNREFUSED') ||
                            error.message?.includes('ENOTFOUND');

      // Only retry on timeout or network errors
      if ((isTimeout || isNetworkError) && retryCount < this.maxRetries) {
        const delayMs = this.baseDelayMs * Math.pow(2, retryCount);
        console.warn(`⚠️  Request failed (${error.message}), retrying in ${delayMs}ms (attempt ${retryCount + 1}/${this.maxRetries})...`);

        await this.sleep(delayMs);
        return this.invokeToolWithRetry(params, retryCount + 1);
      }

      // Record failure after all retries exhausted
      this.recordFailure(error);
      throw error;
    }
  }

  /**
   * Start event subscription for Slack mentions
   */
  start(): void {
    console.log('🤖 Starting Slack bot with event-driven architecture...');

    // Initialize protocol now that client is connected
    this.protocol = this.client.getBrokerProtocol();

    // Subscribe to Slack mention events
    this.subscribeToMentions();
  }

  /**
   * Stop event subscription
   */
  stop(): void {
    // Unsubscribe from events if needed
    console.log('🛑 Slack bot stopped');
  }

  /**
   * Subscribe to Slack mention events via KĀDI event bus
   */
  private subscribeToMentions(): void {
    const topic = `slack.app_mention.${this.botUserId}`;

    console.log(`[KĀDI] Subscriber: Registering subscription {topic: ${topic}, botUserId: ${this.botUserId}}`);

    try {
      this.client.subscribeToEvent(topic, async (event: unknown) => {
        // Check circuit breaker before processing
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

        // Convert to SlackMention format for existing processing logic
        const slackMention: SlackMention = {
          id: mention.id,
          user: mention.user,
          text: mention.text,
          channel: mention.channel,
          thread_ts: mention.thread_ts,
          ts: mention.ts,
        };

        // Process mention using existing logic
        await this.processMention(slackMention);
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

      // Get list of available KADI tools
      const availableTools = this.getAvailableTools();

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

      // Handle the result - invokeTool may return different structures
      if (result && typeof result === 'object') {
        return { success: true, result: result.result || result };
      }

      return { success: true, result };
    } catch (error: any) {
      console.error(`❌ Tool execution failed (${toolName}):`, error);
      return { success: false, error: String(error) };
    }
  }

  /**
   * Send reply to Slack via MCP_Slack_Server
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
  }

  /**
   * Get available KADI tools formatted for Claude API
   */
  private getAvailableTools(): Anthropic.Tool[] {
    // Hardcoded list of available tools
    // TODO: Dynamically fetch from broker via kadi.tools.list
    return [
      {
        name: 'format_text',
        description: 'Format text to uppercase, lowercase, capitalize, or title case. Use this when user asks to convert text case or format text in different styles.',
        input_schema: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'Text to format' },
            style: {
              type: 'string',
              enum: ['uppercase', 'lowercase', 'capitalize', 'title'],
              description: 'Formatting style: uppercase (ALL CAPS), lowercase (all lowercase), capitalize (First letter), title (Each Word Capitalized)',
            },
          },
          required: ['text', 'style'],
        },
      },
      {
        name: 'reverse_text',
        description: 'Reverse the character order in text. Use this when user asks to reverse, flip, or mirror text.',
        input_schema: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'Text to reverse' },
          },
          required: ['text'],
        },
      },
      {
        name: 'count_words',
        description: 'Count words, characters, and lines in text. Use this when user asks how many words, characters, or lines are in text.',
        input_schema: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'Text to count words in' },
          },
          required: ['text'],
        },
      },
      {
        name: 'trim_text',
        description: 'Remove whitespace from text. Use this when user asks to trim, remove spaces, or clean up whitespace.',
        input_schema: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'Text to trim' },
            mode: {
              type: 'string',
              enum: ['both', 'start', 'end'],
              description: 'Trimming mode: both (trim both sides), start (trim beginning only), end (trim ending only)',
            },
          },
          required: ['text', 'mode'],
        },
      },
      {
        name: 'validate_json',
        description: 'Validate and parse JSON strings. Use this when user asks to validate JSON, check if JSON is valid, or parse JSON.',
        input_schema: {
          type: 'object',
          properties: {
            json_string: { type: 'string', description: 'JSON string to validate and parse' },
          },
          required: ['json_string'],
        },
      },
    ];
  }

  /**
   * Resolve target agent for a tool name
   */
  private resolveTargetAgent(toolName: string): string {
    // Simple prefix-based routing
    if (toolName.startsWith('format_') || toolName.startsWith('count_') || toolName.startsWith('validate_') || toolName.startsWith('reverse_') || toolName.startsWith('trim_')) {
      return 'text-processor'; // Agent_TypeScript's own name
    }
    if (toolName.startsWith('slack_')) {
      return 'slack-server';
    }
    if (toolName.startsWith('git_')) {
      return 'git';
    }

    // Default: assume it's a global tool
    return 'text-processor';
  }
}
