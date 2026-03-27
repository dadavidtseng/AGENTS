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
  // Future backends will add their own fields
  [key: string]: unknown;
}

export interface ShareOptions {
  withAgent: string;  // Recipient's public key (base64 SPKI DER)
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
  /** Unix timestamp when the action occurred */
  timestamp: number;
  /** Namespace of the agent who performed the action */
  agentKey: string;
  /** Name of the secret accessed */
  secretName?: string;
  /** Action performed: read, write, delete, share, revoke, list */
  action: string;
  /** For shared access: namespace of the secret owner */
  fromAgent?: string;
  /** Whether the operation succeeded */
  success: boolean;
  /** Failure reason (e.g., 'usage_limit_exceeded') */
  reason?: string;
}

export interface AuditLogFilter {
  /** Filter by secret name */
  secretName?: string;
  /** Filter by action type */
  action?: string;
  /** Only logs after this Unix timestamp */
  sinceUnix?: number;
  /** Maximum number of logs to return */
  limit?: number;
  /** If true, shows logs for secrets you own that others accessed */
  mySecretsOnly?: boolean;
}

export interface HealthStatus {
  healthy: boolean;
  message: string;
  details?: Record<string, unknown>;
}

/**
 * Remote Vault Provider Interface
 *
 * Implementations:
 * - KadiRemoteProvider: KADI broker-based secrets (E2E encrypted)
 * - AwsRemoteProvider: AWS Secrets Manager (future)
 * - HashiCorpRemoteProvider: HashiCorp Vault (future)
 */
export interface RemoteVaultProvider {
  /** Provider type identifier (e.g., 'kadi', 'aws', 'hashicorp') */
  readonly type: string;

  /** Connect to the remote backend */
  connect(config: RemoteVaultConfig): Promise<void>;

  /** Disconnect from the remote backend */
  disconnect(): Promise<void>;

  /** Check if currently connected */
  isConnected(): boolean;

  /** Check backend health/connectivity */
  healthCheck(): Promise<HealthStatus>;

  // ---------------------------------------------------------------------------
  // Core CRUD Operations
  // ---------------------------------------------------------------------------

  /** Get a secret value. Use fromAgent for shared secrets. */
  get(key: string, fromAgent?: string): Promise<string | null>;

  /** Set a secret value */
  set(key: string, value: string): Promise<void>;

  /** Delete a secret */
  delete(key: string): Promise<void>;

  /** List all secret keys */
  list(): Promise<string[]>;

  /** Check if a secret exists */
  exists(key: string): Promise<boolean>;

  // ---------------------------------------------------------------------------
  // Sharing Operations (optional - not all backends support sharing)
  // ---------------------------------------------------------------------------

  /** Share a secret with another agent */
  share?(key: string, options: ShareOptions): Promise<ShareResult>;

  /** Revoke a shared secret */
  revoke?(key: string, fromAgent: string): Promise<void>;

  /** List secrets shared with this agent */
  listShared?(): Promise<SharedSecret[]>;

  /** Get a shared secret by name (errors if ambiguous) */
  getShared?(key: string): Promise<{ value: string; fromAgent: string }>;

  /** Resolve agent display name to public key */
  resolveAgent?(name: string): Promise<ResolvedAgent>;

  /** List audit logs for secret access */
  listAuditLogs?(filter?: AuditLogFilter): Promise<AuditLogEntry[]>;
}
