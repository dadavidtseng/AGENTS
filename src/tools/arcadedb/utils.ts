/**
 * Shared utilities for ArcadeDB tool wrappers
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
 * Find the arcadedb-ability path by checking multiple possible locations
 * relative to this file's directory.
 */
export function getArcadeDBAbilityPath(): string {
  const candidates = [
    // Same level as template-agent-typescript
    resolve(__dirname, '../../../kadi/arcadedb-ability'),
    // One level up
    resolve(__dirname, '../../../../kadi/arcadedb-ability'),
    // Two levels up
    resolve(__dirname, '../../../../../kadi/arcadedb-ability'),
  ];

  for (const path of candidates) {
    if (existsSync(path)) {
      return path;
    }
  }

  throw new Error(
    `arcadedb-ability not found. Searched locations:\n${candidates.join('\n')}`
  );
}
