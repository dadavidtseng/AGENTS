/**
 * @fileoverview Helper utilities for loading git configuration
 * @module services/git/providers/cli/utils/config-helper
 */

import type { AppConfig } from '@/config/index.js';

/**
 * Safely load the application config.
 * Uses dynamic require to avoid circular dependencies.
 *
 * @returns AppConfig object or null if unavailable
 */
function loadConfig(): AppConfig | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const configModule = require('@/config/index.js') as {
      config: AppConfig;
    };
    return configModule.config;
  } catch {
    return null;
  }
}

/**
 * Get the signCommits setting from config.
 * Returns false if config is unavailable.
 *
 * @returns boolean indicating if commits should be signed
 */
export function shouldSignCommits(): boolean {
  const config = loadConfig();
  return config?.git?.signCommits ?? false;
}
