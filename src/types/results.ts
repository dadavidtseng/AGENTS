/**
 * Result type definitions for deployment operations
 *
 * This module uses discriminated unions for type-safe error handling.
 * All deployment operations return Result types that explicitly represent
 * success or failure states.
 *
 * @module types/results
 */

import type {
  DeploymentSequence,
  WalletAddress,
  ProviderUri,
  Network,
  ContainerEngine,
} from './common.js';

/**
 * Success result wrapper
 *
 * Represents a successful operation with data
 *
 * @template TData - The type of the success data
 */
export interface Success<TData> {
  readonly success: true;
  readonly data: TData;
}

/**
 * Failure result wrapper
 *
 * Represents a failed operation with error information
 *
 * @template TError - The type of the error
 */
export interface Failure<TError> {
  readonly success: false;
  readonly error: TError;
}

/**
 * Result type combining success and failure
 *
 * A discriminated union that forces explicit error handling
 *
 * @template TData - The type of success data
 * @template TError - The type of error (defaults to Error)
 *
 * @example
 * const result: Result<number> = await someOperation();
 * if (result.success) {
 *   console.log(result.data); // TypeScript knows this is number
 * } else {
 *   console.error(result.error); // TypeScript knows this is Error
 * }
 */
export type Result<TData, TError = Error> = Success<TData> | Failure<TError>;

/**
 * Akash deployment result data
 *
 * Contains all information about a successful Akash deployment
 */
export interface AkashDeploymentData {
  /**
   * Deployment sequence number (unique ID)
   */
  readonly dseq: DeploymentSequence;

  /**
   * Wallet address that owns the deployment
   */
  readonly owner: WalletAddress;

  /**
   * Provider that accepted the lease
   */
  readonly provider: WalletAddress;

  /**
   * Provider's API endpoint
   */
  readonly providerUri: ProviderUri;

  /**
   * Group sequence number
   */
  readonly gseq: number;

  /**
   * Order sequence number
   */
  readonly oseq: number;

  /**
   * Network where deployment was created
   */
  readonly network: Network;

  /**
   * Service endpoints (if exposed globally)
   * Maps service name to its public URL
   *
   * @example
   * {
   *   "api": "https://provider.akash.network:12345",
   *   "web": "https://provider.akash.network:12346"
   * }
   */
  readonly endpoints?: Readonly<Record<string, string>>;

  /**
   * TLS certificate used for provider communication
   * Only included if certificate was generated during deployment
   */
  readonly certificate?: {
    readonly cert: string;
    readonly privateKey: string;
  };

  /**
   * Profile name that was deployed
   */
  readonly profile: string;

  /**
   * Timestamp when deployment was created
   */
  readonly deployedAt: Date;

  /**
   * Deployment status on blockchain
   *
   * - `active`: Deployment is running
   * - `closed`: Deployment has been terminated
   */
  readonly status: 'active' | 'closed';

  /**
   * Lease pricing information
   *
   * Complete pricing breakdown including per-block, per-hour, and per-month costs
   * in uAKT and AKT. Includes method to convert to USD when AKT market price is provided.
   *
   * @example Display pricing in uAKT
   * ```typescript
   * const { leasePrice } = deploymentData;
   * console.log(`${leasePrice.uakt.perMonth} uAKT/month`);
   * console.log(`${leasePrice.akt.perMonth} AKT/month`);
   * ```
   *
   * @example Convert to USD
   * ```typescript
   * const aktPrice = 0.50; // $0.50 per AKT from CoinGecko
   * const usd = leasePrice.toUSD(aktPrice);
   * console.log(`$${usd.perMonth.toFixed(2)}/month`);
   * ```
   *
   * @see LeasePrice for detailed documentation
   */
  readonly leasePrice: import('../targets/akash/pricing.js').LeasePrice;

  /**
   * When the lease was created (blockchain timestamp)
   *
   * This is a string representation of the block height or timestamp
   * when the lease was established on-chain.
   */
  readonly leaseCreatedAt: string;

  /**
   * Services deployed with their resource allocations
   *
   * Provides both aggregated totals and detailed resource specifications.
   * Each service may have multiple resource specs (e.g., different replica configurations),
   * and this field provides both summary totals and granular details.
   *
   * **totalResources**: Aggregated sum of all resource specs (count × resources)
   * **replicaCount**: Total number of replicas across all specs
   * **resourceSpecs**: Detailed breakdown of each resource specification with replica counts
   *
   * @example Simple usage - Display totals
   * ```typescript
   * deploymentData.services?.forEach(service => {
   *   console.log(`Service: ${service.name}`);
   *   console.log(`  Total CPU: ${service.totalResources.cpu}`);
   *   console.log(`  Total Memory: ${service.totalResources.memory}`);
   *   console.log(`  Total Replicas: ${service.replicaCount}`);
   * });
   * ```
   *
   * @example Advanced usage - Show detailed specs
   * ```typescript
   * deploymentData.services?.forEach(service => {
   *   console.log(`Service: ${service.name} (${service.replicaCount} replicas)`);
   *   service.resourceSpecs.forEach((spec, i) => {
   *     console.log(`  Spec ${i + 1}: ${spec.count}× ${spec.cpu} CPU, ${spec.memory} RAM`);
   *   });
   * });
   * ```
   *
   * @example Real-world scenario
   * ```typescript
   * // Service with mixed replica configurations:
   * {
   *   name: "web",
   *   totalResources: { cpu: "5.0", memory: "10Gi", storage: "5Gi" },
   *   replicaCount: 4,
   *   resourceSpecs: [
   *     { count: 3, cpu: "1.0", memory: "2Gi", storage: "1Gi" },  // 3 standard replicas
   *     { count: 1, cpu: "2.0", memory: "4Gi", storage: "2Gi" }   // 1 high-performance replica
   *   ]
   * }
   * ```
   */
  readonly services?: ReadonlyArray<{
    /** Service name from SDL */
    readonly name: string;

    /**
     * Aggregated total resources across all replicas
     *
     * This is the sum of (count × resources) for all resource specs.
     * Use this for displaying overall capacity or cost estimation.
     */
    readonly totalResources: {
      /** Total CPU allocation (e.g., "5.0" = 5 CPU cores total) */
      readonly cpu: string;
      /** Total memory allocation (e.g., "10Gi" = 10 GiB total) */
      readonly memory: string;
      /** Total storage allocation (e.g., "5Gi" = 5 GiB total) */
      readonly storage: string;
    };

    /**
     * Total number of replicas across all resource specs
     *
     * Sum of all `count` fields in resourceSpecs.
     */
    readonly replicaCount: number;

    /**
     * Detailed resource specifications with replica counts
     *
     * Each spec represents a distinct resource configuration and the number
     * of replicas (count) using that configuration. Most services have only
     * one spec, but advanced deployments may have multiple.
     */
    readonly resourceSpecs: ReadonlyArray<{
      /** Number of replicas with this resource configuration */
      readonly count: number;
      /** CPU per replica (e.g., "1.0", "0.5") */
      readonly cpu: string;
      /** Memory per replica (e.g., "2Gi", "512Mi") */
      readonly memory: string;
      /** Storage per replica (e.g., "1Gi", "10Gi") */
      readonly storage: string;
    }>;
  }>;
}

/**
 * Akash dry-run result data
 *
 * Contains preview information without actually deploying
 */
export interface AkashDryRunData {
  /**
   * Indicates this was a dry run
   */
  readonly dryRun: true;

  /**
   * Generated SDL (Stack Definition Language) content
   */
  readonly sdl: string;

  /**
   * Estimated cost per block in uAKT
   */
  readonly estimatedCost?: number;

  /**
   * Profile name that would be deployed
   */
  readonly profile: string;

  /**
   * Network that would be targeted
   */
  readonly network: Network;
}

/**
 * Result of Akash Network deployment
 *
 * Either deployment data or dry-run data depending on options
 */
export type AkashDeploymentResult =
  | Result<AkashDeploymentData>
  | Result<AkashDryRunData>;

/**
 * Local deployment result data
 *
 * Contains information about a successful local deployment
 */
export interface LocalDeploymentData {
  /**
   * Profile name that was deployed
   */
  readonly profile: string;

  /**
   * Container engine used
   */
  readonly engine: ContainerEngine;

  /**
   * Docker network name
   */
  readonly network: string;

  /**
   * Service names that were deployed
   */
  readonly services: readonly string[];

  /**
   * Container IDs mapped by service name
   */
  readonly containers: Readonly<Record<string, string>>;

  /**
   * Service endpoints (local URLs)
   * Maps service name to localhost:port
   *
   * @example
   * {
   *   "api": "http://localhost:8080",
   *   "web": "http://localhost:3000"
   * }
   */
  readonly endpoints: Readonly<Record<string, string>>;

  /**
   * Path to generated docker-compose.yml
   */
  readonly composePath: string;

  /**
   * Timestamp when deployment was created
   */
  readonly deployedAt: Date;
}

/**
 * Local dry-run result data
 */
export interface LocalDryRunData {
  /**
   * Indicates this was a dry run
   */
  readonly dryRun: true;

  /**
   * Generated docker-compose.yml content
   */
  readonly composeFile: string;

  /**
   * Profile name that would be deployed
   */
  readonly profile: string;

  /**
   * Container engine that would be used
   */
  readonly engine: ContainerEngine;

  /**
   * Services that would be deployed
   */
  readonly services: readonly string[];
}

/**
 * Result of local deployment
 */
export type LocalDeploymentResult =
  | Result<LocalDeploymentData>
  | Result<LocalDryRunData>;

/**
 * Wallet connection result data
 */
export interface WalletConnectionData {
  /**
   * Connected wallet address
   */
  readonly address: WalletAddress;

  /**
   * Wallet type that was used
   */
  readonly walletType: 'keplr' | 'walletconnect';

  /**
   * Account balance in uAKT
   */
  readonly balance?: number;

  /**
   * Network the wallet is connected to
   */
  readonly network: Network;
}

/**
 * Result of wallet connection attempt
 */
export type WalletConnectionResult = Result<WalletConnectionData>;

/**
 * Certificate data
 */
export interface CertificateData {
  /**
   * PEM-encoded certificate
   */
  readonly cert: string;

  /**
   * PEM-encoded private key
   */
  readonly privateKey: string;

  /**
   * Certificate serial number
   */
  readonly serial: string;

  /**
   * Whether this certificate was newly created
   */
  readonly isNew: boolean;

  /**
   * Path where certificate was saved
   */
  readonly path?: string;
}

/**
 * Result of certificate operation
 */
export type CertificateResult = Result<CertificateData>;

/**
 * Helper function to create a success result
 *
 * @template TData - Type of success data
 * @param data - The success data
 * @returns Success result
 *
 * @example
 * return success({ dseq: 12345, provider: 'akash1...' });
 */
export function success<TData>(data: TData): Success<TData> {
  return { success: true, data };
}

/**
 * Helper function to create a failure result
 *
 * @template TError - Type of error
 * @param error - The error
 * @returns Failure result
 *
 * @example
 * return failure(new DeploymentError('Failed to connect', 'CONN_001'));
 */
export function failure<TError = Error>(error: TError): Failure<TError> {
  return { success: false, error };
}

/**
 * Type guard to check if result is successful
 *
 * @param result - The result to check
 * @returns True if result is successful
 *
 * @example
 * if (isSuccess(result)) {
 *   console.log(result.data); // TypeScript knows this exists
 * }
 */
export function isSuccess<TData, TError>(
  result: Result<TData, TError>
): result is Success<TData> {
  return result.success === true;
}

/**
 * Type guard to check if result is a failure
 *
 * @param result - The result to check
 * @returns True if result is a failure
 *
 * @example
 * if (isFailure(result)) {
 *   console.error(result.error); // TypeScript knows this exists
 * }
 */
export function isFailure<TData, TError>(
  result: Result<TData, TError>
): result is Failure<TError> {
  return result.success === false;
}
