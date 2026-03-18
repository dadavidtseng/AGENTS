/**
 * KĀDI Remote Vault Provider
 *
 * Stores secrets on the KĀDI broker's secret-service. All values are
 * E2E encrypted client-side before transmission — the broker only sees
 * ciphertext. Uses NaCl sealed boxes (X25519 + XSalsa20-Poly1305).
 *
 * Supports:
 * - CRUD operations on own secrets
 * - Agent-to-agent secret sharing with time/read limits
 * - Audit log retrieval
 */

import type {
  RemoteVaultProvider,
  RemoteVaultConfig,
  ShareOptions,
  ShareResult,
  SharedSecret,
  AuditLogEntry,
  AuditLogFilter,
  HealthStatus,
  IdentityParam,
} from './types.js';
import { encrypt, decrypt, encryptFor } from '../crypto.js';
import type { Identity } from '../identity.js';

// =============================================================================
// Types
// =============================================================================

interface BrokerCallResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

type BrokerCallFn = (
  method: string,
  params: Record<string, unknown>
) => Promise<BrokerCallResult>;

// =============================================================================
// KadiVaultProvider
// =============================================================================

export class KadiVaultProvider implements RemoteVaultProvider {
  readonly type = 'kadi';

  private identity: Identity | null = null;
  private brokerCall: BrokerCallFn | null = null;
  private connected = false;

  async connect(config: RemoteVaultConfig): Promise<void> {
    if (!config.identity) {
      throw new Error('Identity required for KĀDI remote vault');
    }

    this.identity = {
      privateKey: Buffer.from(config.identity.privateKey, 'base64'),
      publicKey: config.identity.publicKey,
    };

    // Dynamic import to avoid circular dependency
    const { default: client } = await import('../index.js');
    this.brokerCall = async (method, params) => {
      const result = await (client as any).invokeRemote(method, params);
      return result as BrokerCallResult;
    };

    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.identity = null;
    this.brokerCall = null;
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  async healthCheck(): Promise<HealthStatus> {
    if (!this.connected) {
      return { healthy: false, message: 'Not connected' };
    }
    try {
      await this.call('secret.health', {});
      return { healthy: true, message: 'KĀDI secret service reachable' };
    } catch (err) {
      return { healthy: false, message: (err as Error).message };
    }
  }

  // ── Helpers ─────────────────────────────────────────────────────────

  private requireIdentity(): Identity {
    if (!this.identity) throw new Error('Not connected — call connect() first');
    return this.identity;
  }

  private async call(method: string, params: Record<string, unknown>): Promise<unknown> {
    if (!this.brokerCall) throw new Error('Not connected');
    const result = await this.brokerCall(method, params);
    if (result.isError) {
      const text = result.content?.[0]?.text ?? 'Unknown broker error';
      throw new Error(text);
    }
    const text = result.content?.[0]?.text;
    if (!text) return null;
    try { return JSON.parse(text); } catch { return text; }
  }

  // ── CRUD ────────────────────────────────────────────────────────────

  async get(key: string, fromAgent?: string): Promise<string | null> {
    const identity = this.requireIdentity();
    const params: Record<string, unknown> = { key };
    if (fromAgent) params.fromAgent = fromAgent;

    const result = await this.call('secret.get', params) as { value?: string } | null;
    if (!result?.value) return null;

    return decrypt(result.value, identity);
  }

  async set(key: string, value: string): Promise<void> {
    const identity = this.requireIdentity();
    const encrypted = encrypt(value, identity);
    await this.call('secret.set', { key, value: encrypted });
  }

  async delete(key: string): Promise<void> {
    await this.call('secret.delete', { key });
  }

  async list(): Promise<string[]> {
    const result = await this.call('secret.list', {}) as { keys?: string[] } | null;
    return result?.keys ?? [];
  }

  async exists(key: string): Promise<boolean> {
    const result = await this.call('secret.exists', { key }) as { exists?: boolean } | null;
    return result?.exists ?? false;
  }

  // ── Sharing ─────────────────────────────────────────────────────────

  async share(key: string, options: ShareOptions): Promise<ShareResult> {
    const identity = this.requireIdentity();

    // Get plaintext value
    const plaintext = await this.get(key);
    if (plaintext === null) throw new Error(`Secret '${key}' not found`);

    // Resolve target agent's public key
    const target = await this.call('agent.resolve', { name: options.withAgent }) as {
      publicKey?: string;
    } | null;
    if (!target?.publicKey) throw new Error(`Agent '${options.withAgent}' not found or has no public key`);

    // Encrypt for target agent
    const encryptedForTarget = encryptFor(plaintext, target.publicKey);

    const result = await this.call('secret.share', {
      key,
      value: encryptedForTarget,
      withAgent: options.withAgent,
      permission: options.permission ?? 'read',
      durationHours: options.durationHours,
      maxReads: options.maxReads,
    }) as { expiresAt?: number } | null;

    return { expiresAt: result?.expiresAt ?? 0 };
  }

  async revoke(key: string, fromAgent: string): Promise<void> {
    await this.call('secret.revoke', { key, fromAgent });
  }

  async listShared(): Promise<SharedSecret[]> {
    const result = await this.call('secret.listShared', {}) as { shared?: SharedSecret[] } | null;
    return result?.shared ?? [];
  }

  async getShared(key: string): Promise<{ value: string; fromAgent: string }> {
    const identity = this.requireIdentity();
    const result = await this.call('secret.getShared', { key }) as {
      value?: string;
      fromAgent?: string;
    } | null;

    if (!result?.value) throw new Error(`Shared secret '${key}' not found`);

    const decrypted = decrypt(result.value, identity);
    return { value: decrypted, fromAgent: result.fromAgent ?? 'unknown' };
  }

  // ── Audit ───────────────────────────────────────────────────────────

  async listAuditLogs(filter?: AuditLogFilter): Promise<AuditLogEntry[]> {
    const result = await this.call('secret.auditLogs', { ...filter } as Record<string, unknown>) as {
      logs?: AuditLogEntry[];
    } | null;
    return result?.logs ?? [];
  }
}
