/**
 * Shared utilities for container registry tool wrappers
 */

import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

export { z } from '@kadi.build/core';
export type { KadiClient } from '@kadi.build/core';
export { logger, MODULE_AGENT, timer } from 'agents-library';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Find the container-registry-ability path by checking multiple possible locations
 * relative to this file's directory.
 */
export function getContainerRegistryAbilityPath(): string {
  const candidates = [
    // Same level as template-agent-typescript
    resolve(__dirname, '../../../kadi/container-registry-ability'),
    // One level up
    resolve(__dirname, '../../../../kadi/container-registry-ability'),
    // Two levels up
    resolve(__dirname, '../../../../../kadi/container-registry-ability'),
  ];

  for (const path of candidates) {
    if (existsSync(path)) {
      return path;
    }
  }

  throw new Error(
    `container-registry-ability not found. Searched locations:\n${candidates.join('\n')}`
  );
}
