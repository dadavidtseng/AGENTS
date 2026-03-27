/**
 * Shared vault credential loader for KĀDI agents.
 *
 * Loads shared credentials (MODEL_MANAGER_BASE_URL, MODEL_MANAGER_API_KEY,
 * ANTHROPIC_API_KEY) from a `secrets.toml` vault via ability-secret's
 * `get` tool (in-process, no broker connection required).
 *
 * Follows the same pattern as ability-memory/src/lib/config.ts:loadFromVault().
 * ability-secret v0.9+ has walk-up directory discovery, so it automatically
 * finds secrets.toml in parent directories.
 *
 * Resolution order (implemented by each agent's caller):
 *   process.env  >  vault  >  (no credentials)
 *
 * Prerequisites:
 *   - Agent's agent.json must declare: "abilities": { "secret-ability": "^0.9.0" }
 *   - Run `kadi update secret-ability` to install v0.9+ with walk-up discovery
 *
 * @module utils/vault
 */

// ── Constants ────────────────────────────────────────────────────────

const VAULT_NAME = 'model-manager';
const VAULT_KEYS = [
  'MODEL_MANAGER_BASE_URL',
  'MODEL_MANAGER_API_KEY',
  'ANTHROPIC_API_KEY',
] as const;
const TAG = '[vault]';

// ── Types ────────────────────────────────────────────────────────────

export type VaultCredentials = {
  MODEL_MANAGER_BASE_URL?: string;
  MODEL_MANAGER_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
};

/** @deprecated Use VaultCredentials instead */
export type ModelManagerCredentials = VaultCredentials;

// ── Public API ───────────────────────────────────────────────────────

/**
 * Load shared credentials from the nearest `secrets.toml` vault.
 *
 * Uses `loadNative('secret-ability')` — same pattern as
 * ability-memory/src/lib/config.ts:loadFromVault(). ability-secret v0.9+
 * walks up directories automatically to find secrets.toml.
 *
 * Returns empty object if vault or secret-ability is unavailable
 * (graceful degradation).
 */
export async function loadVaultCredentials(): Promise<VaultCredentials> {
  const credentials: VaultCredentials = {};

  try {
    const { KadiClient } = await import('@kadi.build/core');
    const tmpClient = new KadiClient({ name: 'vault-loader', version: '1.0.0' });
    const secrets = await tmpClient.loadNative('secret-ability');

    // Same pattern as ability-memory — no configPath, let walk-up discovery find it
    for (const key of VAULT_KEYS) {
      try {
        const result: any = await secrets.invoke('get', {
          vault: VAULT_NAME,
          key,
        });
        if (result?.value) {
          credentials[key as keyof VaultCredentials] = result.value;
        }
      } catch {
        // Key not present in vault — skip silently
      }
    }

    await secrets.disconnect();

    const loaded = Object.keys(credentials).length;
    if (loaded > 0) {
      console.log(
        `${TAG} Loaded ${loaded}/${VAULT_KEYS.length} credentials from "${VAULT_NAME}" vault`,
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
