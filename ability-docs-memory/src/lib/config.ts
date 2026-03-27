/**
 * Configuration loader for ability-docs-memory.
 *
 * Resolution order (highest wins):
 *   1. Environment variables  (DOCS_DATABASE, MEMORY_API_KEY, ...)
 *   2. Vault "models"         (MEMORY_API_KEY, MEMORY_API_URL)
 *   3. `config.yml` file      (walk-up from CWD — docs section)
 *   4. Built-in defaults (AGENTS-specific)
 */

import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { load } from 'js-yaml';

let configLogged = false;

export type Transport = 'broker' | 'api';

export interface DocsConfig {
  database: string;
  defaultCollection: string;
  embeddingModel: string;
  extractionModel: string;
  maxTokens: number;
  baseUrl: string;
  domain: string;
  apiKey?: string;
  apiUrl?: string;
  embeddingTransport: Transport;
  chatTransport: Transport;
}

export const VAULT_NAME = 'models';
export const VAULT_KEYS = ['MEMORY_API_KEY', 'MEMORY_API_URL'] as const;

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

function loadConfigSection(): Record<string, unknown> {
  const configPath = findConfigFile();
  if (!configPath) {
    if (!configLogged) {
      configLogged = true;
      console.warn('[ability-docs-memory] No config.yml found — using env vars / vault only');
    }
    return {};
  }

  if (!configLogged) {
    configLogged = true;
    console.log(`[ability-docs-memory] config.yml loaded from ${configPath}`);
  }
  const parsed = load(readFileSync(configPath, 'utf8')) as Record<string, unknown>;
  return (parsed?.docs as Record<string, unknown>) ?? {};
}

export async function loadFromVault(client: any): Promise<Record<string, string>> {
  const credentials: Record<string, string> = {};

  try {
    const secrets = await client.loadNative('secret-ability');

    for (const key of VAULT_KEYS) {
      try {
        const result = await secrets.invoke('get', { vault: VAULT_NAME, key });
        if (result?.value) {
          credentials[key] = result.value;
        }
      } catch {
        // Key not present in vault
      }
    }

    await secrets.disconnect();
    console.log(
      `[ability-docs-memory] Vault "${VAULT_NAME}" loaded — ${Object.keys(credentials).length}/${VAULT_KEYS.length} keys found`,
    );
  } catch (err: any) {
    console.warn('[ability-docs-memory] secret-ability not available — using env vars / config only');
    console.warn('[ability-docs-memory] loadNative error:', err?.message ?? err);
  }

  return credentials;
}

export function loadDocsConfig(): DocsConfig {
  return buildConfig({});
}

export async function loadDocsConfigWithVault(client: any): Promise<DocsConfig> {
  const vaultSecrets = await loadFromVault(client);
  return buildConfig(vaultSecrets);
}

function buildConfig(vault: Record<string, string>): DocsConfig {
  const file = loadConfigSection();

  return {
    database:
      process.env.DOCS_DATABASE ??
      process.env.MEMORY_DATABASE ??
      (file.database as string) ??
      'agents_memory',
    defaultCollection:
      process.env.DOCS_DEFAULT_COLLECTION ??
      (file.default_collection as string) ??
      'agents-docs',
    embeddingModel:
      process.env.DOCS_EMBEDDING_MODEL ??
      process.env.MEMORY_EMBEDDING_MODEL ??
      (file.embedding_model as string) ??
      'text-embedding-3-small',
    extractionModel:
      process.env.DOCS_EXTRACTION_MODEL ??
      process.env.MEMORY_EXTRACTION_MODEL ??
      (file.extraction_model as string) ??
      'gpt-5-nano',
    maxTokens:
      Number(process.env.DOCS_MAX_TOKENS) ||
      (file.max_tokens as number) ||
      500,
    baseUrl:
      process.env.DOCS_BASE_URL ??
      (file.base_url as string) ??
      'http://localhost:3333',
    domain:
      process.env.DOCS_DOMAIN ??
      (file.domain as string) ??
      'localhost',
    apiKey:
      process.env.MEMORY_API_KEY ??
      vault['MEMORY_API_KEY'] ??
      undefined,
    apiUrl:
      process.env.MEMORY_API_URL ??
      vault['MEMORY_API_URL'] ??
      undefined,
    embeddingTransport:
      (process.env.DOCS_EMBEDDING_TRANSPORT ??
        process.env.MEMORY_EMBEDDING_TRANSPORT ??
        (file.embedding_transport as string) ??
        'api') as Transport,
    chatTransport:
      (process.env.DOCS_CHAT_TRANSPORT ??
        process.env.MEMORY_CHAT_TRANSPORT ??
        (file.chat_transport as string) ??
        'api') as Transport,
  };
}
