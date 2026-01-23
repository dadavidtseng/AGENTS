/**
 * Shared utilities for ability-file-management tools
 *
 * This module centralizes common imports and helper functions
 * to avoid code duplication across tool files.
 */

import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

// Re-export common dependencies for tool files
export { z } from '@kadi.build/core';
export type { KadiClient } from '@kadi.build/core';
export { logger, MODULE_AGENT, timer } from 'agents-library';

// Get current file's directory for relative path resolution
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Get the path to ability-file-management
 *
 * This works for both development (src/) and production (dist/) builds.
 * The ability is located at: C:\GitHub\ability-file-management
 * From dist/tools/file-management/: ../../../ goes up to C:\GitHub
 * From src/tools/file-management/: ../../../../ goes up to C:\GitHub
 */
export function getFileManagementAbilityPath(): string {
  // Try common paths based on project structure
  const candidates = [
    resolve(__dirname, '../../../ability-file-management'),  // From dist/tools/file-management/ → C:\GitHub\ability-file-management
    resolve(__dirname, '../../../../ability-file-management'), // From src/tools/file-management/ (dev) → C:\GitHub\ability-file-management
    resolve(__dirname, '../../../kadi/ability-file-management'),  // Legacy path (backward compatibility)
    resolve(__dirname, '../../../../kadi/ability-file-management'), // Legacy path (backward compatibility)
  ];

  for (const path of candidates) {
    if (existsSync(path)) {
      return path;
    }
  }

  // If none found, throw with helpful error
  throw new Error(`ability-file-management not found. Tried paths: ${candidates.join(', ')}`);
}


