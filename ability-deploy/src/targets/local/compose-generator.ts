/**
 * Docker Compose File Generation Module
 *
 * Generates docker-compose.yml files from KADI deployment profiles.
 * Transforms service configurations into valid Docker Compose v3 format
 * with proper type safety and validation.
 *
 * Key Features:
 * - Type-safe generation with zero `any` types
 * - Multi-service support
 * - Port mapping transformation
 * - Environment variable conversion
 * - Network configuration
 * - Command overrides
 *
 * @module targets/local/compose-generator
 */

import debug from 'debug';
import yaml from 'js-yaml';
import { type Result, success, failure } from '../../types/index.js';
import type { PortExposure, ImageReference } from '../../types/index.js';
import { DeploymentError } from '../../errors/index.js';
import type {
  ComposeFile,
  ComposeService,
  ComposeNetwork,
  PortMapping,
  RestartPolicy,
} from './types.js';

/**
 * Debug logger for compose generation
 */
const log = debug('deploy-ability:local:compose');

/**
 * Service configuration input (from agent.json profile)
 *
 * This represents the service format in agent.json deploy profiles,
 * which is more flexible and user-friendly than the strict Docker Compose format.
 */
export interface ServiceInput {
  /**
   * Docker image reference
   */
  readonly image: string;

  /**
   * Environment variables as array of KEY=VALUE strings
   */
  readonly env?: readonly string[];

  /**
   * Port exposure configurations
   */
  readonly expose?: readonly PortExposure[];

  /**
   * Command override
   */
  readonly command?: readonly string[];

  /**
   * Resource limits (informational for local)
   *
   * Note: For local deployments, these are primarily informational.
   * Docker Compose doesn't enforce limits by default unless using deploy.resources.
   * Persistent volumes should be configured using the `volumes` field.
   */
  readonly resources?: {
    readonly cpu?: number;
    readonly memory?: string;
    readonly ephemeralStorage?: string;
    readonly persistentVolumes?: readonly {
      readonly name: string;
      readonly size: string;
      readonly mount: string;
      readonly class?: string;
    }[];
  };

  /**
   * Restart policy
   */
  readonly restart?: RestartPolicy;

  /**
   * Service dependencies
   */
  readonly dependsOn?: readonly string[];

  /**
   * Working directory
   */
  readonly workingDir?: string;

  /**
   * Volumes to mount
   */
  readonly volumes?: readonly string[];
}

/**
 * Options for compose generation
 */
export interface ComposeGenerationOptions {
  /**
   * Docker Compose version to use
   * @default '3.9'
   */
  readonly version?: string;

  /**
   * Network name for inter-service communication
   * @default 'kadi-net'
   */
  readonly networkName?: string;

  /**
   * Container name prefix
   * @default 'kadi'
   */
  readonly containerPrefix?: string;

  /**
   * Whether to enable TTY for all services
   * @default true
   */
  readonly tty?: boolean;

  /**
   * Whether to keep stdin open for all services
   * @default true
   */
  readonly stdinOpen?: boolean;

  /**
   * Default restart policy
   * @default undefined (Docker default: no)
   */
  readonly defaultRestart?: RestartPolicy;
}

/**
 * Converts environment variable array to Docker Compose format
 *
 * Transforms array of "KEY=value" strings into an object mapping.
 * Handles values containing '=' characters correctly by only splitting
 * on the first '=' found.
 *
 * @param envArray - Array of environment variables in KEY=VALUE format
 * @returns Environment object for Docker Compose
 *
 * @example
 * ```typescript
 * const result = convertEnvArrayToObject([
 *   'PORT=8080',
 *   'DATABASE_URL=postgres://user:pass@host/db',
 *   'API_KEY=abc=def=ghi'
 * ]);
 *
 * // Returns:
 * // {
 * //   PORT: '8080',
 * //   DATABASE_URL: 'postgres://user:pass@host/db',
 * //   API_KEY: 'abc=def=ghi'
 * // }
 * ```
 */
export function convertEnvArrayToObject(
  envArray: readonly string[]
): Record<string, string> {
  log('Converting %d environment variables', envArray.length);

  const envObject: Record<string, string> = {};

  for (const envVar of envArray) {
    // Split only on first '=' to handle values with '=' in them
    const firstEqualIndex = envVar.indexOf('=');

    if (firstEqualIndex === -1) {
      log('Skipping invalid env var (no =): %s', envVar);
      continue;
    }

    const key = envVar.substring(0, firstEqualIndex);
    const value = envVar.substring(firstEqualIndex + 1);

    if (!key) {
      log('Skipping invalid env var (empty key): %s', envVar);
      continue;
    }

    log('Added env var: %s', key);
    envObject[key] = value;
  }

  return envObject;
}

/**
 * Converts port exposure configs to Docker Compose port mapping format
 *
 * Transforms KADI port exposure format into Docker Compose "external:internal"
 * string format. If `as` is not specified, uses the same port number for both.
 *
 * @param expose - Port exposure configurations
 * @returns Array of port mappings in "external:internal" format
 *
 * @example
 * ```typescript
 * const result = convertPortsToComposeFormat([
 *   { port: 8080, as: 8080, to: ['local'] },
 *   { port: 3000, as: 3001, to: ['local'] },
 *   { port: 5432, to: ['local'] } // as defaults to port
 * ]);
 *
 * // Returns: ['8080:8080', '3001:3000', '5432:5432']
 * ```
 */
export function convertPortsToComposeFormat(
  expose?: readonly PortExposure[]
): readonly PortMapping[] {
  if (!expose || expose.length === 0) {
    log('No ports to convert');
    return [];
  }

  log('Converting %d port mappings', expose.length);

  const ports: PortMapping[] = [];

  for (const portConfig of expose) {
    const external = portConfig.as ?? portConfig.port;
    const internal = portConfig.port;

    const mapping: PortMapping = `${external}:${internal}`;

    log('Port mapping: %s', mapping);
    ports.push(mapping);
  }

  return ports;
}

/**
 * Validates a service configuration
 *
 * Checks that the service has all required fields and valid values.
 *
 * @param serviceName - Name of the service
 * @param service - Service configuration
 * @returns Result indicating validity or error
 *
 * @internal
 */
function validateService(
  serviceName: string,
  service: ServiceInput
): Result<void, DeploymentError> {
  log('Validating service: %s', serviceName);

  // Check required fields
  if (!service.image) {
    return failure(
      new DeploymentError(
        `Service "${serviceName}" is missing required "image" field`,
        'SERVICE_INVALID',
        { serviceName, field: 'image' },
        true,
        'Add an "image" field to the service configuration',
        'error'
      )
    );
  }

  // Validate image format (basic check)
  if (typeof service.image !== 'string' || service.image.trim().length === 0) {
    return failure(
      new DeploymentError(
        `Service "${serviceName}" has invalid image reference`,
        'SERVICE_INVALID',
        { serviceName, field: 'image', value: service.image },
        true,
        'Provide a valid Docker image reference (e.g., "nginx:latest")',
        'error'
      )
    );
  }

  // Validate environment variables format
  if (service.env) {
    for (const envVar of service.env) {
      if (!envVar.includes('=')) {
        return failure(
          new DeploymentError(
            `Service "${serviceName}" has invalid environment variable format: ${envVar}`,
            'SERVICE_INVALID',
            { serviceName, field: 'env', value: envVar },
            true,
            'Environment variables must be in KEY=VALUE format',
            'error'
          )
        );
      }
    }
  }

  // Validate port numbers
  if (service.expose) {
    for (const portConfig of service.expose) {
      if (portConfig.port < 1 || portConfig.port > 65535) {
        return failure(
          new DeploymentError(
            `Service "${serviceName}" has invalid port number: ${portConfig.port}`,
            'SERVICE_INVALID',
            { serviceName, field: 'expose.port', value: portConfig.port },
            true,
            'Port numbers must be between 1 and 65535',
            'error'
          )
        );
      }

      // Validate external port (as) if specified
      // Use explicit undefined check to catch port 0
      if (portConfig.as !== undefined && (portConfig.as < 1 || portConfig.as > 65535)) {
        return failure(
          new DeploymentError(
            `Service "${serviceName}" has invalid external port number: ${portConfig.as}`,
            'SERVICE_INVALID',
            { serviceName, field: 'expose.as', value: portConfig.as },
            true,
            'Port numbers must be between 1 and 65535',
            'error'
          )
        );
      }
    }
  }

  log('Service %s validated successfully', serviceName);
  return success(undefined);
}

/**
 * Converts a service input to Docker Compose service format
 *
 * Transforms KADI service configuration into a proper ComposeService
 * with all necessary fields and proper formatting.
 *
 * @param serviceName - Name of the service
 * @param service - Service input configuration
 * @param options - Generation options
 * @returns Compose service definition
 *
 * @internal
 */
function convertServiceToComposeFormat(
  serviceName: string,
  service: ServiceInput,
  options: ComposeGenerationOptions
): ComposeService {
  const {
    networkName = 'kadi-net',
    containerPrefix = 'kadi',
    tty = true,
    stdinOpen = true,
    defaultRestart,
  } = options;

  log('Converting service %s to compose format', serviceName);

  // Prepare optional fields with proper typing
  const envObject = service.env && service.env.length > 0
    ? convertEnvArrayToObject(service.env)
    : undefined;

  const ports = convertPortsToComposeFormat(service.expose);
  const restart = service.restart ?? defaultRestart;

  // Build service object with conditional spreads - no any casts needed
  const composeService: ComposeService = {
    image: service.image as ImageReference,
    container_name: `${containerPrefix}-${serviceName}`,
    networks: [networkName],
    pull_policy: 'if_not_present',
    tty,
    stdin_open: stdinOpen,
    // Conditionally include optional fields only if they have values
    ...(envObject && Object.keys(envObject).length > 0 && { environment: envObject }),
    ...(ports.length > 0 && { ports }),
    ...(service.command && service.command.length > 0 && { command: service.command }),
    ...(service.volumes && service.volumes.length > 0 && { volumes: service.volumes }),
    ...(service.workingDir && { working_dir: service.workingDir }),
    ...(restart && { restart }),
    ...(service.dependsOn && service.dependsOn.length > 0 && { depends_on: service.dependsOn }),
  };

  log('Service %s converted successfully', serviceName);
  return composeService;
}

/**
 * Generates a Docker Compose file from service configurations
 *
 * Takes a map of service configurations and generates a complete,
 * valid Docker Compose file structure with network configuration.
 *
 * This is the main entry point for compose generation. Returns a
 * strongly-typed ComposeFile structure (not YAML yet).
 *
 * @param services - Map of service name to service configuration
 * @param options - Generation options
 * @returns Result with ComposeFile structure or error
 *
 * @example
 * ```typescript
 * const result = await generateComposeFile(
 *   {
 *     gateway: {
 *       image: 'my-gateway:latest',
 *       env: ['PORT=8080'],
 *       expose: [{ port: 8080, as: 8080, to: ['local'] }]
 *     },
 *     database: {
 *       image: 'postgres:15',
 *       env: ['POSTGRES_PASSWORD=secret']
 *     }
 *   },
 *   { networkName: 'kadi-net' }
 * );
 *
 * if (result.success) {
 *   console.log('Services:', Object.keys(result.data.services));
 * }
 * ```
 */
export function generateComposeFile(
  services: Readonly<Record<string, ServiceInput>>,
  options: ComposeGenerationOptions = {}
): Result<ComposeFile, DeploymentError> {
  const { version = '3.9', networkName = 'kadi-net' } = options;

  log('Generating compose file with %d services', Object.keys(services).length);

  // Validate all services first
  for (const [serviceName, service] of Object.entries(services)) {
    const validationResult = validateService(serviceName, service);

    if (!validationResult.success) {
      log('Service validation failed: %s', serviceName);
      return failure(validationResult.error);
    }
  }

  // Convert all services
  const composeServices: Record<string, ComposeService> = {};

  for (const [serviceName, service] of Object.entries(services)) {
    composeServices[serviceName] = convertServiceToComposeFormat(
      serviceName,
      service,
      options
    );
  }

  // Create network configuration
  const networks: Record<string, ComposeNetwork> = {
    [networkName]: {
      driver: 'bridge',
    },
  };

  // Build compose file
  const composeFile: ComposeFile = {
    version,
    services: composeServices,
    networks,
  };

  log('Compose file generated successfully');

  return success(composeFile);
}

/**
 * Converts a ComposeFile to YAML string
 *
 * Serializes a ComposeFile structure to a formatted YAML string
 * suitable for writing to docker-compose.yml.
 *
 * @param composeFile - Compose file structure
 * @returns YAML string
 *
 * @example
 * ```typescript
 * const yamlString = composeFileToYAML(composeFile);
 * await fs.writeFile('docker-compose.yml', yamlString, 'utf8');
 * ```
 */
export function composeFileToYAML(composeFile: ComposeFile): string {
  log('Converting compose file to YAML');

  return yaml.dump(composeFile, {
    noRefs: true,
    lineWidth: 120,
    quotingType: '"',
    forceQuotes: false,
    sortKeys: false,
  });
}

/**
 * Generates Docker Compose YAML from service configurations
 *
 * Convenience function that combines generation and YAML serialization
 * into a single call. Returns a formatted YAML string ready to write
 * to docker-compose.yml.
 *
 * @param services - Map of service name to service configuration
 * @param options - Generation options
 * @returns Result with YAML string or error
 *
 * @example
 * ```typescript
 * const result = await generateComposeYAML(
 *   {
 *     app: {
 *       image: 'my-app:latest',
 *       env: ['NODE_ENV=production'],
 *       expose: [{ port: 3000, as: 3000, to: ['local'] }]
 *     }
 *   }
 * );
 *
 * if (result.success) {
 *   await fs.writeFile('docker-compose.yml', result.data, 'utf8');
 * }
 * ```
 */
export function generateComposeYAML(
  services: Readonly<Record<string, ServiceInput>>,
  options: ComposeGenerationOptions = {}
): Result<string, DeploymentError> {
  log('Generating compose YAML');

  const composeResult = generateComposeFile(services, options);

  if (!composeResult.success) {
    return failure(composeResult.error);
  }

  const yaml = composeFileToYAML(composeResult.data);

  log('Compose YAML generated: %d bytes', yaml.length);

  return success(yaml);
}
