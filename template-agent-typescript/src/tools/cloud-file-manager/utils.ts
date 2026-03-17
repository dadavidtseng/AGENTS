/**
 * Shared utilities for cloud-file-manager-ability tools
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
 * Get the path to cloud-file-manager-ability
 *
 * This works for both development (src/) and production (dist/) builds.
 * The ability is located at: C:\p4\Personal\SD\kadi\cloud-file-manager-ability
 * From dist/tools/cloud-file-manager/: ../../../ goes to template-agent-typescript root
 * Then ../ goes to SD, then kadi/cloud-file-manager-ability
 */
export function getCloudFileManagerAbilityPath(): string {
  // Try common paths based on project structure
  const candidates = [
    resolve(__dirname, '../../../kadi/cloud-file-manager-ability'),  // From dist/tools/cloud-file-manager/
    resolve(__dirname, '../../../../kadi/cloud-file-manager-ability'), // From src/tools/cloud-file-manager/ (dev)
    resolve(__dirname, '../../../../../kadi/cloud-file-manager-ability'), // Alternative structure
  ];

  for (const path of candidates) {
    if (existsSync(path)) {
      return path;
    }
  }

  // If none found, throw with helpful error
  throw new Error(`cloud-file-manager-ability not found. Tried paths: ${candidates.join(', ')}`);
}
