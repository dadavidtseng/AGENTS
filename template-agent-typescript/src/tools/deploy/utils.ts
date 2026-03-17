/**
 * Shared utilities for deploy-ability tools
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
 * Get the path to deploy-ability
 *
 * This works for both development (src/) and production (dist/) builds.
 * The ability is located at: C:\p4\Personal\SD\kadi\deploy-ability
 * From dist/tools/deploy/: ../../../ goes to template-agent-typescript root
 * Then ../ goes to SD, then kadi/deploy-ability
 */
export function getDeployAbilityPath(): string {
  // Try common paths based on project structure
  const candidates = [
    resolve(__dirname, '../../../kadi/deploy-ability'),  // From dist/tools/deploy/
    resolve(__dirname, '../../../../kadi/deploy-ability'), // From src/tools/deploy/ (dev)
    resolve(__dirname, '../../../../../kadi/deploy-ability'), // Alternative structure
  ];

  for (const path of candidates) {
    if (existsSync(path)) {
      return path;
    }
  }

  // If none found, throw with helpful error
  throw new Error(`deploy-ability not found. Tried paths: ${candidates.join(', ')}`);
}
