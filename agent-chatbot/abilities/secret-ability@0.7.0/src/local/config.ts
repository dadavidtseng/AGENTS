/**
 * Config Module - TOML-based vault configuration
 *
 * Handles reading/writing secrets.toml and config.toml files.
 * Config structure:
 *   [vaults]
 *   dev = { type = "age" }
 *   team = { type = "kadi", broker = "...", network = "..." }
 *
 *   [secrets.dev]
 *   API_KEY = "ENC[...]"
 *
 *   [secrets.team]
 *   DATABASE_URL = true   # true = remote key, value stored on broker
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { parse, stringify } from 'smol-toml';
import { z } from 'zod';

// =============================================================================
// Schemas
// =============================================================================

const vaultTypeSchema = z.enum(['age', 'kadi']);

const vaultEntrySchema = z
  .object({
    type: vaultTypeSchema,
    broker: z.string().optional(),
    network: z.string().optional(),
  })
  .refine(
    (v) => {
      // kadi vaults require broker and network
      if (v.type === 'kadi') {
        return Boolean(v.broker && v.network);
      }
      return true;
    },
    { message: 'Kadi vaults require broker and network fields' }
  );

const configSchema = z.object({
  vaults: z.record(z.string(), vaultEntrySchema).default({}),
  secrets: z.record(z.string(), z.record(z.string(), z.unknown())).default({}),
});

// =============================================================================
// Types
// =============================================================================

export type VaultType = z.infer<typeof vaultTypeSchema>;
export type VaultEntry = z.infer<typeof vaultEntrySchema>;
export type Config = z.infer<typeof configSchema>;

// =============================================================================
// Config Operations
// =============================================================================

/**
 * Read and parse a TOML config file.
 * Returns empty config if file doesn't exist.
 * Validates the structure with Zod schema.
 *
 * @throws Error if config file has invalid structure
 */
export async function readConfig(configPath: string): Promise<Config> {
  const resolved = path.resolve(configPath);

  try {
    const content = await fs.readFile(resolved, 'utf-8');
    const parsed = parse(content);

    // Validate with Zod schema
    const result = configSchema.safeParse(parsed);
    if (!result.success) {
      const issues = result.error.issues
        .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
        .join('\n');
      throw new Error(`Invalid config file ${configPath}:\n${issues}`);
    }

    return result.data;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { vaults: {}, secrets: {} };
    }
    throw err;
  }
}

/**
 * Write config to a TOML file.
 * Creates parent directories if needed.
 */
export async function writeConfig(configPath: string, config: Config): Promise<void> {
  const resolved = path.resolve(configPath);
  const dir = path.dirname(resolved);

  await fs.mkdir(dir, { recursive: true });

  // Build TOML content with proper structure
  const tomlObj: Record<string, unknown> = {};

  // Add [vaults] section
  if (Object.keys(config.vaults).length > 0) {
    tomlObj['vaults'] = config.vaults;
  }

  // Add [secrets.<vault>] sections
  if (Object.keys(config.secrets).length > 0) {
    tomlObj['secrets'] = config.secrets;
  }

  const content = stringify(tomlObj);

  // Write atomically (temp file + rename)
  const tempPath = `${resolved}.tmp`;
  await fs.writeFile(tempPath, content, 'utf-8');
  try {
    await fs.rename(tempPath, resolved);
  } catch (err) {
    // Clean up temp file if rename fails (e.g., cross-filesystem)
    await fs.unlink(tempPath).catch(() => {});
    throw err;
  }
}

/**
 * Get a vault entry from config.
 * Throws if vault doesn't exist.
 */
export function getVault(config: Config, vaultName: string): VaultEntry {
  const vault = config.vaults[vaultName];
  if (!vault) {
    const available = Object.keys(config.vaults).join(', ') || '(none)';
    throw new Error(`Vault '${vaultName}' not found. Available: ${available}`);
  }
  return vault;
}

/**
 * Check if a vault exists in config.
 */
export function hasVault(config: Config, vaultName: string): boolean {
  return vaultName in config.vaults;
}

/**
 * Add a vault to config.
 * Throws if vault already exists or if kadi vault is missing required fields.
 */
export function createVault(config: Config, name: string, entry: VaultEntry): void {
  if (hasVault(config, name)) {
    throw new Error(`Vault '${name}' already exists`);
  }

  // Validate kadi vaults have required fields (schema validates structure, but explicit check for clarity)
  if (entry.type === 'kadi' && (!entry.broker || !entry.network)) {
    throw new Error('Kadi vault requires broker URL and network name');
  }

  config.vaults[name] = entry;
  config.secrets[name] = {};
}

/**
 * Remove a vault from config.
 * Also removes its secrets section.
 */
export function destroyVault(config: Config, name: string): void {
  if (!hasVault(config, name)) {
    throw new Error(`Vault '${name}' not found`);
  }

  delete config.vaults[name];
  delete config.secrets[name];
}

/**
 * Get secrets section for a vault.
 * Returns empty object if section doesn't exist.
 */
export function getSecretsSection(config: Config, vaultName: string): Record<string, unknown> {
  return config.secrets[vaultName] ?? {};
}

/**
 * Set a secret in a vault's secrets section.
 */
export function setSecret(config: Config, vaultName: string, key: string, value: unknown): void {
  if (!config.secrets[vaultName]) {
    config.secrets[vaultName] = {};
  }
  config.secrets[vaultName][key] = value;
}

/**
 * Delete a secret from a vault's secrets section.
 */
export function deleteSecret(config: Config, vaultName: string, key: string): boolean {
  const section = config.secrets[vaultName];
  if (!section || !(key in section)) {
    return false;
  }
  delete section[key];
  return true;
}

/**
 * Check if a secret exists in a vault's secrets section.
 */
export function hasSecret(config: Config, vaultName: string, key: string): boolean {
  const section = config.secrets[vaultName];
  return section ? key in section : false;
}

/**
 * List all secret keys in a vault's secrets section.
 */
export function listSecrets(config: Config, vaultName: string): string[] {
  const section = config.secrets[vaultName];
  return section ? Object.keys(section) : [];
}
