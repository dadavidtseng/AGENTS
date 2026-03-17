/**
 * KĀDI Broker MCP Client
 *
 * Connects to KĀDI broker via MCP protocol using ws-stdio-bridge.
 * Provides typed helper methods for quest, task, and approval tool invocations.
 *
 * Based on the pattern from mcp-client-simple.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Result shape returned by MCP callTool. */
export interface ToolCallResult {
  content: Array<{ type: string; text?: string; [key: string]: unknown }>;
  isError?: boolean;
}

// ---------------------------------------------------------------------------
// KadiMcpClient
// ---------------------------------------------------------------------------

export class KadiMcpClient {
  private client: Client;
  private connected = false;

  constructor() {
    this.client = new Client(
      { name: 'mcp-client-quest', version: '1.0.0' },
      { capabilities: {} },
    );
  }

  // -------------------------------------------------------------------------
  // Connection lifecycle
  // -------------------------------------------------------------------------

  /**
   * Connect to KĀDI broker via WebSocket-to-stdio bridge.
   * Uses the same approach as Claude Desktop: spawn ws-stdio-bridge as a child process.
   */
  async connect(wsUrl?: string, timeoutMs = 15_000): Promise<void> {
    const url = wsUrl ?? process.env.KADI_BROKER_URL ?? 'ws://localhost:8080/mcp';
    const bridgePath =
      process.env.WS_STDIO_BRIDGE_PATH ??
      'C:\\GitHub\\kadi\\kadi-broker\\src\\utils\\ws-stdio-bridge.ts';

    console.log(`[kadi] Connecting to KĀDI broker at ${url}…`);

    const transport = new StdioClientTransport({
      command: 'npx',
      args: ['tsx', bridgePath, url],
    });

    // Race the MCP handshake against a timeout to prevent hanging forever
    const connectPromise = this.client.connect(transport);
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`KĀDI broker connection timed out after ${timeoutMs}ms`)), timeoutMs);
    });

    try {
      await Promise.race([connectPromise, timeoutPromise]);
      this.connected = true;
      console.log('[kadi] Connected to KĀDI broker');
    } catch (err) {
      // Kill the bridge process if it's still running
      try { await transport.close(); } catch { /* ignore */ }
      throw err;
    }
  }

  /** Disconnect from KĀDI broker. */
  async disconnect(): Promise<void> {
    if (this.connected) {
      console.log('[kadi] Disconnecting from KĀDI broker…');
      await this.client.close();
      this.connected = false;
      console.log('[kadi] Disconnected');
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  // -------------------------------------------------------------------------
  // Generic tool invocation
  // -------------------------------------------------------------------------

  /** List all tools available on the broker. */
  async listTools(): Promise<Array<{ name: string; description?: string }>> {
    this.ensureConnected();
    const result = await this.client.listTools();
    return result.tools;
  }

  /** Call an arbitrary tool by name. */
  async callTool(toolName: string, args: Record<string, unknown> = {}): Promise<ToolCallResult> {
    this.ensureConnected();
    console.log(`[kadi] callTool: ${toolName}`);
    const result = await this.client.callTool({ name: toolName, arguments: args });
    return result as ToolCallResult;
  }

  // -------------------------------------------------------------------------
  // Quest helpers (mcp-server-quest tools, prefixed with quest_ by broker)
  // -------------------------------------------------------------------------

  async questList() {
    return this.callTool('quest_quest_list_quest');
  }

  async questGetDetails(questId: string) {
    return this.callTool('quest_quest_query_quest', { questId, detail: 'full' });
  }

  async questGetStatus(questId: string) {
    return this.callTool('quest_quest_query_quest', { questId, detail: 'summary' });
  }

  async questCreate(params: { name: string; description: string; tasks?: unknown[] }) {
    return this.callTool('quest_quest_create_quest', params);
  }

  // -------------------------------------------------------------------------
  // Agent helpers (mcp-server-quest tools, prefixed with quest_ by broker)
  // -------------------------------------------------------------------------

  async agentList(filters: { status?: string; role?: string } = {}) {
    return this.callTool('quest_quest_list_agents', filters);
  }

  // -------------------------------------------------------------------------
  // Task helpers (mcp-server-quest tools, prefixed with quest_ by broker)
  // -------------------------------------------------------------------------

  async taskQuery(filters: Record<string, unknown> = {}) {
    return this.callTool('quest_quest_query_task', filters);
  }

  async taskGetDetails(taskId: string) {
    return this.callTool('quest_quest_query_task', { taskId });
  }

  // -------------------------------------------------------------------------
  // Approval helpers (mcp-server-quest tools, prefixed with quest_ by broker)
  // -------------------------------------------------------------------------

  async approvalGetStatus(questId: string) {
    return this.callTool('quest_quest_query_approval', { questId });
  }

  async approvalSubmit(questId: string, decision: 'approved' | 'rejected', reason?: string) {
    return this.callTool('quest_quest_submit_approval', { questId, decision, reason });
  }

  // -------------------------------------------------------------------------
  // Quest approval action helpers (agent-producer tools, no broker prefix)
  // -------------------------------------------------------------------------

  async questApprove(questId: string, feedback?: string) {
    return this.callTool('quest_approve', { questId, feedback, platform: 'dashboard' });
  }

  async questRequestRevision(questId: string, feedback: string) {
    return this.callTool('quest_request_revision', { questId, feedback, platform: 'dashboard' });
  }

  async questReject(questId: string, feedback: string) {
    return this.callTool('quest_reject', { questId, feedback, platform: 'dashboard' });
  }

  // -------------------------------------------------------------------------
  // Task approval action helpers (agent-producer tools, no broker prefix)
  // -------------------------------------------------------------------------

  async taskApprove(questId: string, taskId: string, feedback?: string) {
    return this.callTool('task_approve', { questId, taskId, feedback });
  }

  async taskRequestRevision(questId: string, taskId: string, feedback: string) {
    return this.callTool('task_request_revision', { questId, taskId, feedback });
  }

  async taskReject(questId: string, taskId: string, feedback: string) {
    return this.callTool('task_reject', { questId, taskId, feedback });
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  private ensureConnected(): void {
    if (!this.connected) {
      throw new Error('Not connected to KĀDI broker. Call connect() first.');
    }
  }
}

/**
 * Parse the text content from a ToolCallResult into a JS object.
 * MCP tool results return content as an array of { type: 'text', text: '...' } blocks.
 */
export function parseToolResult<T = unknown>(result: ToolCallResult): T {
  const textBlock = result.content.find((c) => c.type === 'text');
  if (!textBlock?.text) {
    throw new Error('Tool result contains no text content');
  }
  return JSON.parse(textBlock.text) as T;
}
