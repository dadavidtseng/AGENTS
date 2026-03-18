/**
 * Tool Registration — 23 tools for secret management
 *
 * Categories:
 *   Config:  config.read, config.createVault, config.destroyVault
 *   Import:  vault.fromJson, vault.fromEnv
 *   Local:   get, set, list, delete, exists
 *   Crypto:  encrypt, decrypt, key.init, key.delete
 *   Remote:  remote.get, remote.set, remote.list, remote.delete
 *   Share:   remote.share, remote.revoke, remote.listShared, remote.getShared
 *   Audit:   remote.auditLogs
 */

import { z } from 'zod';
import type { KadiClient } from '@kadi.build/core';
import {
  readConfig,
  writeConfig,
  getVault,
  hasVault,
  createVault,
  destroyVault,
  getSecretsSection,
  setSecret,
  deleteSecret,
  hasSecret,
  listSecrets,
} from './local/index.js';
import {
  encrypt,
  decrypt,
  isEncrypted,
  initMasterKey,
  loadMasterKey,
  requireMasterKey,
  removeMasterKey,
  masterKeyExists,
} from './local/encryption.js';
import { getProvider } from './providers/index.js';
import type { RemoteVaultConfig, IdentityParam } from './providers/types.js';

// Default config path
const DEFAULT_CONFIG = 'secrets.toml';

// Helper: register a tool with proper typing
function reg(
  client: KadiClient,
  name: string,
  description: string,
  input: z.ZodType<any>,
  handler: (params: any) => Promise<unknown>
) {
  (client as any).registerTool({ name, description, input }, handler);
}

export function registerTools(client: KadiClient): void {
  // ════════════════════════════════════════════════════════════════════
  // Config Tools
  // ════════════════════════════════════════════════════════════════════

  reg(client, 'config.read', 'Read the secrets config file. Returns vault definitions and secret keys (not values).', z.object({
    config: z.string().default(DEFAULT_CONFIG).describe('Path to secrets.toml'),
  }), async (p) => {
    const cfg = await readConfig(p.config);
    return {
      vaults: cfg.vaults,
      secrets: Object.fromEntries(
        Object.entries(cfg.secrets).map(([v, s]) => [v, Object.keys(s)])
      ),
    };
  });

  reg(client, 'config.createVault', 'Create a new vault in the config.', z.object({
    config: z.string().default(DEFAULT_CONFIG),
    name: z.string().describe('Vault name'),
    type: z.enum(['age', 'kadi']).describe('Vault type'),
    broker: z.string().optional().describe('Broker URL (kadi type)'),
    network: z.string().optional().describe('Network name (kadi type)'),
  }), async (p) => {
    const cfg = await readConfig(p.config);
    createVault(cfg, p.name, { type: p.type, broker: p.broker, network: p.network });
    if (p.type === 'age') {
      await initMasterKey(p.config);
    }
    await writeConfig(p.config, cfg);
    return { success: true, vault: p.name, type: p.type };
  });

  reg(client, 'config.destroyVault', 'Destroy a vault and all its secrets.', z.object({
    config: z.string().default(DEFAULT_CONFIG),
    name: z.string().describe('Vault name'),
    deleteMasterKey: z.boolean().default(false).describe('Also delete the master key from keychain'),
  }), async (p) => {
    const cfg = await readConfig(p.config);
    const vault = getVault(cfg, p.name);
    destroyVault(cfg, p.name);
    if (p.deleteMasterKey && vault.type === 'age') {
      await removeMasterKey(p.config);
    }
    await writeConfig(p.config, cfg);
    return { success: true, destroyed: p.name };
  });

  // ════════════════════════════════════════════════════════════════════
  // Import Tools
  // ════════════════════════════════════════════════════════════════════

  reg(client, 'vault.fromJson', 'Import secrets from a JSON object into a vault.', z.object({
    config: z.string().default(DEFAULT_CONFIG),
    vault: z.string().describe('Target vault name'),
    secrets: z.record(z.string(), z.string()).describe('Key-value pairs to import'),
  }), async (p) => {
    const cfg = await readConfig(p.config);
    getVault(cfg, p.vault); // validate exists
    const key = await requireMasterKey(p.config);
    let count = 0;
    for (const [k, v] of Object.entries(p.secrets as Record<string, string>)) {
      const enc = encrypt(v, key);
      setSecret(cfg, p.vault, k, enc);
      count++;
    }
    await writeConfig(p.config, cfg);
    return { success: true, imported: count };
  });

  reg(client, 'vault.fromEnv', 'Import secrets from a .env file into a vault.', z.object({
    config: z.string().default(DEFAULT_CONFIG),
    vault: z.string().describe('Target vault name'),
    envFile: z.string().default('.env').describe('Path to .env file'),
    prefix: z.string().optional().describe('Only import keys with this prefix'),
  }), async (p) => {
    const cfg = await readConfig(p.config);
    getVault(cfg, p.vault);
    const key = await requireMasterKey(p.config);

    const fs = await import('node:fs/promises');
    const content = await fs.readFile(p.envFile, 'utf-8');
    let count = 0;
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx < 1) continue;
      const envKey = trimmed.slice(0, eqIdx).trim();
      const envVal = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
      if (p.prefix && !envKey.startsWith(p.prefix)) continue;
      const enc = encrypt(envVal, key);
      setSecret(cfg, p.vault, envKey, enc);
      count++;
    }
    await writeConfig(p.config, cfg);
    return { success: true, imported: count, source: p.envFile };
  });

  // ════════════════════════════════════════════════════════════════════
  // Local CRUD Tools
  // ════════════════════════════════════════════════════════════════════

  reg(client, 'get', 'Get a decrypted secret value from a local vault.', z.object({
    config: z.string().default(DEFAULT_CONFIG),
    vault: z.string().describe('Vault name'),
    key: z.string().describe('Secret key'),
  }), async (p) => {
    const cfg = await readConfig(p.config);
    getVault(cfg, p.vault);
    const section = getSecretsSection(cfg, p.vault);
    const raw = section[p.key];
    if (raw === undefined) return { found: false, key: p.key };
    if (!isEncrypted(raw)) return { found: true, key: p.key, value: String(raw) };
    const masterKey = await requireMasterKey(p.config);
    const value = decrypt(raw as string, masterKey);
    return { found: true, key: p.key, value };
  });

  reg(client, 'set', 'Set an encrypted secret in a local vault.', z.object({
    config: z.string().default(DEFAULT_CONFIG),
    vault: z.string().describe('Vault name'),
    key: z.string().describe('Secret key'),
    value: z.string().describe('Secret value (will be encrypted)'),
  }), async (p) => {
    const cfg = await readConfig(p.config);
    getVault(cfg, p.vault);
    const masterKey = await requireMasterKey(p.config);
    const enc = encrypt(p.value, masterKey);
    setSecret(cfg, p.vault, p.key, enc);
    await writeConfig(p.config, cfg);
    return { success: true, key: p.key };
  });

  reg(client, 'list', 'List all secret keys in a vault (no values).', z.object({
    config: z.string().default(DEFAULT_CONFIG),
    vault: z.string().describe('Vault name'),
  }), async (p) => {
    const cfg = await readConfig(p.config);
    getVault(cfg, p.vault);
    const keys = listSecrets(cfg, p.vault);
    return { vault: p.vault, keys, count: keys.length };
  });

  reg(client, 'delete', 'Delete a secret from a local vault.', z.object({
    config: z.string().default(DEFAULT_CONFIG),
    vault: z.string().describe('Vault name'),
    key: z.string().describe('Secret key'),
  }), async (p) => {
    const cfg = await readConfig(p.config);
    getVault(cfg, p.vault);
    const deleted = deleteSecret(cfg, p.vault, p.key);
    if (!deleted) return { success: false, error: `Secret '${p.key}' not found` };
    await writeConfig(p.config, cfg);
    return { success: true, key: p.key };
  });

  reg(client, 'exists', 'Check if a secret exists in a vault.', z.object({
    config: z.string().default(DEFAULT_CONFIG),
    vault: z.string().describe('Vault name'),
    key: z.string().describe('Secret key'),
  }), async (p) => {
    const cfg = await readConfig(p.config);
    return { exists: hasSecret(cfg, p.vault, p.key) };
  });

  // ════════════════════════════════════════════════════════════════════
  // Crypto Tools
  // ════════════════════════════════════════════════════════════════════

  reg(client, 'encrypt', 'Encrypt a plaintext value using the vault master key.', z.object({
    config: z.string().default(DEFAULT_CONFIG),
    value: z.string().describe('Plaintext to encrypt'),
  }), async (p) => {
    const key = await requireMasterKey(p.config);
    return { encrypted: encrypt(p.value, key) };
  });

  reg(client, 'decrypt', 'Decrypt an ENC[...] value using the vault master key.', z.object({
    config: z.string().default(DEFAULT_CONFIG),
    value: z.string().describe('ENC[...] ciphertext'),
  }), async (p) => {
    if (!isEncrypted(p.value)) return { error: 'Value is not in ENC[...] format' };
    const key = await requireMasterKey(p.config);
    return { decrypted: decrypt(p.value, key) };
  });

  reg(client, 'key.init', 'Initialize a master key for a config file. Stored in OS keychain.', z.object({
    config: z.string().default(DEFAULT_CONFIG),
  }), async (p) => {
    if (await masterKeyExists(p.config)) {
      return { success: false, error: 'Master key already exists' };
    }
    await initMasterKey(p.config);
    return { success: true, message: 'Master key created and stored in keychain' };
  });

  reg(client, 'key.delete', 'Delete the master key for a config file. WARNING: secrets become unrecoverable.', z.object({
    config: z.string().default(DEFAULT_CONFIG),
    confirm: z.literal(true).describe('Must be true to confirm deletion'),
  }), async (p) => {
    await removeMasterKey(p.config);
    return { success: true, message: 'Master key deleted' };
  });

  // ════════════════════════════════════════════════════════════════════
  // Remote CRUD Tools
  // ════════════════════════════════════════════════════════════════════

  const remoteVaultInput = z.object({
    config: z.string().default(DEFAULT_CONFIG),
    vault: z.string().describe('Remote vault name'),
    identity: z.object({
      privateKey: z.string().describe('Base64 PKCS8 DER private key'),
      publicKey: z.string().describe('Base64 SPKI DER public key'),
    }).describe('Agent identity for E2E encryption'),
  });

  async function getRemoteProvider(p: { config: string; vault: string; identity: IdentityParam }) {
    const cfg = await readConfig(p.config);
    const vault = getVault(cfg, p.vault);
    if (vault.type !== 'kadi') throw new Error(`Vault '${p.vault}' is not a remote vault (type: ${vault.type})`);
    return getProvider(p.vault, { ...vault, identity: p.identity });
  }

  reg(client, 'remote.get', 'Get a secret from a remote vault (E2E decrypted).', remoteVaultInput.extend({
    key: z.string().describe('Secret key'),
  }), async (p) => {
    const provider = await getRemoteProvider(p);
    const value = await provider.get(p.key);
    if (value === null) return { found: false, key: p.key };
    return { found: true, key: p.key, value };
  });

  reg(client, 'remote.set', 'Set a secret in a remote vault (E2E encrypted).', remoteVaultInput.extend({
    key: z.string().describe('Secret key'),
    value: z.string().describe('Secret value'),
  }), async (p) => {
    const provider = await getRemoteProvider(p);
    await provider.set(p.key, p.value);
    return { success: true, key: p.key };
  });

  reg(client, 'remote.list', 'List secret keys in a remote vault.', remoteVaultInput, async (p) => {
    const provider = await getRemoteProvider(p);
    const keys = await provider.list();
    return { vault: p.vault, keys, count: keys.length };
  });

  reg(client, 'remote.delete', 'Delete a secret from a remote vault.', remoteVaultInput.extend({
    key: z.string().describe('Secret key'),
  }), async (p) => {
    const provider = await getRemoteProvider(p);
    await provider.delete(p.key);
    return { success: true, key: p.key };
  });

  // ════════════════════════════════════════════════════════════════════
  // Sharing Tools
  // ════════════════════════════════════════════════════════════════════

  reg(client, 'remote.share', 'Share a secret with another agent (E2E encrypted for recipient).', remoteVaultInput.extend({
    key: z.string().describe('Secret key to share'),
    withAgent: z.string().describe('Target agent name or ID'),
    permission: z.enum(['read', 'readwrite']).default('read'),
    durationHours: z.number().optional().describe('Auto-expire after N hours'),
    maxReads: z.number().optional().describe('Max read count before auto-revoke'),
  }), async (p) => {
    const provider = await getRemoteProvider(p);
    if (!provider.share) throw new Error('Provider does not support sharing');
    const result = await provider.share(p.key, {
      withAgent: p.withAgent,
      permission: p.permission,
      durationHours: p.durationHours,
      maxReads: p.maxReads,
    });
    return { success: true, key: p.key, sharedWith: p.withAgent, expiresAt: result.expiresAt };
  });

  reg(client, 'remote.revoke', 'Revoke a previously shared secret.', remoteVaultInput.extend({
    key: z.string().describe('Secret key'),
    fromAgent: z.string().describe('Agent to revoke access from'),
  }), async (p) => {
    const provider = await getRemoteProvider(p);
    if (!provider.revoke) throw new Error('Provider does not support revocation');
    await provider.revoke(p.key, p.fromAgent);
    return { success: true, key: p.key, revokedFrom: p.fromAgent };
  });

  reg(client, 'remote.listShared', 'List secrets shared with this agent.', remoteVaultInput, async (p) => {
    const provider = await getRemoteProvider(p);
    if (!provider.listShared) throw new Error('Provider does not support listing shared secrets');
    const shared = await provider.listShared();
    return { shared, count: shared.length };
  });

  reg(client, 'remote.getShared', 'Get a secret shared by another agent (E2E decrypted).', remoteVaultInput.extend({
    key: z.string().describe('Shared secret key'),
  }), async (p) => {
    const provider = await getRemoteProvider(p);
    if (!provider.getShared) throw new Error('Provider does not support getting shared secrets');
    const result = await provider.getShared(p.key);
    return { found: true, key: p.key, value: result.value, fromAgent: result.fromAgent };
  });

  // ════════════════════════════════════════════════════════════════════
  // Audit Tools
  // ════════════════════════════════════════════════════════════════════

  reg(client, 'remote.auditLogs', 'Retrieve audit logs for a remote vault.', remoteVaultInput.extend({
    secretName: z.string().optional().describe('Filter by secret name'),
    action: z.string().optional().describe('Filter by action (get, set, delete, share, revoke)'),
    sinceUnix: z.number().optional().describe('Only logs after this Unix timestamp'),
    limit: z.number().default(50).describe('Max entries to return'),
    mySecretsOnly: z.boolean().default(false).describe('Only show logs for own secrets'),
  }), async (p) => {
    const provider = await getRemoteProvider(p);
    if (!provider.listAuditLogs) throw new Error('Provider does not support audit logs');
    const logs = await provider.listAuditLogs({
      secretName: p.secretName,
      action: p.action,
      sinceUnix: p.sinceUnix,
      limit: p.limit,
      mySecretsOnly: p.mySecretsOnly,
    });
    return { logs, count: logs.length };
  });

} // end registerTools