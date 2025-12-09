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
import { BaseBot } from 'agents-library';
import { SlackMentionEventSchema } from '../types/slack-events.js';

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
   * Overrides BaseBot.stop() to clean up Slack-specific resources.
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
          const errorDetails = validationResult.error.issues.map((e: any) => `${e.path.join('.')}: ${e.message}`).join(', ');
          console.error(`[KĀDI] Subscriber: Event validation failed {errors: [${errorDetails}]}`);
          return;
        }

        const mention = validationResult.data;

        // Truncate text for logging (don't log full message content)
        const textPreview = mention.text.length > 50
          ? mention.text.substring(0, 50) + '...'
          : mention.text;

        console.log(`[KĀDI] Subscriber: Event received {mentionId: ${mention.id}, user: ${mention.user}, channel: ${mention.channel}, textPreview: "${textPreview}", timestamp: ${mention.timestamp}}`);

        // Process mention using handleMention (non-blocking to prevent event queue backup)
        this.handleMention(mention).catch(error => {
          console.error(`[KĀDI] Subscriber: Error handling mention {mentionId: ${mention.id}, error: ${error.message}}`);
        });
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
        system: `You are KADI Bot, an AI assistant that helps manage tasks using the KADI protocol.

CRITICAL: When using the list_active_tasks tool, ALWAYS format the results as follows:
1. Display tasks in numerical order (sorted by task ID)
2. Use this exact format for each task:
   [Task ID] - [Task Name]
3. Include a header showing the total count
4. Example format:

   Active Tasks (Total: 3):
   1. 08532952-04c1-4afb-93bd-ed674446bfd8 - Implement Monitoring and Auditing
   2. 14bc4c95-fd88-4680-957f-5185ad522501 - Create placeholder task for testing purposes
   3. 5166ce3c-fdc6-42f6-a1e6-d9975ba38bdc - Placeholder Task for Testing

Do NOT summarize or paraphrase task lists - always show the complete numbered list with IDs and names.

CRITICAL: When approving a task using the approve_completion tool:
1. Extract the task ID from the user's message
2. Provide a meaningful summary (e.g., "Task approved by user via Slack")
3. Provide a score between 0-100 (default to 90 if user doesn't specify)
4. Example: User says "I approve task abc-123" -> call approve_completion with:
   - taskId: "abc-123"
   - summary: "Task approved by user via Slack"
   - score: 90

CRITICAL: When responding to users after using tools:
- Be concise and user-friendly
- For approve_completion: Say "✅ Task [taskId] has been approved!" (not technical details about the function)
- For assign_task: Say "✅ Task assigned to [role] agent"
- Avoid mentioning technical details like "the function was used" or internal implementation details`,
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

      // Track if plan_task, list_active_tasks, or get_task_status was called and their results
      let planTaskResult: any = null;
      let listTasksResult: any = null;
      let taskStatusResult: any = null;

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

          // If this is assign_task, record channel context for notifications
          if (toolBlock.name === 'assign_task' && result && typeof result === 'object' && result.taskId) {
            const { taskChannelMap } = await import('../index.js');
            taskChannelMap.set(result.taskId, {
              type: 'slack',
              channelId: mention.channel,
              userId: mention.user,
              threadTs: mention.thread_ts || mention.ts // Use thread_ts if in thread, otherwise use message ts
            });
            console.log(`📍 Recorded Slack channel context for task ${result.taskId} (thread: ${mention.thread_ts || mention.ts})`);
          }

          // If this is plan_task, save the result
          if (toolBlock.name === 'plan_task' && result && typeof result === 'object' && result.message) {
            planTaskResult = result;
          }

          // If this is list_active_tasks, save the result and format it
          if (toolBlock.name === 'list_active_tasks' && result && typeof result === 'object' && result.tasks) {
            listTasksResult = result;
          }

          // If this is get_task_status, save the result and format it
          if (toolBlock.name === 'get_task_status' && result && typeof result === 'object' && result.taskId) {
            taskStatusResult = result;
          }

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

      // Determine final response text
      let finalText: string;

      if (planTaskResult && planTaskResult.message) {
        // Use the pre-formatted message from plan_task directly
        finalText = planTaskResult.message;
      } else if (listTasksResult && listTasksResult.tasks) {
        // Format list_active_tasks results directly
        const tasks = listTasksResult.tasks;
        const total = listTasksResult.total || tasks.length;

        // Sort tasks by ID
        const sortedTasks = [...tasks].sort((a, b) => a.id.localeCompare(b.id));

        // Format as numbered list
        finalText = `Active Tasks (Total: ${total}):\n`;
        sortedTasks.forEach((task, index) => {
          finalText += `${index + 1}. ${task.id} - ${task.name}\n`;
        });
      } else if (taskStatusResult && taskStatusResult.taskId) {
        // Format get_task_status results directly
        finalText = `Task Status:\n`;
        finalText += `ID: ${taskStatusResult.taskId}\n`;
        finalText += `Name: ${taskStatusResult.description}\n`;
        finalText += `Status: ${taskStatusResult.status}\n`;
        if (taskStatusResult.role) {
          finalText += `Role: ${taskStatusResult.role}\n`;
        }
        if (taskStatusResult.progress) {
          finalText += `\nProgress:\n`;
          if (taskStatusResult.progress.filesCreated && taskStatusResult.progress.filesCreated.length > 0) {
            finalText += `  - Files Created: ${taskStatusResult.progress.filesCreated.join(', ')}\n`;
          }
          if (taskStatusResult.progress.filesModified && taskStatusResult.progress.filesModified.length > 0) {
            finalText += `  - Files Modified: ${taskStatusResult.progress.filesModified.join(', ')}\n`;
          }
          if (taskStatusResult.progress.commitSha) {
            finalText += `  - Commit SHA: ${taskStatusResult.progress.commitSha}\n`;
          }
          if (taskStatusResult.progress.errorMessage) {
            finalText += `  - Error: ${taskStatusResult.progress.errorMessage}\n`;
          }
        }
      } else {
        // For other tools, use Claude's response
        finalText = response.content
          .filter((block) => block.type === 'text')
          .map((block: any) => block.text)
          .join('\n');
      }

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
      console.log(`📝 Tool input: ${JSON.stringify(input).substring(0, 200)}...`);

      // Determine target agent based on tool name
      const targetAgent = this.resolveTargetAgent(toolName);
      console.log(`🎯 Target agent: ${targetAgent}`);

      let result: any;

      // Handle local tools (registered on this agent)
      if (targetAgent === 'local') {
        console.log(`🏠 Invoking local tool handler...`);
        // Get the tool handler from the client's registered tools
        const toolHandlers = this.client.getAllRegisteredTools();
        const toolHandler = toolHandlers.find(t => t.definition.name === toolName);

        if (!toolHandler) {
          throw new Error(`Local tool ${toolName} not found in registered tools`);
        }

        // Invoke the tool handler directly
        result = await toolHandler.handler(input);
      } else {
        // Handle network tools via broker protocol
        result = await this.protocol.invokeTool({
          targetAgent,
          toolName,
          toolInput: input,
          timeout: 30000,
        });

        // Check if result is pending (async operation)
        if (result && typeof result === 'object' && result.status === 'pending' && result.requestId) {
          const requestId = result.requestId;
          console.log(`⏳ Tool is pending, waiting for async result: ${requestId}`);

          // Wait for kadi.ability.response notification
          try {
            result = await this.waitForAbilityResponse(requestId, 30000);
            console.log(`📤 Async tool result received: ${JSON.stringify(result).substring(0, 300)}...`);
          } catch (error: any) {
            console.error(`❌ Async tool timeout: ${error.message}`);
            throw error;
          }
        } else {
          const resultStr = result ? JSON.stringify(result) : 'undefined';
          console.log(`📤 Tool result received (synchronous): ${resultStr.substring(0, 300)}...`);
        }
      }

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

      // Convert to Anthropic format with schema validation
      const convertedTools = result.tools.map((tool: any, index: number) => {
        let inputSchema = tool.inputSchema || { type: 'object' };

        // Log tool #76 specifically to identify the problematic tool
        if (index === 71) { // Network tools start at index 0, so tool #76 overall = index 71 in network tools
          console.log(`🔍 Tool #76 (network index ${index}): "${tool.name}"`);
          console.log(`   Schema:`, JSON.stringify(inputSchema, null, 2));
        }

        // Validate and fix schema for JSON Schema draft 2020-12 compatibility
        // Anthropic requires schemas to be valid according to draft 2020-12
        if (inputSchema && typeof inputSchema === 'object') {
          // Remove $schema if present (Anthropic adds its own)
          delete inputSchema.$schema;
          // Remove _kadi property (contains circular references from KadiClient)
          // This fixes the "[Circular]" error for list_tools and other tools
          if (inputSchema.properties && typeof inputSchema.properties === 'object') {
            delete (inputSchema.properties as any)._kadi;
          }


          // Ensure type is present
          if (!inputSchema.type) {
            console.log(`⚠️  Tool #${index} "${tool.name}" missing type, adding default 'object'`);
            inputSchema.type = 'object';
          }

          // Ensure properties is an object (not undefined)
          if (inputSchema.type === 'object' && !inputSchema.properties) {
            inputSchema.properties = {};
          }
        }

        return {
          name: tool.name,
          description: tool.description || '',
          input_schema: inputSchema as Anthropic.Tool.InputSchema
        };
      });

      console.log(`✅ Converted ${convertedTools.length} network tools to Anthropic format`);
      return convertedTools;
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
    // Local tools on agent-producer (exact matches to avoid conflicts)
    const localTools = ['plan_task', 'list_active_tasks', 'get_task_status', 'assign_task', 'approve_completion'];
    if (localTools.includes(toolName)) {
      return 'local'; // Special marker for local tools on this agent
    }
    if (toolName.startsWith('slack_')) {
      return 'slack-server';
    }
    if (toolName.startsWith('discord_')) {
      return 'discord-server';
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
