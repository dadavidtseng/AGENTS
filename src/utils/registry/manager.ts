/**
 * Temporary Container Registry Manager
 *
 * Manages a temporary container registry for making local Docker images accessible
 * to Akash providers during deployment. Wraps the TunneledContainerRegistry from
 * @kadi.build/container-registry-ability with deployment-specific logic.
 *
 * **Core Responsibilities:**
 * - Start/stop temporary registry with public tunnel
 * - Detect which images exist locally vs remotely
 * - Push local images to temporary registry
 * - Track image → registry URL mappings
 * - Provide credentials for SDL generation
 *
 * @module utils/registry/manager
 */

import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import dotenv from 'dotenv';
import debug from 'debug';
import type { DeploymentLogger } from '../../types/common.js';
import type { AkashDeploymentProfile } from '../../types/profiles.js';
import type {
  ContainerMapping,
  RegistryCredentials,
  RegistryInfo,
  RegistryUrls,
  ContainerInfo,
  RegistryOptions
} from './types.js';
import { getErrorMessage } from '../../errors/index.js';

// @ts-ignore - Using existing TunneledContainerRegistry from JavaScript package
import { TunneledContainerRegistry } from '@kadi.build/container-registry-ability';

/**
 * Debug logger for registry operations
 *
 * Enable with: DEBUG=deploy-ability:registry
 */
const log = debug('deploy-ability:registry');

/**
 * Temporary Container Registry Manager
 *
 * Manages the lifecycle of a temporary container registry that makes local images
 * accessible to Akash providers. This class handles starting the registry, detecting
 * local images, pushing them, and tracking URL transformations.
 *
 * **Typical Workflow:**
 * ```typescript
 * const manager = new TemporaryContainerRegistryManager(logger);
 *
 * // 1. Start registry
 * await manager.startTemporaryRegistry({
 *   tunnelService: 'serveo',
 *   containerEngine: 'docker'
 * });
 *
 * // 2. Add local images from profile
 * await manager.addLocalImagesToTemporaryRegistry(profile, 'docker');
 *
 * // 3. Get transformed image URLs
 * const url = manager.getPublicImageUrl('frontend', 'my-app:latest');
 *
 * // 4. Get credentials for SDL
 * const creds = manager.getRegistryCredentials();
 *
 * // 5. Stop registry when done
 * await manager.stopTemporaryRegistry();
 * ```
 */
export class TemporaryContainerRegistryManager {
  private logger: DeploymentLogger;
  private registry: typeof TunneledContainerRegistry | null = null;
  private registryInfo: RegistryInfo | null = null;

  /**
   * Maps original image names to their public registry URLs
   *
   * Key: Original image name (e.g., "my-app:latest")
   * Value: Container mapping with registry URL and metadata
   */
  private containerMappings = new Map<string, ContainerMapping>();

  /**
   * Create a new registry manager
   *
   * @param logger - Logger for progress and error messages
   */
  constructor(logger: DeploymentLogger) {
    this.logger = logger;
  }

  /**
   * Start temporary registry with public tunnel
   *
   * Creates a local container registry on the specified port and exposes it publicly
   * via a tunnel service (ngrok, serveo, or bore). The registry is used to make
   * local Docker images accessible to Akash providers during deployment.
   *
   * **What This Does:**
   * 1. Loads environment variables (.env) for tunnel configuration
   * 2. Starts local registry container on specified port
   * 3. Creates public tunnel (ngrok/serveo/bore)
   * 4. Generates authentication credentials
   * 5. Returns when registry is accessible
   *
   * **Tunnel Services:**
   * - **ngrok**: Most reliable, requires auth token (NGROK_AUTH_TOKEN env var)
   * - **serveo**: Free SSH-based tunnel, no signup required
   * - **bore**: Modern alternative using bore.pub
   *
   * @param options - Configuration options for registry and tunnel
   * @throws Error if registry fails to start or tunnel cannot be established
   *
   * @example
   * ```typescript
   * await manager.startTemporaryRegistry({
   *   port: 3000,
   *   tunnelService: 'serveo',
   *   containerEngine: 'docker',
   *   registryDuration: 600000, // 10 minutes
   *   autoShutdown: false
   * });
   * ```
   */
  async startTemporaryRegistry(options: RegistryOptions): Promise<void> {
    if (this.registry) {
      log('Temporary registry already running');
      return;
    }

    log('Starting temporary container registry...');

    try {
      // Load environment variables for tunnel configuration
      // Checks two locations:
      // 1. Module directory (dist/.env) - plugin-specific overrides
      // 2. Package root (.env) - project-wide configuration
      const moduleDir = path.dirname(fileURLToPath(import.meta.url));
      const pluginEnvPath = path.join(moduleDir, '.env');
      if (fs.existsSync(pluginEnvPath)) {
        dotenv.config({ path: pluginEnvPath });
        log('Loaded env from: %s', pluginEnvPath);
      }
      const packageRootEnvPath = path.join(moduleDir, '..', '..', '..', '.env');
      if (fs.existsSync(packageRootEnvPath)) {
        dotenv.config({ path: packageRootEnvPath });
        log('Loaded env from: %s', packageRootEnvPath);
      }

      // Resolve tunnel configuration from environment variables
      // CLI options take precedence over environment variables
      const envNgrokToken = process.env.NGROK_AUTH_TOKEN || undefined;
      const envNgrokRegion = process.env.NGROK_REGION || undefined;
      const envNgrokProtocol = process.env.NGROK_PROTOCOL || undefined;

      // Create TunneledContainerRegistry instance
      this.registry = new TunneledContainerRegistry({
        port: options.port || 3000,
        tunnelService: options.tunnelService || 'serveo',
        tunnelOptions: {
          // Allow CLI options to override env if provided
          authToken: options.tunnelAuthToken || envNgrokToken,
          region: options.tunnelRegion || envNgrokRegion,
          protocol: options.tunnelProtocol || envNgrokProtocol,
          subdomain: options.tunnelSubdomain
        },
        enableMonitoring: false,
        // Disable verbose logging - only show errors
        // User can enable with DEBUG=deploy-ability:* environment variable if needed
        enableLogging: false,
        logLevel: 'error',
        // Enable auto-shutdown by default to cleanup resources after deployment completes
        // Can be disabled by passing options.autoShutdown = false
        autoShutdown: options.autoShutdown ?? true,
        containerType: options.containerEngine || 'docker',
        duration: options.registryDuration
      });

      // Start the registry and get connection info
      await this.registry.start();
      this.registryInfo = this.registry.getRegistryInfo();

      // Validate registry info
      if (!this.registryInfo) {
        throw new Error(
          'Failed to get registry information after starting registry'
        );
      }

      if (!this.registryInfo.localUrl) {
        throw new Error('Registry started but no local URL available');
      }

      // Determine the primary registry URL (prefer tunnel over local)
      const primaryRegistryUrl =
        this.registryInfo.tunnelUrl || this.registryInfo.localUrl;
      log('Registry started at: %s', primaryRegistryUrl);

      await this.displayRegistryAccessInformation();
    } catch (error) {
      // Clean up on failure
      await this.stopTemporaryRegistry();
      const errMsg = getErrorMessage(error);
      throw new Error(`Failed to start temporary registry: ${errMsg}`);
    }
  }

  /**
   * Display registry access information including domain and credentials
   *
   * Logs registry connection details for debugging purposes.
   * Only logs if debug logging is enabled (DEBUG=deploy-ability:registry).
   */
  private async displayRegistryAccessInformation(): Promise<void> {
    if (!this.registryInfo) {
      return;
    }

    try {
      // Try to get command help from registry (provides formatted domain)
      const commandHelp = await this.registry.generateCommandHelp();

      const registryDomain =
        commandHelp?.registry?.registryDomain ||
        (this.registryInfo.tunnelUrl || this.registryInfo.localUrl).replace(
          /^https?:\/\//,
          ''
        );

      log('Registry domain: %s', registryDomain);

      if (this.registryInfo.credentials) {
        log('Access key: %s', this.registryInfo.credentials.accessKey);
        log('Secret key: [hidden]');
      }
    } catch (error) {
      // Fallback display if command generation fails
      if (this.registryInfo.credentials) {
        log('Registry credentials available');
        log('Username: %s', this.registryInfo.credentials.accessKey);
        log('Password: [hidden]');
      }
    }
  }

  /**
   * Check if a container image exists locally
   *
   * Uses `docker images -q` or `podman images -q` to check if an image exists
   * in the local container engine. This is the ground truth for whether we need
   * to add an image to the temporary registry.
   *
   * **Why This Works:**
   * - Returns image hash if image exists locally
   * - Returns empty string if image doesn't exist
   * - Works for both tagged and untagged images
   * - Handles shorthand names correctly (e.g., "nginx" vs "docker.io/library/nginx")
   *
   * **Reality-Based Detection:**
   * Instead of guessing based on image name patterns (checking for "/" in the name),
   * we check the actual state of the local container engine. This prevents false
   * positives and false negatives.
   *
   * @param imageName - Full image name with tag (e.g., "my-app:latest")
   * @param engine - Container engine to use
   * @returns True if image exists locally, false otherwise
   */
  private checkImageExistsLocally(
    imageName: string,
    engine: 'docker' | 'podman'
  ): boolean {
    try {
      const result = execSync(`${engine} images -q ${imageName}`, {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'] // Suppress stderr
      });
      return result.trim().length > 0;
    } catch (error) {
      // Command failed (engine not available or other error)
      return false;
    }
  }

  /**
   * Add local images from deployment profile to the temporary registry
   *
   * **Simplified Logic (Reality-Based Detection):**
   *
   * Instead of guessing if an image is "local" based on name patterns (like checking
   * if it has "/" in the name), we simply check if the image actually exists locally
   * using `docker images -q <image>`.
   *
   * **This approach:**
   * 1. Is more accurate (checks reality, not heuristics)
   * 2. Is simpler (one check instead of multiple conditions)
   * 3. Handles edge cases automatically:
   *    - Docker Hub shorthand ("nginx" → exists remotely, not locally)
   *    - Custom registries with default namespaces
   *    - Images that "look local" but are actually remote
   *
   * **Decision Flow:**
   * - Image exists locally → Add to temporary registry and make publicly accessible
   * - Image doesn't exist locally → Treat as remote reference (don't add to registry)
   *
   * **Why This Works:**
   * The temporary registry is ONLY needed for images that exist locally but need to
   * be made publicly accessible to Akash providers. If an image doesn't exist locally,
   * either:
   * - It's a remote image (providers can pull it directly)
   * - It doesn't exist anywhere (deployment will fail later with clear error)
   *
   * @param profile - Deployment profile containing services with images
   * @param containerEngine - Container engine to use for operations
   * @throws Error if a required local image cannot be added to registry
   *
   * @example
   * ```typescript
   * await manager.addLocalImagesToTemporaryRegistry(profile, 'docker');
   * // Checks each service image, adds local ones to registry
   * ```
   */
  async addLocalImagesToTemporaryRegistry(
    profile: AkashDeploymentProfile,
    containerEngine: 'docker' | 'podman'
  ): Promise<void> {
    log('Checking which service images exist locally...');

    for (const [serviceName, serviceConfig] of Object.entries(
      profile.services
    )) {
      const imageName = serviceConfig.image;

      // Check if image exists locally (reality-based, not name-based)
      if (this.checkImageExistsLocally(imageName, containerEngine)) {
        // Image exists locally → add to temporary registry
        log('Image found locally for service %s: %s', serviceName, imageName);

        try {
          // Use intelligent fallback strategy (tar file → container engine)
          const mapping = await this.addContainerIntelligently(
            imageName,
            serviceName,
            containerEngine
          );

          // Store the mapping for later SDL generation
          this.containerMappings.set(imageName, mapping);
        } catch (error) {
          const errMsg = getErrorMessage(error);
          this.logger.error(
            `Failed to add local image '${imageName}' for service '${serviceName}': ${errMsg}`
          );
          throw error; // Stop deployment if we can't host a required local image
        }
      } else {
        // Image doesn't exist locally → treat as remote
        log(
          'Image not found locally, treating as remote for service %s: %s',
          serviceName,
          imageName
        );
      }
    }

    log('Successfully processed %d local images', this.containerMappings.size);
  }

  /**
   * Intelligent container addition with fallback strategies
   *
   * Tries multiple strategies to add a container image to the registry:
   * 1. **Strategy 1**: Load from tar file (from kadi-build export cache)
   * 2. **Strategy 2**: Load from container engine (docker/podman)
   * 3. **Failure**: Show helpful error with suggestions
   *
   * **Why Multiple Strategies:**
   * - Tar files are faster and don't require container engine running
   * - Container engine is the fallback if tar file not available
   * - Provides clear guidance if both fail
   *
   * @param imageName - Full image name with tag
   * @param serviceName - Service name from profile
   * @param containerEngine - Container engine to use
   * @returns Container mapping with registry URL
   * @throws Error if image cannot be added with any strategy
   */
  private async addContainerIntelligently(
    imageName: string,
    serviceName: string,
    containerEngine: 'docker' | 'podman'
  ): Promise<ContainerMapping> {
    // Parse image name into repository and tag
    const repoName = imageName.includes(':')
      ? imageName.split(':')[0]
      : imageName;
    const imageTag = imageName.includes(':')
      ? imageName.split(':')[1]
      : 'latest';

    log('Attempting to add container: %s', imageName);

    // Strategy 1: Try to find and use tar file from kadi-build
    const tarPath = this.findKadiBuildTarFile(imageName);
    if (tarPath) {
      try {
        log('Loading container from tar file: %s', tarPath);

        const containerInfo = await this.registry.addContainer({
          type: 'tar',
          name: repoName || imageName, // Fallback to imageName if repoName is undefined
          path: tarPath
        });

        log('Container loaded from tar file with alias: %s', containerInfo.alias);

        return this.createContainerMapping(
          imageName,
          serviceName,
          containerInfo,
          repoName || imageName, // Use imageName as fallback
          imageTag || 'latest' // Use 'latest' as fallback
        );
      } catch (error) {
        const errMsg = getErrorMessage(error);
        log('Failed to load from tar file: %s', errMsg);
        log('Falling back to container engine...');
      }
    }

    // Strategy 2: Try to add from container engine (docker/podman)
    try {
      log('Attempting to add from %s engine: %s', containerEngine, imageName);

      const containerInfo = await this.registry.addContainer({
        type: containerEngine,
        name: repoName || imageName, // Fallback to imageName if repoName is undefined
        image: imageName
      });

      log(
        'Container loaded from %s with alias: %s',
        containerEngine,
        containerInfo.alias
      );

      return this.createContainerMapping(
        imageName,
        serviceName,
        containerInfo,
        repoName || imageName, // Use imageName as fallback
        imageTag || 'latest' // Use 'latest' as fallback
      );
    } catch (error) {
      const errMsg = getErrorMessage(error);
      log('Failed to load from %s: %s', containerEngine, errMsg);
    }

    // Strategy 3: Show helpful error message
    this.showKadiBuildSuggestion(imageName, containerEngine);
    throw new Error(
      `Could not add container ${imageName}. See suggestions above.`
    );
  }

  /**
   * Create container mapping for registry URLs
   *
   * Transforms a local image reference into a complete registry URL mapping
   * that can be used in SDL generation. Includes service name tracking for
   * better debugging and error messages.
   *
   * @param originalImage - Original image name from agent.json (e.g., "my-app")
   * @param serviceName - Service name from profile (e.g., "frontend")
   * @param containerInfo - Container info from registry with alias
   * @param repoName - Repository name extracted from image
   * @param imageTag - Image tag (e.g., "latest")
   * @returns Complete container mapping with registry URL
   */
  private async createContainerMapping(
    originalImage: string,
    serviceName: string,
    containerInfo: ContainerInfo,
    repoName: string,
    imageTag: string
  ): Promise<ContainerMapping> {
    const actualAlias = containerInfo.alias;
    const registryDomain = this.getPreferredDomain();
    const registryImageUrl = `${registryDomain}/${actualAlias}:${imageTag}`;

    const mapping: ContainerMapping = {
      originalImage,
      serviceName,
      registryUrl: registryImageUrl,
      repoName,
      imageTag,
      actualAlias
    };

    log('Container available at: %s', registryImageUrl);

    // Verify container is accessible
    this.verifyContainerInRegistry(actualAlias);

    return mapping;
  }

  /**
   * Get public image URL for a specific service
   *
   * This is the key method that SDL generator calls to get the transformed
   * registry URL for a local image.
   *
   * **Returns null if:**
   * - Image is not local (no mapping exists)
   * - Image wasn't added to registry
   * - Service name doesn't match
   *
   * @param serviceName - Service name from profile
   * @param originalImage - Original image name from profile
   * @returns Public registry URL or null if not a local image
   *
   * @example
   * ```typescript
   * const url = manager.getPublicImageUrl('frontend', 'my-app:latest');
   * // Returns: "abc123.serveo.net/my-app:latest" or null
   * ```
   */
  getPublicImageUrl(serviceName: string, originalImage: string): string | null {
    const mapping = this.containerMappings.get(originalImage);

    if (mapping && mapping.serviceName === serviceName) {
      return mapping.registryUrl;
    }

    return null;
  }

  /**
   * Get registry credentials for SDL generation
   *
   * Returns authentication credentials that should be added to the SDL services
   * section so Akash providers can authenticate with the temporary registry.
   *
   * @returns Registry credentials or null if not available
   *
   * @example
   * ```typescript
   * const creds = manager.getRegistryCredentials();
   * // Use in SDL: { host: "abc123.serveo.net", username: "...", password: "..." }
   * ```
   */
  getRegistryCredentials(): RegistryCredentials | null {
    if (!this.registryInfo?.credentials) {
      log('No registry credentials available');
      return null;
    }

    log(
      'Registry info - tunnel: %s, local: %s',
      this.registryInfo.tunnelUrl,
      this.registryInfo.localUrl
    );

    const host = this.getRegistryDomain();

    // Convert to the format expected by SDL generation
    const credentials = {
      host: host,
      username: this.registryInfo.credentials.accessKey,
      password: this.registryInfo.credentials.secretKey
    };

    log(
      'Returning registry credentials - host: %s, username: %s',
      credentials.host,
      credentials.username
    );

    return credentials;
  }

  /**
   * Find tar file from kadi-build export directory
   *
   * Searches for container tar files exported by kadi-build in common locations:
   * 1. ~/.kadi/tmp/container-registry-exports/containers/ (primary)
   * 2. ./container-exports/ (backup)
   * 3. /tmp/container-registry-exports/containers/ (fallback)
   *
   * **Why This Matters:**
   * Tar files are faster to load and don't require the container engine to be running.
   *
   * @param imageName - Image name to search for (e.g., "my-app:0.0.1")
   * @returns Path to tar file or null if not found
   */
  private findKadiBuildTarFile(imageName: string): string | null {
    // Generate the expected filename pattern
    // Example: "my-app:0.0.1" -> "my-app-0.0.1.tar"
    const expectedFilename = `${imageName.replace(/[^a-zA-Z0-9.-]/g, '-')}.tar`;

    // Common locations where kadi-build saves tar files
    const possiblePaths: string[] = [
      // User's home directory .kadi cache (primary location)
      path.join(
        os.homedir(),
        '.kadi',
        'tmp',
        'container-registry-exports',
        'containers'
      ),
      // Current working directory exports (backup location)
      path.join(process.cwd(), 'container-exports'),
      // Temporary directory exports (fallback location)
      path.join(os.tmpdir(), 'container-registry-exports', 'containers')
    ];

    for (const basePath of possiblePaths) {
      const fullPath = path.join(basePath, expectedFilename);

      if (fs.existsSync(fullPath)) {
        log('Found tar file for %s: %s', imageName, fullPath);
        return fullPath;
      }

      log('Checked: %s - not found', fullPath);
    }

    return null;
  }

  /**
   * Show helpful suggestion to run kadi-build
   *
   * Displays actionable suggestions when a container cannot be found or added.
   * Helps users understand what went wrong and how to fix it.
   *
   * @param imageName - Image that couldn't be added
   * @param containerType - Container engine used
   */
  private showKadiBuildSuggestion(
    imageName: string,
    containerType: string
  ): void {
    this.logger.log(`\nCONTAINER NOT FOUND: ${imageName}`);
    this.logger.log(`\nThis could mean:`);
    this.logger.log(`  • The container hasn't been built yet`);
    this.logger.log(`  • The container name doesn't match what's available`);
    this.logger.log(`  • The container was built with a different tool`);

    this.logger.log(`\n💡 SUGGESTED SOLUTIONS:`);
    this.logger.log(`\n1. Build the container first:`);
    this.logger.log(
      `   ${containerType} build -t ${imageName} .`
    );

    this.logger.log(`\n2. Check available containers:`);
    this.logger.log(
      `   ${containerType} images | grep ${imageName.split(':')[0]}`
    );

    this.logger.log(
      `\n3. Verify the image name in your agent.json matches the built container`
    );

    this.logger.log(`\n4. If using a different tag, ensure it exists:`);
    this.logger.log(`   ${containerType} images ${imageName.split(':')[0]}`);
  }

  /**
   * Verify container is accessible in the registry
   *
   * Checks that a container with the given alias is present in the registry.
   * Logs a warning if not found and shows available containers for debugging.
   *
   * @param actualAlias - Container alias to verify
   */
  private verifyContainerInRegistry(actualAlias: string): void {
    try {
      const containers: ContainerInfo[] = this.registry.listContainers();
      const foundContainer = containers.find(
        (c: ContainerInfo) => c.alias === actualAlias
      );

      if (foundContainer) {
        log('Verified container in registry with alias: %s', foundContainer.alias);
      } else {
        this.logger.warn(
          `   Warning: Container not found in registry with alias: ${actualAlias}`
        );
        this.logger.log(
          `   Available containers: ${containers.map((c: ContainerInfo) => c.alias).join(', ')}`
        );
      }
    } catch (error) {
      // Silently ignore verification errors - registry might not support listing
    }
  }

  /**
   * Get the registry domain (without protocol)
   *
   * Returns the domain to use in image URLs. Prefers tunnel domain over local.
   *
   * @returns Registry domain (e.g., "abc123.serveo.net" or "localhost:3000")
   */
  private getRegistryDomain(): string {
    try {
      const preferredDomain = this.getPreferredDomain();
      if (preferredDomain) {
        log('Registry domain from getRegistryUrls: %s', preferredDomain);
        return preferredDomain;
      }
    } catch (error) {
      const errMsg = getErrorMessage(error);
      log('Could not get registry URLs: %s', errMsg);
    }

    // Fallback to parsing from registry info
    if (this.registryInfo) {
      const url = this.registryInfo.tunnelUrl || this.registryInfo.localUrl;
      if (url) {
        const domain = url.replace(/^https?:\/\//, '');
        log('Registry domain from registryInfo: %s', domain);
        return domain;
      }
    }

    this.logger.error('Could not determine registry domain!');
    return '';
  }

  /**
   * Get registry URL components including local and tunnel endpoints
   *
   * @returns Registry URLs with both local and tunnel information
   */
  private getRegistryUrls(): RegistryUrls {
    if (!this.registryInfo) {
      throw new Error('Registry not started');
    }

    const localUrl = this.registryInfo.localUrl;
    const tunnelUrl = this.registryInfo.tunnelUrl || null;

    // Extract domains (remove protocol)
    const localDomain = localUrl.replace(/^https?:\/\//, '');
    const tunnelDomain = tunnelUrl
      ? tunnelUrl.replace(/^https?:\/\//, '')
      : null;

    return {
      localUrl,
      localDomain,
      tunnelUrl,
      tunnelDomain
    };
  }

  /**
   * Get the preferred domain (tunnel if available, otherwise local)
   *
   * @returns Domain without protocol
   */
  private getPreferredDomain(): string {
    const urls = this.getRegistryUrls();
    return urls.tunnelDomain || urls.localDomain;
  }

  /**
   * Check if registry is running
   *
   * @returns True if registry is started and accessible
   */
  isRunning(): boolean {
    return this.registry !== null && this.registryInfo !== null;
  }

  /**
   * Display container mappings for debugging
   *
   * Shows how original image names were transformed to registry URLs.
   * Useful for troubleshooting deployment issues.
   */
  async displayContainerMappings(): Promise<void> {
    this.logger.log('\nContainer image mappings:');

    if (this.containerMappings.size === 0) {
      this.logger.log('  No local images processed');
      return;
    }

    for (const [originalImage, mapping] of this.containerMappings) {
      this.logger.log(`  ${mapping.serviceName}:`);
      this.logger.log(`    Original: ${originalImage}`);
      this.logger.log(`    Registry: ${mapping.registryUrl}`);
      this.logger.log(`    Alias: ${mapping.actualAlias}`);
    }
  }

  /**
   * Stop the temporary registry and cleanup resources
   *
   * Shuts down the registry container and tunnel. Should be called after
   * deployment completes and providers have pulled all images.
   *
   * **Safe to call multiple times** - idempotent operation.
   */
  async stopTemporaryRegistry(): Promise<void> {
    if (!this.registry) {
      return;
    }

    log('Stopping temporary registry...');

    try {
      // Stop the registry instance
      await this.registry.stop();

      // Clear state
      this.registry = null;
      this.registryInfo = null;
      this.containerMappings.clear();

      log('Temporary registry stopped and cleaned up');
    } catch (error) {
      const errMsg = getErrorMessage(error);
      this.logger.warn(`Error during registry cleanup: ${errMsg}`);
    }
  }
}
