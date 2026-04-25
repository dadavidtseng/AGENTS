/**
 * KĀDI Agent Client
 *
 * Uses BaseAgent from agents-library + KadiClient from @kadi.build/core.
 * Reads broker config from config.toml, secrets from secrets.toml.
 *
 * Exports:
 *  - cfg: Config instance (for server settings)
 *  - secrets: Config instance (for server secrets)
 *  - baseAgent: BaseAgent instance (for lifecycle management)
 *  - client: KadiClient instance (for event subscriptions)
 *  - kadiClient: QuestAgentClient singleton (for route handlers)
 *  - getBrokerUrls: utility to get all configured broker URLs
 *  - parseToolResult: utility to extract typed data from tool results
 *
 * @module kadi-agent
 */

import { BaseAgent, readConfig, loadVaultCredentials } from 'agents-library';
import type { BaseAgentConfig } from 'agents-library';
import type { KadiClient, LoadedAbility } from '@kadi.build/core';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export const cfg = readConfig();

// Secrets: loaded from encrypted vault via secret-ability
let _secrets: Record<string, string> = {};

/** Vault-loaded secrets (observer password, etc.) */
export const secrets = _secrets;

// ---------------------------------------------------------------------------
// Broker resolution
// ---------------------------------------------------------------------------

const hasLocal = cfg.has('broker.local.URL');
const hasRemote = cfg.has('broker.remote.URL');
if (!hasLocal && !hasRemote) {
  throw new Error('At least one broker required: set [broker.local] or [broker.remote] in config.toml');
}

const brokerUrl = hasLocal
  ? (process.env.KADI_BROKER_URL_LOCAL ?? cfg.string('broker.local.URL'))
  : (process.env.KADI_BROKER_URL_REMOTE ?? cfg.string('broker.remote.URL'));
const networks = hasLocal
  ? cfg.strings('broker.local.NETWORKS')
  : cfg.strings('broker.remote.NETWORKS');

const additionalBrokerUrl = hasLocal && hasRemote
  ? (process.env.KADI_BROKER_URL_REMOTE ?? cfg.string('broker.remote.URL'))
  : undefined;
const additionalBrokerNetworks = hasLocal && hasRemote
  ? cfg.strings('broker.remote.NETWORKS')
  : undefined;

// ---------------------------------------------------------------------------
// BaseAgent bootstrap
// ---------------------------------------------------------------------------

const agentId = cfg.has('agent.ID') ? cfg.string('agent.ID') : 'agent-quest';
const agentVersion = cfg.has('agent.VERSION') ? cfg.string('agent.VERSION') : '1.0.0';

const baseAgentConfig: BaseAgentConfig = {
  agentId,
  agentRole: 'programmer',
  version: agentVersion,
  brokerUrl,
  networks,
  ...(additionalBrokerUrl && {
    additionalBrokers: {
      remote: { url: additionalBrokerUrl, networks: additionalBrokerNetworks! },
    },
  }),
};

export const baseAgent = new BaseAgent(baseAgentConfig);
export const client: KadiClient = baseAgent.client;

// ---------------------------------------------------------------------------
// ability-log (loaded after broker connect)
// ---------------------------------------------------------------------------

/** ability-log instance for persistent log/event storage. null until connect(). */
export let abilityLog: LoadedAbility | null = null;

/** Load ability-log via loadNative. Called from bootstrap after broker connect. */
export async function loadAbilityLog(): Promise<void> {
  try {
    abilityLog = await client.loadNative('ability-log');
    console.log('[agent-quest] ability-log loaded for persistent storage');
  } catch (err: any) {
    console.warn(`[agent-quest] ability-log not available: ${err.message}`);
    console.warn('[agent-quest] Event/log persistence will be disabled');
  }
}

// ---------------------------------------------------------------------------
// Broker URL helpers
// ---------------------------------------------------------------------------

/** Get all configured broker URLs for observer queries. */
export function getBrokerUrls(): Array<{ name: string; url: string }> {
  const brokers: Array<{ name: string; url: string }> = [];

  if (hasLocal) {
    brokers.push({ name: 'local', url: cfg.string('broker.local.URL') });
  }
  if (hasRemote) {
    brokers.push({ name: 'remote', url: cfg.string('broker.remote.URL') });
  }

  return brokers.length > 0 ? brokers : [{ name: 'default', url: 'ws://localhost:8080/kadi' }];
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Result shape returned by invokeRemote (same as MCP callTool). */
export interface ToolCallResult {
  content: Array<{ type: string; text?: string; [key: string]: unknown }>;
  isError?: boolean;
}

// ---------------------------------------------------------------------------
// QuestAgentClient — drop-in replacement for KadiMcpClient
// ---------------------------------------------------------------------------

export class QuestAgentClient {
  private connected = false;

  async connect(): Promise<void> {
    // Load vault secrets before connecting
    let vaultSecrets: Record<string, string> = {};
    try {
      vaultSecrets = await loadVaultCredentials();
      Object.assign(_secrets, vaultSecrets);
      const loaded = Object.keys(vaultSecrets).length;
      if (loaded > 0) {
        console.log(`[agent-quest] Loaded ${loaded} secret(s) from vault`);
      }
    } catch (err: any) {
      console.warn(`[agent-quest] Vault unavailable: ${err.message}`);
    }

    const brokers = getBrokerUrls();
    const brokerList = brokers.map(b => `${b.name}:${b.url}`).join(', ');
    console.log(`[agent-quest] Connecting to KĀDI broker(s): ${brokerList}`);
    await baseAgent.connect(vaultSecrets);
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

  async callTool(toolName: string, args: Record<string, unknown> = {}): Promise<ToolCallResult> {
    this.ensureConnected();
    console.log(`[agent-quest] invokeRemote: ${toolName}`);
    const result = await client.invokeRemote(toolName, args);
    return result as ToolCallResult;
  }

  // Quest helpers
  async questList() { return this.callTool('quest_quest_list_quest'); }
  async questGetDetails(questId: string) { return this.callTool('quest_quest_query_quest', { questId, detail: 'full' }); }
  async questGetStatus(questId: string) { return this.callTool('quest_quest_query_quest', { questId, detail: 'summary' }); }
  async questCreate(params: { name: string; description: string; tasks?: unknown[] }) { return this.callTool('quest_quest_create_quest', params); }

  // Agent helpers
  async agentList(filters: { status?: string; role?: string } = {}) { return this.callTool('quest_quest_list_agents', filters); }

  // Task helpers
  async taskQuery(filters: Record<string, unknown> = {}) { return this.callTool('quest_quest_query_task', filters); }
  async taskGetDetails(taskId: string) { return this.callTool('quest_quest_query_task', { taskId }); }

  // Approval helpers
  async approvalGetStatus(questId: string) { return this.callTool('quest_quest_query_approval', { questId }); }
  async approvalSubmit(questId: string, decision: 'approved' | 'rejected', reason?: string) { return this.callTool('quest_quest_submit_approval', { questId, decision, reason }); }

  // Quest approval actions
  async questApprove(questId: string, feedback?: string) { return this.callTool('quest_approve', { questId, feedback, platform: 'dashboard' }); }
  async questRequestRevision(questId: string, feedback: string) { return this.callTool('quest_request_revision', { questId, feedback, platform: 'dashboard' }); }
  async questReject(questId: string, feedback: string) { return this.callTool('quest_reject', { questId, feedback, platform: 'dashboard' }); }

  // Task approval actions
  async taskApprove(questId: string, taskId: string, feedback?: string) { return this.callTool('task_approve', { questId, taskId, feedback }); }
  async taskRequestRevision(questId: string, taskId: string, feedback: string) { return this.callTool('task_request_revision', { questId, taskId, feedback }); }
  async taskReject(questId: string, taskId: string, feedback: string) { return this.callTool('task_reject', { questId, taskId, feedback }); }

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
