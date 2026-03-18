/**
 * KĀDI Agent Client
 *
 * Replaces the MCP-based KadiMcpClient with a proper KĀDI agent using
 * BaseAgent from agents-library + KadiClient from @kadi.build/core.
 * Matches the pattern established by agent-lead and agent-qa.
 *
 * Exports:
 *  - baseAgent: BaseAgent instance (for lifecycle management)
 *  - client: KadiClient instance (for event subscriptions)
 *  - kadiClient: QuestAgentClient singleton (for route handlers)
 *  - parseToolResult: utility to extract typed data from tool results
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { BaseAgent } from 'agents-library';
import type { BaseAgentConfig } from 'agents-library';
import type { KadiClient } from '@kadi.build/core';

// Load .env from project root before anything else
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Result shape returned by invokeRemote (same as MCP callTool). */
export interface ToolCallResult {
  content: Array<{ type: string; text?: string; [key: string]: unknown }>;
  isError?: boolean;
}

// ---------------------------------------------------------------------------
// BaseAgent bootstrap
// ---------------------------------------------------------------------------

/**
 * Parse broker configuration from environment variables.
 * Supports multiple brokers via KADI_BROKER_URL_* pattern.
 * 
 * Examples:
 *   KADI_BROKER_URL=ws://localhost:8080/kadi
 *   KADI_BROKER_URL_PRODUCER=ws://remote:8080/kadi
 */
function parseBrokerConfig(): BaseAgentConfig {
  const brokers: Record<string, { url: string; networks: string[] }> = {};
  
  // Primary broker (default)
  const defaultUrl = process.env.KADI_BROKER_URL ?? 'ws://localhost:8080/kadi';
  brokers.default = { url: defaultUrl, networks: ['quest', 'global'] };
  
  // Additional brokers (KADI_BROKER_URL_PRODUCER, KADI_BROKER_URL_REMOTE, etc.)
  console.log('[kadi-agent] Scanning environment for additional brokers...');
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('KADI_BROKER_URL_') && value) {
      const brokerName = key.replace('KADI_BROKER_URL_', '').toLowerCase();
      console.log(`[kadi-agent] Found additional broker: ${key} = ${value} (name: ${brokerName})`);
      // Derive network name from broker name (e.g., PRODUCER -> producer)
      brokers[brokerName] = { url: value, networks: [brokerName] };
    }
  }
  console.log(`[kadi-agent] Total brokers configured: ${Object.keys(brokers).length}`, brokers);
  
  // If only one broker, use legacy single-broker config
  if (Object.keys(brokers).length === 1) {
    return {
      agentId: 'agent-quest',
      agentRole: 'programmer',
      version: '1.0.0',
      brokerUrl: defaultUrl,
      networks: ['quest', 'global'],
    };
  }

  // Multi-broker config: separate default from additional brokers
  const { default: defaultBroker, ...additionalBrokers } = brokers;
  return {
    agentId: 'agent-quest',
    agentRole: 'programmer',
    version: '1.0.0',
    brokerUrl: defaultBroker.url,
    networks: defaultBroker.networks,
    additionalBrokers,
  };
}

const baseAgentConfig = parseBrokerConfig();
export const baseAgent = new BaseAgent(baseAgentConfig);
export const client: KadiClient = baseAgent.client;

/** Get all configured broker URLs for observer queries. */
export function getBrokerUrls(): Array<{ name: string; url: string }> {
  const brokers: Array<{ name: string; url: string }> = [];
  
  // Always include the default broker
  if ('brokerUrl' in baseAgentConfig) {
    brokers.push({ name: 'default', url: baseAgentConfig.brokerUrl });
  }
  
  // Add additional brokers if configured
  if ('additionalBrokers' in baseAgentConfig && baseAgentConfig.additionalBrokers) {
    for (const [name, config] of Object.entries(baseAgentConfig.additionalBrokers)) {
      brokers.push({ name, url: config.url });
    }
  }
  
  return brokers.length > 0 ? brokers : [{ name: 'default', url: 'ws://localhost:8080/kadi' }];
}

// ---------------------------------------------------------------------------
// QuestAgentClient — drop-in replacement for KadiMcpClient
// ---------------------------------------------------------------------------

export class QuestAgentClient {
  private connected = false;

  // -------------------------------------------------------------------------
  // Connection lifecycle
  // -------------------------------------------------------------------------

  async connect(): Promise<void> {
    const brokers = getBrokerUrls();
    const brokerList = brokers.map(b => `${b.name}:${b.url}`).join(', ');
    console.log(`[agent-quest] Connecting to KĀDI broker(s): ${brokerList}`);
    await baseAgent.connect();
    this.connected = true;
    console.log('[agent-quest] Connected to KĀDI broker(s)');
  }

  async disconnect(): Promise<void> {
    if (this.connected) {
      console.log('[agent-quest] Disconnecting from KĀDI broker…');
      await baseAgent.shutdown();
      this.connected = false;
      console.log('[agent-quest] Disconnected');
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  // -------------------------------------------------------------------------
  // Generic tool invocation
  // -------------------------------------------------------------------------

  async callTool(toolName: string, args: Record<string, unknown> = {}): Promise<ToolCallResult> {
    this.ensureConnected();
    console.log(`[agent-quest] invokeRemote: ${toolName}`);
    const result = await client.invokeRemote(toolName, args);
    return result as ToolCallResult;
  }

  // -------------------------------------------------------------------------
  // Quest helpers
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
  // Agent helpers
  // -------------------------------------------------------------------------

  async agentList(filters: { status?: string; role?: string } = {}) {
    return this.callTool('quest_quest_list_agents', filters);
  }

  // -------------------------------------------------------------------------
  // Task helpers
  // -------------------------------------------------------------------------

  async taskQuery(filters: Record<string, unknown> = {}) {
    return this.callTool('quest_quest_query_task', filters);
  }

  async taskGetDetails(taskId: string) {
    return this.callTool('quest_quest_query_task', { taskId });
  }

  // -------------------------------------------------------------------------
  // Approval helpers
  // -------------------------------------------------------------------------

  async approvalGetStatus(questId: string) {
    return this.callTool('quest_quest_query_approval', { questId });
  }

  async approvalSubmit(questId: string, decision: 'approved' | 'rejected', reason?: string) {
    return this.callTool('quest_quest_submit_approval', { questId, decision, reason });
  }

  // -------------------------------------------------------------------------
  // Quest approval action helpers
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
  // Task approval action helpers
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

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

/**
 * Parse the text content from a ToolCallResult into a JS object.
 * Tool results return content as an array of { type: 'text', text: '...' } blocks.
 */
export function parseToolResult<T = unknown>(result: ToolCallResult): T {
  const textBlock = result.content.find((c) => c.type === 'text');
  if (!textBlock?.text) {
    throw new Error('Tool result contains no text content');
  }
  if (result.isError) {
    throw new Error(textBlock.text);
  }
  try {
    return JSON.parse(textBlock.text) as T;
  } catch {
    throw new Error(textBlock.text);
  }
}

/** Singleton instance for route handlers. */
export const kadiClient = new QuestAgentClient();
