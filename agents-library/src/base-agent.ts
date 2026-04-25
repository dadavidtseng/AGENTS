/**
 * BaseAgent - Shared Foundation for All KĀDI Agents
 * ==================================================
 *
 * Provides the common infrastructure that all agents need:
 * - KadiClient setup and broker connection (non-blocking connect())
 * - Optional ProviderManager for LLM operations
 * - Optional MemoryService for context persistence
 * - Graceful shutdown handling (SIGINT/SIGTERM)
 * - Agent metadata (agentId, agentRole)
 *
 * Design: Composition, not inheritance. Each agent repo instantiates BaseAgent
 * and implements its own behavior. BaseAgent is a concrete class, not abstract.
 *
 * Usage:
 * ```typescript
 * const agent = new BaseAgent({
 *   agentId: 'agent-artist',
 *   agentRole: 'artist',
 *   brokerUrl: 'ws://localhost:8080',
 *   networks: ['global'],
 * });
 * await agent.connect();
 * // ... agent-specific logic using agent.client, agent.providerManager, etc.
 * ```
 *
 * @module base-agent
 */

import { KadiClient } from '@kadi.build/core';
import type { LoadedAbility } from '@kadi.build/core';
import { ProviderManager } from './providers/provider-manager.js';
import { AnthropicProvider } from './providers/anthropic-provider.js';
import { ModelManagerProvider } from './providers/model-manager-provider.js';
import { MemoryService } from './memory/memory-service.js';
import { logger, setLogTransport } from './utils/logger.js';
import { timer } from './utils/timer.js';
import { registerConfigMapping, loadConfig } from './utils/config.js';
import type { LLMProvider, ProviderConfig } from './providers/types.js';

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * Provider configuration for BaseAgent.
 * Controls which LLM providers are available and how they fail over.
 */
export interface BaseAgentProviderConfig {
  /** Anthropic API key (required if using Anthropic provider) */
  anthropicApiKey?: string;

  /** Model Manager Gateway base URL (optional, enables model-manager provider) */
  modelManagerBaseUrl?: string;

  /** Model Manager Gateway API key (required if modelManagerBaseUrl is set) */
  modelManagerApiKey?: string;

  /**
   * Primary provider name.
   * @default 'anthropic' if only anthropicApiKey is set
   * @default 'model-manager' if modelManagerBaseUrl is set
   */
  primaryProvider?: string;

  /** Fallback provider name (optional, enables automatic failover) */
  fallbackProvider?: string;

  /** Number of retry attempts for failed LLM calls @default 3 */
  retryAttempts?: number;

  /** Delay between retries in milliseconds @default 1000 */
  retryDelayMs?: number;

  /** Health check interval in milliseconds @default 60000 */
  healthCheckIntervalMs?: number;
}

/**
 * Memory configuration for BaseAgent.
 * Controls where conversation context and knowledge are stored.
 *
 * Long-term memory is provided by KĀDI memory tools (memory-store, memory-recall,
 * memory-relate) via the broker — no direct database connection needed.
 * The BaseAgent automatically passes its KadiClient to MemoryService.
 */
export interface BaseAgentMemoryConfig {
  /** Path to file-based memory storage directory */
  dataPath: string;
}

/**
 * Configuration for BaseAgent.
 * Only agentId, agentRole, brokerUrl, and networks are required.
 * Provider and memory are optional — agents without them still work.
 */
export interface BaseAgentConfig {
  /** Unique agent identifier (e.g., 'agent-producer', 'agent-artist') */
  agentId: string;

  /** Agent role (e.g., 'producer', 'artist', 'designer', 'programmer') */
  agentRole: string;

  /** Agent version string @default '1.0.0' */
  version?: string;

  /** KĀDI broker WebSocket URL (used as the 'default' broker) */
  brokerUrl: string;

  /** KĀDI networks this agent belongs to (for the default broker) */
  networks: string[];

  /**
   * Additional named brokers to connect to simultaneously.
   * Each key is a broker name, value is { url, networks }.
   * The primary broker (brokerUrl + networks) is always named 'default'.
   *
   * @example
   * ```typescript
   * additionalBrokers: {
   *   remote: { url: 'ws://remote:8080/kadi', networks: ['global'] },
   * }
   * ```
   */
  additionalBrokers?: Record<string, { url: string; networks: string[] }>;

  /** Optional LLM provider configuration */
  provider?: BaseAgentProviderConfig;

  /** Optional memory service configuration */
  memory?: BaseAgentMemoryConfig;
}

// ============================================================================
// BaseAgent Class
// ============================================================================

/**
 * Shared foundation for all KĀDI agents.
 *
 * Provides KadiClient, optional ProviderManager, optional MemoryService,
 * and graceful shutdown. Each agent repo uses BaseAgent via composition
 * and adds its own behavior.
 */
export class BaseAgent {
  /** KĀDI protocol client for broker communication */
  readonly client: KadiClient;

  /** LLM provider manager (undefined if no provider config) */
  providerManager?: ProviderManager;

  /** Memory service for context persistence (undefined if no memory config) */
  memoryService?: MemoryService;

  /** Agent configuration */
  readonly config: BaseAgentConfig;

  /** Whether shutdown handlers have been registered */
  private shutdownHandlersRegistered = false;

  /** Whether the agent is currently connected */
  protected connected = false;

  /** ability-log loaded via loadNative (undefined if not available) */
  private nativeLog: LoadedAbility | null = null;

  /** Timer key for this agent's lifetime tracking */
  protected readonly timerKey: string;

  /** Module tag for logging (uses agentId instead of generic 'template-agent') */
  protected readonly tag: string;

  constructor(config: BaseAgentConfig) {
    this.config = config;
    this.tag = config.agentId;
    this.timerKey = `base-agent-${config.agentId}`;
    timer.start(this.timerKey);

    logger.info(this.tag, `Initializing BaseAgent: ${config.agentId} (role: ${config.agentRole})`, timer.elapsed(this.timerKey));

    // Build brokers map: 'default' + any additional brokers
    const brokers: Record<string, { url: string; networks?: string[] }> = {
      default: { url: config.brokerUrl, networks: config.networks },
    };
    if (config.additionalBrokers) {
      for (const [name, entry] of Object.entries(config.additionalBrokers)) {
        brokers[name] = { url: entry.url, networks: entry.networks };
        logger.debug(this.tag, `   Broker '${name}': ${entry.url} [${entry.networks.join(', ')}]`, timer.elapsed(this.timerKey));
      }
    }

    // Create KadiClient
    this.client = new KadiClient({
      name: config.agentId,
      version: config.version || '1.0.0',
      brokers,
      defaultBroker: 'default',
    });

    // Create ProviderManager if configured
    if (config.provider) {
      this.providerManager = this.createProviderManager(config.provider);
      logger.debug(this.tag, '   ProviderManager created', timer.elapsed(this.timerKey));
    }

    // Create MemoryService if configured (requires async initialize() later)
    // KadiClient is passed for KĀDI memory tools (memory-store, memory-recall, memory-relate)
    if (config.memory) {
      this.memoryService = new MemoryService(
        config.memory.dataPath,
        this.client,
        this.providerManager,
        config.agentId,
      );
      logger.debug(this.tag, '   MemoryService created (pending initialization)', timer.elapsed(this.timerKey));
    }

    logger.debug(this.tag, `   BaseAgent initialized for ${config.agentId}`, timer.elapsed(this.timerKey));
  }

  /**
   * Connect to KĀDI broker and initialize async services.
   *
   * Uses client.connect() (non-blocking) — NOT client.serve() which blocks forever.
   * After connection, initializes MemoryService if configured.
   *
   * @param vaultCredentials - Optional vault credentials (from loadVaultCredentials()).
   *   If provided, any keys not already in process.env are injected so that
   *   loadNative abilities (e.g. ability-log) can read them.
   */
  async connect(vaultCredentials?: Record<string, string>): Promise<void> {
    const brokerCount = 1 + Object.keys(this.config.additionalBrokers || {}).length;
    logger.debug(this.tag, `Connecting ${this.config.agentId} to ${brokerCount} broker(s)...`, timer.elapsed(this.timerKey));
    logger.debug(this.tag, `   Broker 'default': ${this.config.brokerUrl} [${this.config.networks.join(', ')}]`, timer.elapsed(this.timerKey));

    try {
      await this.client.connect();
      this.connected = true;
      logger.info(this.tag, `Connected to ${brokerCount} broker(s)`, timer.elapsed(this.timerKey));

      // Register ArcadeDB config mapping and re-load config so ability-log
      // picks up [arcadedb] section from the host agent's config.toml
      registerConfigMapping({
        'arcadedb.HOST':     'ARCADE_HOST',
        'arcadedb.PORT':     'ARCADE_PORT',
        'arcadedb.USERNAME': 'ARCADE_USERNAME',
        'arcadedb.DATABASE': 'ARCADE_DATABASE',
        'arcadedb.PROTOCOL': 'ARCADE_PROTOCOL',
      });
      loadConfig();

      // Inject vault credentials into process.env for loadNative abilities.
      // Existing env vars take precedence (e.g. from kadi secret receive on Akash).
      if (vaultCredentials) {
        let injected = 0;
        for (const [key, value] of Object.entries(vaultCredentials)) {
          if (!process.env[key]) {
            process.env[key] = value;
            injected++;
          }
        }
        if (injected > 0) {
          logger.debug(this.tag, `Injected ${injected} vault credential(s) into process.env`, timer.elapsed(this.timerKey));
        }
      }

      // Load ability-log for persistent logging (optional, non-fatal)
      try {
        this.nativeLog = await this.client.loadNative('ability-log');
        logger.debug(this.tag, 'ability-log loaded for persistent logging', timer.elapsed(this.timerKey));
      } catch {
        logger.debug(this.tag, 'ability-log not available — persistent logging disabled', timer.elapsed(this.timerKey));
      }

      // Register broker log transport (fire-and-forget, info+ only)
      setLogTransport((level, module, message, data) => {
        if (!this.connected || !this.nativeLog) return;
        this.nativeLog.invoke('log_write', {
          agentId: this.config.agentId,
          agentRole: this.config.agentRole,
          level, module, message,
          networkId: this.config.networks[0] ?? 'unknown',
          source: 'agent',
          timestamp: new Date().toISOString(),
          ...(data !== undefined && { data: String(data) }),
        }).catch(() => {});
      });
    } catch (error: any) {
      logger.error(this.tag, `Failed to connect to broker: ${error.message || String(error)}`, timer.elapsed(this.timerKey), error);
      throw error;
    }

    // Initialize MemoryService after connection (async operation)
    if (this.memoryService) {
      try {
        await this.memoryService.initialize();
        logger.info(this.tag, '   MemoryService initialized', timer.elapsed(this.timerKey));
      } catch (error: any) {
        // Memory initialization failure is non-fatal — agent can still operate
        logger.error(this.tag, `MemoryService initialization failed (non-fatal): ${error.message || String(error)}`, timer.elapsed(this.timerKey), error);
      }
    }
  }

  /**
   * Register SIGINT/SIGTERM handlers for graceful shutdown.
   *
   * Call this once after setting up agent-specific resources.
   * The shutdown sequence: agent-specific cleanup → disconnect → exit.
   *
   * @param onBeforeShutdown - Optional async callback for agent-specific cleanup
   *   (e.g., stopping bots, unsubscribing events) before broker disconnect.
   */
  registerShutdownHandlers(onBeforeShutdown?: () => Promise<void>): void {
    if (this.shutdownHandlersRegistered) {
      logger.info(this.tag, 'Shutdown handlers already registered, skipping', timer.elapsed(this.timerKey));
      return;
    }

    const shutdownHandler = async (signal: string) => {
      logger.info(this.tag, `${signal} received, shutting down ${this.config.agentId}...`, timer.elapsed(this.timerKey));

      try {
        // Step 1: Agent-specific cleanup
        if (onBeforeShutdown) {
          await onBeforeShutdown();
        }

        // Step 2: Shutdown base services
        await this.shutdown();

        logger.info(this.tag, 'Graceful shutdown complete', timer.elapsed(this.timerKey));
        process.exit(0);
      } catch (error: any) {
        logger.error(this.tag, `Error during shutdown: ${error.message || String(error)}`, timer.elapsed(this.timerKey), error);
        process.exit(1);
      }
    };

    process.on('SIGTERM', () => shutdownHandler('SIGTERM'));
    process.on('SIGINT', () => shutdownHandler('SIGINT'));
    this.shutdownHandlersRegistered = true;

    logger.info(this.tag, 'Shutdown handlers registered (SIGTERM, SIGINT)', timer.elapsed(this.timerKey));
  }

  /**
   * Shut down the agent: dispose services and disconnect from broker.
   *
   * Can be called directly for programmatic shutdown, or automatically
   * via registered signal handlers.
   */
  async shutdown(): Promise<void> {
    logger.info(this.tag, `Shutting down ${this.config.agentId}...`, timer.elapsed(this.timerKey));

    // Clear broker log transport before disconnect
    setLogTransport(null);
    this.nativeLog = null;

    // Dispose ProviderManager (stops health checks)
    if (this.providerManager) {
      try {
        this.providerManager.dispose();
        logger.info(this.tag, '   ProviderManager disposed', timer.elapsed(this.timerKey));
      } catch (error: any) {
        logger.error(this.tag, `Error disposing ProviderManager: ${error.message}`, timer.elapsed(this.timerKey));
      }
    }

    // Dispose MemoryService
    if (this.memoryService) {
      try {
        this.memoryService.dispose();
        logger.info(this.tag, '   MemoryService disposed', timer.elapsed(this.timerKey));
      } catch (error: any) {
        logger.error(this.tag, `Error disposing MemoryService: ${error.message}`, timer.elapsed(this.timerKey));
      }
    }

    // Disconnect from broker (clears subscriptions, unloads abilities)
    if (this.connected) {
      try {
        await this.client.disconnect();
        this.connected = false;
        logger.info(this.tag, '   Disconnected from broker', timer.elapsed(this.timerKey));
      } catch (error: any) {
        logger.error(this.tag, `Error disconnecting from broker: ${error.message}`, timer.elapsed(this.timerKey));
      }
    }
  }

  /**
   * Check if the agent is currently connected to the broker.
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Get agent metadata for inclusion in event payloads.
   * Used by the generic event naming system (task 3.11).
   */
  getMetadata(): { agentId: string; agentRole: string } {
    return {
      agentId: this.config.agentId,
      agentRole: this.config.agentRole,
    };
  }

  // ============================================================================
  // Private Helpers
  // ============================================================================

  /**
   * Create ProviderManager from provider configuration.
   * Instantiates the appropriate LLM providers based on available credentials.
   */
  private createProviderManager(providerConfig: BaseAgentProviderConfig): ProviderManager {
    const providers: LLMProvider[] = [];

    // Add Anthropic provider if API key is available
    if (providerConfig.anthropicApiKey) {
      providers.push(new AnthropicProvider(providerConfig.anthropicApiKey));
    }

    // Add Model Manager provider if configured
    if (providerConfig.modelManagerBaseUrl && providerConfig.modelManagerApiKey) {
      providers.push(new ModelManagerProvider(
        providerConfig.modelManagerBaseUrl,
        providerConfig.modelManagerApiKey,
      ));
    }

    if (providers.length === 0) {
      throw new Error('BaseAgent provider config requires at least one provider (set anthropicApiKey or modelManagerBaseUrl + modelManagerApiKey)');
    }

    // Determine primary/fallback providers
    const hasBothProviders = providers.length > 1;
    const primaryProvider = providerConfig.primaryProvider
      || (providerConfig.modelManagerBaseUrl ? 'model-manager' : 'anthropic');
    const fallbackProvider = providerConfig.fallbackProvider
      || (hasBothProviders ? (primaryProvider === 'model-manager' ? 'anthropic' : 'model-manager') : undefined);

    const config: ProviderConfig = {
      primaryProvider,
      fallbackProvider,
      retryAttempts: providerConfig.retryAttempts ?? 3,
      retryDelayMs: providerConfig.retryDelayMs ?? 1000,
      healthCheckIntervalMs: providerConfig.healthCheckIntervalMs ?? 60000,
    };

    logger.debug(this.tag, `   Creating ProviderManager: primary=${primaryProvider}, fallback=${fallbackProvider || 'none'}, providers=${providers.length}`, timer.elapsed(this.timerKey));

    return new ProviderManager(providers, config);
  }
}
