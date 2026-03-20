/**
 * Configuration loader for search-ability.
 *
 * Convention Section 6 compliance:
 *   Config  → config.yml walk-up (chunk_size, embedding_model, database, etc.)
 *   Secrets → secrets.toml vault "models" walk-up (SEARCH_API_KEY, SEARCH_EMBEDDING_API_URL)
 *   Env var overrides for both systems
 *
 * Resolution order (highest wins):
 *   1. Environment variables  (SEARCH_CHUNK_SIZE, SEARCH_API_KEY, ...)
 *   2. Vault "models"         (SEARCH_API_KEY, SEARCH_EMBEDDING_API_URL — encrypted in secrets.toml)
 *   3. `config.yml` file      (walk-up from CWD — non-secret settings only)
 *   4. Built-in defaults
 *
 * Credentials (API keys, URLs containing tokens) NEVER appear in config.yml.
 * They are loaded from the vault at startup via loadNative('secret-ability').
 */

import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { load } from 'js-yaml';

/** Track whether config has already been logged to avoid log spam. */
let configLogged = false;

export type EmbeddingTransport = 'broker' | 'api';

export interface SearchConfig {
  chunkSize: number;
  embeddingModel: string;
  database: string;
  apiKey?: string;
  embeddingTransport: EmbeddingTransport;
  embeddingApiUrl?: string;
}

// ── Vault key names ───────────────────────────────────────────────────

/** Vault name where model-manager credentials are stored. */
export const VAULT_NAME = 'models';

/** Keys read from the "models" vault — names match the env var overrides. */
export const VAULT_KEYS = ['SEARCH_API_KEY', 'SEARCH_EMBEDDING_API_URL'] as const;

// ── Walk-up config.yml discovery ──────────────────────────────────────

/**
 * Walk up from CWD looking for config.yml — mirrors vault discovery pattern.
 */
function findConfigFile(filename = 'config.yml'): string | null {
  let dir = process.cwd();
  while (true) {
    const candidate = join(dir, filename);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * Load the `search` section from the nearest `config.yml`.
 */
function loadConfigSection(): Record<string, unknown> {
  const configPath = findConfigFile();
  if (!configPath) {
    if (!configLogged) {
      configLogged = true;
      console.warn(
        '[search-ability] No config.yml found in directory tree — using env vars / vault only',
      );
    }
    return {};
  }

  if (!configLogged) {
    configLogged = true;
    console.log(`[search-ability] config.yml loaded from ${configPath}`);
  }
  const parsed = load(readFileSync(configPath, 'utf8')) as Record<string, unknown>;
  return (parsed?.search as Record<string, unknown>) ?? {};
}

// ── Vault loading ─────────────────────────────────────────────────────

/**
 * Load credentials from the "models" vault via secret-ability.
 *
 * Uses `loadNative('secret-ability')` which resolves through the KĀDI
 * framework (agent-lock.json), NOT node_modules.  Walk-up discovery
 * finds the nearest secrets.toml automatically.
 *
 * @param client - KadiClient instance (for loadNative)
 * @returns Map of vault key → decrypted value.  Missing keys are omitted.
 */
export async function loadFromVault(
  client: any,
): Promise<Record<string, string>> {
  const credentials: Record<string, string> = {};

  try {
    const secrets = await client.loadNative('secret-ability');

    for (const key of VAULT_KEYS) {
      try {
        const result = await secrets.invoke('get', {
          vault: VAULT_NAME,
          key,
        });
        if (result?.value) {
          credentials[key] = result.value;
        }
      } catch {
        // Key not present in vault — skip silently
      }
    }

    await secrets.disconnect();
    console.log(
      `[search-ability] Vault "${VAULT_NAME}" loaded — ${Object.keys(credentials).length}/${VAULT_KEYS.length} keys found`,
    );
  } catch (err: any) {
    console.warn(
      '[search-ability] secret-ability not available — using env vars / config only',
    );
    console.warn('[search-ability] loadNative error:', err?.message ?? err);
  }

  return credentials;
}

// ── Public API ────────────────────────────────────────────────────────

/**
 * Build the fully-resolved {@link SearchConfig} (synchronous, no vault).
 *
 * Use {@link loadSearchConfigWithVault} for the full resolution chain
 * including vault credentials.  This function is kept for backward
 * compatibility and for unit tests that don't need vault access.
 */
export function loadSearchConfig(): SearchConfig {
  return buildConfig({});
}

/**
 * Build the fully-resolved {@link SearchConfig} with vault credentials.
 *
 * Resolution: env vars → vault → config.yml → defaults.
 *
 * @param client - KadiClient instance (for loadNative('secret-ability'))
 */
export async function loadSearchConfigWithVault(
  client: any,
): Promise<SearchConfig> {
  const vaultSecrets = await loadFromVault(client);
  return buildConfig(vaultSecrets);
}

/**
 * Internal config builder.  Merges env vars, vault values, config.yml,
 * and defaults into a single {@link SearchConfig}.
 */
function buildConfig(vault: Record<string, string>): SearchConfig {
  const file = loadConfigSection();

  return {
    chunkSize: Number(
      process.env.SEARCH_CHUNK_SIZE ?? file.chunk_size ?? 500,
    ),
    embeddingModel:
      process.env.SEARCH_EMBEDDING_MODEL ??
      (file.embedding_model as string) ??
      'nomic-embed-text',
    database:
      process.env.SEARCH_DATABASE ??
      (file.database as string) ??
      'kadi_memory',
    // API key: env var → vault → undefined
    // NEVER from config.yml (credential anti-pattern)
    apiKey:
      process.env.SEARCH_API_KEY ??
      vault['SEARCH_API_KEY'] ??
      undefined,
    embeddingTransport:
      (process.env.SEARCH_EMBEDDING_TRANSPORT ??
        (file.embedding_transport as string) ??
        'api') as EmbeddingTransport,
    // Embedding API URL: env var → vault → config.yml → undefined
    embeddingApiUrl:
      process.env.SEARCH_EMBEDDING_API_URL ??
      vault['SEARCH_EMBEDDING_API_URL'] ??
      (file.embedding_api_url as string) ??
      undefined,
  };
}
