/**
 * Backup-specific config loader for arcadedb-ability.
 *
 * Loads the `tunnel` and `backup` sections from config.yml for the
 * file-sharing staging server used by arcade-backup.
 *
 * This is a thin wrapper around the walk-up config.yml pattern already
 * used by the main arcadedb config loader.
 *
 * @module lib/backup-config
 */

import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { load } from 'js-yaml';

/**
 * Walk up from CWD looking for config.yml.
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
 * Load a named section from config.yml with env-var overrides.
 *
 * Same pattern as backup-ability's loadConfig — kept here so
 * arcadedb-ability doesn't need a dependency on backup-ability.
 *
 * @param section    Top-level YAML key (e.g. 'tunnel')
 * @param envPrefix  Env var prefix (e.g. 'KADI_TUNNEL')
 * @returns          Config object (empty {} if section not found)
 */
export function loadConfig(
  section: string,
  envPrefix: string,
): Record<string, any> {
  const configPath = findConfigFile();
  let config: Record<string, any> = {};

  if (configPath) {
    try {
      const parsed = load(readFileSync(configPath, 'utf8')) as Record<string, any>;
      config = (parsed?.[section] as Record<string, any>) ?? {};
    } catch {
      // Config file parse error — fall through to env vars
    }
  }

  // Env var overrides: KADI_TUNNEL_SERVER_ADDR → server_addr
  const prefix = envPrefix + '_';
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith(prefix) && value !== undefined) {
      const configKey = key
        .slice(prefix.length)
        .toLowerCase();
      config[configKey] = value;
    }
  }

  return config;
}

