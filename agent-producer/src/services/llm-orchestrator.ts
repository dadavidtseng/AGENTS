/**
 * LLM Orchestrator Service
 *
 * Reusable tool-call loop extracted from discord-bot.ts.
 * Sends messages + tools to an LLM via ProviderManager, parses tool calls,
 * executes them via KĀDI broker, and loops until a final text response.
 *
 * Consumers:
 * - DiscordBot.processMention()  — Discord @mention flow
 * - quest-approval.ts handlers   — post-decision LLM invocation
 */

import Anthropic from '@anthropic-ai/sdk';
import type { KadiClient } from '@kadi.build/core';
import type { Message, ProviderError } from 'agents-library';
import { logger, MODULE_AGENT, timer } from 'agents-library';
import { QUEST_WORKFLOW_SYSTEM_PROMPT } from '../prompts/quest-workflow.js';

// ============================================================================
// Constants
// ============================================================================

/** Default model used when no model is specified */
const DEFAULT_MODEL = 'gpt-5';

// ============================================================================
// Types
// ============================================================================

/** Result returned by a single orchestrator run */
export interface OrchestratorResult {
  /** Whether the run completed successfully */
  success: boolean;
  /** Final text response from the LLM (null if failed) */
  response: string | null;
  /** Error message if success is false */
  error?: string;
  /** Number of tool-call iterations executed */
  iterations: number;
}

/** Options for a single orchestrator run */
export interface OrchestratorRunOptions {
  /** Initial messages to send to the LLM */
  messages: Message[];
  /** Model override (e.g. "gpt-5-mini", "claude-sonnet-4") */
  model?: string;
  /** Maximum tool-call iterations (default: 10) */
  maxIterations?: number;
  /** System prompt override (default: QUEST_WORKFLOW_SYSTEM_PROMPT) */
  systemPrompt?: string;
}

// ============================================================================
// LlmOrchestrator
// ============================================================================

export class LlmOrchestrator {
  constructor(
    private readonly providerManager: any,
    private readonly client: KadiClient,
  ) {}

  /**
   * Run the tool-call loop.
   *
   * 1. Discover available tools (local + network via broker)
   * 2. Send messages + tools to LLM
   * 3. Parse tool calls → execute → append results → loop
   * 4. Return final text response
   */
  async run(options: OrchestratorRunOptions): Promise<OrchestratorResult> {
    const {
      messages,
      model = DEFAULT_MODEL,
      maxIterations = 20,
      systemPrompt = QUEST_WORKFLOW_SYSTEM_PROMPT,
    } = options;

    // Work on a mutable copy so callers' arrays are not mutated
    const msgs: Message[] = [...messages];

    // Discover tools
    const anthropicTools = await this.getAvailableTools();
    const openaiTools = this.convertToolsToOpenAIFormat(anthropicTools);

    logger.info(MODULE_AGENT, `[Orchestrator] Starting run with ${msgs.length} messages, ${openaiTools.length} tools, model=${model || 'default'}`, timer.elapsed('main'));

    let iteration = 0;
    let toolsExecuted = false;

    while (iteration < maxIterations) {
      iteration++;
      const hasTools = !toolsExecuted && openaiTools.length > 0;

      logger.info(MODULE_AGENT, `[Orchestrator] Iteration ${iteration}/${maxIterations} (tools=${hasTools ? 'ON' : 'OFF'})`, timer.elapsed('main'));

      // --- Call LLM ---
      let botResponse = '';

      if (hasTools) {
        const result = await this.providerManager.chat(msgs, {
          model,
          system: systemPrompt,
          tools: openaiTools,
          tool_choice: 'auto',
        });

        if (!result.success) {
          const err = (result as { success: false; error: ProviderError }).error;
          logger.error(MODULE_AGENT, `[Orchestrator] Provider failed: ${err.message}`, timer.elapsed('main'));
          return { success: false, response: null, error: err.message, iterations: iteration };
        }
        botResponse = result.data;
      } else {
        // No tools — use streaming for better latency
        const streamResult = await this.providerManager.streamChat(msgs, {
          model,
          system: systemPrompt,
        });

        if (!streamResult.success) {
          const err = (streamResult as { success: false; error: ProviderError }).error;
          logger.error(MODULE_AGENT, `[Orchestrator] Stream failed: ${err.message}`, timer.elapsed('main'));
          return { success: false, response: null, error: err.message, iterations: iteration };
        }

        for await (const chunk of streamResult.data) {
          botResponse += chunk;
        }
      }

      // --- Parse tool calls ---
      const toolCallData = this.parseToolCalls(botResponse);

      if (!toolCallData || toolCallData.toolCalls.length === 0) {
        // Final text response
        logger.info(MODULE_AGENT, `[Orchestrator] Final response (${botResponse.length} chars) after ${iteration} iteration(s)`, timer.elapsed('main'));
        return { success: true, response: botResponse, iterations: iteration };
      }

      // --- Execute tool calls ---
      logger.info(MODULE_AGENT, `[Orchestrator] Executing ${toolCallData.toolCalls.length} tool call(s)`, timer.elapsed('main'));

      msgs.push({
        role: 'assistant',
        content: toolCallData.message || null,
        tool_calls: toolCallData.toolCalls,
      });

      for (const toolCall of toolCallData.toolCalls) {
        const toolResult = await this.executeToolCall(toolCall);

        logger.info(MODULE_AGENT, `[Orchestrator] Tool ${toolCall.function.name} → ${toolResult.substring(0, 200)}`, timer.elapsed('main'));

        if (this.checkToolResultForCompletion(toolResult)) {
          toolsExecuted = true;
        }

        msgs.push({
          role: 'tool',
          content: toolResult,
          tool_call_id: toolCall.id,
        });
      }
    }

    // Exhausted iterations
    logger.error(MODULE_AGENT, `[Orchestrator] Exceeded ${maxIterations} iterations`, timer.elapsed('main'));
    return { success: false, response: null, error: `Exceeded ${maxIterations} iterations`, iterations: maxIterations };
  }

  // ==========================================================================
  // Tool discovery (mirrors discord-bot.ts logic)
  // ==========================================================================

  private async getAvailableTools(): Promise<Anthropic.Tool[]> {
    const agentInfo = this.client.readAgentJson();
    const localTools = agentInfo.tools.map((tool: any) => ({
      name: tool.name,
      description: tool.description || '',
      input_schema: tool.inputSchema as Anthropic.Tool.InputSchema,
    }));

    const networkTools = await this.queryNetworkTools();
    const localNames = new Set(localTools.map((t: any) => t.name));
    const uniqueNetwork = networkTools.filter(t => !localNames.has(t.name));

    logger.info(MODULE_AGENT, `[Orchestrator] Tools: ${localTools.length} local + ${uniqueNetwork.length} network`, timer.elapsed('main'));
    return [...localTools, ...uniqueNetwork];
  }

  private async queryNetworkTools(): Promise<Anthropic.Tool[]> {
    try {
      if (!this.client.isConnected()) return [];

      const response = await this.client.invokeRemote<{
        tools: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }>;
      }>('kadi.ability.list', { includeProviders: false });

      if (!response?.tools || !Array.isArray(response.tools)) return [];

      return response.tools.map(tool => ({
        name: tool.name,
        description: tool.description || '',
        input_schema: (tool.inputSchema as Anthropic.Tool.InputSchema) || {
          type: 'object',
          properties: {},
          required: [],
        },
      }));
    } catch {
      return [];
    }
  }

  // ==========================================================================
  // Tool format conversion
  // ==========================================================================

  private convertToolsToOpenAIFormat(tools: Anthropic.Tool[]) {
    return tools.map(tool => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description || '',
        parameters: this.sanitizeSchema(tool.input_schema),
      },
    }));
  }

  /** Strip internal _kadi metadata from tool schemas to avoid circular refs */
  private sanitizeSchema(schema: any): any {
    if (!schema || typeof schema !== 'object') return schema;
    const { _kadi, $schema, ...rest } = schema;
    if (rest.properties) {
      const { _kadi: _, ...cleanProps } = rest.properties;
      rest.properties = cleanProps;
    }
    if (Array.isArray(rest.required)) {
      rest.required = rest.required.filter((r: string) => r !== '_kadi');
    }
    return rest;
  }

  // ==========================================================================
  // Tool call parsing
  // ==========================================================================

  private parseToolCalls(response: string): { toolCalls: any[]; message: string } | null {
    if (!response.startsWith('__TOOL_CALLS__')) return null;

    try {
      const jsonStr = response.substring('__TOOL_CALLS__'.length);
      const data = JSON.parse(jsonStr);
      return { toolCalls: data.tool_calls || [], message: data.message || '' };
    } catch {
      logger.error(MODULE_AGENT, '[Orchestrator] Failed to parse tool calls', timer.elapsed('main'));
      return null;
    }
  }

  // ==========================================================================
  // Tool execution (with retry on transient errors)
  // ==========================================================================

  private readonly maxRetries = 3;
  private readonly baseDelayMs = 1000;

  private async executeToolCall(toolCall: any): Promise<string> {
    const toolName = toolCall.function.name;
    const toolArgs = JSON.parse(toolCall.function.arguments);

    logger.info(MODULE_AGENT, `[Orchestrator] Executing tool: ${toolName}`, timer.elapsed('main'));

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const result = await this.client.invokeRemote<any>(toolName, toolArgs, { timeout: 30000 });
        return JSON.stringify(result);
      } catch (error: any) {
        const isRetryable = error.message?.includes('timeout') || error.message?.includes('ECONNREFUSED');

        if (isRetryable && attempt < this.maxRetries) {
          const delay = this.baseDelayMs * Math.pow(2, attempt);
          logger.warn(MODULE_AGENT, `[Orchestrator] Tool ${toolName} failed (attempt ${attempt + 1}), retrying in ${delay}ms`, timer.elapsed('main'));
          await new Promise(r => setTimeout(r, delay));
          continue;
        }

        logger.error(MODULE_AGENT, `[Orchestrator] Tool failed: ${toolName} — ${error.message}`, timer.elapsed('main'));
        return JSON.stringify({ error: error.message || String(error) });
      }
    }

    return JSON.stringify({ error: `Tool ${toolName} failed after ${this.maxRetries} retries` });
  }

  // ==========================================================================
  // Completion detection
  // ==========================================================================

  private checkToolResultForCompletion(toolResult: string): boolean {
    try {
      const parsed = JSON.parse(toolResult);
      if (parsed.status === 'complete') return true;

      const markers = ['TASK COMPLETED', 'No further action needed', '✅', 'task is complete', 'operation complete'];
      const lower = toolResult.toLowerCase();
      if (parsed.success === true && markers.some(m => lower.includes(m.toLowerCase()))) return true;
    } catch {
      const markers = ['TASK COMPLETED', 'No further action needed', '✅', 'task is complete', 'operation complete'];
      const lower = toolResult.toLowerCase();
      if (markers.some(m => lower.includes(m.toLowerCase()))) return true;
    }
    return false;
  }
}
