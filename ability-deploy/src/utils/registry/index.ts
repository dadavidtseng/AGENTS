/**
 * Registry Infrastructure
 *
 * Temporary container registry for making local images accessible to Akash providers.
 *
 * **Quick Start:**
 * ```typescript
 * import { setupRegistryIfNeeded } from '@kadi.build/deploy-ability/registry';
 *
 * const ctx = await setupRegistryIfNeeded(profile, logger);
 *
 * try {
 *   await deployToAkash({
 *     loadedProfile: { profile: ctx.deployableProfile }
 *   });
 * } finally {
 *   await ctx.cleanup();
 * }
 * ```
 *
 * @module utils/registry
 */

// Main API
export { setupRegistryIfNeeded, hasLocalImages } from './setup.js';

// Manager class (for advanced use cases)
export { TemporaryContainerRegistryManager } from './manager.js';

// Utilities
export { transformProfileWithRegistry, isLocalImagePattern } from './transformer.js';

// Types
export type {
  RegistryContext,
  RegistryOptions,
  ContainerMapping,
  RegistryCredentials,
  RegistryInfo,
  RegistryUrls,
  ContainerInfo
} from './types.js';
