/**
 * Provider Manager - LLM Provider Orchestration
 *
 * Orchestrates multiple LLM providers with intelligent routing, health monitoring,
 * automatic fallback, retry logic with exponential backoff, and circuit breaker pattern.
 */

import type {
  LLMProvider,
  Message,
  ChatOptions,
  ProviderError,
  ProviderConfig,
} from './types.js';
import { ProviderErrorType } from './types.js';
import type { Result } from '../common/result.js';
import { ok, err } from '../common/result.js';

/**
 * Provider health status tracking
 */
interface ProviderHealth {
  isHealthy: boolean;
  consecutiveFailures: number;
  lastCheck: Date;
}

/**
 * Provider Manager
 *
 * Manages multiple LLM providers with:
 * - Model-based routing (claude→Anthropic, gpt→Model Manager)
 * - Automatic fallback on provider failure
 * - Retry logic with exponential backoff
 * - Circuit breaker pattern (unhealthy after N consecutive failures)
 * - Periodic health checks
 * - Rate limit handling with backoff
 */
export class ProviderManager {
  private providers: Map<string, LLMProvider> = new Map();
  private healthStatus: Map<string, ProviderHealth> = new Map();
  private healthCheckInterval?: NodeJS.Timeout;

  /**
   * Circuit breaker configuration
   */
  private readonly maxConsecutiveFailures = 3;

  /**
   * Rate limit backoff: 5s * 2^attempt
   */
  private readonly rateLimitBaseDelayMs = 5000;

  /**
   * Create Provider Manager instance
   *
   * @param providers - Array of LLM providers to manage
   * @param config - Provider configuration (primary, fallback, retry, health check)
   */
  constructor(
    providers: LLMProvider[],
    private readonly config: ProviderConfig
  ) {
    // Register providers
    for (const provider of providers) {
      this.providers.set(provider.name, provider);
      this.healthStatus.set(provider.name, {
        isHealthy: true,
        consecutiveFailures: 0,
        lastCheck: new Date(),
      });
    }

    // Validate configuration
    if (!this.providers.has(config.primaryProvider)) {
      throw new Error(
        `Primary provider "${config.primaryProvider}" not found in providers list`
      );
    }

    if (
      config.fallbackProvider &&
      !this.providers.has(config.fallbackProvider)
    ) {
      throw new Error(
        `Fallback provider "${config.fallbackProvider}" not found in providers list`
      );
    }

    // Start periodic health checks
    this.startHealthChecks();
  }

  /**
   * Generate chat completion with provider selection and fallback
   *
   * @param messages - Conversation messages
   * @param options - Optional chat configuration
   * @returns Result with response text or error
   */
  async chat(
    messages: Message[],
    options?: ChatOptions
  ): Promise<Result<string, ProviderError>> {
    // Select provider based on model or use primary
    const selectedProvider = this.selectProvider(options?.model);
    const modelInfo = options?.model ? ` for model '${options.model}'` : ' (default model)';
    console.log(`[ProviderManager:Chat] Selected provider: ${selectedProvider}${modelInfo}`);

    // Attempt with primary provider
    const result = await this.attemptWithRetry(
      selectedProvider,
      async (provider) => provider.chat(messages, options)
    );

    // If primary succeeded, return result
    if (result.success) {
      return result;
    }

    // Handle rate limit with backoff
    if (result.error.type === ProviderErrorType.RATE_LIMIT) {
      console.warn(
        `[ProviderManager:Chat] Rate limit on ${selectedProvider}, backing off...`
      );
      // Don't fallback on rate limit - just return the error
      return result;
    }

    // If primary failed and fallback configured, try fallback
    if (
      this.config.fallbackProvider &&
      this.config.fallbackProvider !== selectedProvider
    ) {
      console.warn(
        `[ProviderManager:Chat] Primary provider ${selectedProvider} failed, trying fallback ${this.config.fallbackProvider}`
      );

      const fallbackResult = await this.attemptWithRetry(
        this.config.fallbackProvider,
        async (provider) => provider.chat(messages, options)
      );

      if (fallbackResult.success) {
        return fallbackResult;
      }
    }

    // Both primary and fallback failed
    return result;
  }

  /**
   * Generate streaming chat completion with provider selection and fallback
   *
   * @param messages - Conversation messages
   * @param options - Optional chat configuration
   * @returns Result with async iterator of text chunks or error
   */
  async streamChat(
    messages: Message[],
    options?: ChatOptions
  ): Promise<Result<AsyncIterator<string>, ProviderError>> {
    // Select provider based on model or use primary
    const selectedProvider = this.selectProvider(options?.model);
    const modelInfo = options?.model ? ` for model '${options.model}'` : ' (default model)';
    console.log(
      `[ProviderManager:Stream] Selected provider: ${selectedProvider}${modelInfo}`
    );

    // Attempt with primary provider
    const result = await this.attemptWithRetry(
      selectedProvider,
      async (provider) => provider.streamChat(messages, options)
    );

    // If primary succeeded, return result
    if (result.success) {
      return result;
    }

    // Handle rate limit with backoff
    if (result.error.type === ProviderErrorType.RATE_LIMIT) {
      console.warn(
        `[ProviderManager:Stream] Rate limit on ${selectedProvider}, backing off...`
      );
      return result;
    }

    // If primary failed and fallback configured, try fallback
    if (
      this.config.fallbackProvider &&
      this.config.fallbackProvider !== selectedProvider
    ) {
      console.warn(
        `[ProviderManager:Stream] Primary provider ${selectedProvider} failed, trying fallback ${this.config.fallbackProvider}`
      );

      const fallbackResult = await this.attemptWithRetry(
        this.config.fallbackProvider,
        async (provider) => provider.streamChat(messages, options)
      );

      if (fallbackResult.success) {
        return fallbackResult;
      }
    }

    // Both primary and fallback failed
    return result;
  }

  /**
   * Get combined list of available models from all healthy providers
   *
   * @returns Result with array of model IDs or error
   */
  async getAvailableModels(): Promise<Result<string[], ProviderError>> {
    const allModels: string[] = [];
    const errors: ProviderError[] = [];

    for (const [name, provider] of this.providers) {
      const health = this.healthStatus.get(name);
      if (!health?.isHealthy) {
        continue; // Skip unhealthy providers
      }

      const result = await provider.getAvailableModels();
      if (result.success) {
        allModels.push(...result.data);
      } else {
        errors.push(result.error);
      }
    }

    if (allModels.length > 0) {
      return ok(allModels);
    }

    // If no models available, return first error
    if (errors.length > 0) {
      return err(errors[0]);
    }

    return err({
      type: ProviderErrorType.UNKNOWN,
      message: 'No healthy providers available',
      provider: 'provider-manager',
    });
  }

  /**
   * Get health status of all providers
   *
   * @returns Map of provider names to health status
   */
  getHealthStatus(): Map<string, ProviderHealth> {
    return new Map(this.healthStatus);
  }

  /**
   * Manually trigger health check for all providers
   */
  async checkAllProvidersHealth(): Promise<void> {
    const checks = Array.from(this.providers.entries()).map(
      async ([name, provider]) => {
        try {
          const isHealthy = await provider.isHealthy();
          const currentHealth = this.healthStatus.get(name)!;

          if (isHealthy) {
            // Reset failures on successful health check
            currentHealth.consecutiveFailures = 0;
            currentHealth.isHealthy = true;
            // Reset provider's internal failure counter
            provider.resetHealth();
          } else {
            currentHealth.consecutiveFailures++;
            // Circuit breaker: mark unhealthy after max failures
            if (
              currentHealth.consecutiveFailures >= this.maxConsecutiveFailures
            ) {
              currentHealth.isHealthy = false;
              console.warn(
                `[ProviderManager:HealthCheck] Provider ${name} marked unhealthy after ${currentHealth.consecutiveFailures} consecutive failures`
              );
            }
          }

          currentHealth.lastCheck = new Date();
        } catch (error) {
          console.error(
            `[ProviderManager:HealthCheck] Health check error for ${name}:`,
            error
          );
        }
      }
    );

    await Promise.all(checks);
  }

  /**
   * Clean up resources (stop health checks)
   */
  dispose(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = undefined;
    }
  }

  /**
   * Select provider based on model name or use primary
   *
   * Model-based routing:
   * - Models starting with "claude" → anthropic provider
   * - Models starting with "gpt" → model-manager provider
   * - Otherwise → primary provider from config
   */
  private selectProvider(model?: string): string {
    if (!model) {
      return this.config.primaryProvider;
    }

    const modelLower = model.toLowerCase();

    if (modelLower.startsWith('claude')) {
      return 'anthropic';
    }

    if (modelLower.startsWith('gpt')) {
      return 'model-manager';
    }

    return this.config.primaryProvider;
  }

  /**
   * Attempt operation with retry and exponential backoff
   *
   * @param providerName - Name of provider to use
   * @param operation - Operation to attempt
   * @returns Result from operation
   */
  private async attemptWithRetry<T>(
    providerName: string,
    operation: (provider: LLMProvider) => Promise<Result<T, ProviderError>>
  ): Promise<Result<T, ProviderError>> {
    const provider = this.providers.get(providerName);
    if (!provider) {
      return err({
        type: ProviderErrorType.UNKNOWN,
        message: `Provider "${providerName}" not found`,
        provider: 'provider-manager',
      });
    }

    // Check circuit breaker
    const health = this.healthStatus.get(providerName);
    if (health && !health.isHealthy) {
      console.warn(
        `[ProviderManager:Retry] Provider ${providerName} is unhealthy, skipping`
      );
      return err({
        type: ProviderErrorType.UNKNOWN,
        message: `Provider "${providerName}" is currently unhealthy`,
        provider: providerName,
      });
    }

    let lastError: ProviderError | undefined;

    for (let attempt = 0; attempt < this.config.retryAttempts; attempt++) {
      if (attempt > 0) {
        // Exponential backoff: delayMs * 2^attempt
        const delay = this.config.retryDelayMs * Math.pow(2, attempt - 1);
        console.log(
          `[ProviderManager:Retry] Attempt ${attempt + 1}/${this.config.retryAttempts} for ${providerName} after ${delay}ms delay`
        );
        await this.sleep(delay);
      }

      const result = await operation(provider);

      if (result.success) {
        // Success - reset failure counter
        if (health) {
          health.consecutiveFailures = 0;
          health.isHealthy = true;
        }
        return result;
      }

      lastError = result.error;

      console.error(
        `[ProviderManager:Retry] Provider ${providerName} attempt ${attempt + 1} failed:`,
        result.error.type,
        result.error.message
      );

      // Handle rate limits with special backoff
      if (result.error.type === ProviderErrorType.RATE_LIMIT) {
        const rateLimitDelay =
          this.rateLimitBaseDelayMs * Math.pow(2, attempt);
        console.warn(
          `[ProviderManager:Retry] Rate limit detected on ${providerName}, waiting ${rateLimitDelay}ms before retry`
        );
        await this.sleep(rateLimitDelay);
      }

      // Don't retry on auth failures or invalid requests
      if (
        result.error.type === ProviderErrorType.AUTH_FAILED ||
        result.error.type === ProviderErrorType.INVALID_REQUEST
      ) {
        console.error(
          `[ProviderManager:Retry] Non-retryable error on ${providerName}: ${result.error.type}`
        );
        break;
      }
    }

    // After all retries exhausted, track failure for health monitoring
    // Only track actual health issues, not model routing problems
    if (health && lastError) {
      // Exclude MODEL_NOT_FOUND - these are routing issues, not health problems
      const shouldTrackFailure = lastError.type !== ProviderErrorType.MODEL_NOT_FOUND;

      if (shouldTrackFailure) {
        health.consecutiveFailures++;

        if (health.consecutiveFailures >= this.maxConsecutiveFailures) {
          health.isHealthy = false;
          console.warn(
            `[ProviderManager:CircuitBreaker] Provider ${providerName} circuit opened after ${health.consecutiveFailures} consecutive request failures`
          );
        }
      } else {
        // MODEL_NOT_FOUND doesn't affect health - log for debugging
        console.log(
          `[ProviderManager:Routing] Provider ${providerName} doesn't support requested model (not a health issue)`
        );
      }
    }

    return err(
      lastError || {
        type: ProviderErrorType.UNKNOWN,
        message: 'All retry attempts failed',
        provider: providerName,
      }
    );
  }

  /**
   * Start periodic health checks for all providers
   */
  private startHealthChecks(): void {
    // Run initial health check
    this.checkAllProvidersHealth().catch((error) =>
      console.error('[ProviderManager:HealthCheck] Initial health check failed:', error)
    );

    // Schedule periodic health checks
    this.healthCheckInterval = setInterval(() => {
      this.checkAllProvidersHealth().catch((error) =>
        console.error('[ProviderManager:HealthCheck] Periodic health check failed:', error)
      );
    }, this.config.healthCheckIntervalMs);
  }

  /**
   * Sleep utility for delays
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
