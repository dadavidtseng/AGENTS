/**
 * Kadi Remote Provider
 *
 * Implementation of RemoteVaultProvider for KADI broker-based secrets.
 * Secrets are E2E encrypted - the broker only sees ciphertext.
 *
 * This implementation is adapted from remote.ts for the v2 provider interface.
 */

import { KadiClient } from '@kadi.build/core';
import type {
  RemoteVaultProvider,
  RemoteVaultConfig,
  ShareOptions,
  ShareResult,
  SharedSecret,
  HealthStatus,
  AuditLogEntry,
  AuditLogFilter,
} from './types.js';
import type { Identity } from '../identity.js';
import { encrypt, decrypt, encryptFor } from '../crypto.js';

// =============================================================================
// Types
// =============================================================================

interface ToolProvider {
  sessionId: string;
  source: string;
  displayName?: string;
  agentId?: string;
  publicKey?: string;
}

interface DiscoveredTool {
  name: string;
  providers?: ToolProvider[];
}

// =============================================================================
// KadiRemoteProvider
// =============================================================================

export class KadiRemoteProvider implements RemoteVaultProvider {
  readonly type = 'kadi';

  private _broker: string | null = null;
  private _network: string | null = null;
  private _vault: string | null = null;
  private client: KadiClient | null = null;
  private identity: Identity | null = null;
  private toolNames: Map<string, string> = new Map();
  private connected = false;

  /**
   * Get identity, throwing if not connected.
   */
  private requireIdentity(): Identity {
    if (!this.identity) {
      throw new Error('Provider not connected: identity not available');
    }
    return this.identity;
  }

  /**
   * Get client, throwing if not connected.
   */
  private requireClient(): KadiClient {
    if (!this.client) {
      throw new Error('Provider not connected: client not available');
    }
    return this.client;
  }

  async connect(config: RemoteVaultConfig): Promise<void> {
    if (this.connected) return;

    if (!config.broker) {
      throw new Error('Kadi provider requires broker URL');
    }
    if (!config.network) {
      throw new Error('Kadi provider requires network name');
    }

    this._broker = config.broker;
    this._network = config.network;
    if (!config.vault) {
      throw new Error('Kadi provider requires vault name (MCP upstream id)');
    }
    this._vault = config.vault;

    // Use provided identity
    if (!config.identity) {
      throw new Error('Kadi provider requires identity');
    }
    this.identity = {
      privateKey: Buffer.from(config.identity.privateKey, 'base64'),
      publicKey: config.identity.publicKey,
    };

    // Create and connect client
    this.client = new KadiClient({
      name: 'secret-ability',
      brokers: { vault: { url: this._broker, networks: [this._network] } },
      defaultBroker: 'vault',
      identity: this.identity,
    });

    await this.client.connect();
    try {
      await this.discoverTools();
    } catch (err) {
      // Clean up client if tool discovery fails
      await this.client.disconnect();
      throw err;
    }
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.disconnect();
      this.connected = false;
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  async healthCheck(): Promise<HealthStatus> {
    if (!this.connected) {
      return {
        healthy: false,
        message: 'Not connected',
        details: {
          broker: this._broker,
          network: this._network,
        },
      };
    }

    try {
      // Try to list tools as a health check
      await this.list();
      return {
        healthy: true,
        message: 'Connected',
        details: {
          broker: this._broker,
          network: this._network,
          toolCount: this.toolNames.size,
        },
      };
    } catch (err) {
      return {
        healthy: false,
        message: err instanceof Error ? err.message : String(err),
        details: {
          broker: this._broker,
          network: this._network,
        },
      };
    }
  }

  // ---------------------------------------------------------------------------
  // Core CRUD Operations
  // ---------------------------------------------------------------------------

  async get(key: string, fromAgent?: string): Promise<string | null> {
    const toolName = this.requireTool('get_secret');
    const params: Record<string, unknown> = { name: key };
    if (fromAgent) params['from_agent'] = fromAgent;

    const result = await this.invoke<{ value?: string; found?: boolean }>(toolName, params);
    if (!result.found || result.value === undefined) return null;

    return decrypt(result.value, this.requireIdentity());
  }

  async set(key: string, value: string): Promise<void> {
    const toolName = this.requireTool('store_secret');
    const encrypted = encrypt(value, this.requireIdentity());
    await this.invoke(toolName, { name: key, value: encrypted });
  }

  async delete(key: string): Promise<void> {
    const toolName = this.requireTool('delete_secret');
    await this.invoke(toolName, { name: key });
  }

  async list(): Promise<string[]> {
    const toolName = this.requireTool('list_secrets');
    const result = await this.invoke<{ secrets?: string[] }>(toolName, {});
    return result.secrets ?? [];
  }

  async exists(key: string): Promise<boolean> {
    const toolName = this.requireTool('get_secret');
    const result = await this.invoke<{ found?: boolean }>(toolName, { name: key });
    return result.found ?? false;
  }

  // ---------------------------------------------------------------------------
  // Sharing Operations
  // ---------------------------------------------------------------------------

  async share(key: string, options: ShareOptions): Promise<ShareResult> {
    const plaintext = await this.get(key);
    if (plaintext === null) {
      throw new Error(`Secret '${key}' not found in your namespace`);
    }

    const encryptedForRecipient = encryptFor(plaintext, options.withAgent);
    const toolName = this.requireTool('share_secret');

    const params: Record<string, unknown> = {
      name: key,
      with_agent: options.withAgent,
      encrypted_value: encryptedForRecipient,
      permission: options.permission ?? 'read',
      duration_hours: options.durationHours ?? 1,
    };
    if (options.maxReads) {
      params['max_reads'] = options.maxReads;
    }

    const result = await this.invoke<{ success: boolean; expires_at: number }>(toolName, params);
    return { expiresAt: result.expires_at };
  }

  async revoke(key: string, fromAgent: string): Promise<void> {
    const toolName = this.requireTool('revoke_share');
    await this.invoke(toolName, { name: key, from_agent: fromAgent });
  }

  async listShared(): Promise<SharedSecret[]> {
    const toolName = this.requireTool('list_shared_with_me');
    const result = await this.invoke<{
      secrets?: Array<{
        name: string;
        from_agent: string;
        permission: string;
        expires_at: number;
        max_reads: number;
        read_count: number;
      }>;
    }>(toolName, {});

    return (result.secrets ?? []).map((s) => ({
      key: s.name,
      fromAgent: s.from_agent,
      permission: s.permission as 'read' | 'readwrite',
      expiresAt: s.expires_at,
    }));
  }

  async getShared(key: string): Promise<{ value: string; fromAgent: string }> {
    const shared = await this.listShared();
    const matches = shared.filter((s) => s.key === key);

    if (matches.length === 0) {
      throw new Error(`No secret named '${key}' has been shared with you`);
    }
    if (matches.length > 1) {
      const agents = matches.map((m) => m.fromAgent).join(', ');
      throw new Error(
        `Multiple agents shared a secret named '${key}'. ` +
          `Use get() with fromAgent to disambiguate. Agents: ${agents}`
      );
    }

    const match = matches[0]!; // Safe: length === 1 after above checks
    const value = await this.get(key, match.fromAgent);
    if (value === null) {
      throw new Error(`Failed to retrieve shared secret '${key}' from agent ${match.fromAgent}`);
    }

    return { value, fromAgent: match.fromAgent };
  }

  // ---------------------------------------------------------------------------
  // Audit Logs
  // ---------------------------------------------------------------------------

  async listAuditLogs(filter?: AuditLogFilter): Promise<AuditLogEntry[]> {
    const toolName = this.requireTool('list_audit_logs');
    const params: Record<string, unknown> = {};

    if (filter?.secretName) params['secret_name'] = filter.secretName;
    if (filter?.action) params['action'] = filter.action;
    if (filter?.sinceUnix) params['since_unix'] = filter.sinceUnix;
    if (filter?.limit) params['limit'] = filter.limit;
    if (filter?.mySecretsOnly) params['my_secrets_only'] = filter.mySecretsOnly;

    const result = await this.invoke<{
      logs?: Array<{
        timestamp: number;
        agent_key: string;
        secret_name?: string;
        action: string;
        from_agent?: string;
        success: boolean;
        reason?: string;
      }>;
    }>(toolName, params);

    return (result.logs ?? []).map((log) => ({
      timestamp: log.timestamp,
      agentKey: log.agent_key,
      secretName: log.secret_name,
      action: log.action,
      fromAgent: log.from_agent,
      success: log.success,
      reason: log.reason,
    }));
  }

  // ---------------------------------------------------------------------------
  // Tool Discovery
  // ---------------------------------------------------------------------------

  private async discoverTools(): Promise<void> {
    const result = await this.requireClient().invokeRemote<{ tools: DiscoveredTool[] }>(
      'kadi.ability.list',
      { includeProviders: true }
    );

    if (!result?.tools) {
      throw new Error('Failed to list tools from broker');
    }

    const targetSessionId = `upstream:${this._vault}`;

    for (const tool of result.tools) {
      if (!tool.providers) continue;
      const isOurs = tool.providers.some(
        (p) => p.sessionId === targetSessionId && p.source === 'mcp-upstream'
      );
      if (isOurs) {
        const original = this.extractOriginalName(tool.name);
        this.toolNames.set(original, tool.name);
      }
    }

    if (this.toolNames.size === 0) {
      throw new Error(
        `No tools found for vault "${this._vault}" on broker.\n` +
          `  Make sure the secret service is registered on the broker.`
      );
    }
  }

  private extractOriginalName(prefixedName: string): string {
    const known = [
      'store_secret',
      'get_secret',
      'delete_secret',
      'list_secrets',
      'share_secret',
      'revoke_share',
      'list_shared_with_me',
      'list_audit_logs',
    ];
    for (const k of known) {
      if (prefixedName === k || prefixedName.endsWith(`_${k}`)) return k;
    }
    return prefixedName;
  }

  // ---------------------------------------------------------------------------
  // Tool Invocation
  // ---------------------------------------------------------------------------

  private requireTool(name: string): string {
    const prefixed = this.toolNames.get(name);
    if (!prefixed) {
      const available = [...this.toolNames.keys()].join(', ');
      throw new Error(
        `Tool "${name}" not found on vault "${this._vault}".\n` +
          `  Available: ${available || '(none)'}`
      );
    }
    return prefixed;
  }

  private async invoke<T = unknown>(
    toolName: string,
    params: Record<string, unknown>
  ): Promise<T> {
    const raw = await this.requireClient().invokeRemote<unknown>(toolName, {
      ...params,
      _kadi: { requireProvider: `upstream:${this._vault}` },
    });
    return this.unwrapMcpResult<T>(raw);
  }

  /**
   * Unwrap MCP CallToolResult format from broker.
   * Format: { content: [{ type: "text", text: "{...}" }], isError?: boolean }
   */
  private unwrapMcpResult<T>(raw: unknown): T {
    if (typeof raw !== 'object' || raw === null) return raw as T;
    const result = raw as Record<string, unknown>;

    if (result['isError']) {
      const text = this.extractText(result);
      throw new Error(text || 'Remote tool execution failed');
    }

    if (Array.isArray(result['content'])) {
      const text = this.extractText(result);
      if (text) {
        try {
          return JSON.parse(text) as T;
        } catch {
          return text as T;
        }
      }
    }

    return raw as T;
  }

  private extractText(result: Record<string, unknown>): string | null {
    const content = result['content'] as Array<{ type: string; text?: string }> | undefined;
    if (!Array.isArray(content)) return null;
    const textBlock = content.find((c) => c.type === 'text');
    return textBlock?.text ?? null;
  }
}
