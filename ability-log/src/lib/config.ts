/**
 * Configuration loader for ability-log.
 *
 * Follows KĀDI Convention Section 6 — the same pattern as ability-arcadedb:
 *
 * **Settings** (host, port, database) come from `config.toml` via walk-up
 * discovery from CWD. When loaded via loadNative(), CWD is the host agent's
 * directory, so the host agent's config.toml `[arcadedb]` section is used.
 *
 * **Credentials** (username, password) come from secret-ability's `arcadedb`
 * vault, delivered as env vars at runtime. They are NEVER read from config.toml.
 *
 * Resolution order (highest wins):
 *   1. Environment variables  (ARCADE_HOST, ARCADE_PORT, ...)
 *   2. `config.toml` file     (walk-up from CWD — settings only, no secrets)
 *   3. Built-in defaults      (localhost:2480, agents_logs)
 *
 * Credential resolution:
 *   1. `ARCADE_USERNAME` / `ARCADE_PASSWORD` env vars (set by secret-ability)
 *   2. Built-in dev defaults   (root / empty)
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type { ArcadeClientConfig } from './arcade-client.js';

const TAG = '[ability-log:config]';
const CONFIG_FILENAME = 'config.toml';

// ── Walk-up discovery ────────────────────────────────────────────────

/**
 * Walk up from `startDir` to filesystem root looking for config.toml.
 */
function findConfigFile(startDir: string = process.cwd()): string | null {
  let dir = startDir;
  while (true) {
    const candidate = join(dir, CONFIG_FILENAME);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break; // reached root
    dir = parent;
  }
  return null;
}

// ── Minimal TOML parser ─────────────────────────────────────────────
//
// Only handles flat key-value pairs under [section] headers.
// No arrays-of-tables, inline tables, or multiline strings.

function parseSimpleToml(content: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  let currentSection = '';

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const sectionMatch = line.match(/^\[([a-zA-Z0-9._-]+)\]$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1];
      continue;
    }

    const kvMatch = line.match(/^([a-zA-Z0-9_-]+)\s*=\s*(.+)$/);
    if (!kvMatch) continue;

    const key = kvMatch[1];
    const rawValue = kvMatch[2].trim();
    const fullKey = currentSection ? `${currentSection}.${key}` : key;

    result[fullKey] = parseTomlValue(rawValue);
  }

  return result;
}

function parseTomlValue(raw: string): string | number | boolean {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  if ((raw.startsWith('"') && raw.endsWith('"')) ||
      (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1);
  }
  return raw;
}

// ── Config loader ───────────────────────────────────────────────────

/**
 * Load ArcadeDB config following Convention Section 6:
 *   env vars > config.toml [arcadedb] section > defaults
 *
 * Credentials come from env vars only (set by secret-ability vault).
 *
 * Throws if required config (host, password) cannot be resolved.
 */
export function loadArcadeLogConfig(): ArcadeClientConfig {
  const file = loadConfigSection();
  const configPath = findConfigFile();

  const host = process.env.ARCADE_HOST ?? file.host;
  const port = Number(process.env.ARCADE_PORT ?? file.port ?? 2480);
  const protocol = process.env.ARCADE_PROTOCOL
    ?? file.protocol
    ?? (port === 443 ? 'https' : 'http');
  const database = process.env.ARCADE_DATABASE ?? file.database ?? 'agents_logs';

  // Credentials: env vars only (from secret-ability arcadedb vault)
  const username = process.env.ARCADE_USERNAME;
  const password = process.env.ARCADE_PASSWORD;

  // Validate required fields
  const missing: string[] = [];
  if (!host) missing.push('ARCADE_HOST (env or [arcadedb] HOST in config.toml)');
  if (!username) missing.push('ARCADE_USERNAME (env, set by secret-ability arcadedb vault)');
  if (!password) missing.push('ARCADE_PASSWORD (env, set by secret-ability arcadedb vault)');

  if (missing.length > 0) {
    const source = configPath ? `config.toml: ${configPath}` : 'no config.toml found';
    const msg = `${TAG} Missing required ArcadeDB config:\n  - ${missing.join('\n  - ')}\n  (${source})`;
    console.error(msg);
    throw new Error(msg);
  }

  if (configPath) {
    console.log(`${TAG} Loaded settings from ${configPath}`);
  }

  return {
    host: String(host),
    port,
    protocol: String(protocol),
    username: username!,
    password: password!,
    database: String(database),
  };
}

/**
 * Load the `[arcadedb]` section from the nearest config.toml.
 * Returns empty object if no config file found.
 */
function loadConfigSection(): Record<string, unknown> {
  const configPath = findConfigFile();
  if (!configPath) return {};

  try {
    const content = readFileSync(configPath, 'utf-8');
    const parsed = parseSimpleToml(content);

    // Extract only arcadedb.* keys, strip the prefix
    const section: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (key.startsWith('arcadedb.')) {
        section[key.slice('arcadedb.'.length)] = value;
      }
    }
    return section;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${TAG} Failed to parse ${configPath}: ${msg}`);
    return {};
  }
}
