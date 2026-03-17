/**
 * Local Deployment Orchestrator
 *
 * Main orchestration logic for local Docker/Podman deployments.
 * Coordinates engine management, network setup, compose generation,
 * and container orchestration.
 *
 * This module ties together all the local deployment components:
 * - Engine verification and startup
 * - Network creation
 * - Compose file generation
 * - Container deployment
 *
 * @module targets/local/deployer
 */

import debug from 'debug';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  success,
  failure,
  type LocalDeploymentOptions,
  type LocalDeploymentResult,
} from '../../types/index.js';
import { DeploymentError, getErrorMessage } from '../../errors/index.js';
import { loadProfile } from '../../utils/profile-loader.js';
import { runCommand } from '../../utils/command-runner.js';
import { ensureEngineRunning } from './engine-manager.js';
import { ensureNetwork } from './network-manager.js';
import {
  generateComposeYAML,
  type ServiceInput,
  type ComposeGenerationOptions,
} from './compose-generator.js';

/**
 * Debug logger for deployment orchestration
 */
const log = debug('deploy-ability:local:deploy');

/**
 * Default network name for KADI deployments
 */
const DEFAULT_NETWORK = 'kadi-net';

/**
 * Default compose file name
 */
const DEFAULT_COMPOSE_FILE = 'docker-compose.yml';

/**
 * Maps local deployment phase to general deployment phase
 *
 * @param phase - Local deployment phase
 * @returns General deployment phase
 *
 * @internal
 */
function mapLocalPhaseToDeploymentPhase(
  phase: 'profile' | 'engine' | 'network' | 'compose' | 'deploy' | 'complete'
): 'loading-profile' | 'initializing' | 'creating-deployment' | 'completed' {
  switch (phase) {
    case 'profile':
      return 'loading-profile';
    case 'engine':
    case 'network':
      return 'initializing';
    case 'compose':
    case 'deploy':
      return 'creating-deployment';
    case 'complete':
      return 'completed';
  }
}

/**
 * Emits a progress event if onProgress callback is provided
 *
 * Converts local deployment phases to general deployment phases
 * for compatibility with the common progress callback interface.
 *
 * @param options - Deployment options
 * @param phase - Local deployment phase
 * @param message - Progress message
 * @param progress - Optional progress percentage (0-100)
 *
 * @internal
 */
function emitProgress(
  options: LocalDeploymentOptions,
  phase: 'profile' | 'engine' | 'network' | 'compose' | 'deploy' | 'complete',
  message: string,
  progress?: number
): void {
  if (options.onProgress) {
    log('Progress: %s - %s', phase, message);

    options.onProgress({
      phase: mapLocalPhaseToDeploymentPhase(phase),
      message,
      progress,
      data: {
        localPhase: phase,
      },
    });
  }
}

/**
 * Performs a local deployment using Docker or Podman Compose
 *
 * This is the main orchestration function that executes a complete
 * local deployment workflow:
 *
 * 1. **Profile Loading** - Load and validate deployment profile from agent.json
 * 2. **Engine Verification** - Ensure container engine is running (auto-start Podman if needed)
 * 3. **Network Setup** - Create required Docker network for inter-service communication
 * 4. **Compose Generation** - Generate docker-compose.yml from service configurations
 * 5. **File Writing** - Write compose file to disk
 * 6. **Container Deployment** - Execute `docker compose up -d` to start services
 *
 * **Dry Run Mode:**
 * When `dryRun: true` is set, all validation and generation steps are performed,
 * but no actual deployment occurs. The generated compose file is returned in the
 * result for inspection.
 *
 * **Progress Tracking:**
 * Provide an `onProgress` callback to receive real-time updates about deployment
 * progress. Events include phase, message, and optional metadata.
 *
 * @param options - Local deployment options
 * @returns Result with deployment information or error
 *
 * @example Basic Usage
 * ```typescript
 * const result = await deployLocal({
 *   projectRoot: '/path/to/project',
 *   profile: 'local-dev'
 * });
 *
 * if (result.success) {
 *   console.log('Deployed services:', result.data.services);
 *   console.log('Endpoints:', result.data.endpoints);
 * } else {
 *   console.error('Deployment failed:', result.error.getUserMessage());
 * }
 * ```
 *
 * @example With Progress Tracking
 * ```typescript
 * const result = await deployLocal({
 *   projectRoot: process.cwd(),
 *   profile: 'production-local',
 *   onProgress: (event) => {
 *     console.log(`[${event.phase}] ${event.message}`);
 *   }
 * });
 * ```
 *
 * @example Dry Run
 * ```typescript
 * const result = await deployLocal({
 *   projectRoot: process.cwd(),
 *   dryRun: true
 * });
 *
 * if (result.success) {
 *   console.log('Generated compose file:');
 *   console.log(result.data.composeFile);
 * }
 * ```
 */
export async function deployLocal(
  options: LocalDeploymentOptions
): Promise<LocalDeploymentResult> {
  const {
    projectRoot,
    profile: profileName,
    loadedProfile: preloadedProfile,
    engine: engineOverride,
    network: networkOverride,
    composeOutputPath: composePathOverride,
    dryRun = false,
    verbose = false,
    logger,
  } = options;

  log('Starting local deployment');
  log('Project root: %s', projectRoot);
  log('Profile: %s', profileName || '(default)');
  log('Dry run: %s', dryRun);

  // -------------------------------------------------------------------------
  // Phase 1: Load and validate deployment profile
  // -------------------------------------------------------------------------

  emitProgress(options, 'profile', 'Loading deployment profile');

  let loadedProfile;

  if (preloadedProfile) {
    // Use pre-loaded profile if provided (allows callers to transform profile)
    log('Using pre-loaded profile');
    loadedProfile = preloadedProfile;
  } else {
    // Otherwise load from disk
    try {
      loadedProfile = await loadProfile(projectRoot, profileName, logger);
    } catch (error) {
      const errMsg = getErrorMessage(error);
      log('Profile loading failed: %s', errMsg);

      return failure(
        new DeploymentError(
          `Failed to load deployment profile: ${errMsg}`,
          'PROFILE_LOAD_ERROR',
          {
            projectRoot,
            profileName,
            error: errMsg,
          },
          true,
          'Check that agent.json exists and has valid deploy configuration',
          'error',
          error as Error
        )
      );
    }
  }

  const { name: selectedProfileName, profile } = loadedProfile;

  // Validate this is a local profile
  if (profile.target !== 'local') {
    log('Profile is not a local target: %s', profile.target);

    return failure(
      new DeploymentError(
        `Profile "${selectedProfileName}" is not a local deployment profile (target: "${profile.target}")`,
        'PROFILE_INVALID',
        {
          profileName: selectedProfileName,
          target: profile.target,
        },
        true,
        'Select a profile with target: "local"',
        'error'
      )
    );
  }

  // Extract configuration with overrides
  const engine = engineOverride ?? profile.engine ?? 'docker';
  const networkName = networkOverride ?? profile.network ?? DEFAULT_NETWORK;
  const composePath =
    composePathOverride ?? path.join(projectRoot, DEFAULT_COMPOSE_FILE);

  log('Configuration: engine=%s network=%s', engine, networkName);

  const serviceNames = Object.keys(profile.services);
  log('Services to deploy: %s', serviceNames.join(', '));

  // -------------------------------------------------------------------------
  // Phase 2: Dry run - preview without executing
  // -------------------------------------------------------------------------

  if (dryRun) {
    log('Dry run mode - generating preview');

    emitProgress(options, 'compose', 'Generating compose file (dry run)');

    const composeResult = generateComposeYAML(
      profile.services as Record<string, ServiceInput>,
      {
        networkName,
        containerPrefix: 'kadi',
      }
    );

    if (!composeResult.success) {
      log('Compose generation failed: %s', composeResult.error.message);
      return failure(composeResult.error);
    }

    log('Dry run complete - returning preview data');

    return success({
      dryRun: true as const,
      profile: selectedProfileName,
      engine,
      services: serviceNames,
      composeFile: composeResult.data,
    });
  }

  // -------------------------------------------------------------------------
  // Phase 3: Ensure container engine is running
  // -------------------------------------------------------------------------

  emitProgress(options, 'engine', `Ensuring ${engine} is running`);

  const engineResult = await ensureEngineRunning(engine, {
    timeout: 60_000,
    autoStart: true,
  });

  if (!engineResult.success) {
    log('Engine check failed: %s', engineResult.error.message);
    logger?.error(`${engine} is not available`);
    return failure(engineResult.error);
  }

  log('Engine ready (autoStarted=%s)', engineResult.data.autoStarted);

  // -------------------------------------------------------------------------
  // Phase 4: Create or verify network
  // -------------------------------------------------------------------------

  emitProgress(options, 'network', `Setting up network: ${networkName}`);

  const networkResult = await ensureNetwork(engine, networkName, {
    timeout: 30_000,
    driver: 'bridge',
  });

  if (!networkResult.success) {
    log('Network setup failed: %s', networkResult.error.message);
    logger?.error(`Failed to create network ${networkName}`);
    return failure(networkResult.error);
  }

  log('Network ready (preexisting=%s)', networkResult.data.preexisting);

  // -------------------------------------------------------------------------
  // Phase 5: Generate Docker Compose file
  // -------------------------------------------------------------------------

  emitProgress(options, 'compose', 'Generating docker-compose.yml');

  const composeOptions: ComposeGenerationOptions = {
    version: '3.9',
    networkName,
    containerPrefix: 'kadi',
    tty: true,
    stdinOpen: true,
  };

  const composeResult = generateComposeYAML(
    profile.services as Record<string, ServiceInput>,
    composeOptions
  );

  if (!composeResult.success) {
    log('Compose generation failed: %s', composeResult.error.message);
    logger?.error('Failed to generate docker-compose.yml');
    return failure(composeResult.error);
  }

  log('Compose file generated: %d bytes', composeResult.data.length);

  // -------------------------------------------------------------------------
  // Phase 6: Write compose file to disk
  // -------------------------------------------------------------------------

  emitProgress(options, 'compose', `Writing compose file to ${composePath}`);

  try {
    await fs.writeFile(composePath, composeResult.data, 'utf8');
    log('Compose file written to: %s', composePath);
  } catch (error) {
    const errMsg = getErrorMessage(error);
    log('Failed to write compose file: %s', errMsg);

    return failure(
      new DeploymentError(
        `Failed to write docker-compose.yml to ${composePath}`,
        'FILE_WRITE_ERROR',
        {
          path: composePath,
          error: errMsg,
        },
        true,
        'Check file permissions and disk space',
        'error',
        error as Error
      )
    );
  }

  // -------------------------------------------------------------------------
  // Phase 7: Deploy services with docker compose
  // -------------------------------------------------------------------------

  emitProgress(options, 'deploy', 'Starting services');

  // Use -d flag for detached mode (background)
  const composeUpCommand = `${engine} compose up -d`;

  log('Executing: %s', composeUpCommand);

  const deployResult = await runCommand(composeUpCommand, {
    cwd: projectRoot,
    timeout: 300_000, // 5 minutes for container pulls
    silent: !verbose,
  });

  if (!deployResult.success) {
    log('Deployment failed: %s', deployResult.error.message);
    logger?.error('Deployment failed');

    return failure(
      new DeploymentError(
        'Failed to start services with docker compose',
        'COMPOSE_UP_FAILED',
        {
          engine,
          command: composeUpCommand,
          error: deployResult.error.message,
          exitCode: deployResult.error.context.exitCode,
        },
        true,
        'Check docker compose output for errors, ensure images exist',
        'error',
        deployResult.error
      )
    );
  }

  log('Deployment completed successfully');

  // -------------------------------------------------------------------------
  // Phase 8: Extract container information
  // -------------------------------------------------------------------------

  emitProgress(options, 'complete', 'Getting container information');

  // Get container IDs from docker compose ps
  const psCommand = `${engine} compose ps --quiet`;
  log('Getting container IDs: %s', psCommand);

  const psResult = await runCommand(psCommand, {
    cwd: projectRoot,
    timeout: 30_000,
    silent: true,
  });

  const containersMap: Record<string, string> = {};

  if (psResult.success) {
    const containerIds = psResult.data.stdout.trim().split('\n').filter(id => id);
    log('Found %d containers', containerIds.length);

    // Map container IDs to service names
    // Get full container info to match names
    for (const containerId of containerIds) {
      const inspectCmd = `${engine} inspect ${containerId} --format '{{.Name}}'`;
      const inspectResult = await runCommand(inspectCmd, {
        timeout: 10_000,
        silent: true,
      });

      if (inspectResult.success) {
        const containerName = inspectResult.data.stdout.trim().replace(/^\//, ''); // Remove leading /

        // Match container name to service name
        // Container names are typically: kadi-{serviceName} or {project}_{serviceName}_1
        for (const serviceName of serviceNames) {
          if (containerName.includes(serviceName)) {
            containersMap[serviceName] = containerId.substring(0, 12); // Short ID
            log('Mapped service %s to container %s', serviceName, containerId.substring(0, 12));
            break;
          }
        }
      }
    }
  } else {
    log('Failed to get container IDs: %s', psResult.error.message);
    // Non-fatal - continue without container IDs
  }

  // -------------------------------------------------------------------------
  // Phase 9: Build endpoint information
  // -------------------------------------------------------------------------

  // Extract endpoints from service configurations
  const endpointsMap: Record<string, string> = {};

  for (const [serviceName, serviceConfig] of Object.entries(profile.services)) {
    const config = serviceConfig as ServiceInput;

    if (config.expose) {
      for (const portConfig of config.expose) {
        const externalPort = portConfig.as ?? portConfig.port;

        // Use first exposed port as primary endpoint for this service
        if (!endpointsMap[serviceName]) {
          endpointsMap[serviceName] = `http://localhost:${externalPort}`;
        }
      }
    }
  }

  log('Endpoints: %o', endpointsMap);
  log('Containers: %o', containersMap);

  return success({
    profile: selectedProfileName,
    engine,
    network: networkResult.data.name,
    services: serviceNames,
    containers: containersMap,
    endpoints: endpointsMap,
    composePath,
    deployedAt: new Date(),
  });
}
