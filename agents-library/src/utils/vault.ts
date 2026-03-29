/**
 * Shared vault credential loader for KĀDI agents.
 *
 * Loads credentials from one or more vaults specified in config.toml:
 *   [secrets]
 *   VAULTS = ["anthropic", "model-manager"]
 *   KEYS = ["ANTHROPIC_API_KEY", "MODEL_MANAGER_BASE_URL", "MODEL_MANAGER_API_KEY"]
 *
 * Falls back to the hardcoded defaults if config.toml is missing or
 * has no [secrets] section.
 *
 * @module utils/vault
 */

import { readConfig } from './read-config.js';

// ── Constants ────────────────────────────────────────────────────────

const DEFAULT_VAULTS = ['model-manager'];
const DEFAULT_KEYS = [
  'MODEL_MANAGER_BASE_URL',
  'MODEL_MANAGER_API_KEY',
  'ANTHROPIC_API_KEY',
];
const TAG = '[vault]';

// ── Types ────────────────────────────────────────────────────────────

export type VaultCredentials = Record<string, string>;

/** @deprecated Use VaultCredentials instead */
export type ModelManagerCredentials = VaultCredentials;

// ── Public API ───────────────────────────────────────────────────────

/**
 * Load credentials from configured vaults.
 *
 * Reads [secrets] VAULTS and KEYS from config.toml.
 * For each key, tries each vault in order until found.
 *
 * Returns empty object if vault or secret-ability is unavailable
 * (graceful degradation).
 */
export async function loadVaultCredentials(): Promise<VaultCredentials> {
  const credentials: VaultCredentials = {};

  // Resolve vault names and keys from config.toml
  let vaultNames: string[];
  let vaultKeys: string[];
  try {
    const cfg = readConfig();
    vaultNames = cfg.has('secrets.VAULTS') ? cfg.strings('secrets.VAULTS') : DEFAULT_VAULTS;
    vaultKeys = cfg.has('secrets.KEYS') ? cfg.strings('secrets.KEYS') : DEFAULT_KEYS;
  } catch {
    vaultNames = DEFAULT_VAULTS;
    vaultKeys = DEFAULT_KEYS;
  }

  try {
    const { KadiClient } = await import('@kadi.build/core');
    const tmpClient = new KadiClient({ name: 'vault-loader', version: '1.0.0' });
    const secrets = await tmpClient.loadNative('secret-ability');

    // For each key, try each vault in order until found
    for (const key of vaultKeys) {
      for (const vault of vaultNames) {
        try {
          const result: any = await secrets.invoke('get', { vault, key });
          if (result?.value) {
            credentials[key] = result.value;
            break; // Found — skip remaining vaults for this key
          }
        } catch {
          // Key not in this vault — try next
        }
      }
    }

    await secrets.disconnect();

    const loaded = Object.keys(credentials).length;
    if (loaded > 0) {
      console.log(
        `${TAG} Loaded ${loaded}/${vaultKeys.length} credentials from vaults: ${vaultNames.join(', ')}`,
      );
    }
  } catch (err: any) {
    console.warn(
      `${TAG} secret-ability unavailable — using env vars only (${err?.message ?? err})`,
    );
  }

  return credentials;
}

/** @deprecated Use loadVaultCredentials instead */
export const loadModelManagerCredentials = loadVaultCredentials;
