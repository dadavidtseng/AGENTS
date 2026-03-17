/**
 * Container Engine Management Module
 *
 * Manages Docker and Podman container engine lifecycle, ensuring engines
 * are running and accessible before deployment operations.
 *
 * Key Features:
 * - Automatic Podman VM startup on macOS/Windows
 * - Health checks and connectivity verification
 * - Structured error handling with recovery suggestions
 * - Type-safe Result returns (no throwing)
 *
 * @module targets/local/engine-manager
 */

import debug from 'debug';
import {
  type Result,
  success,
  failure,
  type ContainerEngine,
} from '../../types/index.js';
import { DeploymentError } from '../../errors/index.js';
import { runCommand, type CommandOptions } from '../../utils/command-runner.js';

/**
 * Debug logger for engine operations
 */
const log = debug('deploy-ability:local:engine');

/**
 * Container engine information
 *
 * Returned after successful engine verification, providing
 * structured data about the running engine.
 */
export interface EngineInfo {
  /**
   * Engine type
   */
  readonly engine: ContainerEngine;

  /**
   * Whether engine is running
   */
  readonly running: boolean;

  /**
   * Engine version string
   */
  readonly version?: string;

  /**
   * Whether this engine was auto-started by us
   */
  readonly autoStarted: boolean;

  /**
   * Platform the engine is running on
   */
  readonly platform?: string;
}

/**
 * Options for engine verification
 */
export interface EngineCheckOptions {
  /**
   * Timeout for engine operations in milliseconds
   * @default 30000 (30 seconds)
   */
  readonly timeout?: number;

  /**
   * Whether to attempt auto-starting the engine
   * @default true
   */
  readonly autoStart?: boolean;

  /**
   * Command execution options
   */
  readonly commandOptions?: CommandOptions;
}

/**
 * Checks if a container engine is running and accessible
 *
 * Performs a health check by running `docker info` or `podman info`.
 * Returns structured engine information if successful.
 *
 * **Does NOT auto-start the engine** - use `ensureEngineRunning` for that.
 *
 * @param engine - Container engine to check
 * @param options - Check options
 * @returns Result with engine info or error
 *
 * @example
 * ```typescript
 * const result = await checkEngineRunning('docker');
 *
 * if (result.success) {
 *   console.log(`Docker is running: v${result.data.version}`);
 * } else {
 *   console.error('Docker not available:', result.error.message);
 * }
 * ```
 */
export async function checkEngineRunning(
  engine: ContainerEngine,
  options: EngineCheckOptions = {}
): Promise<Result<EngineInfo, DeploymentError>> {
  const { timeout = 30_000, commandOptions } = options;

  log('Checking if %s is running', engine);

  const infoCommand = `${engine} info --format json`;

  const result = await runCommand(infoCommand, {
    ...commandOptions,
    timeout,
    silent: true,
  });

  if (!result.success) {
    log('%s is not running: %s', engine, result.error.message);

    return failure(
      new DeploymentError(
        `${engine} is not running or not accessible`,
        'ENGINE_NOT_RUNNING',
        {
          engine,
          command: infoCommand,
          error: result.error.message,
        },
        true,
        engine === 'docker'
          ? 'Start Docker Desktop or run "dockerd" manually, then retry'
          : 'Run "podman machine start" manually, then retry',
        'error',
        result.error
      )
    );
  }

  log('%s is running', engine);

  // Parse version and platform from info output
  let version: string | undefined;
  let platform: string | undefined;

  try {
    const info = JSON.parse(result.data.stdout);
    version = info.version?.Version || info.Version;
    platform = info.host?.os || info.host?.arch || process.platform;
  } catch {
    // Ignore parsing errors - version/platform are optional
    log('Could not parse engine info JSON');
  }

  return success({
    engine,
    running: true,
    version,
    platform,
    autoStarted: false,
  });
}

/**
 * Attempts to start a Podman VM
 *
 * On macOS and Windows, Podman runs inside a VM that must be started
 * before the engine can be used. This function handles the startup
 * process and waits for the VM to become ready.
 *
 * @param options - Command execution options
 * @returns Result indicating success or failure
 *
 * @internal
 */
async function startPodmanVM(
  options: EngineCheckOptions = {}
): Promise<Result<void, DeploymentError>> {
  const { timeout = 60_000, commandOptions } = options;

  log('Attempting to start Podman VM');

  const startResult = await runCommand('podman machine start', {
    ...commandOptions,
    timeout,
    silent: false,
  });

  if (!startResult.success) {
    log('Failed to start Podman VM: %s', startResult.error.message);

    return failure(
      new DeploymentError(
        'Podman VM could not be started',
        'PODMAN_VM_START_FAILED',
        {
          command: 'podman machine start',
          error: startResult.error.message,
        },
        true,
        'Run "podman machine init" (first time only) and "podman machine start" manually',
        'error',
        startResult.error
      )
    );
  }

  log('Podman VM start command completed');

  // Wait for socket to become available
  log('Waiting for Podman socket to become available');

  const checkResult = await runCommand('podman info --format json', {
    ...commandOptions,
    timeout: 30_000,
    silent: true,
  });

  if (!checkResult.success) {
    log('Podman socket did not become available: %s', checkResult.error.message);

    return failure(
      new DeploymentError(
        'Podman VM started but socket is not available',
        'PODMAN_SOCKET_UNAVAILABLE',
        {
          error: checkResult.error.message,
        },
        true,
        'Wait a few seconds and retry, or run "podman machine stop && podman machine start"',
        'error',
        checkResult.error
      )
    );
  }

  log('Podman socket is now available');
  return success(undefined);
}

/**
 * Ensures a container engine is running and accessible
 *
 * This is the main entry point for engine management. It will:
 *
 * **For Docker:**
 * - Check if Docker daemon is running
 * - Return error if not (cannot auto-start Docker)
 * - Provide clear instructions for manual startup
 *
 * **For Podman:**
 * - Check if Podman socket is available
 * - Automatically start Podman VM if not running (macOS/Windows)
 * - Wait for VM to become ready
 * - Return error if auto-start fails
 *
 * This eliminates common "connection refused" errors and provides
 * a better developer experience, especially with Podman's VM architecture.
 *
 * @param engine - Container engine to ensure is running
 * @param options - Engine check options
 * @returns Result with engine info or error
 *
 * @example
 * ```typescript
 * const result = await ensureEngineRunning('podman', { autoStart: true });
 *
 * if (result.success) {
 *   console.log('Engine ready:', result.data);
 *   if (result.data.autoStarted) {
 *     console.log('Podman VM was automatically started');
 *   }
 * } else {
 *   console.error('Engine error:', result.error.getUserMessage());
 *   console.error('Suggestion:', result.error.suggestion);
 * }
 * ```
 *
 * @example With custom timeout
 * ```typescript
 * const result = await ensureEngineRunning('docker', {
 *   timeout: 10_000,
 *   autoStart: false
 * });
 * ```
 */
export async function ensureEngineRunning(
  engine: ContainerEngine,
  options: EngineCheckOptions = {}
): Promise<Result<EngineInfo, DeploymentError>> {
  const { autoStart = true } = options;

  log('Ensuring %s is running (autoStart: %s)', engine, autoStart);

  // Fast path: check if engine is already running
  const checkResult = await checkEngineRunning(engine, options);

  if (checkResult.success) {
    log('%s is already running', engine);
    return checkResult;
  }

  // Engine not running - check if we can auto-start
  if (!autoStart) {
    log('Auto-start disabled, returning error');
    return checkResult;
  }

  // Docker cannot be auto-started (platform-specific, complex)
  if (engine === 'docker') {
    log('Cannot auto-start Docker, returning error');
    return checkResult;
  }

  // For Podman, check if this is a connection error we can fix
  const errorMessage = checkResult.error.context.error as string;
  const isConnectionError =
    /cannot connect to podman|unable to connect|dial unix/i.test(errorMessage);

  if (!isConnectionError) {
    log('Not a connection error, cannot auto-start: %s', errorMessage);
    return checkResult;
  }

  // Attempt to auto-start Podman VM
  log('Attempting auto-start of Podman VM');

  const startResult = await startPodmanVM(options);

  if (!startResult.success) {
    log('Auto-start failed');
    return failure(startResult.error);
  }

  log('Auto-start succeeded, verifying engine is running');

  // Verify engine is now running
  const verifyResult = await checkEngineRunning(engine, options);

  if (verifyResult.success) {
    log('Engine verified running after auto-start');
    return success({
      ...verifyResult.data,
      autoStarted: true,
    });
  }

  log('Engine still not running after auto-start');
  return verifyResult;
}

/**
 * Gets version information for a container engine
 *
 * Convenience function to extract just the version string from an engine.
 *
 * @param engine - Container engine to check
 * @param options - Check options
 * @returns Result with version string or error
 *
 * @example
 * ```typescript
 * const result = await getEngineVersion('docker');
 *
 * if (result.success) {
 *   console.log('Docker version:', result.data);
 * }
 * ```
 */
export async function getEngineVersion(
  engine: ContainerEngine,
  options: EngineCheckOptions = {}
): Promise<Result<string, DeploymentError>> {
  const result = await checkEngineRunning(engine, options);

  if (!result.success) {
    return failure(result.error);
  }

  if (!result.data.version) {
    return failure(
      new DeploymentError(
        'Could not determine engine version',
        'ENGINE_VERSION_UNKNOWN',
        { engine },
        false,
        undefined,
        'warning'
      )
    );
  }

  return success(result.data.version);
}
