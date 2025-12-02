/**
 * Claude API Orchestrator for Multi-Step Workflows
 * =================================================
 *
 * Provides reusable Claude API interaction logic extracted from bot implementations.
 * Enables tool handlers to orchestrate multi-step workflows with Claude's assistance.
 *
 * This helper allows agent-producer to use Claude API for intelligent task planning
 * without duplicating the bot's Claude integration logic.
 *
 * @module claude-orchestrator
 */

import Anthropic from '@anthropic-ai/sdk';
import type { KadiClient } from '@kadi.build/core';

// ============================================================================
// Types
// ============================================================================

/**
 * Configuration for Claude orchestrator
 */
export interface ClaudeOrchestratorConfig {
  /** KĀDI client for tool discovery and invocation */
  client: KadiClient;

  /** Anthropic API key */
  anthropicApiKey: string;

  /** Optional Claude model (defaults to haiku) */
  model?: string;

  /** Optional max tokens (defaults to 4096) */
  maxTokens?: number;
}

/**
 * Result from Claude API call
 */
export interface ClaudeResponse {
  /** Final text response from Claude */
  text: string;

  /** Full conversation history (for debugging) */
  conversationHistory: Anthropic.MessageParam[];
}

// ============================================================================
// Claude Orchestrator Class
// ============================================================================

/**
 * Claude API orchestrator for multi-step workflows
 *
 * Provides a clean interface for calling Claude API with tool support,
 * handling the tool use loop, and extracting final responses.
 *
 * Example usage:
 * ```typescript
 * const orchestrator = new ClaudeOrchestrator({
 *   client: kadiClient,
 *   anthropicApiKey: process.env.ANTHROPIC_API_KEY!
 * });
 *
 * const response = await orchestrator.callClaude(
 *   'Analyze this task and suggest improvements: ...',
 *   protocol
 * );
 * ```
 */
export class ClaudeOrchestrator {
  private anthropic: Anthropic;
  private client: KadiClient;
  private model: string;
  private maxTokens: number;

  constructor(config: ClaudeOrchestratorConfig) {
    this.client = config.client;
    this.anthropic = new Anthropic({ apiKey: config.anthropicApiKey });
    this.model = config.model || process.env.BOT_CLAUDE_MODEL || 'claude-3-haiku-20240307';
    this.maxTokens = config.maxTokens || parseInt(process.env.BOT_CLAUDE_MAX_TOKENS || '4096');
  }

  /**
   * Call Claude API with a prompt and handle tool use loop
   *
   * @param prompt - User prompt to send to Claude
   * @param protocol - KĀDI broker protocol for tool invocation
   * @param allowedToolPrefixes - Optional array of tool name prefixes to restrict Claude's access (e.g., ['shrimp_analyze', 'shrimp_reflect'])
   * @returns Claude's final text response after all tool calls
   */
  async callClaude(prompt: string, protocol: any, allowedToolPrefixes?: string[]): Promise<ClaudeResponse> {
    console.log(`🤖 Calling Claude API with prompt: "${prompt.substring(0, 100)}..."`);

    // Get available tools from KĀDI broker
    let availableTools = await this.getAvailableTools();

    // Filter tools if allowedToolPrefixes is specified
    if (allowedToolPrefixes && allowedToolPrefixes.length > 0) {
      availableTools = availableTools.filter(tool =>
        allowedToolPrefixes.some(prefix => tool.name.startsWith(prefix))
      );
      console.log(`🔒 Restricted to ${availableTools.length} tools matching prefixes: ${allowedToolPrefixes.join(', ')}`);
    }

    // Initial Claude API call
    let response = await this.anthropic.messages.create({
      model: this.model,
      max_tokens: this.maxTokens,
      tools: availableTools,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    });

    // Conversation history for multi-turn interactions
    const conversationMessages: Anthropic.MessageParam[] = [
      { role: 'user', content: prompt },
    ];

    // Handle tool use loop
    while (response.stop_reason === 'tool_use') {
      // Extract tool calls from response
      const toolBlocks = response.content.filter((block) => block.type === 'tool_use');

      console.log(`🔧 Claude requested ${toolBlocks.length} tool call(s)`);

      // Add assistant response to conversation
      conversationMessages.push({
        role: 'assistant',
        content: response.content,
      });

      // Execute tool calls
      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const toolBlock of toolBlocks) {
        if (toolBlock.type !== 'tool_use') continue;

        console.log(`🔧 Executing tool: ${toolBlock.name}`);
        console.log(`📝 Tool input: ${JSON.stringify(toolBlock.input).substring(0, 200)}...`);

        const result = await this.executeKadiTool(
          protocol,
          toolBlock.name,
          toolBlock.input as Record<string, unknown>
        );

        // Log the result to help debug issues
        const resultStr = JSON.stringify(result);
        if (resultStr.includes('error') || resultStr.includes('Error') || resultStr.includes('failed')) {
          console.log(`⚠️ Tool result contains error: ${resultStr.substring(0, 300)}...`);
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
        model: this.model,
        max_tokens: this.maxTokens,
        tools: availableTools,
        messages: conversationMessages,
      });
    }

    // Extract final text response
    const finalText = response.content
      .filter((block) => block.type === 'text')
      .map((block: any) => block.text)
      .join('\n');

    console.log(`✅ Claude API completed with ${conversationMessages.length} turns`);

    return {
      text: finalText,
      conversationHistory: conversationMessages,
    };
  }

  /**
   * Execute a KĀDI tool via broker protocol
   *
   * @param protocol - KĀDI broker protocol
   * @param toolName - Name of tool to execute
   * @param input - Tool input parameters
   * @returns Tool execution result
   */
  private async executeKadiTool(
    protocol: any,
    toolName: string,
    input: Record<string, unknown>
  ): Promise<any> {
    try {
      // Determine target agent based on tool name prefix
      const targetAgent = this.resolveTargetAgent(toolName);

      const result = await protocol.invokeTool({
        targetAgent,
        toolName,
        toolInput: input,
        timeout: 30000,
      });

      // Handle MCP tool response format
      if (result && typeof result === 'object') {
        // MCP tools return { content: [{ type: 'text', text: '...' }] }
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

        return result;
      }

      return result;
    } catch (error: any) {
      console.error(`❌ Tool execution failed (${toolName}):`, error);
      return `Error executing tool: ${error.message || String(error)}`;
    }
  }

  /**
   * Get available KĀDI tools formatted for Claude API
   *
   * Combines tools from two sources:
   * 1. Local tools: Registered directly on this agent
   * 2. Network tools: Available via broker on connected networks
   */
  private async getAvailableTools(): Promise<Anthropic.Tool[]> {
    // 1. Get locally registered tools
    const localTools = this.client.getAllRegisteredTools().map(tool => ({
      name: tool.definition.name,
      description: tool.definition.description || '',
      input_schema: tool.definition.inputSchema as Anthropic.Tool.InputSchema,
    }));

    // 2. Query broker for network tools
    const networkTools = await this.queryNetworkTools();

    // 3. Deduplicate (prefer local tools)
    const localToolNames = new Set(localTools.map(t => t.name));
    const uniqueNetworkTools = networkTools.filter(t => !localToolNames.has(t.name));

    console.log(
      `📋 Available tools: ${localTools.length} local + ${uniqueNetworkTools.length} network = ${localTools.length + uniqueNetworkTools.length} total`
    );

    return [...localTools, ...uniqueNetworkTools];
  }

  /**
   * Query broker for tools available on connected networks
   */
  private async queryNetworkTools(): Promise<Anthropic.Tool[]> {
    try {
      const networks = this.client.config.networks || [];
      const protocol = this.client.getBrokerProtocol();

      const result = await (protocol as any).connection.sendRequest({
        jsonrpc: '2.0',
        method: 'kadi.ability.list',
        params: {
          networks,
          includeProviders: false,
        },
        id: `tools_${Date.now()}`,
      }) as {
        tools: Array<{
          name: string;
          description?: string;
          inputSchema?: any;
        }>;
      };

      return result.tools.map((tool: any) => ({
        name: tool.name,
        description: tool.description || '',
        input_schema: (tool.inputSchema || { type: 'object' }) as Anthropic.Tool.InputSchema,
      }));
    } catch (error) {
      console.error('❌ Failed to query network tools from broker:', error);
      return [];
    }
  }

  /**
   * Resolve target agent for a tool name based on prefix
   */
  private resolveTargetAgent(toolName: string): string {
    if (toolName.startsWith('plan_') || toolName.startsWith('list_') ||
        toolName.startsWith('get_') || toolName.startsWith('approve_')) {
      return 'agent-producer';
    }
    if (toolName.startsWith('shrimp_')) {
      return 'mcp-server-shrimp-agent-playground';
    }
    if (toolName.startsWith('slack_')) {
      return 'mcp-server-slack';
    }
    if (toolName.startsWith('discord_server_')) {
      return 'mcp-server-discord';
    }
    if (toolName.startsWith('git_')) {
      return 'mcp-server-git';
    }

    // Default: assume it's on agent-producer
    return 'agent-producer';
  }
}
