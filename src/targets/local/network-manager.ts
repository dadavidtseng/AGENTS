/**
 * Docker Network Management Module
 *
 * Manages Docker/Podman networks for KADI deployments, ensuring
 * required networks exist and are properly configured for inter-service
 * communication.
 *
 * Key Features:
 * - Network creation with idempotency (safe to call multiple times)
 * - Network inspection and validation
 * - Automatic conflict resolution
 * - Type-safe Result returns
 *
 * @module targets/local/network-manager
 */

import debug from 'debug';
import {
  type Result,
  success,
  failure,
  type ContainerEngine,
} from '../../types/index.js';
import { DeploymentError, getErrorMessage } from '../../errors/index.js';
import { runCommand, type CommandOptions } from '../../utils/command-runner.js';
import type { NetworkInfo } from './types.js';

/**
 * Debug logger for network operations
 */
const log = debug('deploy-ability:local:network');

/**
 * Options for network operations
 */
export interface NetworkOptions {
  /**
   * Timeout for network operations in milliseconds
   * @default 30000 (30 seconds)
   */
  readonly timeout?: number;

  /**
   * Command execution options
   */
  readonly commandOptions?: CommandOptions;
}

/**
 * Network creation options
 */
export interface CreateNetworkOptions extends NetworkOptions {
  /**
   * Network driver to use
   * @default 'bridge'
   */
  readonly driver?: 'bridge' | 'host' | 'overlay' | 'macvlan' | 'none' | string;

  /**
   * Enable IPv6
   * @default false
   */
  readonly ipv6?: boolean;

  /**
   * Additional driver options
   */
  readonly driverOpts?: Record<string, string>;
}

/**
 * Checks if a Docker network exists
 *
 * Queries the container engine to verify if a network with the given
 * name exists. Returns true if it exists, false otherwise.
 *
 * @param engine - Container engine to use
 * @param networkName - Name of the network to check
 * @param options - Network operation options
 * @returns Result with boolean indicating existence
 *
 * @example
 * ```typescript
 * const result = await networkExists('docker', 'kadi-net');
 *
 * if (result.success && result.data) {
 *   console.log('Network exists');
 * } else if (result.success && !result.data) {
 *   console.log('Network does not exist');
 * } else {
 *   console.error('Error checking network:', result.error.message);
 * }
 * ```
 */
export async function networkExists(
  engine: ContainerEngine,
  networkName: string,
  options: NetworkOptions = {}
): Promise<Result<boolean, DeploymentError>> {
  const { timeout = 30_000, commandOptions } = options;

  log('Checking if network %s exists', networkName);

  const inspectCommand = `${engine} network inspect ${networkName}`;

  const result = await runCommand(inspectCommand, {
    ...commandOptions,
    timeout,
    silent: true,
  });

  if (result.success) {
    log('Network %s exists', networkName);
    return success(true);
  }

  // Check if this is a "not found" error vs other errors
  const errorMessage = (result.error.context.stderr as string) || '';
  const isNotFound =
    /no such network|not found|Error: network .* not found/i.test(errorMessage);

  if (isNotFound) {
    log('Network %s does not exist', networkName);
    return success(false);
  }

  // Other error - return it
  log('Error checking network %s: %s', networkName, result.error.message);

  return failure(
    new DeploymentError(
      `Failed to check if network "${networkName}" exists`,
      'NETWORK_CHECK_FAILED',
      {
        engine,
        networkName,
        error: result.error.message,
      },
      true,
      'Ensure the container engine is running and accessible',
      'error',
      result.error
    )
  );
}

/**
 * Gets detailed information about a Docker network
 *
 * Retrieves and parses network information including driver, scope,
 * and whether the network was created externally.
 *
 * @param engine - Container engine to use
 * @param networkName - Name of the network to inspect
 * @param options - Network operation options
 * @returns Result with network information
 *
 * @example
 * ```typescript
 * const result = await getNetworkInfo('docker', 'kadi-net');
 *
 * if (result.success) {
 *   console.log('Network ID:', result.data.id);
 *   console.log('Driver:', result.data.driver);
 *   console.log('Pre-existing:', result.data.preexisting);
 * }
 * ```
 */
export async function getNetworkInfo(
  engine: ContainerEngine,
  networkName: string,
  options: NetworkOptions = {}
): Promise<Result<NetworkInfo, DeploymentError>> {
  const { timeout = 30_000, commandOptions } = options;

  log('Getting info for network %s', networkName);

  const inspectCommand = `${engine} network inspect ${networkName}`;

  const result = await runCommand(inspectCommand, {
    ...commandOptions,
    timeout,
    silent: true,
  });

  if (!result.success) {
    log('Failed to get network info for %s: %s', networkName, result.error.message);

    return failure(
      new DeploymentError(
        `Network "${networkName}" not found`,
        'NETWORK_NOT_FOUND',
        {
          engine,
          networkName,
          error: result.error.message,
        },
        true,
        `Create the network with: ${engine} network create ${networkName}`,
        'error',
        result.error
      )
    );
  }

  // Parse network info from JSON output
  try {
    const networks = JSON.parse(result.data.stdout);

    if (!Array.isArray(networks) || networks.length === 0) {
      log('Network inspect returned empty array for %s', networkName);

      return failure(
        new DeploymentError(
          `Network "${networkName}" inspect returned no data`,
          'NETWORK_INSPECT_EMPTY',
          {
            engine,
            networkName,
          },
          false,
          undefined,
          'warning'
        )
      );
    }

    const network = networks[0];

    log(
      'Network %s found: id=%s driver=%s',
      networkName,
      network.Id,
      network.Driver
    );

    return success({
      id: network.Id,
      name: network.Name || networkName,
      driver: network.Driver || 'bridge',
      preexisting: true, // If we're inspecting it, it existed before this call
    });
  } catch (error) {
    const errMsg = getErrorMessage(error);
    log('Failed to parse network inspect JSON: %s', errMsg);

    return failure(
      new DeploymentError(
        'Failed to parse network information',
        'NETWORK_PARSE_ERROR',
        {
          engine,
          networkName,
          stdout: result.data.stdout.substring(0, 200),
          error: errMsg,
        },
        false,
        undefined,
        'error',
        error as Error
      )
    );
  }
}

/**
 * Creates a Docker network if it doesn't already exist
 *
 * This function is idempotent - safe to call multiple times. If the
 * network already exists, it will return success with `preexisting: true`.
 *
 * Handles the common "already exists" error gracefully and returns
 * structured network information.
 *
 * @param engine - Container engine to use
 * @param networkName - Name of the network to create
 * @param options - Network creation options
 * @returns Result with network information
 *
 * @example Basic Usage
 * ```typescript
 * const result = await ensureNetwork('docker', 'kadi-net');
 *
 * if (result.success) {
 *   if (result.data.preexisting) {
 *     console.log('Network already existed');
 *   } else {
 *     console.log('Network created:', result.data.id);
 *   }
 * }
 * ```
 *
 * @example With Custom Driver
 * ```typescript
 * const result = await ensureNetwork('docker', 'my-overlay-net', {
 *   driver: 'overlay',
 *   ipv6: true
 * });
 * ```
 */
export async function ensureNetwork(
  engine: ContainerEngine,
  networkName: string,
  options: CreateNetworkOptions = {}
): Promise<Result<NetworkInfo, DeploymentError>> {
  const {
    timeout = 30_000,
    driver = 'bridge',
    ipv6 = false,
    driverOpts,
    commandOptions,
  } = options;

  log('Ensuring network %s exists (driver: %s)', networkName, driver);

  // First, check if network already exists
  const existsResult = await networkExists(engine, networkName, {
    timeout,
    commandOptions,
  });

  if (!existsResult.success) {
    return failure(existsResult.error);
  }

  if (existsResult.data) {
    log('Network %s already exists, getting info', networkName);

    // Network exists - get its info
    const infoResult = await getNetworkInfo(engine, networkName, {
      timeout,
      commandOptions,
    });

    if (infoResult.success) {
      return success({
        ...infoResult.data,
        preexisting: true,
      });
    }

    // Failed to get info but we know it exists - return minimal info
    log('Failed to get network info, returning minimal data');
    return success({
      id: '',
      name: networkName,
      driver,
      preexisting: true,
    });
  }

  // Network doesn't exist - create it
  log('Network %s does not exist, creating', networkName);

  // Build create command with options
  const createArgs: string[] = ['network', 'create'];

  if (driver) {
    createArgs.push('--driver', driver);
  }

  if (ipv6) {
    createArgs.push('--ipv6');
  }

  if (driverOpts) {
    for (const [key, value] of Object.entries(driverOpts)) {
      createArgs.push('--opt', `${key}=${value}`);
    }
  }

  createArgs.push(networkName);

  const createCommand = `${engine} ${createArgs.join(' ')}`;

  log('Creating network with command: %s', createCommand);

  const createResult = await runCommand(createCommand, {
    ...commandOptions,
    timeout,
    silent: true,
  });

  if (!createResult.success) {
    // Check if this is an "already exists" error (race condition)
    const errorMessage =
      (createResult.error.context.stderr as string) ||
      createResult.error.message;

    if (/already exists/i.test(errorMessage)) {
      log('Network %s was created by another process (race condition)', networkName);

      // Another process created it - get its info
      const infoResult = await getNetworkInfo(engine, networkName, {
        timeout,
        commandOptions,
      });

      if (infoResult.success) {
        return success({
          ...infoResult.data,
          preexisting: true,
        });
      }

      // Couldn't get info but we know it exists
      return success({
        id: '',
        name: networkName,
        driver,
        preexisting: true,
      });
    }

    // Other error - return it
    log('Failed to create network %s: %s', networkName, createResult.error.message);

    return failure(
      new DeploymentError(
        `Failed to create network "${networkName}"`,
        'NETWORK_CREATE_FAILED',
        {
          engine,
          networkName,
          driver,
          error: createResult.error.message,
        },
        true,
        'Check container engine logs and ensure you have network creation permissions',
        'error',
        createResult.error
      )
    );
  }

  // Network created successfully
  const networkId = createResult.data.stdout.trim();

  log('Network %s created successfully: id=%s', networkName, networkId);

  return success({
    id: networkId,
    name: networkName,
    driver,
    preexisting: false,
  });
}

/**
 * Removes a Docker network
 *
 * Deletes the specified network. Will fail if containers are still
 * attached to the network.
 *
 * @param engine - Container engine to use
 * @param networkName - Name of the network to remove
 * @param options - Network operation options
 * @returns Result indicating success or failure
 *
 * @example
 * ```typescript
 * const result = await removeNetwork('docker', 'kadi-net');
 *
 * if (result.success) {
 *   console.log('Network removed');
 * } else if (result.error.code === 'NETWORK_IN_USE') {
 *   console.log('Network still has containers attached');
 * }
 * ```
 */
export async function removeNetwork(
  engine: ContainerEngine,
  networkName: string,
  options: NetworkOptions = {}
): Promise<Result<void, DeploymentError>> {
  const { timeout = 30_000, commandOptions } = options;

  log('Removing network %s', networkName);

  const removeCommand = `${engine} network rm ${networkName}`;

  const result = await runCommand(removeCommand, {
    ...commandOptions,
    timeout,
    silent: true,
  });

  if (!result.success) {
    const errorMessage =
      (result.error.context.stderr as string) || result.error.message;

    // Check for common error cases
    if (/has active endpoints|network .* has active endpoints/i.test(errorMessage)) {
      log('Network %s has active endpoints', networkName);

      return failure(
        new DeploymentError(
          `Network "${networkName}" has active containers attached`,
          'NETWORK_IN_USE',
          {
            engine,
            networkName,
            error: result.error.message,
          },
          true,
          `Stop all containers using this network first, then retry`,
          'error',
          result.error
        )
      );
    }

    if (/no such network|not found/i.test(errorMessage)) {
      log('Network %s does not exist', networkName);

      // Not found is actually success for removal
      return success(undefined);
    }

    // Other error
    log('Failed to remove network %s: %s', networkName, result.error.message);

    return failure(
      new DeploymentError(
        `Failed to remove network "${networkName}"`,
        'NETWORK_REMOVE_FAILED',
        {
          engine,
          networkName,
          error: result.error.message,
        },
        true,
        'Check container engine logs for details',
        'error',
        result.error
      )
    );
  }

  log('Network %s removed successfully', networkName);
  return success(undefined);
}
