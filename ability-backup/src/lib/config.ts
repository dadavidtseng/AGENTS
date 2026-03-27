/**
 * Walk-up config.yml loader — Convention Section 6.
 *
 * Mirrors the walk-up discovery pattern used by secret-ability for
 * secrets.toml.  Starts from CWD, walks up looking for config.yml,
 * then loads a named section.  Env vars override file values.
 *
 * Usage:
 *   const tunnelConfig = loadConfig('tunnel', 'KADI_TUNNEL');
 *   const backupConfig = loadConfig('backup', 'BACKUP');
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { load } from 'js-yaml';

/** Track which sections have already been logged to avoid log spam. */
const loggedSections = new Set<string>();

// ── Walk-up discovery ─────────────────────────────────────────────────

/** Walk up from CWD looking for config.yml — mirrors vault discovery. */
export function findConfigFile(filename = 'config.yml'): string | null {
  let dir = process.cwd();
  while (true) {
    const candidate = join(dir, filename);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break; // filesystem root
    dir = parent;
  }
  return null;
}

// ── Section loader ────────────────────────────────────────────────────

/**
 * Load a section from config.yml.  Env vars override file values.
 *
 * @param section    Top-level YAML key (e.g. 'tunnel', 'backup')
 * @param envPrefix  Prefix for env var overrides (e.g. 'KADI_TUNNEL' →
 *                   KADI_TUNNEL_SERVER_ADDR overrides tunnel.server_addr)
 * @returns          Merged config object.  Returns {} if no config.yml
 *                   is found (non-fatal — allows env-only operation).
 */
export function loadConfig(
  section: string,
  envPrefix: string,
): Record<string, any> {
  const configPath = findConfigFile();
  let config: Record<string, any> = {};

  if (configPath) {
    const parsed = load(readFileSync(configPath, 'utf8')) as Record<string, any>;
    config = { ...(parsed?.[section] ?? {}) };
    if (!loggedSections.has(section)) {
      loggedSections.add(section);
      console.log(`[backup-ability] config.yml loaded from ${configPath} (section: ${section})`);
    }
  } else if (!loggedSections.has('__missing__')) {
    loggedSections.add('__missing__');
    console.warn(
      '[backup-ability] No config.yml found in directory tree — using env vars only',
    );
  }

  // Env vars override file values
  for (const key of Object.keys(config)) {
    const envKey = `${envPrefix}_${key.toUpperCase()}`;
    if (process.env[envKey] !== undefined) {
      config[key] = process.env[envKey];
    }
  }

  // Also pick up env vars that aren't in the file yet
  for (const [envKey, envVal] of Object.entries(process.env)) {
    if (envKey.startsWith(`${envPrefix}_`) && envVal !== undefined) {
      const configKey = envKey.slice(envPrefix.length + 1).toLowerCase();
      if (!(configKey in config)) {
        config[configKey] = envVal;
      }
    }
  }

  return config;
}
