/**
 * Configuration loader for arcadedb-ability.
 *
 * **Settings** (host, port, paths) come from `config.yml` via walk-up discovery.
 * **Credentials** (username, password) come from secret-ability's `arcadedb`
 * vault, delivered as env vars at runtime. They are NEVER read from config.yml.
 *
 * Resolution order (highest wins):
 *   1. Environment variables  (ARCADE_HOST, ARCADE_PORT, ...)
 *   2. `config.yml` file      (walk-up from CWD — settings only, no secrets)
 *   3. Built-in defaults      (localhost:2480, kadi-arcadedb, ...)
 *
 * Credential resolution:
 *   1. `ARCADE_USERNAME` / `ARCADE_PASSWORD` env vars (set by secret-ability)
 *   2. Built-in dev defaults   (root / playwithdata)
 */

import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { load } from 'js-yaml';

import type { ArcadeConfig } from './types.js';

/**
 * Walk up from the current working directory looking for `config.yml`.
 *
 * This mirrors the walk-up discovery pattern used by secret-ability for
 * `secrets.toml` — start at CWD, check each parent until found.
 *
 * @returns Absolute path to the first matching file, or `null` if none is
 *          found before reaching the filesystem root.
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
 * Load and return the `arcadedb` section from the nearest `config.yml`.
 *
 * Returns an empty object when no config file is found so callers can
 * fall through to environment variables and defaults.
 */
function loadConfigSection(): Record<string, unknown> {
  const configPath = findConfigFile();
  if (!configPath) return {};

  const parsed = load(readFileSync(configPath, 'utf8')) as Record<string, unknown>;
  return (parsed?.arcadedb as Record<string, unknown>) ?? {};
}

/**
 * Build the fully-resolved {@link ArcadeConfig}.
 *
 * Settings environment variables (override config.yml):
 *   - `ARCADE_HOST`           -- Server hostname       (default: `localhost`)
 *   - `ARCADE_PORT`           -- HTTP API port          (default: `2480`)
 *   - `ARCADE_CONTAINER_NAME` -- Docker container name  (default: `kadi-arcadedb`)
 *   - `ARCADE_DATA_DIR`       -- Data directory         (default: `./arcadedb-data`)
 *   - `ARCADE_BACKUP_DIR`     -- Backup path            (default: `./arcadedb-data/backups`)
 *
 * Credential environment variables (set by secret-ability vault):
 *   - `ARCADE_USERNAME`       -- Auth user              (default: `root`)
 *   - `ARCADE_PASSWORD`       -- Auth password           (default: `playwithdata`)
 */
export function loadArcadeConfig(): ArcadeConfig {
  const file = loadConfigSection();

  // Pick storage paths from the config section matching deployment mode.
  // config.yml defines both `local:` and `container:` sub-sections with
  // explicit data_dir / backup_dir values.  Env vars still win over config.
  const isContainer = process.env.KADI_DEPLOY_MODE === 'container';
  const modeSection = isContainer
    ? (file.container as Record<string, any>) ?? {}
    : (file.local as Record<string, any>) ?? {};

  // Fallback defaults if the mode section is missing from config.yml
  const fallbackDataDir = isContainer ? '/home/arcadedb/databases' : './arcadedb-data';
  const fallbackBackupDir = isContainer ? '/home/arcadedb/backups' : './arcadedb-data/backups';

  return {
    server: {
      host: process.env.ARCADE_HOST ?? (file.host as string) ?? 'localhost',
      port: Number(process.env.ARCADE_PORT ?? file.port ?? 2480),
      username: process.env.ARCADE_USERNAME ?? 'root',
      password: process.env.ARCADE_PASSWORD ?? 'playwithdata',
      container_name: process.env.ARCADE_CONTAINER_NAME ?? (file.container_name as string) ?? 'kadi-arcadedb',
    },
    storage: {
      data_dir: process.env.ARCADE_DATA_DIR ?? (modeSection.data_dir as string) ?? fallbackDataDir,
      backup_dir: process.env.ARCADE_BACKUP_DIR ?? (modeSection.backup_dir as string) ?? fallbackBackupDir,
    },
    defaults: {
      backup_retention_days: Number(file.backup_retention_days ?? 30),
      log_lines: Number(file.log_lines ?? 50),
    },
  };
}
