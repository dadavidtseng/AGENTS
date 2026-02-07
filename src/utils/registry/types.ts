/**
 * Registry Infrastructure Types
 *
 * Type definitions for temporary container registry that makes local images
 * accessible to Akash providers during deployment.
 *
 * @module utils/registry/types
 */

import type { AkashDeploymentProfile } from '../../types/profiles.js';

/**
 * Registry context returned by setupRegistryIfNeeded
 *
 * Contains a transformed deployment profile where local image references have been
 * replaced with public registry URLs, plus a cleanup function to shut down the
 * temporary registry after deployment completes.
 *
 * **Lifecycle:**
 * 1. Call `setupRegistryIfNeeded()` → Returns `RegistryContext`
 * 2. Use `deployableProfile` for deployment
 * 3. After deployment, call `cleanup()` to shut down registry
 *
 * @example
 * ```typescript
 * const ctx = await setupRegistryIfNeeded(profile, logger);
 *
 * try {
 *   await deployToAkash({
 *     loadedProfile: {
 *       profile: ctx.deployableProfile // Use transformed profile
 *     }
 *   });
 * } finally {
 *   await ctx.cleanup(); // Always cleanup
 * }
 * ```
 */
export interface RegistryContext {
  /**
   * Profile ready for deployment to Akash
   *
   * Local images have been replaced with public registry URLs.
   * For example:
   *   - Original: `{ image: "my-app" }`
   *   - Deployable: `{ image: "abc123.serveo.net/my-app:latest", credentials: {...} }`
   *
   * If no local images were detected, this will be the same as the original profile.
   */
  readonly deployableProfile: AkashDeploymentProfile;

  /**
   * Cleanup function to call after deployment
   *
   * Shuts down the temporary registry. Should be called after Akash providers
   * have successfully pulled the images (containers are running).
   *
   * **Important:** Always call this in a finally block to ensure cleanup happens
   * even if deployment fails.
   *
   * If no registry was started (no local images), this is a no-op function.
   */
  cleanup: () => Promise<void>;
}

/**
 * Configuration options for registry setup
 *
 * Controls how the temporary registry is started and exposed publicly.
 */
export interface RegistryOptions {
  /**
   * Skip registry setup and assume images are in remote registries
   *
   * When true, no temporary registry is started regardless of whether local
   * images are detected. Use this when you've manually pushed all images to
   * Docker Hub, GHCR, or another registry.
   *
   * **Warning:** If set to true but images aren't actually in a remote registry,
   * deployment will fail when providers try to pull them.
   *
   * @default false
   */
  useRemoteRegistry?: boolean;

  /**
   * Container engine to use for image operations
   *
   * Used for checking if images exist locally and pushing them to the registry.
   *
   * @default 'docker'
   */
  containerEngine?: 'docker' | 'podman';

  /**
   * Tunnel service to expose registry publicly
   *
   * The temporary registry runs on localhost and needs to be exposed publicly
   * so Akash providers can pull images. Choose a tunnel service:
   *
   * - **ngrok**: Reliable, requires auth token for extended sessions
   * - **serveo**: Free, no signup, but less reliable
   * - **bore**: Modern alternative, requires bore.pub service
   *
   * @default 'serveo'
   */
  tunnelService?: 'ngrok' | 'serveo' | 'bore';

  /**
   * How long to keep registry running before auto-shutdown (milliseconds)
   *
   * Provides a safety net in case cleanup() isn't called. The registry will
   * automatically shut down after this duration.
   *
   * @default 600000 (10 minutes)
   */
  registryDuration?: number;

  /**
   * Enable automatic shutdown when downloads complete
   *
   * When true, the registry monitors download activity and automatically shuts
   * down once all images have been pulled. This is more efficient than waiting
   * for the duration timeout.
   *
   * @default true
   */
  autoShutdown?: boolean;

  /**
   * Authentication token for tunnel service
   *
   * Required for ngrok. Optional for other services depending on their features.
   *
   * **Environment variable:** Can also be set via NGROK_AUTH_TOKEN
   *
   * @default undefined
   */
  tunnelAuthToken?: string;

  /**
   * Region for tunnel service
   *
   * For ngrok: 'us', 'eu', 'ap', 'au', 'sa', 'jp', 'in'
   *
   * **Environment variable:** Can also be set via NGROK_REGION
   *
   * @default undefined (uses tunnel service default)
   */
  tunnelRegion?: string;

  /**
   * Protocol for tunnel
   *
   * @default 'http'
   */
  tunnelProtocol?: 'http' | 'https';

  /**
   * Custom subdomain for tunnel
   *
   * May require paid plan depending on tunnel service.
   *
   * @default undefined (random subdomain assigned)
   */
  tunnelSubdomain?: string;

  /**
   * Port for local registry server
   *
   * @default 3000
   */
  port?: number;
}

/**
 * Container mapping that tracks original image to registry URL transformation
 *
 * Internal type used by TemporaryContainerRegistryManager to track how images
 * are transformed during the registry setup process.
 */
export interface ContainerMapping {
  /** Original image name from agent.json (e.g., "my-app" or "my-app:latest") */
  originalImage: string;

  /** Service name from profile (e.g., "frontend", "api") */
  serviceName: string;

  /** Full registry URL with credentials host (e.g., "temp-registry.serveo.net/my-app:latest") */
  registryUrl: string;

  /** Repository name extracted from image (e.g., "my-app") */
  repoName: string;

  /** Image tag (e.g., "latest", "v1.0.0") */
  imageTag: string;

  /** Sanitized alias used in registry (e.g., "my-app") */
  actualAlias: string;
}

/**
 * Registry credentials for SDL generation
 *
 * Credentials required for Akash providers to authenticate with the temporary registry.
 * These are automatically added to the SDL services section.
 */
export interface RegistryCredentials {
  /** Registry host without protocol (e.g., "abc123.serveo.net") */
  host: string;

  /** Username for registry authentication */
  username: string;

  /** Password for registry authentication */
  password: string;
}

/**
 * Registry information from container registry instance
 *
 * Internal type containing connection details for the running registry.
 */
export interface RegistryInfo {
  /** Primary registry URL (tunnel URL if available, otherwise local) */
  url: string;

  /** Local registry URL (always present - always starts locally) */
  localUrl: string;

  /** Tunnel URL (optional - tunneling might fail) */
  tunnelUrl?: string;

  /** Authentication credentials (optional - may not be required) */
  credentials?: {
    username: string;
    password: string;
    accessKey: string;
    secretKey: string;
  };
}

/**
 * Registry URL components including local and tunnel endpoints
 *
 * Internal type used for managing both local and public registry URLs.
 */
export interface RegistryUrls {
  /** Local URL with protocol (e.g., "http://localhost:3000") */
  localUrl: string;

  /** Local domain without protocol (e.g., "localhost:3000") */
  localDomain: string;

  /** Tunnel URL with protocol (e.g., "https://abc123.serveo.net") or null */
  tunnelUrl: string | null;

  /** Tunnel domain without protocol (e.g., "abc123.serveo.net") or null */
  tunnelDomain: string | null;
}

/**
 * Container information returned by the registry
 *
 * Represents a container that has been added to the temporary registry.
 * The alias is the sanitized name used to reference the container in the registry.
 */
export interface ContainerInfo {
  /** Sanitized container alias used in the registry (e.g., "my-app") */
  alias: string;
}
