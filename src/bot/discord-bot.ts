/**
 * Discord Bot Integration for Agent_TypeScript with Resilience
 * ===========================================================
 *
 * Subscribes to Discord @mention events from KĀDI broker and responds using Claude API.
 * Includes retry logic, circuit breaker, and timeout metrics.
 *
 * Flow:
 * 1. Subscribe to discord.mention.{botId} topic on KĀDI broker
 * 2. Receive @mention events in real-time
 * 3. For each mention, call Claude API with user message
 * 4. Execute any tool calls Claude requests via KADI broker
 * 5. Reply to Discord channel via send_discord_message MCP tool
 *
 * Resilience Features:
 * - Exponential backoff retry (3 attempts with 1s, 2s, 4s delays)
 * - Circuit breaker (opens after 5 failures, resets after 1 minute)
 * - Timeout metrics tracking
 */

import Anthropic from '@anthropic-ai/sdk';
import {DiscordMentionEventSchema} from '../types/discord-events.js';
import {BaseBot, BaseBotConfig, logger, MODULE_DISCORD_BOT, timer} from 'agents-library';
import type { Message, ProviderError } from 'agents-library';
import type { MemoryError } from 'agents-library';
import { QUEST_WORKFLOW_SYSTEM_PROMPT } from '../prompts/quest-workflow.js';
import { getRandomAcknowledgment } from './acknowledgments.js';

// ============================================================================
// Types
// ============================================================================

interface ChatImageAttachment {
    filename: string;
    contentType: string;
    size: number;
    url?: string;
    base64?: string;
}

interface DiscordMention {
    id: string;
    user: string;
    text: string;
    channel: string;
    thread_ts: string;
    ts: string;
    attachments?: ChatImageAttachment[];
}

interface DiscordBotConfig extends BaseBotConfig {
    providerManager?: any; // ProviderManager from agents-library
    memoryService?: any;   // MemoryService from agents-library
}

// ============================================================================
// Discord Bot Manager with Resilience
// ============================================================================

export class DiscordBot extends BaseBot {
    constructor(config: DiscordBotConfig) {
        super(config);
        
        // Log service availability (services are stored in BaseBot)
        if (this.providerManager) {
            logger.info(MODULE_DISCORD_BOT, 'ProviderManager initialized and available', timer.elapsed('main'));
        } else {
            logger.warn(MODULE_DISCORD_BOT, 'ProviderManager not provided - using direct Anthropic client', timer.elapsed('main'));
        }
        
        if (this.memoryService) {
            logger.info(MODULE_DISCORD_BOT, 'MemoryService initialized and available', timer.elapsed('main'));
        } else {
            logger.warn(MODULE_DISCORD_BOT, 'MemoryService not provided - memory features disabled', timer.elapsed('main'));
        }
    }

    /**
     * Start Discord bot - initialize protocol and subscribe to events
     */
    async start(): Promise<void> {
        logger.info(MODULE_DISCORD_BOT, 'Starting Discord bot (event-driven mode)...', timer.elapsed('main'));

        // Initialize ability response subscription from BaseBot
        await this.initializeAbilityResponseSubscription();

        // Subscribe to Discord mention events
        await this.subscribeToMentions();
    }

    /**
     * Stop Discord bot
     */
    stop(): void {
        logger.info(MODULE_DISCORD_BOT, 'Discord bot stopped', timer.elapsed('main'));
    }

    /**
     * Subscribe to Discord mention events via KĀDI event bus
     */
    private async subscribeToMentions(): Promise<void> {
        const topic = `discord.mention.${this.botUserId}`;

        logger.info(MODULE_DISCORD_BOT, `Subscriber: Registering subscription {topic: ${topic}, botUserId: ${this.botUserId}}`, timer.elapsed('main'));

        try {
            await this.client.subscribe(topic, async (event: any) => {
                // Check circuit breaker before processing
                if (this.checkCircuitBreaker()) {
                    logger.warn(MODULE_DISCORD_BOT, 'Subscriber: Event processing skipped {reason: circuit breaker OPEN}', timer.elapsed('main'));
                    return;
                }

                // Extract event data from KĀDI envelope
                // KĀDI wraps events in: { eventName, data, timestamp, source, metadata }
                const eventData = (event as any)?.data || event;

                // Validate event payload with schema
                const validationResult = DiscordMentionEventSchema.safeParse(eventData);

                if (!validationResult.success) {
                    const errorDetails = validationResult.error.issues.map((e: any) => `${e.path.join('.')}: ${e.message}`).join(', ');
                    logger.error(MODULE_DISCORD_BOT, `Subscriber: Event validation failed {errors: [${errorDetails}]}`, timer.elapsed('main'));
                    return;
                }

                const mention = validationResult.data;

                // Truncate text for logging (don't log full message content)
                const textPreview = mention.text.length > 50
                    ? mention.text.substring(0, 50) + '...'
                    : mention.text;

                logger.info(MODULE_DISCORD_BOT, `Subscriber: Event received {mentionId: ${mention.id}, user: ${mention.username}, channel: ${mention.channelName}, guild: ${mention.guild}, textPreview: \"${textPreview}\", timestamp: ${mention.timestamp}}`, timer.elapsed('main'));

                // Convert to DiscordMention format for existing processing logic
                const discordMention: DiscordMention = {
                    id: mention.id,
                    user: mention.user,
                    text: mention.text,
                    channel: mention.channel,
                    thread_ts: mention.id, // Use message ID as thread identifier
                    ts: mention.ts,
                    ...(mention.attachments && { attachments: mention.attachments }),
                };

                // Process mention using existing logic (non-blocking to prevent event queue backup)
                this.handleMention(discordMention).catch(error => {
                    logger.error(MODULE_DISCORD_BOT, `Subscriber: Error handling mention {mentionId: ${discordMention.id}}`, timer.elapsed('main'), error);
                });
            });

            logger.info(MODULE_DISCORD_BOT, `Subscriber: Subscription registered successfully {topic: ${topic}}`, timer.elapsed('main'));
        } catch (error: any) {
            logger.error(MODULE_DISCORD_BOT, `Subscriber: Subscription registration failed {topic: ${topic}}`, timer.elapsed('main'), error);
        }
    }

    /**
     * Handle a Discord mention event from KĀDI broker
     */
    /**
     * Handle structured commands (task approval, failure responses)
     * Returns true if message was handled, false if should fall through to LLM
     */
    private async handleStructuredCommands(mention: DiscordMention): Promise<boolean> {
        const message = mention.text;

        try {
            // 1. Task Approval (approve/reject/request changes)
            const { handleTaskApproval } = await import('../handlers/task-approval.js');
            const approvalResult = await handleTaskApproval(this.client, message);

            if (approvalResult) {
                logger.info(MODULE_DISCORD_BOT, 'Task approval command handled', timer.elapsed('main'));

                await this.sendDiscordReply(
                    mention.channel,
                    mention.id,
                    approvalResult.message
                );

                return true;
            }

            // 2. Task Failure Response (retry/skip/abort)
            const { processFailureResponse } = await import('../handlers/task-failure.js');
            const failureHandled = await processFailureResponse(this.client, message);
            if (failureHandled) {
                logger.info(MODULE_DISCORD_BOT, 'Task failure response handled', timer.elapsed('main'));

                await this.sendDiscordReply(
                    mention.channel,
                    mention.id,
                    '✅ Task failure response processed'
                );

                return true;
            }

            // No structured command detected
            return false;

        } catch (error: any) {
            logger.error(MODULE_DISCORD_BOT, `Error handling structured command: ${error.message}`, timer.elapsed('main'), error);

            await this.sendDiscordReply(
                mention.channel,
                mention.id,
                `❌ Error: ${error.message}`
            );

            return true; // Handled (with error)
        }
    }

    protected async handleMention(mention: DiscordMention): Promise<void> {
        try {
            logger.info(MODULE_DISCORD_BOT, `Processing mention from @${mention.user}: \"${mention.text}\"`, timer.elapsed('main'));

            // Step 1: Check for structured commands (task approval, failure responses)
            const handled = await this.handleStructuredCommands(mention);

            if (handled) {
                logger.info(MODULE_DISCORD_BOT, 'Message handled by structured command handler', timer.elapsed('main'));
                return;
            }

            // Step 2: Pass all other messages to LLM for natural language understanding
            // Send immediate acknowledgment so user doesn't wait in silence
            await this.sendDiscordReply(
                mention.channel,
                mention.id,
                getRandomAcknowledgment()
            );

            await this.processMention(mention);
        } catch (error: any) {
            logger.error(MODULE_DISCORD_BOT, `Error handling mention from @${mention.user}`, timer.elapsed('main'), error);

            // Send error message to Discord
            await this.sendDiscordReply(
                mention.channel,
                mention.id,
                'Sorry, I encountered an error processing your message. Please try again later.'
            );
        }
    }

    /**
     * Process a single Discord mention with Claude API
     */
    /**
     * Process a single Discord mention with ProviderManager and MemoryService
     */
    private async processMention(mention: DiscordMention): Promise<void> {
    // Check if services are available
    if (!this.providerManager || !this.memoryService) {
      logger.error(MODULE_DISCORD_BOT, 'ProviderManager or MemoryService not available', timer.elapsed('main'));
      await this.sendDiscordReply(
        mention.channel,
        mention.id,
        'Sorry, the bot is not properly configured. Please contact the administrator.'
      );
      return;
    }

    // Check circuit breaker before processing
    if (this.checkCircuitBreaker()) {
      logger.warn(MODULE_DISCORD_BOT, `Circuit breaker OPEN - skipping mention from @${mention.user}`, timer.elapsed('main'));

      // Send user-friendly error message
      await this.sendDiscordReply(
        mention.channel,
        mention.id,
        '⚠️ Service temporarily unavailable due to repeated failures. Please try again in a few minutes.'
      );
      return;
    }

    try {
      // Step 1: Retrieve conversation context from MemoryService
      const contextResult = await this.memoryService.retrieveContext(mention.user, mention.channel);

      if (!contextResult.success) {
        const errorResult = contextResult as { success: false; error: MemoryError };
        logger.warn(MODULE_DISCORD_BOT, `Failed to retrieve context: ${errorResult.error.message}`, timer.elapsed('main'));
      }

      const context = contextResult.success ? contextResult.data : [];

      // Step 2: Build messages array (context + new user message)
      // Append platform context so the LLM has real channel/user IDs for tool calls
      const platformContext = `\n\n[Context: platform=discord, channelId=${mention.channel}, userId=${mention.user}]`;

      // If message has image attachments, append references so LLM knows to use vision tools
      // The LLM should pass the filename as the `image` parameter; executeToolCall resolves it
      let imageContext = '';
      if (mention.attachments && mention.attachments.length > 0) {
        const imageRefs = mention.attachments.map((att, i) =>
          `  ${i + 1}. "${att.filename}" (${att.contentType}, ${Math.round(att.size / 1024)}KB)`
        ).join('\n');
        imageContext = `\n\n[Attached images — use vision_analyze tool to analyze them. Pass the filename as the "image" parameter:\n${imageRefs}\n]`;
      }

      const messages: Message[] = [
        ...context.map(msg => ({
          role: msg.role,
          content: msg.content,
        })),
        {
          role: 'user' as const,
          content: mention.text + platformContext,
        },
      ];

      // Step 3: Detect model from message using regex /\[([^\]]+)\]/
      const modelMatch = mention.text.match(/\[([^\]]+)\]/);
      const detectedModel = modelMatch ? modelMatch[1] : 'gpt-5-mini';

      logger.info(MODULE_DISCORD_BOT, `Model: ${detectedModel}${modelMatch ? ' (from message)' : ' (default)'}`, timer.elapsed('main'));

      // Step 4: Get available tools and convert to OpenAI format
      const anthropicTools = await this.getAvailableTools();
      const openaiTools = this.convertToolsToOpenAIFormat(anthropicTools);

      // Log tool count for debugging
      logger.info(MODULE_DISCORD_BOT, `Tools being sent to LLM (${openaiTools.length} total)`, timer.elapsed('main'));
      logger.info(MODULE_DISCORD_BOT, `Passing ${openaiTools.length} tools to LLM`, timer.elapsed('main'));

      // Step 5: Tool calling loop - keep calling until we get a final text response
      let maxIterations = 15;
      let iteration = 0;
      let finalResponse: string | null = null;
      let toolsExecuted = false; // Track if tools have been executed

      while (iteration < maxIterations && !finalResponse) {
        iteration++;

        logger.info(MODULE_DISCORD_BOT, `=== Iteration ${iteration} ===`, timer.elapsed('main'));
        logger.info(MODULE_DISCORD_BOT, `Sending ${messages.length} messages to LLM with model: ${detectedModel || 'default'}${toolsExecuted ? ' (tools disabled - already executed)' : ''}`, timer.elapsed('main'));

        // Log message roles for debugging
        const msgSummary = messages.map(m => `${m.role}${m.tool_call_id ? `(tool:${m.tool_call_id.substring(0,8)})` : ''}`).join(', ');
        logger.info(MODULE_DISCORD_BOT, `Message roles: [${msgSummary}]`, timer.elapsed('main'));

        // Generate response using ProviderManager
        // IMPORTANT: Use non-streaming when tools are present (streaming doesn't support tool calls)
        // Use streaming only for final text responses (better UX with slow models)
        const hasTools = !toolsExecuted && openaiTools.length > 0;
        let botResponse = '';

        if (hasTools) {
          // Non-streaming mode for tool calls
          logger.info(MODULE_DISCORD_BOT, `Using NON-STREAMING mode (tools present)`, timer.elapsed('main'));

          const result = await this.providerManager.chat(messages, {
            model: detectedModel,
            system: QUEST_WORKFLOW_SYSTEM_PROMPT,
            tools: openaiTools,
            tool_choice: 'auto',
          });

          // Handle error or success
          if (!result.success) {
            // Explicit type cast to error branch
            const errorResult = result as { success: false; error: ProviderError };
            logger.error(MODULE_DISCORD_BOT, `Provider failed: ${errorResult.error.message}`, timer.elapsed('main'));

            // Record failure for circuit breaker
            const error = new Error(errorResult.error.message);
            this.recordFailure(error);

            // Send user-friendly error message (no stack traces)
            const userMessage = 'Sorry, I encountered an issue generating a response. The issue has been logged.';
            await this.sendDiscordReply(mention.channel, mention.id, userMessage);
            return;
          }

          botResponse = result.data;
          logger.info(MODULE_DISCORD_BOT, `Non-streaming response complete (${botResponse.length} chars)`, timer.elapsed('main'));
        } else {
          // Streaming mode for final text responses
          logger.info(MODULE_DISCORD_BOT, `Using STREAMING mode (no tools)`, timer.elapsed('main'));

          const streamResult = await this.providerManager.streamChat(messages, {
            model: detectedModel,
            system: QUEST_WORKFLOW_SYSTEM_PROMPT,
          });

          // Handle stream error or success
          if (!streamResult.success) {
            // Explicit type cast to error branch
            const errorResult = streamResult as { success: false; error: ProviderError };
            logger.error(MODULE_DISCORD_BOT, `Provider failed: ${errorResult.error.message}`, timer.elapsed('main'));

            // Record failure for circuit breaker
            const error = new Error(errorResult.error.message);
            this.recordFailure(error);

            // Send user-friendly error message (no stack traces)
            const userMessage = 'Sorry, I encountered an issue generating a response. The issue has been logged.';
            await this.sendDiscordReply(mention.channel, mention.id, userMessage);
            return;
          }

          // Buffer the streamed response
          try {
            for await (const chunk of streamResult.data) {
              botResponse += chunk;
            }
            logger.info(MODULE_DISCORD_BOT, `Streamed response complete (${botResponse.length} chars)`, timer.elapsed('main'));
          } catch (streamError: any) {
            logger.error(MODULE_DISCORD_BOT, `Stream error: ${streamError.message}`, timer.elapsed('main'));
            await this.sendDiscordReply(mention.channel, mention.id, 'Sorry, the response stream was interrupted.');
            return;
          }
        }

        // Check if response contains tool calls
        const toolCallData = this.parseToolCalls(botResponse);

        if (toolCallData && toolCallData.toolCalls.length > 0) {
          // LLM wants to execute tools
          logger.info(MODULE_DISCORD_BOT, `LLM requested ${toolCallData.toolCalls.length} tool call(s)`, timer.elapsed('main'));

          // Add assistant message with tool calls to conversation
          messages.push({
            role: 'assistant',
            content: toolCallData.message || null,
            tool_calls: toolCallData.toolCalls,
          });

          // Execute each tool and collect results
          for (const toolCall of toolCallData.toolCalls) {
            const toolResult = await this.executeToolCall(toolCall, mention);

            logger.info(MODULE_DISCORD_BOT, `Tool ${toolCall.function.name} result: ${toolResult.substring(0, 200)}...`, timer.elapsed('main'));
            logger.info(MODULE_DISCORD_BOT, `Tool call ID: ${toolCall.id}`, timer.elapsed('main'));

            // Check if tool result indicates task completion
            const isTaskComplete = this.checkToolResultForCompletion(toolResult);
            if (isTaskComplete) {
              logger.info(MODULE_DISCORD_BOT, `Tool result indicates TASK COMPLETED - will not offer tools in next iteration`, timer.elapsed('main'));
              toolsExecuted = true;
            }

            // PRESERVE: Discord-specific task tracking
            // If this is assign_task, record channel context for notifications
            if (toolCall.function.name === 'assign_task') {
              try {
                const resultObj = JSON.parse(toolResult);
                if (resultObj && resultObj.taskId) {
                  const { taskChannelMap } = await import('../index.js');
                  taskChannelMap.set(resultObj.taskId, {
                    type: 'discord',
                    channelId: mention.channel,
                    userId: mention.user
                  });
                  logger.info(MODULE_DISCORD_BOT, `Recorded Discord channel context for task ${resultObj.taskId}`, timer.elapsed('main'));
                }
              } catch (e) {
                // Ignore parse errors
              }
            }

            // If this is task_execution, the context was already injected in executeToolCall
            // The task_execution tool will store the context in taskChannelMap for all triggered tasks

            // Add tool result to conversation using OpenAI tool format
            messages.push({
              role: 'tool',
              content: toolResult,
              tool_call_id: toolCall.id,
            });
          }

          logger.info(MODULE_DISCORD_BOT, `Messages array now has ${messages.length} messages, continuing to iteration ${iteration + 1}`, timer.elapsed('main'));

          // Continue loop - tools will be disabled in next iteration if toolsExecuted is true
          continue;
        }

        // No tool calls - this is the final text response
        logger.info(MODULE_DISCORD_BOT, `Received final text response (no tool calls), breaking loop`, timer.elapsed('main'));
        finalResponse = botResponse;
        break;
      }

      logger.info(MODULE_DISCORD_BOT, `Completed iteration ${iteration}, maxIterations: ${maxIterations}, finalResponse: ${finalResponse ? 'YES' : 'NO'}`, timer.elapsed('main'));

      // Check if we got a final response
      if (!finalResponse) {
        logger.error(MODULE_DISCORD_BOT, `Tool calling loop exceeded maximum iterations (${maxIterations})`, timer.elapsed('main'));
        await this.sendDiscordReply(mention.channel, mention.id, 'Sorry, I encountered an issue completing your request.');
        return;
      }

      const botResponse = finalResponse;

      // Step 6: Store messages in MemoryService
      // Store user message
      await this.memoryService.storeMessage(mention.user, mention.channel, {
        role: 'user',
        content: mention.text,
        timestamp: Date.now(),
      });

      // Store bot response
      await this.memoryService.storeMessage(mention.user, mention.channel, {
        role: 'assistant',
        content: botResponse,
        timestamp: Date.now(),
      });

      // Step 7: Send response to channel (PRESERVE: Discord-specific reply)
      logger.info(MODULE_DISCORD_BOT, `Sending final response (${botResponse.length} chars) to Discord...`, timer.elapsed('main'));
      await this.sendDiscordReply(mention.channel, mention.id, botResponse);

      logger.info(MODULE_DISCORD_BOT, `Replied to @${mention.user}`, timer.elapsed('main'));

      // Record success for circuit breaker
      this.recordSuccess();
    } catch (error: any) {
      logger.error(MODULE_DISCORD_BOT, `Error processing mention from @${mention.user}`, timer.elapsed('main'), error);

      // Classify error type
      const errorType = this.classifyError(error);
      const isTransient = errorType === 'network' || errorType === 'timeout' || errorType === 'rate_limit';

      // Record failure for circuit breaker
      this.recordFailure(error);

      // Send appropriate error message to Discord (no stack traces)
      const userMessage = isTransient
        ? 'Sorry, I encountered a temporary issue. Please try again in a moment.'
        : 'Sorry, I encountered an error processing your message. The issue has been logged.';

      try {
        await this.sendDiscordReply(mention.channel, mention.id, userMessage);
      } catch (replyError: any) {
        logger.error(MODULE_DISCORD_BOT, 'Failed to send error reply', timer.elapsed('main'), replyError);
      }
    }
  }

  /**
   * Convert Anthropic tools to OpenAI format for ProviderManager
   */
  private convertToolsToOpenAIFormat(anthropicTools: Anthropic.Tool[]): Array<{
    type: 'function';
    function: {
      name: string;
      description: string;
      parameters: any;
    };
  }> {
    return anthropicTools.map(tool => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description || '',
        parameters: tool.input_schema,
      },
    }));
  }

  /**
   * Parse tool calls from LLM response
   */
  private parseToolCalls(response: string): { toolCalls: any[]; message: string } | null {
    if (!response.startsWith('__TOOL_CALLS__')) {
      return null;
    }

    try {
      const jsonStr = response.substring('__TOOL_CALLS__'.length);
      const data = JSON.parse(jsonStr);
      return {
        toolCalls: data.tool_calls || [],
        message: data.message || ''
      };
    } catch (error) {
      logger.error(MODULE_DISCORD_BOT, 'Failed to parse tool calls', timer.elapsed('main'), error as Error);
      return null;
    }
  }

  /**
   * Resolve vision tool image params: if the LLM passed a filename that matches
   * an attachment, replace it with the actual data URI (base64) or public URL.
   */
  private resolveVisionImageArgs(toolArgs: Record<string, any>, attachments?: ChatImageAttachment[]): void {
    if (!attachments || attachments.length === 0) return;

    const imageKeys = ['image', 'image_a', 'image_b'];
    for (const key of imageKeys) {
      const val = toolArgs[key];
      if (typeof val !== 'string') continue;
      // Skip if already a URL or data URI
      if (val.startsWith('http://') || val.startsWith('https://') || val.startsWith('data:')) continue;

      // Match by filename (exact or contained)
      const att = attachments.find(a => a.filename === val || val.includes(a.filename) || a.filename.includes(val));
      if (!att) continue;

      if (att.url) {
        toolArgs[key] = att.url;
        logger.info(MODULE_DISCORD_BOT, `Resolved image "${val}" → URL`, timer.elapsed('main'));
      } else if (att.base64) {
        toolArgs[key] = `data:${att.contentType};base64,${att.base64}`;
        logger.info(MODULE_DISCORD_BOT, `Resolved image "${val}" → data URI (${Math.round(att.size / 1024)}KB)`, timer.elapsed('main'));
      }
    }
  }

  /**
   * Execute a single tool call with retry logic
   */
  private async executeToolCall(toolCall: any, mention?: DiscordMention): Promise<string> {
    const toolName = toolCall.function.name;
    const toolArgs = JSON.parse(toolCall.function.arguments);

    logger.info(MODULE_DISCORD_BOT, `Executing tool: ${toolName}`, timer.elapsed('main'));

    try {
      // Inject Discord channel context for task_execution tool
      if (toolName === 'task_execution' && mention) {
        toolArgs._context = {
          type: 'discord',
          channelId: mention.channel,
          userId: mention.user,
          guildId: mention.channel, // Discord uses channel as guild identifier in this context
        };
        logger.info(MODULE_DISCORD_BOT, `Injected Discord context for task_execution: channel ${mention.channel}`, timer.elapsed('main'));
      }

      // Determine target agent based on tool name
      const targetAgent = this.resolveTargetAgent(toolName);

      // Use invokeToolWithRetry for resilient tool execution
      const result = await this.invokeToolWithRetry({
        targetAgent,
        toolName,
        toolInput: toolArgs,
        timeout: 30000,
      });

      // Check if result is async pending - wait for actual result
      if (result && typeof result === 'object' &&
          result.status === 'pending' && result.requestId) {
        logger.info(MODULE_DISCORD_BOT, `Tool ${toolName} returned pending, waiting for async result: ${result.requestId}`, timer.elapsed('main'));

        try {
          const asyncResult = await this.waitForAbilityResponse(result.requestId, 30000);
          logger.info(MODULE_DISCORD_BOT, `Async result received for ${toolName}`, timer.elapsed('main'));
          return JSON.stringify(asyncResult);
        } catch (asyncError: any) {
          logger.error(MODULE_DISCORD_BOT, `Async tool timeout for ${toolName}: ${asyncError.message}`, timer.elapsed('main'));
          return JSON.stringify({ error: `Tool timeout: ${asyncError.message}` });
        }
      }

      return JSON.stringify(result);
    } catch (error: any) {
      logger.error(MODULE_DISCORD_BOT, `Tool execution failed: ${toolName}`, timer.elapsed('main'), error);
      return JSON.stringify({ error: error.message || String(error) });
    }
  }

  /**
   * Check if tool result indicates task completion
   * Returns true if the tool result contains completion markers
   */
  private checkToolResultForCompletion(toolResult: string): boolean {
    try {
      // Try to parse as JSON first
      try {
        const parsed = JSON.parse(toolResult);

        // Check for new standard: status field
        if (parsed.status === 'complete') {
          logger.info(MODULE_DISCORD_BOT, 'Tool completion detected via status field', timer.elapsed('main'));
          return true;
        }

        // Legacy: check for success + completion markers
        const completionMarkers = [
          'TASK COMPLETED',
          'No further action needed',
          '✅',
          'task is complete',
          'operation complete'
        ];

        const resultLower = toolResult.toLowerCase();
        const hasCompletionMarker = completionMarkers.some(marker =>
          resultLower.includes(marker.toLowerCase())
        );

        if (parsed.success === true && hasCompletionMarker) {
          logger.info(MODULE_DISCORD_BOT, 'Tool completion detected via legacy markers', timer.elapsed('main'));
          return true;
        }
      } catch {
        // Not JSON, check raw text markers
        const completionMarkers = [
          'TASK COMPLETED',
          'No further action needed',
          '✅',
          'task is complete',
          'operation complete'
        ];

        const resultLower = toolResult.toLowerCase();
        const hasCompletionMarker = completionMarkers.some(marker =>
          resultLower.includes(marker.toLowerCase())
        );

        if (hasCompletionMarker) {
          logger.info(MODULE_DISCORD_BOT, 'Tool completion detected via text markers', timer.elapsed('main'));
          return true;
        }
      }

      return false;
    } catch (error) {
      logger.warn(MODULE_DISCORD_BOT, `Error checking tool result for completion: ${error}`, timer.elapsed('main'));
      return false;
    }
  }

  /**
   * Classify error type for circuit breaker and retry logic
   */
  private classifyError(error: any): string {
    const message = error.message?.toLowerCase() || '';

    // Network-related errors (transient)
    if (message.includes('econnrefused') || message.includes('enotfound') ||
        message.includes('network') || message.includes('socket')) {
      return 'network';
    }

    // Timeout errors (transient)
    if (message.includes('timeout') || message.includes('timed out')) {
      return 'timeout';
    }

    // Rate limiting (transient)
    if (message.includes('rate limit') || message.includes('429') ||
        message.includes('too many requests')) {
      return 'rate_limit';
    }

    // API errors (non-transient)
    if (message.includes('api') || message.includes('invalid') ||
        message.includes('unauthorized') || message.includes('403')) {
      return 'api_error';
    }

    // Validation errors (non-transient)
    if (message.includes('validation') || message.includes('invalid input') ||
        message.includes('schema')) {
      return 'validation_error';
    }

    // Unknown error type
    return 'unknown';
  }


    /**
     * Send reply to Discord via MCP_Discord_Server
     *
     * Handles Discord's 2,000 character limit by splitting long messages
     * into multiple sequential replies.
     */
    private async sendDiscordReply(
        channel: string,
        message_id: string,
        text: string
    ): Promise<void> {

        const MAX_DISCORD_MESSAGE_LENGTH = 2000;

        // If message fits in one reply, send directly
        if (text.length <= MAX_DISCORD_MESSAGE_LENGTH) {
            await this.invokeToolWithRetry({
                targetAgent: 'agent-chatbot',
                toolName: 'discord_send_reply',
                toolInput: {
                    channel,
                    message_id,
                    text,
                },
                timeout: parseInt(process.env.BOT_TOOL_TIMEOUT_MS || '10000'),
            });
            return;
        }

        // Split long message into chunks
        logger.info(MODULE_DISCORD_BOT, `Message too long (${text.length} chars), splitting into chunks...`, timer.elapsed('main'));

        const chunks = this.splitMessage(text, MAX_DISCORD_MESSAGE_LENGTH);

        logger.info(MODULE_DISCORD_BOT, `Sending ${chunks.length} message chunks to Discord`, timer.elapsed('main'));

        // Send first chunk as a reply to the original message
        await this.invokeToolWithRetry({
            targetAgent: 'agent-chatbot',
            toolName: 'discord_send_reply',
            toolInput: {
                channel,
                message_id,
                text: chunks[0],
            },
            timeout: parseInt(process.env.BOT_TOOL_TIMEOUT_MS || '10000'),
        });

        // Send remaining chunks as regular messages (not replies)
        for (let i = 1; i < chunks.length; i++) {
            await this.invokeToolWithRetry({
                targetAgent: 'agent-chatbot',
                toolName: 'discord_send_message',
                toolInput: {
                    channel,
                    text: chunks[i],
                },
                timeout: parseInt(process.env.BOT_TOOL_TIMEOUT_MS || '10000'),
            });

            // Small delay between messages to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 500));
        }
    }

    /**
     * Split message into chunks that respect Discord's character limit
     *
     * Tries to split on newlines to keep formatting intact.
     *
     * @param text - Full message text
     * @param maxLength - Maximum length per chunk (default: 2000)
     * @returns Array of message chunks
     */
    private splitMessage(text: string, maxLength: number = 2000): string[] {
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
            // Check if client is connected to any broker
            if (!this.client.isConnected()) {
                logger.debug(MODULE_DISCORD_BOT, 'No broker connection available for network tool discovery', timer.elapsed('main'));
                return [];
            }

            // Use kadi-core v0.6.0+ API to discover tools from broker
            // The broker returns tools with their schemas in the format:
            // { tools: [{ name, description, inputSchema, tags, providers }] }
            const response = await this.client.invokeRemote<{ tools: Array<{
                name: string;
                description?: string;
                inputSchema?: Record<string, unknown>;
                tags?: string[];
            }> }>('kadi.ability.list', { includeProviders: false });

            if (!response?.tools || !Array.isArray(response.tools)) {
                logger.warn(MODULE_DISCORD_BOT, 'Invalid response from kadi.ability.list', timer.elapsed('main'));
                return [];
            }

            // Convert broker tools to Anthropic format
            const networkTools: Anthropic.Tool[] = response.tools.map((tool: { name: string; description?: string; inputSchema?: Record<string, unknown> }) => ({
                name: tool.name,
                description: tool.description || '',
                input_schema: tool.inputSchema as Anthropic.Tool.InputSchema || {
                    type: 'object',
                    properties: {},
                    required: []
                }
            }));

            logger.debug(MODULE_DISCORD_BOT, `Discovered ${networkTools.length} network tools from broker`, timer.elapsed('main'));
            return networkTools;
        } catch (error) {
            logger.error(MODULE_DISCORD_BOT, 'Failed to query network tools from broker', timer.elapsed('main'), error as Error | string);
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
        const agentInfo = this.client.readAgentJson();
        const localTools = agentInfo.tools.map((tool: any) => ({
            name: tool.name,
            description: tool.description || '',
            input_schema: tool.inputSchema as Anthropic.Tool.InputSchema
        }));

        // 2. Query broker for tools available on connected networks
        const networkTools = await this.queryNetworkTools();

        // 3. Deduplicate: prefer local tools over network tools (local tools are authoritative)
        const localToolNames = new Set(localTools.map((t: Anthropic.Tool) => t.name));
        const uniqueNetworkTools = networkTools.filter(t => !localToolNames.has(t.name));

        // 4. Combine and return (local tools first, then unique network tools)
        logger.info(MODULE_DISCORD_BOT, `Available tools: ${localTools.length} local + ${uniqueNetworkTools.length} network (${networkTools.length - uniqueNetworkTools.length} duplicates removed) = ${localTools.length + uniqueNetworkTools.length} total`, timer.elapsed('main'));

        return [...localTools, ...uniqueNetworkTools];
    }

    /**
     * Resolve target agent for a tool name
     */
    private resolveTargetAgent(toolName: string): string {
        // Local tools on agent-producer (exact matches to avoid conflicts)
        const localTools = ['plan_task', 'list_active_tasks', 'get_task_status', 'assign_task', 'approve_completion'];
        if (localTools.includes(toolName)) {
            return 'local'; // Special marker for local tools on this agent
        }
        if (toolName.startsWith('slack_')) {
            return 'agent-chatbot';
        }
        if (toolName.startsWith('discord_')) {
            return 'agent-chatbot';
        }
        if (toolName.startsWith('git_')) {
            return 'git';
        }
        if (toolName.startsWith('shrimp_')) {
            return 'mcp-server-shrimp-agent-playground';
        }

        // Default: assume it's a network tool
        return 'unknown';
    }
}
