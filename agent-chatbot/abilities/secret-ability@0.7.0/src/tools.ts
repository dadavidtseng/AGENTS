/**
 * Secret Ability - TOML-based vault system
 *
 * Tools available:
 * - Config: config.read, config.createVault, config.destroyVault
 * - Batch: vault.fromJson, vault.fromEnv
 * - Local secrets: get, set, list, delete, exists
 * - Encryption: encrypt, decrypt, key.init, key.delete
 * - Remote secrets: remote.get, remote.set, remote.list, remote.delete
 * - Remote sharing: remote.share, remote.revoke, remote.listShared, remote.getShared
 * - Remote audit: remote.auditLogs
 *
 * These tools work with TOML config files (secrets.toml).
 *
 * Architecture:
 * - Local (age) vaults: File I/O + encryption, no provider needed
 * - Remote (kadi) vaults: Use RemoteVaultProvider interface
 */

import { KadiClient, z } from '@kadi.build/core';
import {
  readConfig,
  writeConfig,
  getVault,
  createVault,
  destroyVault,
  getSecretsSection,
  setSecret,
  deleteSecret,
  hasSecret,
  listSecrets,
  type VaultEntry,
} from './local/config.js';
import {
  encrypt,
  decrypt,
  isEncrypted,
  initMasterKey,
  removeMasterKey,
  requireMasterKey,
  masterKeyExists,
} from './local/encryption.js';
import { getRemoteProvider } from './providers/index.js';

// =============================================================================
// Schemas
// =============================================================================

/** Vault type: local (age) or remote (kadi) */
const vaultTypeSchema = z.enum(['age', 'kadi']);

/** Options for creating a remote vault */
const remoteVaultOptionsSchema = z.object({
  broker: z.string().describe('Broker WebSocket URL'),
  network: z.string().describe('Network name on the broker'),
});

/** Identity for remote operations */
const identitySchema = z.object({
  privateKey: z.string().describe('Base64-encoded PKCS8 DER private key'),
  publicKey: z.string().describe('Base64-encoded SPKI DER public key'),
});

/** Vault entry in config */
const vaultEntrySchema = z.object({
  type: vaultTypeSchema,
  broker: z.string().optional(),
  network: z.string().optional(),
});

/** Full config structure */
const configSchema = z.object({
  vaults: z.record(z.string(), vaultEntrySchema),
  secrets: z.record(z.string(), z.record(z.string(), z.unknown())),
});

// Types for future use
export type Config = z.infer<typeof configSchema>;
export type VaultType = z.infer<typeof vaultTypeSchema>;

// =============================================================================
// Constants
// =============================================================================

/** Default config file path (project-level) */
const DEFAULT_CONFIG_PATH = './secrets.toml';

// =============================================================================
// Helper functions
// =============================================================================

/**
 * Resolve config path, using default if not provided.
 */
function resolveConfigPath(configPath?: string): string {
  return configPath ?? DEFAULT_CONFIG_PATH;
}

function requireAgeVault(vault: VaultEntry, vaultName: string): void {
  if (vault.type !== 'age') {
    throw new Error(
      `Vault '${vaultName}' is type '${vault.type}', not 'age'. ` +
        `Use v2.remote.* tools for remote vaults.`
    );
  }
}

function requireKadiVault(vault: VaultEntry, vaultName: string): void {
  if (vault.type !== 'kadi') {
    throw new Error(
      `Vault '${vaultName}' is type '${vault.type}', not 'kadi'. ` +
        `Use v2.* tools for local vaults.`
    );
  }
}

interface CreateAgeVaultResult {
  config: Awaited<ReturnType<typeof readConfig>>;
  masterKey: Buffer;
  configPath: string;
}

/**
 * Shared setup for creating an age vault with secrets.
 * Handles config reading, vault creation, and master key initialization.
 */
async function createAgeVaultWithSecrets(
  configPathInput: string | undefined,
  vaultName: string
): Promise<CreateAgeVaultResult> {
  const configPath = resolveConfigPath(configPathInput);
  const config = await readConfig(configPath);

  // Create the vault (throws if it already exists)
  createVault(config, vaultName, { type: 'age' });

  // Initialize master key if needed
  if (!(await masterKeyExists(configPath))) {
    await initMasterKey(configPath);
  }

  const masterKey = await requireMasterKey(configPath);
  return { config, masterKey, configPath };
}


// =============================================================================
// Register v2 tools
// =============================================================================

export function registerTools(client: KadiClient): void {
  // ===========================================================================
  // Config Operations
  // ===========================================================================

  /**
   * config.read - Read and parse the TOML config file
   */
  client.registerTool(
    {
      name: 'config.read',
      description: 'Read and parse a secrets TOML config file',
      input: z.object({
        configPath: z.string().optional().describe('Path to config file (default: ./secrets.toml)'),
      }),
    },
    async (params) => {
      const configPath = resolveConfigPath(params.configPath);
      const config = await readConfig(configPath);
      return { vaults: config.vaults, secrets: config.secrets };
    }
  );

  /**
   * config.createVault - Add a new vault to the config
   */
  client.registerTool(
    {
      name: 'config.createVault',
      description:
        "Add a new vault to the config file. Creates the file if it doesn't exist.",
      input: z.object({
        configPath: z.string().optional().describe('Path to config file (default: ./secrets.toml)'),
        name: z.string().describe('Vault name (must be unique)'),
        type: vaultTypeSchema.describe('Vault type: "age" for local, "kadi" for remote'),
        options: remoteVaultOptionsSchema.optional().describe('Required for kadi vaults'),
      }),
    },
    async (params) => {
      const configPath = resolveConfigPath(params.configPath);
      const config = await readConfig(configPath);

      // Build vault entry
      const entry: VaultEntry = { type: params.type };
      if (params.type === 'kadi') {
        if (!params.options) {
          throw new Error('Kadi vault requires options (broker, network)');
        }
        entry.broker = params.options.broker;
        entry.network = params.options.network;
      }

      createVault(config, params.name, entry);

      // For age vaults, initialize master key if not exists
      if (params.type === 'age' && !(await masterKeyExists(configPath))) {
        await initMasterKey(configPath);
      }

      await writeConfig(configPath, config);
      return { vault: params.name, type: params.type };
    }
  );

  /**
   * config.destroyVault - Remove a vault from the config
   */
  client.registerTool(
    {
      name: 'config.destroyVault',
      description: 'Remove a vault and all its secrets from the config file',
      input: z.object({
        configPath: z.string().optional().describe('Path to config file (default: ./secrets.toml)'),
        name: z.string().describe('Vault name to remove'),
      }),
    },
    async (params) => {
      const configPath = resolveConfigPath(params.configPath);
      const config = await readConfig(configPath);
      const vault = getVault(config, params.name);
      const wasAge = vault.type === 'age';

      destroyVault(config, params.name);
      await writeConfig(configPath, config);

      // Clean up master key if no age vaults remain
      if (wasAge) {
        const hasAgeVaults = Object.values(config.vaults).some((v) => v.type === 'age');
        if (!hasAgeVaults) {
          await removeMasterKey(configPath);
        }
      }

      return { removed: params.name };
    }
  );

  /**
   * vault.fromJson - Create an age vault and populate it with secrets in one step
   */
  client.registerTool(
    {
      name: 'vault.fromJson',
      description:
        'Create a new local (age) vault and store multiple secrets in it. ' +
        'Errors if the vault already exists.',
      input: z.object({
        configPath: z.string().optional().describe('Path to config file (default: ./secrets.toml)'),
        name: z.string().describe('Vault name to create (must be unique)'),
        secrets: z.record(z.string(), z.string()).describe('Key-value pairs of secrets (plaintext values)'),
      }),
    },
    async (params) => {
      const { config, masterKey, configPath } = await createAgeVaultWithSecrets(
        params.configPath,
        params.name
      );

      for (const [key, value] of Object.entries(params.secrets)) {
        const encValue = encrypt(value, masterKey);
        setSecret(config, params.name, key, encValue);
      }

      await writeConfig(configPath, config);
      return { vault: params.name, count: Object.keys(params.secrets).length };
    }
  );

  /**
   * vault.fromEnv - Create an age vault from environment variables
   */
  client.registerTool(
    {
      name: 'vault.fromEnv',
      description:
        'Create a new local (age) vault and store secrets read from environment variables. ' +
        'Errors if the vault already exists or if any environment variable is not set.',
      input: z.object({
        configPath: z.string().optional().describe('Path to config file (default: ./secrets.toml)'),
        name: z.string().describe('Vault name to create (must be unique)'),
        keys: z.array(z.string()).describe('Environment variable names to read'),
      }),
    },
    async (params) => {
      const { config, masterKey, configPath } = await createAgeVaultWithSecrets(
        params.configPath,
        params.name
      );

      for (const key of params.keys) {
        const value = process.env[key];
        if (value === undefined) {
          throw new Error(`Environment variable '${key}' is not set`);
        }
        const encValue = encrypt(value, masterKey);
        setSecret(config, params.name, key, encValue);
      }

      await writeConfig(configPath, config);
      return { vault: params.name, count: params.keys.length };
    }
  );

  // ===========================================================================
  // Local Secret Operations (age vaults)
  // ===========================================================================

  /**
   * v2.get - Get a secret from a local vault
   */
  client.registerTool(
    {
      name: 'get',
      description: 'Get a secret value from a local (age) vault',
      input: z.object({
        configPath: z.string().optional().describe('Path to config file (default: ./secrets.toml)'),
        vault: z.string().describe('Vault name'),
        key: z.string().describe('Secret key'),
      }),
    },
    async (params) => {
      const configPath = resolveConfigPath(params.configPath);
      const config = await readConfig(configPath);
      const vault = getVault(config, params.vault);
      requireAgeVault(vault, params.vault);

      const secrets = getSecretsSection(config, params.vault);
      const encValue = secrets[params.key];

      if (encValue === undefined) {
        throw new Error(`Secret '${params.key}' not found in vault '${params.vault}'`);
      }
      if (!isEncrypted(encValue)) {
        throw new Error(`Secret '${params.key}' is not encrypted (expected ENC[...] format)`);
      }

      const masterKey = await requireMasterKey(configPath);
      const plaintext = decrypt(encValue, masterKey);
      return { value: plaintext };
    }
  );

  /**
   * v2.set - Set a secret in a local vault
   */
  client.registerTool(
    {
      name: 'set',
      description: 'Set a secret value in a local (age) vault',
      input: z.object({
        configPath: z.string().optional().describe('Path to config file (default: ./secrets.toml)'),
        vault: z.string().describe('Vault name'),
        key: z.string().describe('Secret key'),
        value: z.string().describe('Secret value (plaintext)'),
      }),
    },
    async (params) => {
      const configPath = resolveConfigPath(params.configPath);
      const config = await readConfig(configPath);
      const vault = getVault(config, params.vault);
      requireAgeVault(vault, params.vault);

      const masterKey = await requireMasterKey(configPath);
      const encValue = encrypt(params.value, masterKey);

      setSecret(config, params.vault, params.key, encValue);
      await writeConfig(configPath, config);
      return {};
    }
  );

  /**
   * v2.list - List secrets in a local vault
   */
  client.registerTool(
    {
      name: 'list',
      description: 'List all secret keys in a local (age) vault',
      input: z.object({
        configPath: z.string().optional().describe('Path to config file (default: ./secrets.toml)'),
        vault: z.string().describe('Vault name'),
      }),
    },
    async (params) => {
      const configPath = resolveConfigPath(params.configPath);
      const config = await readConfig(configPath);
      const vault = getVault(config, params.vault);
      requireAgeVault(vault, params.vault);

      const keys = listSecrets(config, params.vault);
      return { keys };
    }
  );

  /**
   * v2.delete - Delete a secret from a local vault
   */
  client.registerTool(
    {
      name: 'delete',
      description: 'Delete a secret from a local (age) vault',
      input: z.object({
        configPath: z.string().optional().describe('Path to config file (default: ./secrets.toml)'),
        vault: z.string().describe('Vault name'),
        key: z.string().describe('Secret key to delete'),
      }),
    },
    async (params) => {
      const configPath = resolveConfigPath(params.configPath);
      const config = await readConfig(configPath);
      const vault = getVault(config, params.vault);
      requireAgeVault(vault, params.vault);

      const deleted = deleteSecret(config, params.vault, params.key);
      if (!deleted) {
        throw new Error(`Secret '${params.key}' not found in vault '${params.vault}'`);
      }

      await writeConfig(configPath, config);
      return {};
    }
  );

  /**
   * v2.exists - Check if a secret exists in a local vault
   */
  client.registerTool(
    {
      name: 'exists',
      description: 'Check if a secret exists in a local (age) vault',
      input: z.object({
        configPath: z.string().optional().describe('Path to config file (default: ./secrets.toml)'),
        vault: z.string().describe('Vault name'),
        key: z.string().describe('Secret key'),
      }),
    },
    async (params) => {
      const configPath = resolveConfigPath(params.configPath);
      const config = await readConfig(configPath);
      const vault = getVault(config, params.vault);
      requireAgeVault(vault, params.vault);

      const exists = hasSecret(config, params.vault, params.key);
      return { exists };
    }
  );

  // ===========================================================================
  // Encryption Primitives
  // ===========================================================================

  /**
   * v2.encrypt - Encrypt a plaintext value to ENC[...] format
   */
  client.registerTool(
    {
      name: 'encrypt',
      description: 'Encrypt a plaintext value using the master key for the given config',
      input: z.object({
        configPath: z.string().optional().describe('Path to config file (default: ./secrets.toml)'),
        plaintext: z.string().describe('Value to encrypt'),
      }),
    },
    async (params) => {
      const configPath = resolveConfigPath(params.configPath);
      const masterKey = await requireMasterKey(configPath);
      const encValue = encrypt(params.plaintext, masterKey);
      return { ciphertext: encValue };
    }
  );

  /**
   * v2.decrypt - Decrypt an ENC[...] value to plaintext
   */
  client.registerTool(
    {
      name: 'decrypt',
      description: 'Decrypt an ENC[...] value using the master key for the given config',
      input: z.object({
        configPath: z.string().optional().describe('Path to config file (default: ./secrets.toml)'),
        ciphertext: z.string().describe('ENC[...] value to decrypt'),
      }),
    },
    async (params) => {
      if (!isEncrypted(params.ciphertext)) {
        throw new Error('Value is not in ENC[...] format');
      }

      const configPath = resolveConfigPath(params.configPath);
      const masterKey = await requireMasterKey(configPath);
      const plaintext = decrypt(params.ciphertext, masterKey);
      return { plaintext };
    }
  );

  /**
   * v2.key.init - Initialize master key for a config file
   */
  client.registerTool(
    {
      name: 'key.init',
      description: 'Create a new master key in the OS keychain for the given config file',
      input: z.object({
        configPath: z.string().optional().describe('Path to config file (default: ./secrets.toml)'),
      }),
    },
    async (params) => {
      const configPath = resolveConfigPath(params.configPath);
      await initMasterKey(configPath);
      return {};
    }
  );

  /**
   * v2.key.delete - Delete master key for a config file
   */
  client.registerTool(
    {
      name: 'key.delete',
      description: 'Delete the master key from the OS keychain for the given config file',
      input: z.object({
        configPath: z.string().optional().describe('Path to config file (default: ./secrets.toml)'),
      }),
    },
    async (params) => {
      const configPath = resolveConfigPath(params.configPath);
      await removeMasterKey(configPath);
      return {};
    }
  );

  // ===========================================================================
  // Remote Secret Operations (kadi vaults)
  // ===========================================================================

  /**
   * v2.remote.get - Get a secret from a remote vault
   */
  client.registerTool(
    {
      name: 'remote.get',
      description:
        'Get a secret from a remote (kadi) vault. Use fromAgent to get a shared secret.',
      input: z.object({
        configPath: z.string().optional().describe('Path to config file (default: ./secrets.toml)'),
        vault: z.string().describe('Vault name'),
        key: z.string().describe('Secret key'),
        identity: identitySchema.describe('Agent identity for authentication'),
        fromAgent: z
          .string()
          .optional()
          .describe('Public key of agent who shared (omit for own secrets)'),
      }),
    },
    async (params) => {
      const configPath = resolveConfigPath(params.configPath);
      const config = await readConfig(configPath);
      const vault = getVault(config, params.vault);
      requireKadiVault(vault, params.vault);

      const provider = await getRemoteProvider({
        type: vault.type,
        broker: vault.broker,
        network: vault.network,
        vault: params.vault,
        identity: params.identity,
      });

      const value = await provider.get(params.key, params.fromAgent);
      if (value === null) {
        throw new Error(`Secret '${params.key}' not found`);
      }

      return { value };
    }
  );

  /**
   * v2.remote.set - Set a secret in a remote vault
   */
  client.registerTool(
    {
      name: 'remote.set',
      description: 'Set a secret in a remote (kadi) vault (E2E encrypted)',
      input: z.object({
        configPath: z.string().optional().describe('Path to config file (default: ./secrets.toml)'),
        vault: z.string().describe('Vault name'),
        key: z.string().describe('Secret key'),
        value: z.string().describe('Secret value (plaintext, encrypted before sending)'),
        identity: identitySchema.describe('Agent identity for authentication'),
      }),
    },
    async (params) => {
      const configPath = resolveConfigPath(params.configPath);
      const config = await readConfig(configPath);
      const vault = getVault(config, params.vault);
      requireKadiVault(vault, params.vault);

      const provider = await getRemoteProvider({
        type: vault.type,
        broker: vault.broker,
        network: vault.network,
        vault: params.vault,
        identity: params.identity,
      });

      await provider.set(params.key, params.value);

      // Track secret name locally (true = exists remotely, value is on broker)
      setSecret(config, params.vault, params.key, true);
      await writeConfig(configPath, config);
      return {};
    }
  );

  /**
   * v2.remote.list - List secrets in a remote vault
   */
  client.registerTool(
    {
      name: 'remote.list',
      description: 'List all secret keys in a remote (kadi) vault',
      input: z.object({
        configPath: z.string().optional().describe('Path to config file (default: ./secrets.toml)'),
        vault: z.string().describe('Vault name'),
        identity: identitySchema.describe('Agent identity for authentication'),
      }),
    },
    async (params) => {
      const configPath = resolveConfigPath(params.configPath);
      const config = await readConfig(configPath);
      const vault = getVault(config, params.vault);
      requireKadiVault(vault, params.vault);

      const provider = await getRemoteProvider({
        type: vault.type,
        broker: vault.broker,
        network: vault.network,
        vault: params.vault,
        identity: params.identity,
      });

      const keys = await provider.list();
      return { keys };
    }
  );

  /**
   * v2.remote.delete - Delete a secret from a remote vault
   */
  client.registerTool(
    {
      name: 'remote.delete',
      description: 'Delete a secret from a remote (kadi) vault (also revokes all shares)',
      input: z.object({
        configPath: z.string().optional().describe('Path to config file (default: ./secrets.toml)'),
        vault: z.string().describe('Vault name'),
        key: z.string().describe('Secret key to delete'),
        identity: identitySchema.describe('Agent identity for authentication'),
      }),
    },
    async (params) => {
      const configPath = resolveConfigPath(params.configPath);
      const config = await readConfig(configPath);
      const vault = getVault(config, params.vault);
      requireKadiVault(vault, params.vault);

      const provider = await getRemoteProvider({
        type: vault.type,
        broker: vault.broker,
        network: vault.network,
        vault: params.vault,
        identity: params.identity,
      });

      await provider.delete(params.key);

      // Remove from local tracking
      deleteSecret(config, params.vault, params.key);
      await writeConfig(configPath, config);
      return {};
    }
  );

  /**
   * v2.remote.share - Share a secret with another agent
   */
  client.registerTool(
    {
      name: 'remote.share',
      description:
        'Share a secret with another agent (E2E encrypted for recipient).',
      input: z.object({
        configPath: z.string().optional().describe('Path to config file (default: ./secrets.toml)'),
        vault: z.string().describe('Vault name'),
        key: z.string().describe('Secret key to share'),
        identity: identitySchema.describe('Agent identity for authentication'),
        withAgent: z.string().describe('Recipient public key (base64 SPKI DER)'),
        permission: z
          .enum(['read', 'readwrite'])
          .optional()
          .describe('Access level (default: read)'),
        durationHours: z.number().optional().describe('Hours until expiry (default: 1)'),
        maxReads: z.number().optional().describe('Max reads, 0 = unlimited (default: 0)'),
      }),
    },
    async (params) => {
      const configPath = resolveConfigPath(params.configPath);
      const config = await readConfig(configPath);
      const vault = getVault(config, params.vault);
      requireKadiVault(vault, params.vault);

      const provider = await getRemoteProvider({
        type: vault.type,
        broker: vault.broker,
        network: vault.network,
        vault: params.vault,
        identity: params.identity,
      });

      if (!provider.share) {
        throw new Error('Provider does not support sharing');
      }

      const result = await provider.share(params.key, {
        withAgent: params.withAgent,
        permission: params.permission,
        durationHours: params.durationHours,
        maxReads: params.maxReads,
      });

      return { expiresAt: result.expiresAt };
    }
  );

  /**
   * v2.remote.revoke - Revoke a shared secret
   */
  client.registerTool(
    {
      name: 'remote.revoke',
      description: "Revoke another agent's access to a shared secret",
      input: z.object({
        configPath: z.string().optional().describe('Path to config file (default: ./secrets.toml)'),
        vault: z.string().describe('Vault name'),
        key: z.string().describe('Secret key'),
        identity: identitySchema.describe('Agent identity for authentication'),
        fromAgent: z.string().describe('Public key of agent to revoke'),
      }),
    },
    async (params) => {
      const configPath = resolveConfigPath(params.configPath);
      const config = await readConfig(configPath);
      const vault = getVault(config, params.vault);
      requireKadiVault(vault, params.vault);

      const provider = await getRemoteProvider({
        type: vault.type,
        broker: vault.broker,
        network: vault.network,
        vault: params.vault,
        identity: params.identity,
      });

      if (!provider.revoke) {
        throw new Error('Provider does not support revoking');
      }

      await provider.revoke(params.key, params.fromAgent);
      return {};
    }
  );

  /**
   * v2.remote.listShared - List secrets shared with this agent
   */
  client.registerTool(
    {
      name: 'remote.listShared',
      description: 'List all secrets that other agents have shared with you',
      input: z.object({
        configPath: z.string().optional().describe('Path to config file (default: ./secrets.toml)'),
        vault: z.string().describe('Vault name'),
        identity: identitySchema.describe('Agent identity for authentication'),
      }),
    },
    async (params) => {
      const configPath = resolveConfigPath(params.configPath);
      const config = await readConfig(configPath);
      const vault = getVault(config, params.vault);
      requireKadiVault(vault, params.vault);

      const provider = await getRemoteProvider({
        type: vault.type,
        broker: vault.broker,
        network: vault.network,
        vault: params.vault,
        identity: params.identity,
      });

      if (!provider.listShared) {
        throw new Error('Provider does not support listing shared secrets');
      }

      const secrets = await provider.listShared();
      return { secrets };
    }
  );

  /**
   * v2.remote.getShared - Get a shared secret by name
   */
  client.registerTool(
    {
      name: 'remote.getShared',
      description: 'Find and retrieve a shared secret by name (errors if ambiguous)',
      input: z.object({
        configPath: z.string().optional().describe('Path to config file (default: ./secrets.toml)'),
        vault: z.string().describe('Vault name'),
        key: z.string().describe('Secret key to find'),
        identity: identitySchema.describe('Agent identity for authentication'),
      }),
    },
    async (params) => {
      const configPath = resolveConfigPath(params.configPath);
      const config = await readConfig(configPath);
      const vault = getVault(config, params.vault);
      requireKadiVault(vault, params.vault);

      const provider = await getRemoteProvider({
        type: vault.type,
        broker: vault.broker,
        network: vault.network,
        vault: params.vault,
        identity: params.identity,
      });

      if (!provider.getShared) {
        throw new Error('Provider does not support getting shared secrets');
      }

      const result = await provider.getShared(params.key);
      return { value: result.value, fromAgent: result.fromAgent };
    }
  );

  /**
   * v2.remote.auditLogs - List audit logs for secret access
   */
  client.registerTool(
    {
      name: 'remote.auditLogs',
      description:
        'List audit logs showing who accessed secrets. Use mySecretsOnly to see who accessed YOUR secrets.',
      input: z.object({
        configPath: z.string().optional().describe('Path to config file (default: ./secrets.toml)'),
        vault: z.string().describe('Vault name'),
        identity: identitySchema.describe('Agent identity for authentication'),
        secretName: z.string().optional().describe('Filter by secret name'),
        action: z
          .enum(['read', 'write', 'delete', 'share', 'revoke', 'list'])
          .optional()
          .describe('Filter by action type'),
        sinceUnix: z.number().optional().describe('Only logs after this Unix timestamp'),
        limit: z.number().optional().describe('Maximum logs to return (default: 100)'),
        mySecretsOnly: z
          .boolean()
          .optional()
          .describe('If true, shows who accessed YOUR secrets (default: shows your own actions)'),
      }),
    },
    async (params) => {
      const configPath = resolveConfigPath(params.configPath);
      const config = await readConfig(configPath);
      const vault = getVault(config, params.vault);
      requireKadiVault(vault, params.vault);

      const provider = await getRemoteProvider({
        type: vault.type,
        broker: vault.broker,
        network: vault.network,
        vault: params.vault,
        identity: params.identity,
      });

      if (!provider.listAuditLogs) {
        throw new Error('Provider does not support audit logs');
      }

      const logs = await provider.listAuditLogs({
        secretName: params.secretName,
        action: params.action,
        sinceUnix: params.sinceUnix,
        limit: params.limit,
        mySecretsOnly: params.mySecretsOnly,
      });

      return { logs, count: logs.length };
    }
  );
}
