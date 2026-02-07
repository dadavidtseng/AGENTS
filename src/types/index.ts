/**
 * Type definitions barrel export
 *
 * Centralized export point for all type definitions in deploy-ability
 *
 * @module types
 */

// Common types
export type {
  Brand,
  DeploymentSequence,
  WalletAddress,
  ProviderUri,
  ImageReference,
  Network,
  ContainerEngine,
  DeploymentTarget,
  DeploymentLogger,
  ProgressEvent,
  CpuUnits,
  MemorySize,
  StorageSize,
  AkashResourceRequirements,
  LocalResourceRequirements,
  ResourceRequirements,
  GpuVendor,
  GpuModel,
  GpuRequirements,
  PortExposure,
  EnvironmentVariable,
  AkashServiceConfig,
  LocalServiceConfig,
  BaseServiceConfig,
  ProgressCallback,
} from './common.js';

// Result types
export type {
  Success,
  Failure,
  Result,
  AkashDeploymentData,
  AkashDryRunData,
  AkashDeploymentResult,
  LocalDeploymentData,
  LocalDryRunData,
  LocalDeploymentResult,
  WalletConnectionData,
  WalletConnectionResult,
  CertificateData,
  CertificateResult,
} from './results.js';

export { success, failure, isSuccess, isFailure } from './results.js';

// Validators
export {
  WalletAddressSchema,
  DeploymentSequenceSchema,
  createWalletAddress,
  createDeploymentSequence,
  isWalletAddress,
  isDeploymentSequence,
  toWalletAddress,
  toDeploymentSequence,
} from './validators.js';

// Options types
export type {
  BaseDeploymentOptions,
  AkashDeploymentOptions,
  LocalDeploymentOptions,
  WalletConnectionOptions,
  CertificateOptions,
  MonitoringOptions,
  BlacklistConfig,
} from './options.js';

// Profile types
export type {
  AgentConfig,
  BuildProfile,
  BaseDeploymentProfile,
  LocalDeploymentProfile,
  AkashDeploymentProfile,
  DeploymentProfile,
  LoadedProfile,
} from './profiles.js';

export { isLocalProfile, isAkashProfile } from './profiles.js';
