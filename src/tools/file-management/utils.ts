/**
 * Shared utilities for file-management-ability tools
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
 * Get the path to file-management-ability
 *
 * This works for both development (src/) and production (dist/) builds.
 * The ability is located at: C:\p4\Personal\SD\kadi\file-management-ability
 * From dist/tools/file-management/: ../../../ goes to template-agent-typescript root
 * Then ../ goes to AGENTS, then kadi/file-management-ability
 */
export function getFileManagementAbilityPath(): string {
  // Try common paths based on project structure
  const candidates = [
    resolve(__dirname, '../../../kadi/file-management-ability'),  // From dist/tools/file-management/
    resolve(__dirname, '../../../../kadi/file-management-ability'), // From src/tools/file-management/ (dev)
    resolve(__dirname, '../../../../../kadi/file-management-ability'), // Alternative structure
  ];

  for (const path of candidates) {
    if (existsSync(path)) {
      return path;
    }
  }

  // If none found, throw with helpful error
  throw new Error(`file-management-ability not found. Tried paths: ${candidates.join(', ')}`);
}
