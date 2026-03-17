/**
 * Utilities for local-remote-file-manager tool wrappers
 *
 * Provides shared utilities for all local-remote-file-manager tools including:
 * - Zod schema validation
 * - Logger for consistent logging
 * - Path resolution for ability loading
 * - Module name constant
 */

import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

// Re-export common dependencies for tool files
export { z } from '@kadi.build/core';
export type { KadiClient } from '@kadi.build/core';
export { logger, timer } from 'agents-library';

// Define module-specific constant
export const MODULE_AGENT = 'local-remote-file-manager';

// Get current file's directory for relative path resolution
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Get the path to local-remote-file-manager-ability
 *
 * This works for both development (src/) and production (dist/) builds.
 * The ability is located at: C:\p4\Personal\SD\kadi\local-remote-file-manager-ability
 * From dist/tools/local-remote-file-manager/: ../../../ goes to template-agent-typescript root
 * Then ../ goes to AGENTS, then kadi/local-remote-file-manager-ability
 */
export function getLocalRemoteFileManagerAbilityPath(): string {
  // Try common paths based on project structure
  const candidates = [
    resolve(__dirname, '../../../kadi/local-remote-file-manager-ability'),  // From dist/tools/local-remote-file-manager/
    resolve(__dirname, '../../../../kadi/local-remote-file-manager-ability'), // From src/tools/local-remote-file-manager/ (dev)
    resolve(__dirname, '../../../../../kadi/local-remote-file-manager-ability'), // Alternative structure
  ];

  for (const path of candidates) {
    if (existsSync(path)) {
      return path;
    }
  }

  // If none found, throw with helpful error
  throw new Error(`local-remote-file-manager-ability not found. Tried paths: ${candidates.join(', ')}`);
}
