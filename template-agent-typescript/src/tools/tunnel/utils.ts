/**
 * Shared utilities for tunnel tool wrappers
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
 * Find the kadi-tunnel-ability path by checking multiple possible locations
 * relative to this file's directory.
 */
export function getKadiTunnelAbilityPath(): string {
  const candidates = [
    // Same level as template-agent-typescript
    resolve(__dirname, '../../../kadi/kadi-tunnel-ability'),
    // One level up
    resolve(__dirname, '../../../../kadi/kadi-tunnel-ability'),
    // Two levels up
    resolve(__dirname, '../../../../../kadi/kadi-tunnel-ability'),
  ];

  for (const path of candidates) {
    if (existsSync(path)) {
      return path;
    }
  }

  throw new Error(
    `kadi-tunnel-ability not found. Searched locations:\n${candidates.join('\n')}`
  );
}
