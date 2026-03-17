/**
 * Local deployment target type definitions
 *
 * Types specific to local Docker/Podman deployment
 *
 * @module targets/local/types
 */

import type {
  ImageReference,
} from '../../types/index.js';

/**
 * Port mapping in Docker Compose format
 *
 * Format: "external:internal" (e.g., "8080:8080")
 */
export type PortMapping = `${number}:${number}`;

/**
 * Container restart policy
 */
export type RestartPolicy = 'no' | 'always' | 'on-failure' | 'unless-stopped';

/**
 * Volume mount specification
 */
export interface VolumeMount {
  /**
   * Source path or volume name
   */
  readonly source: string;

  /**
   * Target path inside container
   */
  readonly target: string;

  /**
   * Mount type
   */
  readonly type?: 'bind' | 'volume' | 'tmpfs';

  /**
   * Read-only mount
   */
  readonly readOnly?: boolean;
}

/**
 * Network mode for container
 */
export type NetworkMode = 'bridge' | 'host' | 'none' | string;

/**
 * Healthcheck configuration
 */
export interface Healthcheck {
  /**
   * Test command
   */
  readonly test: readonly string[];

  /**
   * Interval between checks
   */
  readonly interval?: string;

  /**
   * Timeout for each check
   */
  readonly timeout?: string;

  /**
   * Number of retries before unhealthy
   */
  readonly retries?: number;

  /**
   * Start period before first check
   */
  readonly startPeriod?: string;
}

/**
 * Service dependency
 */
export interface ServiceDependency {
  /**
   * Service name
   */
  readonly service: string;

  /**
   * Condition to wait for
   */
  readonly condition: 'service_started' | 'service_healthy' | 'service_completed_successfully';
}

/**
 * Docker Compose service definition
 *
 * Strongly typed version with no `any` types
 */
export interface ComposeService {
  /**
   * Container image
   */
  readonly image: ImageReference;

  /**
   * Container name
   */
  readonly container_name?: string;

  /**
   * Build configuration (if building from Dockerfile)
   */
  readonly build?: {
    readonly context: string;
    readonly dockerfile?: string;
    readonly args?: Record<string, string>;
  };

  /**
   * Command override
   */
  readonly command?: readonly string[];

  /**
   * Entrypoint override
   */
  readonly entrypoint?: readonly string[];

  /**
   * Environment variables
   */
  readonly environment?: Record<string, string>;

  /**
   * Port mappings
   */
  readonly ports?: readonly string[];

  /**
   * Volume mounts
   */
  readonly volumes?: readonly string[];

  /**
   * Networks this service connects to
   */
  readonly networks?: readonly string[];

  /**
   * Service dependencies
   */
  readonly depends_on?: readonly string[] | Record<string, ServiceDependency>;

  /**
   * Restart policy
   */
  readonly restart?: RestartPolicy;

  /**
   * Healthcheck configuration
   */
  readonly healthcheck?: Healthcheck;

  /**
   * Working directory
   */
  readonly working_dir?: string;

  /**
   * User to run as
   */
  readonly user?: string;

  /**
   * Enable TTY
   */
  readonly tty?: boolean;

  /**
   * Keep stdin open
   */
  readonly stdin_open?: boolean;

  /**
   * Privileged mode
   */
  readonly privileged?: boolean;

  /**
   * Extra hosts
   */
  readonly extra_hosts?: readonly string[];

  /**
   * Pull policy for the image
   */
  readonly pull_policy?: 'always' | 'never' | 'if_not_present' | 'missing';

  /**
   * DNS servers
   */
  readonly dns?: readonly string[];

  /**
   * Resource limits (Compose v3)
   */
  readonly deploy?: {
    readonly resources?: {
      readonly limits?: {
        readonly cpus?: string;
        readonly memory?: string;
      };
      readonly reservations?: {
        readonly cpus?: string;
        readonly memory?: string;
      };
    };
  };
}

/**
 * Docker network configuration
 */
export interface ComposeNetwork {
  /**
   * Network driver
   */
  readonly driver?: 'bridge' | 'host' | 'overlay' | 'macvlan' | 'none' | string;

  /**
   * External network (already exists)
   */
  readonly external?: boolean;

  /**
   * Network name (for external networks)
   */
  readonly name?: string;

  /**
   * Driver options
   */
  readonly driver_opts?: Record<string, string>;

  /**
   * Enable IPv6
   */
  readonly enable_ipv6?: boolean;

  /**
   * IPAM configuration
   */
  readonly ipam?: {
    readonly driver?: string;
    readonly config?: ReadonlyArray<{
      readonly subnet?: string;
      readonly ip_range?: string;
      readonly gateway?: string;
    }>;
  };
}

/**
 * Docker Compose file structure
 *
 * Complete type-safe representation of docker-compose.yml
 */
export interface ComposeFile {
  /**
   * Compose file version
   */
  readonly version: string;

  /**
   * Services to deploy
   */
  readonly services: Readonly<Record<string, ComposeService>>;

  /**
   * Networks configuration
   */
  readonly networks?: Readonly<Record<string, ComposeNetwork>>;

  /**
   * Volumes configuration
   */
  readonly volumes?: Readonly<Record<string, {
    readonly driver?: string;
    readonly driver_opts?: Record<string, string>;
    readonly external?: boolean;
    readonly name?: string;
  }>>;
}

/**
 * Container status from Docker/Podman
 */
export type ContainerStatus =
  | 'created'
  | 'running'
  | 'paused'
  | 'restarting'
  | 'removing'
  | 'exited'
  | 'dead';

/**
 * Container information
 */
export interface ContainerInfo {
  /**
   * Container ID
   */
  readonly id: string;

  /**
   * Container name
   */
  readonly name: string;

  /**
   * Container status
   */
  readonly status: ContainerStatus;

  /**
   * Image used
   */
  readonly image: ImageReference;

  /**
   * Ports exposed
   */
  readonly ports: ReadonlyArray<{
    readonly internal: number;
    readonly external?: number;
    readonly protocol: 'tcp' | 'udp';
  }>;

  /**
   * When container was created
   */
  readonly createdAt: Date;

  /**
   * When container started (if running)
   */
  readonly startedAt?: Date;
}

/**
 * Network information
 */
export interface NetworkInfo {
  /**
   * Network ID
   */
  readonly id: string;

  /**
   * Network name
   */
  readonly name: string;

  /**
   * Network driver
   */
  readonly driver: string;

  /**
   * Whether network already existed
   */
  readonly preexisting: boolean;
}

/**
 * Validation error for service configuration
 */
export interface ServiceValidationError {
  /**
   * Service name
   */
  readonly service: string;

  /**
   * Field that failed validation
   */
  readonly field: string;

  /**
   * Error message
   */
  readonly message: string;
}
