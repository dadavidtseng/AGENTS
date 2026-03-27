/**
 * Vault Discovery Module
 *
 * Walks up the directory tree from a starting point to find secrets.toml,
 * similar to how npm resolves node_modules or eslint resolves .eslintrc.
 *
 * Resolution order:
 * 1. Explicit configPath (if provided) — no discovery
 * 2. KADI_VAULT_PATH environment variable
 * 3. Walk up from startDir looking for VAULT_CONFIG_FILENAME
 * 4. Global fallback: ~/.kadi/secrets.toml
 * 5. Legacy fallback: ~/.kadi/secrets/config.toml (backward compat)
 * 6. Default: {startDir}/secrets.toml (for creation scenarios)
 */

import * as fs from 'node:fs/promises';
import * as fsSync from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// =============================================================================
// Constants
// =============================================================================

/** The filename we search for when discovering vault configs. */
export const VAULT_CONFIG_FILENAME = 'secrets.toml';

/** Environment variable that overrides discovery with an explicit path. */
export const VAULT_PATH_ENV_VAR = 'KADI_VAULT_PATH';

/** Global config directory (e.g. ~/.kadi/) */
const GLOBAL_KADI_DIR = path.join(os.homedir(), '.kadi');

/** Legacy global config path (~/.kadi/secrets/config.toml) — pre-discovery convention */
const LEGACY_GLOBAL_CONFIG = path.join(GLOBAL_KADI_DIR, 'secrets', 'config.toml');

// =============================================================================
// Types
// =============================================================================

/** How the config path was resolved. */
export type DiscoverySource =
  | 'explicit'    // Caller provided configPath directly
  | 'env'         // From KADI_VAULT_PATH environment variable
  | 'discovered'  // Found via walk-up directory search
  | 'global'      // From ~/.kadi/secrets.toml
  | 'legacy'      // From ~/.kadi/secrets/config.toml (backward compat)
  | 'default';    // Fallback to CWD (file may not exist yet)

export interface DiscoveryResult {
  /** Absolute path to the config file. */
  configPath: string;
  /** How the path was determined. */
  source: DiscoverySource;
}

// =============================================================================
// Discovery cache
// =============================================================================

/**
 * Cache of discovery results keyed by starting directory.
 * Prevents repeated filesystem walks for the same working directory.
 */
const discoveryCache = new Map<string, DiscoveryResult>();

/**
 * Clear the discovery cache. Useful for testing or when the
 * filesystem layout changes at runtime.
 */
export function clearDiscoveryCache(): void {
  discoveryCache.clear();
}

// =============================================================================
// Core discovery
// =============================================================================

/**
 * Check if a file exists at the given path.
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

/**
 * Walk up the directory tree from startDir looking for VAULT_CONFIG_FILENAME.
 * Returns the absolute path to the config file if found, or null.
 */
async function walkUp(startDir: string): Promise<string | null> {
  let dir = path.resolve(startDir);

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const candidate = path.join(dir, VAULT_CONFIG_FILENAME);
    if (await fileExists(candidate)) {
      return candidate;
    }

    const parent = path.dirname(dir);
    if (parent === dir) {
      // Reached filesystem root
      return null;
    }
    dir = parent;
  }
}

/**
 * Walk up the directory tree collecting ALL secrets.toml files found.
 * Returns paths ordered from closest (child) to farthest (ancestor).
 * Does NOT stop at the first match — continues to the filesystem root.
 */
async function walkUpAll(startDir: string): Promise<string[]> {
  const results: string[] = [];
  let dir = path.resolve(startDir);

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const candidate = path.join(dir, VAULT_CONFIG_FILENAME);
    if (await fileExists(candidate)) {
      results.push(candidate);
    }

    const parent = path.dirname(dir);
    if (parent === dir) {
      // Reached filesystem root
      break;
    }
    dir = parent;
  }

  return results;
}

/**
 * Discover the config file path using the walk-up strategy.
 *
 * This is the main discovery function. It does NOT check for explicit
 * configPath or environment variables — those are handled by resolveConfigPath.
 *
 * @param startDir - Directory to start searching from (default: process.cwd())
 * @returns Discovery result with resolved path and source
 */
export async function discoverConfigPath(
  startDir?: string
): Promise<DiscoveryResult> {
  const resolvedStart = path.resolve(startDir ?? process.cwd());

  // Check cache
  const cached = discoveryCache.get(resolvedStart);
  if (cached) {
    return cached;
  }

  // 1. Walk up from startDir
  const found = await walkUp(resolvedStart);
  if (found) {
    const result: DiscoveryResult = { configPath: found, source: 'discovered' };
    discoveryCache.set(resolvedStart, result);
    return result;
  }

  // 2. Check global ~/.kadi/secrets.toml
  const globalPath = path.join(GLOBAL_KADI_DIR, VAULT_CONFIG_FILENAME);
  if (await fileExists(globalPath)) {
    const result: DiscoveryResult = { configPath: globalPath, source: 'global' };
    discoveryCache.set(resolvedStart, result);
    return result;
  }

  // 3. Check legacy ~/.kadi/secrets/config.toml (backward compat)
  if (await fileExists(LEGACY_GLOBAL_CONFIG)) {
    const result: DiscoveryResult = { configPath: LEGACY_GLOBAL_CONFIG, source: 'legacy' };
    discoveryCache.set(resolvedStart, result);
    return result;
  }

  // 4. Default to {startDir}/secrets.toml (for creation scenarios)
  const defaultPath = path.join(resolvedStart, VAULT_CONFIG_FILENAME);
  const result: DiscoveryResult = { configPath: defaultPath, source: 'default' };
  discoveryCache.set(resolvedStart, result);
  return result;
}

/**
 * Discover ALL config file paths by walking the full directory tree upward.
 *
 * Unlike discoverConfigPath (which stops at the first match), this collects
 * every secrets.toml found between startDir and the filesystem root.
 * Results are ordered closest-first (child before parent), so callers can
 * implement child-shadows-parent semantics by processing in order.
 *
 * @param startDir - Directory to start searching from (default: process.cwd())
 * @returns Array of discovery results, closest first. May be empty.
 */
export async function discoverAllConfigPaths(
  startDir?: string
): Promise<DiscoveryResult[]> {
  const resolvedStart = path.resolve(startDir ?? process.cwd());

  // Walk up collecting all secrets.toml files
  const found = await walkUpAll(resolvedStart);

  const results: DiscoveryResult[] = found.map((configPath) => ({
    configPath,
    source: 'discovered' as DiscoverySource,
  }));

  // Also include global ~/.kadi/secrets.toml if it exists and isn't already in the list
  const globalPath = path.join(GLOBAL_KADI_DIR, VAULT_CONFIG_FILENAME);
  if (await fileExists(globalPath)) {
    const alreadyIncluded = results.some((r) => r.configPath === globalPath);
    if (!alreadyIncluded) {
      results.push({ configPath: globalPath, source: 'global' });
    }
  }

  // Also include legacy ~/.kadi/secrets/config.toml if it exists (backward compat)
  if (await fileExists(LEGACY_GLOBAL_CONFIG)) {
    const alreadyIncluded = results.some((r) => r.configPath === LEGACY_GLOBAL_CONFIG);
    if (!alreadyIncluded) {
      results.push({ configPath: LEGACY_GLOBAL_CONFIG, source: 'legacy' });
    }
  }

  return results;
}

/**
 * Resolve the config path, using discovery when no explicit path is given.
 *
 * This replaces the original resolveConfigPath in tools.ts. It maintains
 * full backward compatibility:
 * - If configPath is provided, it is resolved and returned (no discovery)
 * - If KADI_VAULT_PATH env var is set, it is used
 * - Otherwise, walk-up discovery is performed
 *
 * @param configPath - Explicit path provided by the caller (optional)
 * @returns Discovery result with resolved absolute path and source
 */
export async function resolveConfigPath(
  configPath?: string
): Promise<DiscoveryResult> {
  // Explicit path — use as-is (backward compatible behavior)
  if (configPath !== undefined) {
    return {
      configPath: path.resolve(configPath),
      source: 'explicit',
    };
  }

  // Environment variable override
  const envPath = process.env[VAULT_PATH_ENV_VAR];
  if (envPath) {
    return {
      configPath: path.resolve(envPath),
      source: 'env',
    };
  }

  // Walk-up discovery
  return discoverConfigPath();
}

// =============================================================================
// Synchronous variants
// =============================================================================

/**
 * Check if a file exists synchronously.
 */
function fileExistsSync(filePath: string): boolean {
  try {
    return fsSync.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

/**
 * Walk up the directory tree synchronously.
 */
function walkUpSync(startDir: string): string | null {
  let dir = path.resolve(startDir);

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const candidate = path.join(dir, VAULT_CONFIG_FILENAME);
    if (fileExistsSync(candidate)) {
      return candidate;
    }

    const parent = path.dirname(dir);
    if (parent === dir) {
      return null;
    }
    dir = parent;
  }
}

/**
 * Walk up the directory tree synchronously, collecting ALL secrets.toml files.
 * Returns paths ordered from closest (child) to farthest (ancestor).
 */
function walkUpAllSync(startDir: string): string[] {
  const results: string[] = [];
  let dir = path.resolve(startDir);

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const candidate = path.join(dir, VAULT_CONFIG_FILENAME);
    if (fileExistsSync(candidate)) {
      results.push(candidate);
    }

    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }

  return results;
}

/**
 * Synchronous version of discoverConfigPath.
 *
 * Uses fs.statSync for the directory walk — acceptable because:
 * - Only a few stat() calls (O(directory depth), typically 2-5)
 * - Called once per tool invocation, not in a hot loop
 * - Subsequent I/O (readConfig, etc.) is async
 *
 * @param startDir - Directory to start searching from (default: process.cwd())
 */
export function discoverConfigPathSync(startDir?: string): DiscoveryResult {
  const resolvedStart = path.resolve(startDir ?? process.cwd());

  // Check cache
  const cached = discoveryCache.get(resolvedStart);
  if (cached) {
    return cached;
  }

  // 1. Walk up from startDir
  const found = walkUpSync(resolvedStart);
  if (found) {
    const result: DiscoveryResult = { configPath: found, source: 'discovered' };
    discoveryCache.set(resolvedStart, result);
    return result;
  }

  // 2. Check global ~/.kadi/secrets.toml
  const globalPath = path.join(GLOBAL_KADI_DIR, VAULT_CONFIG_FILENAME);
  if (fileExistsSync(globalPath)) {
    const result: DiscoveryResult = { configPath: globalPath, source: 'global' };
    discoveryCache.set(resolvedStart, result);
    return result;
  }

  // 3. Check legacy ~/.kadi/secrets/config.toml (backward compat)
  if (fileExistsSync(LEGACY_GLOBAL_CONFIG)) {
    const result: DiscoveryResult = { configPath: LEGACY_GLOBAL_CONFIG, source: 'legacy' };
    discoveryCache.set(resolvedStart, result);
    return result;
  }

  // 4. Default to {startDir}/secrets.toml (for creation scenarios)
  const defaultPath = path.join(resolvedStart, VAULT_CONFIG_FILENAME);
  const result: DiscoveryResult = { configPath: defaultPath, source: 'default' };
  discoveryCache.set(resolvedStart, result);
  return result;
}

/**
 * Synchronous version of discoverAllConfigPaths.
 *
 * Walks the full directory tree upward, collecting every secrets.toml.
 * Results are ordered closest-first (child before parent).
 *
 * @param startDir - Directory to start searching from (default: process.cwd())
 */
export function discoverAllConfigPathsSync(startDir?: string): DiscoveryResult[] {
  const resolvedStart = path.resolve(startDir ?? process.cwd());

  const found = walkUpAllSync(resolvedStart);

  const results: DiscoveryResult[] = found.map((configPath) => ({
    configPath,
    source: 'discovered' as DiscoverySource,
  }));

  // Also include global ~/.kadi/secrets.toml if it exists and isn't already in the list
  const globalPath = path.join(GLOBAL_KADI_DIR, VAULT_CONFIG_FILENAME);
  if (fileExistsSync(globalPath)) {
    const alreadyIncluded = results.some((r) => r.configPath === globalPath);
    if (!alreadyIncluded) {
      results.push({ configPath: globalPath, source: 'global' });
    }
  }

  // Also include legacy ~/.kadi/secrets/config.toml if it exists (backward compat)
  if (fileExistsSync(LEGACY_GLOBAL_CONFIG)) {
    const alreadyIncluded = results.some((r) => r.configPath === LEGACY_GLOBAL_CONFIG);
    if (!alreadyIncluded) {
      results.push({ configPath: LEGACY_GLOBAL_CONFIG, source: 'legacy' });
    }
  }

  return results;
}

/**
 * Synchronous version of resolveConfigPath.
 *
 * Drop-in replacement for the original resolveConfigPath in tools.ts.
 * Same resolution order, same return semantics, but synchronous.
 *
 * @param configPath - Explicit path provided by the caller (optional)
 * @returns Resolved absolute path to the config file
 */
export function resolveConfigPathSync(configPath?: string): string {
  // Explicit path — use as-is (backward compatible behavior)
  if (configPath !== undefined) {
    return path.resolve(configPath);
  }

  // Environment variable override
  const envPath = process.env[VAULT_PATH_ENV_VAR];
  if (envPath) {
    return path.resolve(envPath);
  }

  // Walk-up discovery
  const result = discoverConfigPathSync();
  return result.configPath;
}
