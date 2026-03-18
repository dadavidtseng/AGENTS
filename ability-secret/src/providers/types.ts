/**
 * Remote Vault Provider Interface
 *
 * Abstraction for remote secret backends. Each vault type (kadi, aws, hashicorp, etc.)
 * implements this interface. Local (age) vaults don't use providers - they're just
 * file I/O + encryption.
 */

export interface IdentityParam {
  /** Base64-encoded PKCS8 DER private key */
  privateKey: string;
  /** Base64-encoded SPKI DER public key */
  publicKey: string;
}

export interface RemoteVaultConfig {
  type: string;
  broker?: string;
  network?: string;
  /** Vault ID (MCP upstream id on broker) */
  vault?: string;
  /** Agent's identity (required for remote operations) */
  identity: IdentityParam;
  [key: string]: unknown;
}

export interface ShareOptions {
  withAgent: string;
  permission?: 'read' | 'readwrite';
  durationHours?: number;
  maxReads?: number;
}

export interface ShareResult {
  expiresAt: number;
}

export interface SharedSecret {
  key: string;
  fromAgent: string;
  fromAgentName?: string;
  permission: 'read' | 'readwrite';
  expiresAt: number;
}

export interface ResolvedAgent {
  displayName: string;
  agentId: string;
  publicKey: string;
}

export interface AuditLogEntry {
  timestamp: number;
  agentKey: string;
  secretName?: string;
  action: string;
  fromAgent?: string;
  success: boolean;
  reason?: string;
}

export interface AuditLogFilter {
  secretName?: string;
  action?: string;
  sinceUnix?: number;
  limit?: number;
  mySecretsOnly?: boolean;
}

export interface HealthStatus {
  healthy: boolean;
  message: string;
  details?: Record<string, unknown>;
}

export interface RemoteVaultProvider {
  readonly type: string;
  connect(config: RemoteVaultConfig): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  healthCheck(): Promise<HealthStatus>;
  get(key: string, fromAgent?: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  list(): Promise<string[]>;
  exists(key: string): Promise<boolean>;
  share?(key: string, options: ShareOptions): Promise<ShareResult>;
  revoke?(key: string, fromAgent: string): Promise<void>;
  listShared?(): Promise<SharedSecret[]>;
  getShared?(key: string): Promise<{ value: string; fromAgent: string }>;
  resolveAgent?(name: string): Promise<ResolvedAgent>;
  listAuditLogs?(filter?: AuditLogFilter): Promise<AuditLogEntry[]>;
}
