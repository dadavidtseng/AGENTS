/**
 * Registry Setup
 *
 * Main entry point for setting up temporary registry infrastructure for local images.
 * Automatically detects local images and makes them accessible to Akash providers.
 *
 * @module utils/registry/setup
 */

import { execSync } from 'node:child_process';
import type { DeploymentLogger } from '../../types/common.js';
import type { AkashDeploymentProfile } from '../../types/profiles.js';
import type { RegistryContext, RegistryOptions } from './types.js';
import { TemporaryContainerRegistryManager } from './manager.js';
import { transformProfileWithRegistry } from './transformer.js';

/**
 * Setup temporary registry infrastructure if profile uses local images
 *
 * **Automatic Detection:**
 * This function automatically detects if your profile references local container images
 * (images that exist on your machine but not in a public registry). If local images
 * are found, it starts a temporary registry, pushes the images, and exposes them
 * publicly so Akash providers can pull them during deployment.
 *
 * **Three Possible Outcomes:**
 * 1. **No local images** → Returns profile unchanged, no registry started
 * 2. **User opted out** → Returns profile unchanged (useRemoteRegistry: true)
 * 3. **Local images found** → Starts registry, transforms profile, returns cleanup function
 *
 * **How It Works:**
 * 1. Checks if user opted out via `useRemoteRegistry: true`
 * 2. Scans each service image with `docker images -q <image>`
 * 3. If local images exist:
 *    - Starts registry container on localhost
 *    - Pushes local images to registry
 *    - Exposes registry via tunnel (ngrok/serveo/bore)
 *    - Rewrites profile to use public registry URLs
 * 4. Returns `RegistryContext` with transformed profile and cleanup function
 *
 * **Cleanup:**
 * Always call the returned `cleanup()` function after deployment completes.
 * This shuts down the registry and frees resources. Use a finally block to
 * ensure cleanup happens even if deployment fails.
 *
 * @param profile - Deployment profile from agent.json
 * @param logger - Logger for progress messages
 * @param options - Registry configuration options
 * @returns Registry context with transformed profile and cleanup function
 *
 * @example No local images (no registry needed)
 * ```typescript
 * const profile = {
 *   target: 'akash',
 *   network: 'mainnet',
 *   services: {
 *     app: { image: 'nginx:latest' } // Remote image
 *   }
 * };
 *
 * const ctx = await setupRegistryIfNeeded(profile, logger);
 * // ctx.deployableProfile === profile (unchanged)
 * // ctx.cleanup() is a no-op
 * ```
 *
 * @example Local images detected (registry started)
 * ```typescript
 * const profile = {
 *   target: 'akash',
 *   network: 'mainnet',
 *   services: {
 *     app: { image: 'my-app:latest' } // Local image
 *   }
 * };
 *
 * const ctx = await setupRegistryIfNeeded(profile, logger);
 * // Registry started, image pushed, profile transformed
 * // ctx.deployableProfile.services.app.image === 'xyz.serveo.net/my-app:latest'
 *
 * try {
 *   await deployToAkash({
 *     loadedProfile: { profile: ctx.deployableProfile }
 *   });
 * } finally {
 *   await ctx.cleanup(); // Always cleanup
 * }
 * ```
 *
 * @example User opted out (manual registry management)
 * ```typescript
 * const ctx = await setupRegistryIfNeeded(profile, logger, {
 *   useRemoteRegistry: true
 * });
 * // No registry started - user manually pushed images
 * // ctx.deployableProfile === profile (unchanged)
 * ```
 */
export async function setupRegistryIfNeeded(
  profile: AkashDeploymentProfile,
  logger: DeploymentLogger,
  options: RegistryOptions = {}
): Promise<RegistryContext> {
  // User explicitly wants to use remote registry
  // Skip all registry infrastructure and assume images are already pushed
  if (options.useRemoteRegistry) {
    logger.log('📡 Using remote registry (local registry disabled)');
    logger.log('Ensure all images are pushed to a remote registry!');

    return {
      deployableProfile: profile,
      cleanup: async () => {} // No cleanup needed
    };
  }

  // Check if any services use local images
  // Uses reality-based detection (docker images -q) to check actual existence
  const engine = options.containerEngine || 'docker';
  if (!hasLocalImages(profile, engine)) {
    // All images are remote (docker.io/nginx, ghcr.io/owner/repo, etc.)
    // No registry needed - providers can pull directly
    return {
      deployableProfile: profile,
      cleanup: async () => {} // No cleanup needed
    };
  }

  // Profile has local images - start registry infrastructure
  logger.log('Local images detected - setting up temporary registry...');

  const manager = new TemporaryContainerRegistryManager(logger);

  await manager.startTemporaryRegistry({
    port: options.port || 3000,
    tunnelService: options.tunnelService || 'serveo',
    containerEngine: engine,
    registryDuration: options.registryDuration || 600000, // 10 minutes default
    autoShutdown: options.autoShutdown ?? false, // Manual cleanup by default
    tunnelAuthToken: options.tunnelAuthToken,
    tunnelRegion: options.tunnelRegion,
    tunnelProtocol: options.tunnelProtocol,
    tunnelSubdomain: options.tunnelSubdomain
  });

  // Push local images to registry
  await manager.addLocalImagesToTemporaryRegistry(profile, engine);

  // Transform profile: "my-app" → "abc123.serveo.net/my-app:latest"
  const deployableProfile = transformProfileWithRegistry(profile, manager);

  // Return context with cleanup function
  return {
    deployableProfile,
    cleanup: async () => {
      if (manager.isRunning()) {
        logger.log('Shutting down temporary registry...');
        await manager.stopTemporaryRegistry();
        logger.log('Temporary registry shut down');
      }
    }
  };
}

/**
 * Check if profile contains any local container images
 *
 * **Reality-Based Detection:**
 * Instead of guessing based on image name patterns, we check if images
 * actually exist locally using `docker images -q <image>` or `podman images -q <image>`.
 *
 * **Why This is Better:**
 * - **Accurate**: Checks reality, not heuristics
 * - **Simple**: One check instead of multiple name pattern conditions
 * - **Handles edge cases**: "nginx" looks local but is on Docker Hub
 *
 * **Why This Matters:**
 * If this returns true, we start the temporary registry infrastructure
 * (tunnel, registry container). We should only do this when there are ACTUAL local
 * images that need to be made publicly accessible.
 *
 * **Performance:**
 * Runs a shell command for each service image. This is fast (< 100ms per image)
 * and necessary to get accurate results. The alternative (name-based guessing)
 * would lead to false positives and unnecessary infrastructure startup.
 *
 * @param profile - Deployment profile to check
 * @param engine - Container engine to use for checking
 * @returns True if profile has any images that exist locally
 *
 * @example
 * ```typescript
 * const profile = {
 *   services: {
 *     app: { image: 'my-app:latest' },      // If exists locally: true
 *     db: { image: 'postgres:14' }          // If not local: false
 *   }
 * };
 *
 * const hasLocal = hasLocalImages(profile, 'docker');
 * // true if my-app:latest exists in local Docker images
 * // false if only remote images present
 * ```
 */
export function hasLocalImages(
  profile: AkashDeploymentProfile,
  engine: 'docker' | 'podman' = 'docker'
): boolean {
  if (!profile.services) return false;

  return Object.values(profile.services).some((service) => {
    const image = service.image;
    if (!image) return false;

    try {
      // Check if image exists locally using container engine
      // Returns image hash if exists, empty string if not
      const result = execSync(`${engine} images -q ${image}`, {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'] // Suppress stderr to avoid noise
      });
      return result.trim().length > 0;
    } catch (error) {
      // Image doesn't exist locally or engine unavailable
      return false;
    }
  });
}
