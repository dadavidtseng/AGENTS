/**
 * Shared TOML config loader for KĀDI agents.
 *
 * Loads non-secret configuration from `config.toml` and injects into
 * `process.env` (existing env vars take precedence).
 *
 * Walk-up discovery: searches from CWD upward until it finds config.toml.
 *
 * Professor's paradigm:
 *   secrets.toml  → encrypted vault (committed)
 *   config.toml   → non-secret settings (committed)
 *   .env          → optional local override (NOT committed)
 *
 * Resolution order: process.env > .env (dotenv) > config.toml > defaults
 *
 * @module utils/config
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';

// ── Constants ────────────────────────────────────────────────────────

const CONFIG_FILENAME = 'config.toml';
const TAG = '[config]';

// ── TOML key → env var mapping ───────────────────────────────────────
//
// Flat mapping from TOML dotted paths to env var names.
// Only mapped keys are injected into process.env.

const TOML_TO_ENV: Record<string, string> = {
  'broker.url':              'KADI_BROKER_URL',
  'broker.networks':         'KADI_NETWORK',
  'broker.remote.url':       'KADI_BROKER_URL_2',
  'broker.remote.networks':  'KADI_NETWORK_2',
  'bot.tool_timeout_ms':     'BOT_TOOL_TIMEOUT_MS',
  'bot.slack.enabled':       'ENABLE_SLACK_BOT',
  'bot.slack.user_id':       'SLACK_BOT_USER_ID',
  'bot.discord.enabled':     'ENABLE_DISCORD_BOT',
  'bot.discord.user_id':     'DISCORD_BOT_USER_ID',
  'memory.data_path':        'MEMORY_DATA_PATH',
};

// ── Types ────────────────────────────────────────────────────────────

export interface LoadConfigResult {
  /** Path to the config.toml that was loaded, or null if none found */
  configPath: string | null;
  /** Number of env vars injected */
  injectedCount: number;
}

// ── Walk-up discovery ────────────────────────────────────────────────

/**
 * Walk up from `startDir` to filesystem root looking for config.toml.
 */
function findConfigFile(startDir: string): string | null {
  let dir = resolve(startDir);

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
// We only need flat key-value and nested tables — no arrays-of-tables,
// inline tables, multiline strings, etc. This avoids adding smol-toml
// as a dependency to agents-library.

type TomlValue = string | number | boolean | string[] | Record<string, unknown>;

function parseSimpleToml(content: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  let currentSection = '';

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();

    // Skip comments and blank lines
    if (!line || line.startsWith('#')) continue;

    // Section header: [broker] or [broker.remote]
    const sectionMatch = line.match(/^\[([a-zA-Z0-9._-]+)\]$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1];
      continue;
    }

    // Key = value
    const kvMatch = line.match(/^([a-zA-Z0-9_-]+)\s*=\s*(.+)$/);
    if (!kvMatch) continue;

    const key = kvMatch[1];
    const rawValue = kvMatch[2].trim();
    const fullKey = currentSection ? `${currentSection}.${key}` : key;

    // Parse value
    result[fullKey] = parseTomlValue(rawValue);
  }

  return result;
}

function parseTomlValue(raw: string): TomlValue {
  // Boolean
  if (raw === 'true') return true;
  if (raw === 'false') return false;

  // Number (integer or float)
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);

  // String (quoted)
  if ((raw.startsWith('"') && raw.endsWith('"')) ||
      (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1);
  }

  // Array of strings: ["a", "b", "c"]
  if (raw.startsWith('[') && raw.endsWith(']')) {
    const inner = raw.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(',').map(s => {
      const trimmed = s.trim();
      if ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
          (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
        return trimmed.slice(1, -1);
      }
      return trimmed;
    });
  }

  // Bare string (unquoted)
  return raw;
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Load config.toml and inject mapped values into process.env.
 *
 * - Walks up from `startDir` (default: CWD) to find config.toml
 * - Only injects keys defined in TOML_TO_ENV mapping
 * - Existing env vars are NOT overwritten (env > config.toml)
 * - Array values are joined with commas (e.g. networks)
 *
 * @param startDir - Directory to start searching from (default: process.cwd())
 * @returns Info about what was loaded
 */
export function loadConfig(startDir?: string): LoadConfigResult {
  const configPath = findConfigFile(startDir || process.cwd());

  if (!configPath) {
    return { configPath: null, injectedCount: 0 };
  }

  const content = readFileSync(configPath, 'utf-8');
  const parsed = parseSimpleToml(content);

  let injectedCount = 0;

  for (const [tomlKey, envKey] of Object.entries(TOML_TO_ENV)) {
    // Skip if env var already set (env takes precedence)
    if (process.env[envKey]) continue;

    const value = parsed[tomlKey];
    if (value === undefined || value === null) continue;

    // Convert to string for process.env
    if (Array.isArray(value)) {
      process.env[envKey] = value.join(',');
    } else {
      process.env[envKey] = String(value);
    }
    injectedCount++;
  }

  if (injectedCount > 0) {
    console.log(`${TAG} Loaded ${injectedCount} settings from ${configPath}`);
  }

  return { configPath, injectedCount };
}

/**
 * Register additional TOML key → env var mappings.
 *
 * Allows agents to extend the default mapping with agent-specific keys
 * before calling loadConfig().
 */
export function registerConfigMapping(mappings: Record<string, string>): void {
  Object.assign(TOML_TO_ENV, mappings);
}
