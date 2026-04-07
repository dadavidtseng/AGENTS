/**
 * Base Bot Abstract Class for Platform-Agnostic Bot Logic
 * ========================================================
 *
 * Provides shared functionality for all platform-specific bots (Slack, Discord, etc.)
 * Eliminates code duplication by consolidating common patterns:
 * - Circuit breaker pattern for fault tolerance
 * - Exponential backoff retry logic
 * - Metrics tracking and monitoring
 * - Tool invocation with resilience
 *
 * This is an abstract class - cannot be instantiated directly.
 * Platform-specific bots must extend this and implement abstract methods.
 *
 * @example
 * ```typescript
 * export class SlackBot extends BaseBot {
 *   async handleMention(event: SlackMentionEvent): Promise<void> {
 *     // Slack-specific mention handling
 *   }
 *
 *   async start(): Promise<void> {
 *     await super.initializeAbilityResponseSubscription();
 *     await this.subscribeToMentions();
 *   }
 *
 *   stop(): void {
 *     // Cleanup logic
 *   }
 * }
 * ```
 */

import Anthropic from '@anthropic-ai/sdk';
import type { KadiClient } from '@kadi.build/core';
import { logger, MODULE_AGENT } from './utils/logger.js';
import { timer } from './utils/timer.js';
import type { ProviderManager } from './providers/provider-manager.js';
import type { MemoryService } from './memory/memory-service.js';

// ============================================================================
// Base Bot Configuration Interface
// ============================================================================

/**
 * Base configuration required by all bots
 */
export interface BaseBotConfig {
  /** KĀDI client instance for event subscription and tool invocation */
  client: KadiClient;

  /** Anthropic API key for Claude integration */
  anthropicApiKey: string;

  /** Bot user ID for topic routing (platform-specific format) */
  botUserId: string;

  /** Optional provider manager for LLM operations (shared service) */
  providerManager?: ProviderManager;

  /** Optional memory service for conversation context (shared service) */
  memoryService?: MemoryService;
}

// ============================================================================
// Abstract Base Bot Class
// ============================================================================

/**
 * Abstract base class for platform-agnostic bot logic
 *
 * Provides common functionality shared across all platform bots:
 * - Circuit breaker for fault tolerance
 * - Retry logic with exponential backoff
 * - Metrics tracking
 * - Tool invocation helpers
 *
 * Platform-specific bots (SlackBot, DiscordBot) extend this class
 * and implement the abstract methods.
 */
export abstract class BaseBot {
  // ============================================================================
  // Protected Properties (accessible to subclasses)
  // ============================================================================

  /** KĀDI client for broker communication */
  protected client: KadiClient;

  /** Anthropic API client for Claude integration */
  protected anthropic: Anthropic;

  /** Bot user ID for topic routing */
  protected botUserId: string;

  /** Optional provider manager for LLM operations */
  protected providerManager?: ProviderManager;

  /** Optional memory service for conversation context */
  protected memoryService?: MemoryService;

  /** Pending async tool responses (requestId -> Promise resolver) */
  private pendingResponses = new Map<string, {
    resolve: (result: any) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
  }>();

  // ============================================================================
  // Circuit Breaker State (private)
  // ============================================================================

  /** Number of consecutive failures */
  private failureCount = 0;

  /** Timestamp of last failure (for reset timeout) */
  private lastFailureTime = 0;

  /** Maximum failures before circuit opens */
  private readonly maxFailures = 5;

  /** Time in ms before circuit breaker resets */
  private readonly resetTimeMs = 60000; // 1 minute

  /** Whether circuit breaker is open (blocking requests) */
  private isCircuitOpen = false;

  // ============================================================================
  // Retry Configuration (private)
  // ============================================================================

  /** Maximum retry attempts for failed operations */
  private readonly maxRetries = 3;

  /** Base delay in ms for exponential backoff (1s, 2s, 4s) */
  private readonly baseDelayMs = 1000;

  // ============================================================================
  // Metrics Tracking (private)
  // ============================================================================

  /** Total number of requests processed */
  private totalRequests = 0;

  /** Number of requests that timed out */
  private timeoutCount = 0;

  /** Number of successful requests */
  private successCount = 0;

  // ============================================================================
  // Constructor
  // ============================================================================

  /**
   * Create a new BaseBot instance
   *
   * @param config - Base bot configuration with client, API key, and bot ID
   */
  constructor(config: BaseBotConfig) {
    this.client = config.client;
    this.anthropic = new Anthropic({ apiKey: config.anthropicApiKey });
    this.botUserId = config.botUserId;
    this.providerManager = config.providerManager;
    this.memoryService = config.memoryService;
  }

  // ============================================================================
  // Abstract Methods (must be implemented by subclasses)
  // ============================================================================

  /**
   * Handle platform-specific mention event
   *
   * Subclasses must implement this to process @mentions for their platform.
   *
   * @param event - Platform-specific mention event (e.g., SlackMentionEvent, DiscordMentionEvent)
   */
  protected abstract handleMention(event: any): Promise<void>;

  /**
   * Start the bot and begin processing events
   *
   * Subclasses must implement this to:
   * 1. Call initializeAbilityResponseSubscription()
   * 2. Subscribe to platform-specific events
   */
  public abstract start(): Promise<void>;

  /**
   * Stop the bot and cleanup resources
   *
   * Subclasses must implement this to unsubscribe from events
   * and perform any platform-specific cleanup.
   */
  public abstract stop(): void;

  // ============================================================================
  // Protected Helper Methods (available to subclasses)
  // ============================================================================

  /**
   * Initialize ability response subscription
   *
   * Must be called by subclasses in their start() method
   * before attempting to invoke tools or subscribe to events.
   *
   * Subscribes to async ability responses from kadi-broker.
   */
  protected async initializeAbilityResponseSubscription(): Promise<void> {
    // Subscribe to async ability responses from kadi-broker
    await this.subscribeToAbilityResponses();
  }

  /**
   * Subscribe to kadi.ability.response notifications
   *
   * Handles async tool results from broker. When a tool returns {status: "pending"},
   * the actual result arrives later as a kadi.ability.response notification.
   *
   * @private
   */
  private async subscribeToAbilityResponses(): Promise<void> {
    // Subscribe to kadi.ability.response events via kadi-core v0.6.0 subscribe API
    await this.client.subscribe('kadi.ability.response', (event: any) => {
      const { requestId, result, error } = event || {};

      const pending = this.pendingResponses.get(requestId);
      if (!pending) {
        // This response is for a different request or already handled
        return;
      }

      // Clear timeout timer
      clearTimeout(pending.timer);
      this.pendingResponses.delete(requestId);

      // Resolve or reject the promise
      if (error) {
        pending.reject(new Error(`Async tool failed: ${error}`));
      } else {
        pending.resolve(result);
      }
    }, { broker: 'default' });

    logger.info(MODULE_AGENT, 'Subscribed to kadi.ability.response notifications', timer.elapsed('main'));
  }

  /**
   * Wait for async ability response from kadi-broker
   *
   * When a tool returns {status: "pending", requestId: "..."}, this method
   * waits for the actual result to arrive via kadi.ability.response notification.
   *
   * @param requestId - Request ID from pending status response
   * @param timeout - Timeout in milliseconds (default: 30000)
   * @returns Promise that resolves with the actual tool result
   * @throws Error if timeout expires before result arrives
   *
   * @example
   * ```typescript
   * const result = await this.protocol.invokeTool({...});
   * if (result?.status === 'pending') {
   *   const actualResult = await this.waitForAbilityResponse(result.requestId);
   *   return actualResult;
   * }
   * ```
   */
  protected waitForAbilityResponse(requestId: string, timeout = 30000): Promise<any> {
    return new Promise((resolve, reject) => {
      // Setup timeout
      const timer = setTimeout(() => {
        this.pendingResponses.delete(requestId);
        reject(new Error(`Timeout waiting for async tool result: ${requestId}`));
      }, timeout);

      // Register promise resolver
      this.pendingResponses.set(requestId, {
        resolve,
        reject,
        timer
      });
    });
  }

  /**
   * Sleep for specified milliseconds
   *
   * Used for exponential backoff delays in retry logic.
   *
   * @param ms - Milliseconds to sleep
   */
  protected sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Check circuit breaker state and reset if needed
   *
   * Returns true if circuit is open (blocking requests).
   * Automatically resets circuit after resetTimeMs has elapsed.
   *
   * @returns true if circuit is open, false if closed
   *
   * @example
   * ```typescript
   * if (this.checkCircuitBreaker()) {
   *   console.log('Circuit open - skipping request');
   *   return;
   * }
   * ```
   */
  protected checkCircuitBreaker(): boolean {
    const now = Date.now();

    // Reset circuit if enough time has passed
    if (this.isCircuitOpen && (now - this.lastFailureTime) > this.resetTimeMs) {
      console.log('Circuit breaker reset - attempting recovery');
      this.isCircuitOpen = false;
      this.failureCount = 0;
    }

    return this.isCircuitOpen;
  }

  /**
   * Record failure and update circuit breaker state
   *
   * Increments failure count and opens circuit if maxFailures threshold reached.
   * Logs metrics every 10 requests.
   *
   * @param _error - Error object (for potential future use)
   */
  protected recordFailure(_error: any): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    this.timeoutCount++;

    if (this.failureCount >= this.maxFailures && !this.isCircuitOpen) {
      this.isCircuitOpen = true;
      console.error(`⚡ Circuit breaker OPEN after ${this.failureCount} failures`);
      console.error(`   Will retry after ${this.resetTimeMs / 1000} seconds`);
    }

    // Log timeout metrics every 10 requests
    if (this.totalRequests % 10 === 0) {
      this.logMetrics();
    }
  }

  /**
   * Record success and reset failure counter
   *
   * Resets consecutive failure count when a request succeeds.
   * Increments success metrics.
   */
  protected recordSuccess(): void {
    if (this.failureCount > 0) {
      console.log(`Request succeeded - resetting failure count (was ${this.failureCount})`);
    }
    this.failureCount = 0;
    this.successCount++;
  }

  /**
   * Reset circuit breaker state
   *
   * Manually resets circuit breaker and clears failure count.
   * Use with caution - typically circuit should auto-reset.
   */
  protected resetCircuitBreaker(): void {
    this.isCircuitOpen = false;
    this.failureCount = 0;
    this.lastFailureTime = 0;
    console.log('Circuit breaker manually reset');
  }

  /**
   * Invoke KĀDI tool with retry logic and exponential backoff
   *
   * Automatically retries failed tool invocations with exponential backoff:
   * - Attempt 1: Immediate
   * - Attempt 2: 1s delay
   * - Attempt 3: 2s delay
   * - Attempt 4: 4s delay
   *
   * Only retries on timeout or network errors. Other errors fail immediately.
   *
   * @param params - Tool invocation parameters
   * @param params.targetAgent - Target agent ID (e.g., 'mcp-server-slack')
   * @param params.toolName - Tool name to invoke (e.g., 'send_slack_message')
   * @param params.toolInput - Tool input parameters
   * @param params.timeout - Timeout in milliseconds
   * @param retryCount - Current retry attempt (internal, do not set)
   * @returns Tool invocation result
   * @throws Error if all retries exhausted
   *
   * @example
   * ```typescript
   * await this.invokeToolWithRetry({
   *   targetAgent: 'mcp-server-slack',
   *   toolName: 'send_slack_message',
   *   toolInput: { channel: 'C123', text: 'Hello' },
   *   timeout: 10000
   * });
   * ```
   */
  protected async invokeToolWithRetry(
    params: {
      targetAgent: string;
      toolName: string;
      toolInput: any;
      timeout: number;
    },
    retryCount = 0
  ): Promise<any> {
    this.totalRequests++;

    try {
      const result = await this.client.invokeRemote(
        params.toolName,
        params.toolInput,
        { timeout: params.timeout }
      );
      this.recordSuccess();
      return result;
    } catch (error: any) {
      const isTimeout = error.message?.includes('timeout');
      const isNetworkError = error.message?.includes('ECONNREFUSED') ||
                            error.message?.includes('ENOTFOUND');

      // Only retry on timeout or network errors
      if ((isTimeout || isNetworkError) && retryCount < this.maxRetries) {
        const delayMs = this.baseDelayMs * Math.pow(2, retryCount);
        console.warn(`Request failed (${error.message}), retrying in ${delayMs}ms (attempt ${retryCount + 1}/${this.maxRetries})...`);

        await this.sleep(delayMs);
        return this.invokeToolWithRetry(params, retryCount + 1);
      }

      // Record failure after all retries exhausted
      this.recordFailure(error);
      throw error;
    }
  }

  /**
   * Get current bot metrics
   *
   * Returns metrics for monitoring and debugging:
   * - Total requests processed
   * - Success count and rate
   * - Timeout count and rate
   * - Circuit breaker state
   *
   * @returns Metrics object
   *
   * @example
   * ```typescript
   * const metrics = this.getMetrics();
   * console.log(`Success rate: ${metrics.successRate}%`);
   * ```
   */
  protected getMetrics(): {
    totalRequests: number;
    successCount: number;
    timeoutCount: number;
    successRate: number;
    timeoutRate: number;
    isCircuitOpen: boolean;
  } {
    const successRate = this.totalRequests > 0
      ? (this.successCount / this.totalRequests) * 100
      : 0;
    const timeoutRate = this.totalRequests > 0
      ? (this.timeoutCount / this.totalRequests) * 100
      : 0;

    return {
      totalRequests: this.totalRequests,
      successCount: this.successCount,
      timeoutCount: this.timeoutCount,
      successRate: parseFloat(successRate.toFixed(1)),
      timeoutRate: parseFloat(timeoutRate.toFixed(1)),
      isCircuitOpen: this.isCircuitOpen
    };
  }

  /**
   * Log timeout and success metrics
   *
   * Logs formatted metrics to console for monitoring.
   * Called automatically every 10 requests or can be called manually.
   */
  protected logMetrics(): void {
    const metrics = this.getMetrics();

    console.log('Bot Metrics:');
    console.log(`   Total Requests: ${metrics.totalRequests}`);
    console.log(`   Successes: ${metrics.successCount} (${metrics.successRate}%)`);
    console.log(`   Timeouts: ${metrics.timeoutCount} (${metrics.timeoutRate}%)`);
    console.log(`   Circuit Breaker: ${metrics.isCircuitOpen ? 'OPEN' : 'CLOSED'}`);
  }
}
