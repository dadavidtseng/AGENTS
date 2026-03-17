/**
 * Common type definitions shared across the deploy-ability library
 *
 * This module provides foundational types including:
 * - Branded types for domain safety
 * - Logger interfaces
 * - Network definitions
 * - Resource specifications
 *
 * @module types/common
 */

/**
 * Branded type utilities for type-safe domain values
 *
 * Branded types prevent accidental mixing of semantically different values
 * that share the same primitive type (e.g., DSEQ vs port number, both numbers)
 */
declare const brand: unique symbol;

/**
 * Creates a branded type from a base type
 *
 * @example
 * type UserId = Brand<number, 'UserId'>;
 * type ProductId = Brand<number, 'ProductId'>;
 *
 * const userId: UserId = 123 as UserId;
 * const productId: ProductId = 456 as ProductId;
 * // userId and productId are incompatible despite both being numbers
 */
export type Brand<T, TBrand extends string> = T & {
  readonly [brand]: TBrand;
};

/**
 * Deployment sequence number on Akash Network
 *
 * A unique identifier for a deployment on the Akash blockchain.
 * Branded to prevent confusion with other numeric IDs.
 */
export type DeploymentSequence = Brand<number, 'DSEQ'>;

/**
 * Akash wallet address
 *
 * A bech32-encoded address starting with "akash1"
 * Branded to prevent mixing with other string values
 */
export type WalletAddress = Brand<string, 'AkashAddress'>;

/**
 * Provider URI
 *
 * The HTTPS endpoint of an Akash provider
 */
export type ProviderUri = string;

/**
 * Container image reference
 *
 * A Docker image reference (e.g., "nginx:latest", "myapp:1.0.0")
 */
export type ImageReference = string;

/**
 * Network target for deployment
 */
export type Network = 'mainnet' | 'testnet' | 'sandbox';

/**
 * Container orchestration engine
 */
export type ContainerEngine = 'docker' | 'podman';

/**
 * Deployment target platform
 */
export type DeploymentTarget = 'akash' | 'local';

/**
 * Logger interface for deployment operations
 *
 * Provides structured logging with multiple severity levels.
 * Implement this interface to integrate with your logging system.
 *
 * @example
 * const logger: DeploymentLogger = {
 *   log: (msg) => console.log(`[INFO] ${msg}`),
 *   error: (msg) => console.error(`[ERROR] ${msg}`),
 *   warn: (msg) => console.warn(`[WARN] ${msg}`),
 *   debug: (msg) => process.env.DEBUG && console.debug(`[DEBUG] ${msg}`)
 * };
 */
export interface DeploymentLogger {
  /**
   * Log informational messages
   * Use for normal operational messages
   */
  log(message: string, ...args: unknown[]): void;

  /**
   * Log error messages
   * Use for errors that need attention
   */
  error(message: string, ...args: unknown[]): void;

  /**
   * Log warning messages
   * Use for concerning but non-critical issues
   */
  warn(message: string, ...args: unknown[]): void;

  /**
   * Log debug messages
   * Use for detailed diagnostic information
   */
  debug(message: string, ...args: unknown[]): void;
}

/**
 * Progress event for deployment operations
 *
 * Emitted during deployment to provide real-time status updates.
 * Used with onProgress callbacks to track deployment progress.
 *
 * @example
 * ```typescript
 * onProgress: (event) => {
 *   console.log(`[${event.phase}] ${event.message}`);
 *   if (event.data) {
 *     console.log('Data:', event.data);
 *   }
 * }
 * ```
 */
export interface ProgressEvent {
  /**
   * Current deployment phase
   *
   * - `profile`: Loading and validating deployment profile
   * - `engine`: Checking/starting container engine
   * - `network`: Setting up Docker network
   * - `compose`: Generating docker-compose.yml
   * - `deploy`: Deploying containers
   * - `complete`: Deployment finished successfully
   */
  readonly phase: 'profile' | 'engine' | 'network' | 'compose' | 'deploy' | 'complete';

  /**
   * Human-readable progress message
   */
  readonly message: string;

  /**
   * Optional structured data about this phase
   */
  readonly data?: unknown;
}

/**
 * CPU resource specification
 *
 * Represents CPU allocation in cores (fractional allowed)
 * @example 0.5 = half a CPU core, 2.0 = two full cores
 */
export type CpuUnits = number;

/**
 * Memory resource specification
 *
 * Memory size with unit suffix (e.g., "512Mi", "2Gi")
 * Follows Kubernetes resource notation
 */
export type MemorySize = string;

/**
 * Storage resource specification
 *
 * Storage size with unit suffix (e.g., "10Gi", "100Mi")
 * Follows Kubernetes resource notation
 */
export type StorageSize = string;

/**
 * Akash storage class types
 *
 * Storage classes define the performance tier and persistence characteristics:
 * - **beta1**: HDD storage (cheapest, slowest) - Good for cold storage, backups
 * - **beta2**: SSD storage (balanced) - Recommended for most workloads
 * - **beta3**: NVMe storage (fastest, most expensive) - For high-IOPS databases
 * - **ram**: System memory (temporary in-memory storage) - Ultra-fast but volatile
 */
export type AkashStorageClass = 'beta1' | 'beta2' | 'beta3' | 'ram';

/**
 * Persistent volume specification for Akash Network
 *
 * Defines a named persistent volume that **survives container restarts**.
 * Data persists for the duration of the lease.
 *
 * **Use Cases:**
 * - Database files (PostgreSQL, MongoDB)
 * - User uploads (images, videos)
 * - ML model weights
 * - Configuration files
 *
 * @example
 * ```typescript
 * const dataVolume: PersistentVolumeSpec = {
 *   name: 'data',
 *   size: '10Gi',
 *   mount: '/data',
 *   class: 'beta2'
 * };
 * ```
 */
export interface PersistentVolumeSpec {
  /**
   * Volume name (must be unique within the service)
   * Used to reference the volume in mount paths
   * @example "data", "cache", "logs"
   */
  readonly name: string;

  /**
   * Volume size with unit suffix
   * @example "1Gi", "10Gi", "100Gi"
   */
  readonly size: StorageSize;

  /**
   * Container mount path for this volume
   * @example "/data", "/var/lib/mysql", "/app/uploads"
   */
  readonly mount: string;

  /**
   * Storage class (performance tier)
   * Defaults to 'beta2' (SSD) if not specified
   * @example "beta2", "beta3"
   */
  readonly class?: AkashStorageClass;
}

/**
 * Resource requirements for Akash deployments
 *
 * Akash requires explicit cpu/memory allocation since the network
 * needs to know what resources to allocate on provider nodes.
 *
 * **Storage vs Memory:**
 * - **memory**: RAM for running processes (fast, volatile)
 * - **ephemeralStorage**: Container root filesystem and /tmp (disk, wiped on restart)
 * - **persistentVolumes**: Named volumes that survive restarts (disk, persistent)
 *
 * @example
 * ```typescript
 * const resources: AkashResourceRequirements = {
 *   cpu: 0.5,
 *   memory: "1Gi",              // 1GB RAM for Node.js runtime
 *   ephemeralStorage: "512Mi",  // 512MB for container root FS, /tmp, logs
 *   persistentVolumes: [
 *     {
 *       name: "data",
 *       size: "10Gi",            // 10GB persistent disk mounted at /data
 *       mount: "/data",
 *       class: "beta2"
 *     }
 *   ]
 * };
 * ```
 */
export interface AkashResourceRequirements {
  /**
   * CPU cores required (fractional allowed) - REQUIRED for Akash
   * @example 0.5, 1.0, 2.0, 4.0
   */
  readonly cpu: number;

  /**
   * Memory (RAM) required with unit suffix - REQUIRED for Akash
   *
   * Used for:
   * - Application heap/stack
   * - In-memory caches
   * - Runtime state
   *
   * @example "512Mi", "1Gi", "2Gi"
   */
  readonly memory: MemorySize;

  /**
   * Ephemeral storage (disk) required with unit suffix
   *
   * Container's root filesystem storage that is **wiped on restart**.
   * Used for:
   * - Container's root filesystem (OS files, binaries)
   * - /tmp directory
   * - Temporary files during processing
   * - Logs before shipping to external service
   *
   * @example "512Mi", "1Gi", "2Gi"
   */
  readonly ephemeralStorage?: StorageSize;

  /**
   * Persistent volumes that **survive container restarts**
   *
   * Named volumes mounted at specific paths that persist for lease duration.
   * Used for:
   * - Database files
   * - User uploads
   * - ML model weights
   * - Configuration files
   *
   * Optional - omit if no persistent storage needed.
   *
   * @example
   * ```typescript
   * [
   *   { name: "data", size: "10Gi", mount: "/data", class: "beta2" },
   *   { name: "cache", size: "5Gi", mount: "/cache", class: "beta1" }
   * ]
   * ```
   */
  readonly persistentVolumes?: readonly PersistentVolumeSpec[];

  /**
   * GPU requirements (Akash-specific)
   * Optional, only for GPU workloads
   */
  readonly gpu?: GpuRequirements;
}

/**
 * Resource requirements for Local deployments (Docker/Podman)
 *
 * All fields optional since Docker/Podman handle defaults.
 * Specify only what you need to override.
 *
 * @example
 * ```typescript
 * // Let Docker use defaults
 * const resources: LocalResourceRequirements = {};
 *
 * // Or specify limits
 * const resources: LocalResourceRequirements = {
 *   cpu: 2,
 *   memory: "4Gi"
 * };
 * ```
 */
export interface LocalResourceRequirements {
  /**
   * CPU cores (fractional allowed) - optional for local
   * @example 0.5, 1.0, 2.0, 4.0
   */
  readonly cpu?: number;

  /**
   * Memory (RAM) with unit suffix - optional for local
   * @example "512Mi", "1Gi", "2Gi"
   */
  readonly memory?: MemorySize;

  /**
   * Ephemeral storage (disk) with unit suffix
   * @example "512Mi", "1Gi", "2Gi"
   */
  readonly ephemeralStorage?: StorageSize;

  /**
   * Persistent volumes
   */
  readonly persistentVolumes?: readonly PersistentVolumeSpec[];

  /**
   * GPU requirements
   */
  readonly gpu?: GpuRequirements;
}

/**
 * Union type for resource requirements (either Akash or Local)
 *
 * Use the specific type when you know the deployment target.
 */
export type ResourceRequirements = AkashResourceRequirements | LocalResourceRequirements;

/**
 * GPU vendor specification
 */
export type GpuVendor = 'nvidia' | 'amd';

/**
 * GPU model specification for Akash Network
 */
export interface GpuModel {
  /**
   * GPU model name
   * @example "rtx4090", "a100", "t4", "rtxa6000"
   */
  readonly model: string;

  /**
   * GPU memory (VRAM) required
   * @example "24Gi", "48Gi", "80Gi"
   */
  readonly ram?: string;

  /**
   * GPU interface type
   */
  readonly interface?: 'pcie' | 'sxm';
}

/**
 * GPU resource requirements
 */
export interface GpuRequirements {
  /**
   * Number of GPU units required
   * @example 1, 2, 4
   */
  readonly units: number;

  /**
   * GPU vendor and model attributes
   *
   * @example
   * ```typescript
   * attributes: {
   *   vendor: {
   *     nvidia: [{ model: "rtx4090", ram: "24Gi" }]
   *   }
   * }
   * ```
   */
  readonly attributes: {
    readonly vendor: Readonly<Record<string, readonly GpuModel[]>>;
  };
}

/**
 * Akash HTTP proxy options for fine-grained HTTP endpoint control
 *
 * These options configure the Akash ingress controller's behavior for HTTP endpoints.
 * Particularly useful for long-running operations like model downloads.
 *
 * **Background:**
 * Akash uses NGINX as an ingress controller with default 60-second timeouts.
 * For services that need longer response times (e.g., Ollama model pulling),
 * you must explicitly configure longer timeouts.
 *
 * **Default Values** (from Akash source code):
 * - max_body_size: 1,048,576 bytes (1 MB)
 * - read_timeout: 60 seconds (NGINX ingress format)
 * - send_timeout: 60 seconds (NGINX ingress format)
 * - next_tries: 3
 * - next_cases: ["error", "timeout"]
 *
 * **IMPORTANT:** Timeout values must be specified in **seconds** (NGINX format),
 * not milliseconds. The NGINX ingress controller expects integer seconds.
 *
 * @see https://akash.network/docs/network-features/deployment-http-options/
 * @see https://github.com/akash-network/node/blob/main/sdl/v2.go#L18-L37
 *
 * @example Long-running operations (Ollama model pull)
 * ```typescript
 * const httpOptions: HttpOptions = {
 *   max_body_size: 10485760,    // 10 MB
 *   read_timeout: 600,          // 10 minutes (in seconds)
 *   send_timeout: 600,          // 10 minutes (in seconds)
 * };
 * ```
 *
 * @example High-traffic service with retries
 * ```typescript
 * const httpOptions: HttpOptions = {
 *   max_body_size: 5242880,     // 5 MB
 *   next_cases: ["error", "timeout", "500", "502", "503"],
 *   next_tries: 5,
 *   next_timeout: 3,            // 3 seconds
 * };
 * ```
 */
export interface HttpOptions {
  /**
   * Maximum size of HTTP request body in bytes
   *
   * Limits the size of incoming request payloads.
   * Useful for preventing abuse or handling large file uploads.
   *
   * @default 1048576 (1 MB)
   * @example 10485760 // 10 MB
   */
  readonly max_body_size?: number;

  /**
   * Maximum time (in SECONDS) the proxy waits for a response from the service
   *
   * **Critical for long-running operations!**
   * If your service takes >60s to respond (default), you MUST increase this.
   *
   * **IMPORTANT:** Use SECONDS, not milliseconds (NGINX ingress format)
   *
   * Common use cases:
   * - ML model downloads: 600 (10 min)
   * - Large file processing: 300 (5 min)
   * - Batch operations: 180 (3 min)
   *
   * @default 60 (60 seconds)
   * @example 600 // 10 minutes for Ollama model pulls
   */
  readonly read_timeout?: number;

  /**
   * Maximum time (in SECONDS) the proxy waits for the service to accept a request
   *
   * Typically mirrors read_timeout for symmetry.
   *
   * **IMPORTANT:** Use SECONDS, not milliseconds (NGINX ingress format)
   *
   * @default 60 (60 seconds)
   * @example 600 // 10 minutes
   */
  readonly send_timeout?: number;

  /**
   * HTTP status codes and error conditions that trigger retry to another replica
   *
   * Only applies when service count > 1.
   *
   * **Allowed values:**
   * - "error" - Network/connection errors
   * - "timeout" - Request timeout
   * - "403", "404", "429", "500", "502", "503", "504" - HTTP status codes
   * - "off" - Disable retries
   *
   * @default ["error", "timeout"]
   * @example ["error", "timeout", "500", "502", "503"]
   */
  readonly next_cases?: readonly string[];

  /**
   * Number of times to retry with another replica before giving up
   *
   * Only applies when service count > 1.
   *
   * @default 3
   * @example 5
   */
  readonly next_tries?: number;

  /**
   * Time (in SECONDS) to wait before considering a retry attempt has timed out
   *
   * Only applies when service count > 1.
   *
   * **IMPORTANT:** Use SECONDS, not milliseconds (NGINX ingress format)
   *
   * @example 3 // 3 seconds
   */
  readonly next_timeout?: number;
}

/**
 * Port exposure configuration
 *
 * Defines how a container port is exposed
 */
export interface PortExposure {
  /**
   * Internal container port
   */
  readonly port: number;

  /**
   * External port to map to (defaults to same as port)
   */
  readonly as: number;

  /**
   * Exposure targets
   * - ["local"]: Only accessible from host machine
   * - [{ global: true }]: Accessible from internet (Akash)
   * - [{ service: "name" }]: Accessible from another service (Akash inter-service)
   */
  readonly to?: ReadonlyArray<string | { readonly global?: boolean } | { readonly service?: string }>;

  /**
   * Protocol (defaults to TCP)
   */
  readonly protocol?: 'tcp' | 'udp';

  /**
   * HTTP-specific options for Akash ingress configuration
   *
   * **Only applies to Akash deployments with global exposure.**
   * Local deployments ignore this field.
   *
   * Use this for services that need:
   * - Long response times (>60s)
   * - Large request bodies (>1MB)
   * - Custom retry logic
   *
   * @example Ollama with long model pull timeouts
   * ```typescript
   * {
   *   port: 11434,
   *   as: 80,
   *   to: [{ global: true }],
   *   http_options: {
   *     read_timeout: 600,    // 10 minutes (in seconds)
   *     send_timeout: 600,
   *   }
   * }
   * ```
   */
  readonly http_options?: HttpOptions;
}

/**
 * Environment variable specification
 *
 * Either a simple key=value string or a structured object
 */
export type EnvironmentVariable =
  | string
  | {
      readonly name: string;
      readonly value: string;
    };

/**
 * Base service configuration fields (shared between Akash and Local)
 */
interface BaseServiceConfigFields {
  /**
   * Container image to deploy
   * @example "nginx:latest", "myapp:1.0.0"
   */
  readonly image: ImageReference;

  /**
   * Environment variables
   * @example ["PORT=8080", "NODE_ENV=production"]
   */
  readonly env?: readonly EnvironmentVariable[];

  /**
   * Port exposures
   */
  readonly expose?: readonly PortExposure[];

  /**
   * Command override (replaces image's CMD)
   */
  readonly command?: readonly string[];
}

/**
 * Service configuration for Akash deployments
 *
 * Uses AkashResourceRequirements which requires cpu/memory
 */
export interface AkashServiceConfig extends BaseServiceConfigFields {
  /**
   * Resource requirements (cpu/memory required for Akash)
   */
  readonly resources?: AkashResourceRequirements;
}

/**
 * Service configuration for Local deployments (Docker/Podman)
 *
 * Uses LocalResourceRequirements where all fields are optional
 */
export interface LocalServiceConfig extends BaseServiceConfigFields {
  /**
   * Resource requirements (all optional for local)
   */
  readonly resources?: LocalResourceRequirements;
}

/**
 * Service configuration common across all targets
 *
 * Base configuration that applies to both local and remote deployments.
 * Union type - use specific types (AkashServiceConfig, LocalServiceConfig)
 * when you know the deployment target.
 */
export type BaseServiceConfig = AkashServiceConfig | LocalServiceConfig;

/**
 * Progress event emitted during deployment
 *
 * Allows monitoring of deployment progress in real-time
 */
export interface DeploymentProgressEvent {
  /**
   * Current deployment phase
   */
  readonly phase:
    | 'initializing'
    | 'loading-profile'
    | 'connecting-wallet'
    | 'creating-certificate'
    | 'building-images'
    | 'creating-deployment'
    | 'waiting-for-bids'
    | 'creating-lease'
    | 'sending-manifest'
    | 'waiting-for-containers'
    | 'completed'
    | 'failed';

  /**
   * Human-readable progress message
   */
  readonly message: string;

  /**
   * Progress percentage (0-100)
   * undefined if not applicable
   */
  readonly progress?: number;

  /**
   * Additional context data
   */
  readonly data?: Record<string, unknown>;
}

/**
 * Progress callback function
 *
 * Called periodically during deployment to report progress
 */
export type ProgressCallback = (event: DeploymentProgressEvent) => void;
