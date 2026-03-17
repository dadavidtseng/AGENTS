/**
 * Utilities barrel export
 *
 * @module utils
 */

export {
  ConsoleLogger,
  SilentLogger,
  createLogger,
  defaultLogger,
} from './logger.js';

export {
  loadAgentConfig,
  loadDeploymentProfile,
  loadFirstProfile,
  loadProfile,
  getAvailableProfiles,
} from './profile-loader.js';

export {
  runCommand,
  runCommandSimple,
  commandExists,
  type CommandOptions,
  type CommandResult,
} from './command-runner.js';

export {
  setupRegistryIfNeeded,
  hasLocalImages,
  TemporaryContainerRegistryManager,
  transformProfileWithRegistry,
  isLocalImagePattern,
  type RegistryContext,
  type RegistryOptions,
  type ContainerMapping,
  type RegistryCredentials,
  type RegistryInfo,
  type RegistryUrls,
  type ContainerInfo,
} from './registry/index.js';
