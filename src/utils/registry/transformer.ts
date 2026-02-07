/**
 * Profile Transformer
 *
 * Transforms deployment profiles to use temporary registry URLs for local images.
 * Replaces local image references with public registry URLs and adds authentication
 * credentials.
 *
 * @module utils/registry/transformer
 */

import type { AkashDeploymentProfile } from '../../types/profiles.js';
import type { TemporaryContainerRegistryManager } from './manager.js';

/**
 * Transform profile to use registry URLs for local images
 *
 * Creates a new profile object where:
 * - Local image references are replaced with public registry URLs
 * - Registry credentials are added to each service with local images
 * - Remote images remain unchanged
 *
 * **Deep Clone:**
 * Creates a deep copy of the profile to avoid mutating the original. This is
 * important because the original profile might be used for other purposes or
 * stored for future reference.
 *
 * **Transformation Logic:**
 * For each service in the profile:
 * 1. Check if manager has a registry URL for this image (indicates it's local)
 * 2. If yes: Replace image with registry URL and add credentials
 * 3. If no: Leave image unchanged (it's remote or wasn't processed)
 *
 * @param profile - Original deployment profile
 * @param manager - Registry manager with image mappings and credentials
 * @returns Transformed profile ready for deployment
 *
 * @example
 * ```typescript
 * const original = {
 *   target: 'akash',
 *   services: {
 *     app: { image: 'my-app:latest' },      // Local image
 *     db: { image: 'postgres:14' }          // Remote image
 *   }
 * };
 *
 * const transformed = transformProfileWithRegistry(original, manager);
 * // Result:
 * // {
 * //   target: 'akash',
 * //   services: {
 * //     app: {
 * //       image: 'abc123.serveo.net/my-app:latest',
 * //       credentials: { host: '...', username: '...', password: '...' }
 * //     },
 * //     db: { image: 'postgres:14' }  // Unchanged - remote image
 * //   }
 * // }
 * ```
 */
export function transformProfileWithRegistry(
  profile: AkashDeploymentProfile,
  manager: TemporaryContainerRegistryManager
): AkashDeploymentProfile {
  // Deep clone to avoid mutating original profile
  // Using JSON.parse/JSON.stringify is simple and safe here because:
  // 1. Profile is a plain data object (no functions, symbols, etc.)
  // 2. We want a complete deep copy
  // 3. Any special objects have already been validated by Zod schemas
  const transformed = JSON.parse(
    JSON.stringify(profile)
  ) as AkashDeploymentProfile;

  // Get registry credentials (same for all services)
  const credentials = manager.getRegistryCredentials();

  // Transform each service
  for (const [serviceName, service] of Object.entries(transformed.services)) {
    const originalImage = service.image;

    // Check if this image was added to the registry (indicates it's local)
    const registryUrl = manager.getPublicImageUrl(serviceName, originalImage);

    if (registryUrl) {
      // Local image - replace with registry URL
      // TODO: Fix deploy-ability types to provide mutable service configs
      // Currently BaseServiceConfig uses readonly properties which prevents
      // legitimate mutations on cloned objects. We work with plain objects
      // after JSON.parse, so this is safe at runtime.
      const mutableService = service as any;
      mutableService.image = registryUrl;

      // Add registry credentials if available
      if (credentials) {
        mutableService.credentials = {
          host: credentials.host,
          username: credentials.username,
          password: credentials.password
        };
      }
    }
    // else: Remote image - leave unchanged
  }

  return transformed;
}

/**
 * Check if an image appears to be local based on name patterns
 *
 * **Heuristic-Based Detection:**
 * Checks image name patterns to guess if an image is local:
 * - No "/" → Likely local (e.g., "my-app")
 * - Starts with "localhost/" → Definitely local
 * - Starts with "127.0.0.1/" → Definitely local
 * - Contains "/" → Likely remote (e.g., "docker.io/nginx", "ghcr.io/owner/repo")
 *
 * **Note:** This is a heuristic and can be wrong!
 * - "nginx" looks local but is actually on Docker Hub
 * - "myregistry.com/app" looks remote but might not exist
 *
 * **Reality-Based Detection is Better:**
 * The manager uses `docker images -q` to check actual existence, which is more
 * accurate. This function is provided as a fallback for quick checks without
 * shelling out to the container engine.
 *
 * @param image - Image name to check
 * @returns True if image appears to be local based on naming patterns
 *
 * @example
 * ```typescript
 * isLocalImagePattern('my-app');              // true - no slash
 * isLocalImagePattern('localhost/my-app');    // true - localhost prefix
 * isLocalImagePattern('nginx:latest');        // true - no slash (but wrong!)
 * isLocalImagePattern('docker.io/nginx');     // false - has registry domain
 * isLocalImagePattern('ghcr.io/owner/repo');  // false - has registry domain
 * ```
 */
export function isLocalImagePattern(image: string): boolean {
  if (!image) return false;

  // Local images typically don't contain registry domains or start with localhost
  return (
    !image.includes('/') ||
    image.startsWith('localhost/') ||
    image.startsWith('127.0.0.1/')
  );
}
