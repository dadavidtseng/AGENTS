/**
 * Typed config reader for KĀDI agents.
 *
 * Returns a `Config` wrapper around the parsed config.toml with typed
 * accessors that throw on missing or wrong-type values.
 *
 * Usage:
 *   const cfg = readConfig();
 *   const url = cfg.string('broker.url');        // throws if missing
 *   const nets = cfg.strings('broker.networks'); // throws if missing
 *   if (cfg.has('broker.remote.url')) { ... }    // optional check
 *
 * @module utils/read-config
 */

import { readFileSync } from 'node:fs';
import { findConfigFile, parseSimpleToml } from './config.js';

// ── Config class ─────────────────────────────────────────────────────

export class Config {
  private data: Record<string, unknown>;
  readonly path: string;

  constructor(data: Record<string, unknown>, path: string) {
    this.data = data;
    this.path = path;
  }

  /** Check if a key exists. */
  has(key: string): boolean {
    return this.data[key] !== undefined;
  }

  /** Get raw value. Returns undefined if missing. */
  get(key: string): unknown {
    return this.data[key];
  }

  /** Get a string value. Throws if missing or wrong type. */
  string(key: string): string {
    const value = this.require(key);
    if (typeof value !== 'string') {
      throw new Error(
        `Config key '${key}' in ${this.path} is ${typeof value}, expected string`,
      );
    }
    return value;
  }

  /** Get a string array. Throws if missing or wrong type. */
  strings(key: string): string[] {
    const value = this.require(key);
    if (!Array.isArray(value)) {
      throw new Error(
        `Config key '${key}' in ${this.path} is ${typeof value}, expected string[]`,
      );
    }
    return value as string[];
  }

  /** Get a boolean. Throws if missing or wrong type. */
  bool(key: string): boolean {
    const value = this.require(key);
    if (typeof value !== 'boolean') {
      throw new Error(
        `Config key '${key}' in ${this.path} is ${typeof value}, expected boolean`,
      );
    }
    return value;
  }

  /** Get a number. Throws if missing or wrong type. */
  number(key: string): number {
    const value = this.require(key);
    if (typeof value !== 'number') {
      throw new Error(
        `Config key '${key}' in ${this.path} is ${typeof value}, expected number`,
      );
    }
    return value;
  }

  // ── Internal ─────────────────────────────────────────────────────

  private require(key: string): unknown {
    const value = this.data[key];
    if (value === undefined) {
      throw new Error(
        `Missing required config key '${key}' in ${this.path}`,
      );
    }
    return value;
  }
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Walk up from CWD to find config.toml, parse it, return a Config instance.
 * Throws if config.toml is not found.
 */
export function readConfig(startDir?: string): Config {
  const configPath = findConfigFile(startDir || process.cwd());
  if (!configPath) {
    throw new Error(
      `config.toml not found. Searched upward from: ${startDir || process.cwd()}`,
    );
  }
  const content = readFileSync(configPath, 'utf-8');
  const data = parseSimpleToml(content);
  return new Config(data, configPath);
}
