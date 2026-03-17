/**
 * Options type definitions for deployment operations
 *
 * This module defines configuration options for different deployment targets.
 * All options use readonly properties to ensure immutability.
 *
 * @module types/options
 */

import type {
  DeploymentLogger,
  Network,
  ContainerEngine,
  ProgressCallback,
} from './common.js';
import type { LoadedProfile, AkashDeploymentProfile, LocalDeploymentProfile } from './profiles.js';

/**
 * Blacklist configuration for provider filtering
 *
 * Advanced configuration for controlling how provider blacklisting works.
 * Used when you need explicit control over blacklist behavior.
 */
export interface BlacklistConfig {
  /**
   * Blacklist mode
   *
   * - `merge`: Add to profile blacklist (default behavior when using array)
   * - `replace`: Replace profile blacklist entirely
   * - `none`: Disable all blacklisting (ignore profile)
   */
  readonly mode: 'merge' | 'replace' | 'none';

  /**
   * Provider addresses to blacklist
   *
   * Required for 'merge' and 'replace' modes, ignored for 'none' mode
   *
   * @example ['akash1abc...', 'akash1def...']
   */
  readonly providers?: readonly string[];
}

/**
 * Base deployment options shared across all targets
 *
 * These options apply regardless of deployment target
 */
export interface BaseDeploymentOptions {
  /**
   * Path to project root directory containing agent.json
   *
   * @example '/path/to/my-project'
   * @example process.cwd()
   */
  readonly projectRoot: string;

  /**
   * Deployment profile name from agent.json
   *
   * References a profile defined in agent.json's deploy section
   *
   * @example 'production'
   * @example 'staging'
   * @example 'local-dev'
   */
  readonly profile: string;

  /**
   * Custom logger implementation
   *
   * If not provided, uses console-based default logger
   *
   * @example
   * {
   *   log: (msg) => winston.info(msg),
   *   error: (msg) => winston.error(msg),
   *   warn: (msg) => winston.warn(msg),
   *   debug: (msg) => winston.debug(msg)
   * }
   */
  readonly logger?: DeploymentLogger;

  /**
   * Enable verbose debug logging
   *
   * @default false
   */
  readonly verbose?: boolean;

  /**
   * Dry run mode - preview without deploying
   *
   * When true, generates deployment artifacts but doesn't execute deployment
   *
   * @default false
   */
  readonly dryRun?: boolean;

  /**
   * Progress callback for real-time updates
   *
   * Called periodically during deployment to report progress
   *
   * @example
   * onProgress: (event) => {
   *   console.log(`${event.phase}: ${event.message}`);
   *   if (event.progress) {
   *     updateProgressBar(event.progress);
   *   }
   * }
   */
  readonly onProgress?: ProgressCallback;
}

/**
 * Akash Network deployment options
 *
 * Configuration specific to deploying on Akash Network
 */
export interface AkashDeploymentOptions extends BaseDeploymentOptions {
  /**
   * Pre-loaded profile with transformations applied
   *
   * Allows callers to modify the profile before deployment (e.g., replace
   * local images with registry URLs). When provided, skips loading from disk.
   */
  readonly loadedProfile?: LoadedProfile<AkashDeploymentProfile>;

  /**
   * Akash network to deploy to
   *
   * @default 'mainnet'
   */
  readonly network?: Network;

  /**
   * Path to existing certificate JSON file
   *
   * If not provided, will attempt to create a new certificate
   * or load from default location (~/.akash/certificate.json)
   *
   * @example '/path/to/certificate.json'
   */
  readonly certificatePath?: string;

  /**
   * WalletConnect project ID
   *
   * Required for WalletConnect integration.
   * Get one at https://cloud.walletconnect.com
   *
   * @example 'abc123def456...'
   */
  readonly walletConnectProjectId?: string;

  /**
   * Auto-accept first bid without user confirmation
   *
   * Useful for automated deployments. Use with caution in production.
   *
   * @default false
   */
  readonly autoAcceptBid?: boolean;

  /**
   * Provider blacklist configuration
   *
   * Controls how provider blacklisting works:
   * - `string[]`: Adds to profile blacklist (default behavior)
   * - `{mode: 'merge', providers: string[]}`: Explicitly merge with profile
   * - `{mode: 'replace', providers: string[]}`: Replace profile blacklist entirely
   * - `{mode: 'none'}`: Disable all blacklisting (ignore profile)
   *
   * @example
   * ```typescript
   * // Simple case - adds to profile blacklist
   * blacklist: ['akash1xyz...']
   *
   * // Explicit merge (same as array)
   * blacklist: { mode: 'merge', providers: ['akash1xyz...'] }
   *
   * // Replace profile blacklist entirely
   * blacklist: { mode: 'replace', providers: ['akash1xyz...'] }
   *
   * // Disable all blacklisting
   * blacklist: { mode: 'none' }
   * ```
   */
  readonly blacklist?: readonly string[] | BlacklistConfig;

  /**
   * Maximum price per block in uAKT
   *
   * Bids above this price will be rejected
   *
   * @example 1000
   */
  readonly maxPrice?: number;

  /**
   * Deployment deposit in uAKT
   *
   * Amount to deposit for the deployment
   * If not specified, uses minimum required amount
   *
   * @example 5000000
   */
  readonly deposit?: number;

  /**
   * Use remote container registry instead of temporary local registry
   *
   * @default false
   */
  readonly useRemoteRegistry?: boolean;

  /**
   * Timeout for waiting for lease (milliseconds)
   *
   * @default 300000 (5 minutes)
   */
  readonly leaseTimeout?: number;

  /**
   * Timeout for waiting for containers to run (milliseconds)
   *
   * @default 600000 (10 minutes)
   */
  readonly containerTimeout?: number;
}

/**
 * Local deployment options
 *
 * Configuration specific to local Docker/Podman deployment
 */
export interface LocalDeploymentOptions extends BaseDeploymentOptions {
  /**
   * Pre-loaded profile with transformations applied
   *
   * Allows callers to modify the profile before deployment (e.g., inject
   * environment variables for Trusted Introducer pattern). When provided,
   * skips loading from disk.
   */
  readonly loadedProfile?: LoadedProfile<LocalDeploymentProfile>;

  /**
   * Container orchestration engine
   *
   * @default 'docker'
   */
  readonly engine?: ContainerEngine;

  /**
   * Docker network name for inter-service communication
   *
   * @default 'kadi-net'
   */
  readonly network?: string;

  /**
   * Path where docker-compose.yml should be generated
   *
   * @default '{projectRoot}/docker-compose.yml'
   */
  readonly composeOutputPath?: string;

  /**
   * Pull images before deploying
   *
   * Forces pull of latest image versions
   *
   * @default false
   */
  readonly pullImages?: boolean;

  /**
   * Force recreate containers even if configuration unchanged
   *
   * @default false
   */
  readonly forceRecreate?: boolean;

  /**
   * Build missing images before deploying
   *
   * If true, will attempt to build images that don't exist locally
   *
   * @default false
   */
  readonly buildMissing?: boolean;

  /**
   * Remove orphaned containers
   *
   * Removes containers for services not defined in current compose file
   *
   * @default true
   */
  readonly removeOrphans?: boolean;

  /**
   * Timeout for container startup (seconds)
   *
   * @default 60
   */
  readonly startupTimeout?: number;
}

/**
 * Wallet connection options
 */
export interface WalletConnectionOptions {
  /**
   * Network to connect to
   */
  readonly network: Network;

  /**
   * WalletConnect project ID
   *
   * Required if using WalletConnect instead of Keplr
   */
  readonly walletConnectProjectId?: string;

  /**
   * Preferred wallet type
   *
   * If not specified, will try Keplr first, then WalletConnect
   */
  readonly preferredWallet?: 'keplr' | 'walletconnect';

  /**
   * Custom logger
   */
  readonly logger?: DeploymentLogger;
}

/**
 * Certificate loading/creation options
 */
export interface CertificateOptions {
  /**
   * Path to existing certificate file
   *
   * If not provided, will look in default locations
   */
  readonly certificatePath?: string;

  /**
   * Wallet address (for certificate subject)
   */
  readonly walletAddress: string;

  /**
   * Force creation of new certificate even if one exists
   *
   * @default false
   */
  readonly forceNew?: boolean;

  /**
   * Where to save the certificate
   *
   * @default '~/.akash/certificate.json'
   */
  readonly savePath?: string;

  /**
   * Custom logger
   */
  readonly logger?: DeploymentLogger;
}

/**
 * Options for monitoring deployment status
 */
export interface MonitoringOptions {
  /**
   * Lease ID to monitor
   */
  readonly leaseId: {
    readonly dseq: number;
    readonly gseq: number;
    readonly oseq: number;
    readonly owner: string;
    readonly provider: string;
  };

  /**
   * Provider URI
   */
  readonly providerUri: string;

  /**
   * Certificate for provider communication
   */
  readonly certificate: {
    readonly cert: string;
    readonly privateKey: string;
  };

  /**
   * Polling interval in milliseconds
   *
   * @default 5000
   */
  readonly pollInterval?: number;

  /**
   * Maximum time to wait in milliseconds
   *
   * @default 600000 (10 minutes)
   */
  readonly maxWaitTime?: number;

  /**
   * Progress callback
   */
  readonly onProgress?: ProgressCallback;

  /**
   * Custom logger
   */
  readonly logger?: DeploymentLogger;
}
