/**
 * @fileoverview Git Provider Factory for selecting appropriate provider
 * @module services/git/core/GitProviderFactory
 *
 * The GitProviderFactory is responsible for selecting and instantiating
 * the appropriate git provider based on environment and configuration.
 *
 * Provider Selection Strategy:
 * 1. CLI Provider (default): Full feature set, local-only
 * 2. Isomorphic Provider (future): Core features, edge-compatible
 * 3. API Providers (future): GitHub API, GitLab API, etc.
 *
 * Selection is based on:
 * - Environment (local vs serverless/edge)
 * - Required capabilities
 * - Configuration preferences
 */

import { logger } from '@/utils/index.js';

import type { IGitProvider } from './IGitProvider.js';
import { CliGitProvider } from '../providers/cli/index.js';

/**
 * Provider type enumeration.
 */
export enum GitProviderType {
  /** CLI provider using native git binary (local-only, full features) */
  CLI = 'cli',
  /** Isomorphic git provider (edge-compatible, core features) */
  ISOMORPHIC = 'isomorphic',
  /** GitHub API provider (cloud-based, GitHub-specific) */
  GITHUB_API = 'github-api',
  /** GitLab API provider (cloud-based, GitLab-specific) */
  GITLAB_API = 'gitlab-api',
}

/**
 * Provider selection options.
 */
export interface GitProviderOptions {
  /** Preferred provider type (if available) */
  preferredType?: GitProviderType;
  /** Whether running in serverless/edge environment */
  isServerless?: boolean;
  /** Required capabilities (provider must support all) */
  requiredCapabilities?: Array<keyof IGitProvider['capabilities']>;
}

/**
 * Factory for creating and managing git providers.
 *
 * Singleton pattern - use GitProviderFactory.getInstance() to get instance.
 */
export class GitProviderFactory {
  private static instance: GitProviderFactory | null = null;
  private providerCache: Map<GitProviderType, IGitProvider> = new Map();

  /**
   * Private constructor - use getInstance() instead.
   */
  private constructor() {}

  /**
   * Get or create the singleton factory instance.
   *
   * @returns GitProviderFactory instance
   */
  static getInstance(): GitProviderFactory {
    if (!GitProviderFactory.instance) {
      GitProviderFactory.instance = new GitProviderFactory();
    }
    return GitProviderFactory.instance;
  }

  /**
   * Get an appropriate git provider based on options.
   *
   * Selects the best provider for the current environment and requirements.
   *
   * @param options - Provider selection options
   * @returns Promise resolving to a configured git provider
   *
   * @example
   * ```typescript
   * const factory = GitProviderFactory.getInstance();
   * const provider = await factory.getProvider({
   *   preferredType: GitProviderType.CLI,
   *   isServerless: false,
   * });
   * ```
   */
  async getProvider(options: GitProviderOptions = {}): Promise<IGitProvider> {
    const {
      preferredType,
      isServerless = false,
      requiredCapabilities = [],
    } = options;

    // Determine which provider to use
    const providerType = this.selectProviderType(
      preferredType,
      isServerless,
      requiredCapabilities,
    );

    // Return cached provider if available
    if (this.providerCache.has(providerType)) {
      logger.debug('Using cached git provider', {
        requestId: 'factory',
        timestamp: Date.now().toString(),
        type: providerType,
      });
      return this.providerCache.get(providerType)!;
    }

    // Create new provider instance
    const provider = await this.createProvider(providerType);

    // Verify provider capabilities
    this.verifyCapabilities(provider, requiredCapabilities);

    // Cache and return
    this.providerCache.set(providerType, provider);
    logger.info('Git provider initialized', {
      requestId: 'factory',
      timestamp: Date.now().toString(),
      type: providerType,
      version: provider.version,
    });

    return provider;
  }

  /**
   * Select the most appropriate provider type based on environment and requirements.
   *
   * @param preferredType - User's preferred provider type (if any)
   * @param isServerless - Whether running in serverless environment
   * @param requiredCapabilities - Required capabilities
   * @returns Selected provider type
   *
   * @internal
   */
  private selectProviderType(
    preferredType: GitProviderType | undefined,
    isServerless: boolean,
    _requiredCapabilities: Array<keyof IGitProvider['capabilities']>,
  ): GitProviderType {
    // If serverless, we can only use isomorphic or API providers (future)
    if (isServerless) {
      logger.warning(
        'Serverless environment detected - CLI provider not available',
        {
          requestId: 'factory',
          timestamp: Date.now().toString(),
          preferredType,
          fallback: GitProviderType.ISOMORPHIC,
        },
      );
      // TODO: Return isomorphic provider when implemented
      throw new Error(
        'Serverless git provider not yet implemented. Use local environment for now.',
      );
    }

    // If user specified a preference and it's available, use it
    if (preferredType === GitProviderType.CLI) {
      return GitProviderType.CLI;
    }

    // Default to CLI provider for local environments
    return GitProviderType.CLI;
  }

  /**
   * Create a provider instance for the given type.
   *
   * @param type - Provider type to create
   * @returns Promise resolving to provider instance
   *
   * @internal
   */
  private createProvider(type: GitProviderType): Promise<IGitProvider> {
    switch (type) {
      case GitProviderType.CLI:
        return Promise.resolve(new CliGitProvider());

      case GitProviderType.ISOMORPHIC:
        // TODO: Implement isomorphic git provider
        return Promise.reject(
          new Error('Isomorphic git provider not yet implemented'),
        );

      case GitProviderType.GITHUB_API:
        // TODO: Implement GitHub API provider
        return Promise.reject(
          new Error('GitHub API provider not yet implemented'),
        );

      case GitProviderType.GITLAB_API:
        // TODO: Implement GitLab API provider
        return Promise.reject(
          new Error('GitLab API provider not yet implemented'),
        );

      default: {
        // Exhaustive check - this should never be reached if all enum cases are handled
        const exhaustiveCheck: never = type;
        return Promise.reject(
          new Error(`Unknown provider type: ${String(exhaustiveCheck)}`),
        );
      }
    }
  }

  /**
   * Verify that a provider supports all required capabilities.
   *
   * @param provider - Provider instance to verify
   * @param requiredCapabilities - Required capabilities
   * @throws Error if provider is missing required capabilities
   *
   * @internal
   */
  private verifyCapabilities(
    provider: IGitProvider,
    requiredCapabilities: Array<keyof IGitProvider['capabilities']>,
  ): void {
    const missing = requiredCapabilities.filter(
      (cap) => !provider.capabilities[cap],
    );

    if (missing.length > 0) {
      throw new Error(
        `Provider '${provider.name}' is missing required capabilities: ${missing.join(', ')}`,
      );
    }
  }

  /**
   * Clear the provider cache.
   *
   * Useful for testing or when you want to force provider re-initialization.
   */
  clearCache(): void {
    this.providerCache.clear();
    logger.debug('Git provider cache cleared', {
      requestId: 'factory',
      timestamp: Date.now().toString(),
    });
  }

  /**
   * Reset the singleton instance.
   *
   * @internal - Primarily for testing
   */
  static resetInstance(): void {
    GitProviderFactory.instance = null;
  }
}
