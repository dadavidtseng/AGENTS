/**
 * Local Deployment Target - Public API
 *
 * Main entry point for local Docker/Podman deployments.
 * Re-exports all public APIs and types for the local target.
 *
 * @example Basic Usage
 * ```typescript
 * import { deployToLocal } from '@kadi.build/deploy-ability/local';
 *
 * const result = await deployToLocal({
 *   projectRoot: '/path/to/project',
 *   profile: 'local-dev'
 * });
 *
 * if (result.success) {
 *   console.log('Deployed!', result.data.endpoints);
 * }
 * ```
 *
 * @example With Progress Tracking
 * ```typescript
 * import { deployToLocal } from '@kadi.build/deploy-ability/local';
 *
 * const result = await deployToLocal({
 *   projectRoot: process.cwd(),
 *   onProgress: (event) => {
 *     console.log(`[${event.phase}] ${event.message}`);
 *   }
 * });
 * ```
 *
 * @module targets/local
 */

// Main deployment function
export { deployLocal as deployToLocal } from './deployer.js';

// Engine management
export {
  ensureEngineRunning,
  checkEngineRunning,
  getEngineVersion,
  type EngineInfo,
  type EngineCheckOptions,
} from './engine-manager.js';

// Network management
export {
  ensureNetwork,
  networkExists,
  getNetworkInfo,
  removeNetwork,
  type NetworkOptions,
  type CreateNetworkOptions,
} from './network-manager.js';

// Compose generation
export {
  generateComposeFile,
  generateComposeYAML,
  composeFileToYAML,
  convertEnvArrayToObject,
  convertPortsToComposeFormat,
  type ServiceInput,
  type ComposeGenerationOptions,
} from './compose-generator.js';

// Local types
export type {
  ComposeFile,
  ComposeService,
  ComposeNetwork,
  PortMapping,
  RestartPolicy,
  NetworkMode,
  ContainerStatus,
  ContainerInfo,
  NetworkInfo,
  ServiceDependency,
  Healthcheck,
  VolumeMount,
  ServiceValidationError,
} from './types.js';
