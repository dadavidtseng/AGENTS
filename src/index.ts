/**
 * deploy-ability - Programmatic deployment library for KADI
 *
 * Deploy applications to Akash Network, local Docker, or other platforms
 * without CLI dependencies.
 *
 * @example Quick Start - Akash
 * ```typescript
 * import { deployToAkash } from '@kadi.build/deploy-ability';
 *
 * const result = await deployToAkash({
 *   projectRoot: process.cwd(),
 *   profile: 'production'
 * });
 *
 * if (result.success) {
 *   console.log(`Deployed! DSEQ: ${result.data.dseq}`);
 *   console.log(`Provider: ${result.data.providerUri}`);
 * } else {
 *   console.error(`Deployment failed: ${result.error.message}`);
 * }
 * ```
 *
 * @example Quick Start - Local
 * ```typescript
 * import { deployToLocal } from '@kadi.build/deploy-ability';
 *
 * const result = await deployToLocal({
 *   projectRoot: process.cwd(),
 *   profile: 'local-dev',
 *   engine: 'docker'
 * });
 *
 * if (result.success) {
 *   console.log('Deployed locally!');
 *   console.log('Services:', result.data.services);
 *   console.log('Endpoints:', result.data.endpoints);
 * }
 * ```
 *
 * @module deploy-ability
 */

// Re-export types
export type * from './types/index.js';

// Re-export errors
export * from './errors/index.js';

// Re-export utilities
export * from './utils/index.js';

// Re-export constants
export * from './constants.js';

// Main deployment functions
export { deployToLocal } from './targets/local/index.js';

// Akash target - complete API exported
export * from './targets/akash/index.js';
