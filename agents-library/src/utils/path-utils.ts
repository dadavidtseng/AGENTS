/**
 * Cross-platform path utilities for WSL/Windows interop.
 *
 * When git worktrees are created on Windows, the `.git` file stores
 * Windows-style paths (e.g. `C:/GitHub/...`). If the agent later runs
 * inside WSL, those paths must be translated to `/mnt/c/GitHub/...`.
 */

import os from 'os';
import fs from 'fs';

/** Cached result — true when running inside WSL. */
let _isWsl: boolean | null = null;

/**
 * Detect whether the current process is running inside WSL.
 * Uses `/proc/version` which contains "microsoft" or "WSL" on WSL distros.
 */
export function isWsl(): boolean {
  if (_isWsl !== null) return _isWsl;

  if (os.platform() !== 'linux') {
    _isWsl = false;
    return false;
  }

  try {
    const procVersion = fs.readFileSync('/proc/version', 'utf-8').toLowerCase();
    _isWsl = procVersion.includes('microsoft') || procVersion.includes('wsl');
  } catch {
    _isWsl = false;
  }

  return _isWsl;
}

/**
 * Convert a Windows-style path to a WSL path when running inside WSL.
 *
 * `C:/GitHub/foo` → `/mnt/c/GitHub/foo`
 * `D:\Projects\bar` → `/mnt/d/Projects/bar`
 *
 * If not running in WSL, or the path is already POSIX, returns as-is.
 */
export function toNativePath(p: string): string {
  if (!isWsl()) return p;

  // Match drive letter: C:/ or C:\ (case-insensitive)
  const match = p.match(/^([A-Za-z]):[/\\](.*)/);
  if (!match) return p;

  const drive = match[1].toLowerCase();
  const rest = match[2].replace(/\\/g, '/');
  return `/mnt/${drive}/${rest}`;
}
