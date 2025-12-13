/**
 * Base Agent - Abstract foundation for SimpleMiner autonomous agents
 *
 * Provides common functionality for spawning, controlling, and managing
 * AI agents in the SimpleMiner game world via KADI protocol.
 *
 * Features:
 * - Agent lifecycle management (spawn, despawn)
 * - Command queue management (MOVE, MINE, PLACE, CRAFT, WAIT)
 * - Status polling and monitoring
 * - Vision system access (nearby blocks)
 * - Inventory management
 * - Graceful shutdown handling
 *
 * @module agents/simpleminer/base-agent
 */

import type { KadiClient } from '@kadi.build/core';

// ============================================================================
// Types
// ============================================================================

/**
 * Base configuration for all SimpleMiner agents
 */
export interface AgentConfig {
  /** Agent display name in game */
  name: string;
  /** Initial spawn position */
  spawnPosition?: {
    x: number;
    y: number;
    z: number;
  };
  /** Logging verbosity */
  verbose?: boolean;
}

/**
 * Agent position in 3D world space
 */
export interface Position {
  x: number;
  y: number;
  z: number;
}

/**
 * Block information from vision system
 */
export interface BlockInfo {
  block_name: string;
  position: Position;
}

/**
 * Inventory slot information
 */
export interface InventorySlot {
  slot: number;
  item_id: number;
  item_name: string;
  quantity: number;
}

/**
 * Agent status information
 */
export interface AgentStatus {
  position: Position;
  current_command: string | null;
  queue_size: number;
}

/**
 * Command types supported by SimpleMiner agents
 */
export type CommandType = 'MOVE' | 'MINE' | 'PLACE' | 'CRAFT' | 'WAIT';

// ============================================================================
// Base Agent Class
// ============================================================================

/**
 * Abstract base class for SimpleMiner autonomous agents
 *
 * Provides common functionality for interacting with the SimpleMiner game
 * via KADI protocol. Subclasses implement specific behaviors (mining, building).
 */
export abstract class BaseAgent {
  protected readonly client: KadiClient;
  protected readonly config: AgentConfig;
  protected agentId: number | null = null;
  protected isRunning: boolean = false;

  constructor(client: KadiClient, config: AgentConfig) {
    this.client = client;
    this.config = config;
  }

  // ============================================================================
  // Lifecycle Methods
  // ============================================================================

  /**
   * Start the agent - spawn in game and begin behavior loop
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      this.log('Agent already running');
      return;
    }

    this.log(`Starting agent: ${this.config.name}`);
    this.isRunning = true;

    try {
      // Spawn agent in game world
      await this.spawn();

      // Run behavior loop
      await this.runBehaviorLoop();
    } catch (error) {
      this.logError('Agent error:', error);
      throw error;
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Stop the agent gracefully
   */
  async stop(): Promise<void> {
    this.log('Stopping agent...');
    this.isRunning = false;

    if (this.agentId !== null) {
      await this.despawn();
    }
  }

  /**
   * Spawn agent in the game world
   */
  protected async spawn(): Promise<void> {
    const pos = this.config.spawnPosition || { x: 0, y: 0, z: 70 };

    this.log(`Spawning at (${pos.x}, ${pos.y}, ${pos.z})`);

    const result = await this.invokeTool('simpleminer_spawn_agent', {
      name: this.config.name,
      x: pos.x,
      y: pos.y,
      z: pos.z
    });

    if (result.success && result.data?.agent_id !== undefined) {
      this.agentId = result.data.agent_id;
      this.log(`Spawned with ID: ${this.agentId}`);
    } else {
      throw new Error(`Failed to spawn agent: ${result.error?.message || 'Unknown error'}`);
    }
  }

  /**
   * Remove agent from game world
   */
  protected async despawn(): Promise<void> {
    if (this.agentId === null) return;

    this.log(`Despawning agent ID: ${this.agentId}`);

    await this.invokeTool('simpleminer_despawn_agent', {
      agent_id: this.agentId
    });

    this.agentId = null;
  }

  // ============================================================================
  // Command Methods
  // ============================================================================

  /**
   * Queue a MOVE command - move to target position
   */
  protected async queueMove(target: Position): Promise<boolean> {
    return this.queueCommand('MOVE', {
      x: target.x,
      y: target.y,
      z: target.z
    });
  }

  /**
   * Queue a MINE command - break block at position
   */
  protected async queueMine(blockPos: Position): Promise<boolean> {
    return this.queueCommand('MINE', {
      x: Math.floor(blockPos.x),
      y: Math.floor(blockPos.y),
      z: Math.floor(blockPos.z)
    });
  }

  /**
   * Queue a PLACE command - place item at position
   */
  protected async queuePlace(blockPos: Position, itemId: number): Promise<boolean> {
    return this.queueCommand('PLACE', {
      x: Math.floor(blockPos.x),
      y: Math.floor(blockPos.y),
      z: Math.floor(blockPos.z),
      item_id: itemId
    });
  }

  /**
   * Queue a CRAFT command - craft item using recipe
   */
  protected async queueCraft(recipeId: number): Promise<boolean> {
    return this.queueCommand('CRAFT', {
      recipe_id: recipeId
    });
  }

  /**
   * Queue a WAIT command - pause for duration
   */
  protected async queueWait(durationSeconds: number): Promise<boolean> {
    return this.queueCommand('WAIT', {
      duration: durationSeconds
    });
  }

  /**
   * Queue a command for the agent
   */
  protected async queueCommand(type: CommandType, params: Record<string, any>): Promise<boolean> {
    if (this.agentId === null) {
      this.logError('Cannot queue command: agent not spawned');
      return false;
    }

    const result = await this.invokeTool('simpleminer_queue_command', {
      agent_id: this.agentId,
      command_type: type,
      params
    });

    if (result.success) {
      this.log(`Queued ${type} command`);
      return true;
    } else {
      this.logError(`Failed to queue ${type}: ${result.error?.message}`);
      return false;
    }
  }

  // ============================================================================
  // Query Methods
  // ============================================================================

  /**
   * Get blocks near the agent
   */
  protected async getNearbyBlocks(radius: number = 20): Promise<BlockInfo[]> {
    if (this.agentId === null) return [];

    const result = await this.invokeTool('simpleminer_get_nearby_blocks', {
      agent_id: this.agentId,
      radius
    });

    if (result.success && result.data?.blocks) {
      return result.data.blocks as BlockInfo[];
    }

    return [];
  }

  /**
   * Get agent's inventory contents
   */
  protected async getInventory(): Promise<InventorySlot[]> {
    if (this.agentId === null) return [];

    const result = await this.invokeTool('simpleminer_get_agent_inventory', {
      agent_id: this.agentId
    });

    if (result.success && result.data?.slots) {
      return result.data.slots as InventorySlot[];
    }

    return [];
  }

  /**
   * Get agent's current status
   */
  protected async getStatus(): Promise<AgentStatus | null> {
    if (this.agentId === null) return null;

    const result = await this.invokeTool('simpleminer_get_agent_status', {
      agent_id: this.agentId
    });

    if (result.success && result.data) {
      return result.data as AgentStatus;
    }

    return null;
  }

  /**
   * Wait until command queue is empty
   */
  protected async waitForCommandsComplete(timeoutMs: number = 30000): Promise<boolean> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const status = await this.getStatus();

      if (status && status.queue_size === 0 && status.current_command === 'NONE') {
        return true;
      }

      // Poll every 500ms
      await this.sleep(500);
    }

    this.logError('Timeout waiting for commands to complete');
    return false;
  }

  // ============================================================================
  // Abstract Methods
  // ============================================================================

  /**
   * Main behavior loop - implemented by subclasses
   */
  protected abstract runBehaviorLoop(): Promise<void>;

  // ============================================================================
  // Helper Methods
  // ============================================================================

  /**
   * Invoke a SimpleMiner tool via KADI protocol
   */
  protected async invokeTool(toolName: string, params: any): Promise<{
    success: boolean;
    data?: any;
    error?: { type: string; message: string };
  }> {
    const protocol = this.client.getBrokerProtocol();
    const targetAgent = 'SimpleMiner Agent';

    try {
      this.logVerbose(`Invoking ${toolName}`);

      const response = await protocol.invokeTool({
        targetAgent,
        toolName,
        toolInput: params,
        timeout: 30000
      });

      // Parse MCP response format
      let data = response as any;
      try {
        const resp = response as any;
        if (resp?.content?.[0]?.text) {
          data = JSON.parse(resp.content[0].text);
        }
      } catch (e) {
        // Keep original response
      }

      return { success: true, data };

    } catch (error: any) {
      return {
        success: false,
        error: {
          type: 'transient',
          message: error.message || String(error)
        }
      };
    }
  }

  /**
   * Sleep for specified milliseconds
   */
  protected sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Log message with agent prefix
   */
  protected log(message: string): void {
    console.log(`[${this.config.name}] ${message}`);
  }

  /**
   * Log error with agent prefix
   */
  protected logError(message: string, error?: any): void {
    console.error(`[${this.config.name}] ❌ ${message}`, error || '');
  }

  /**
   * Log verbose message (only if verbose mode enabled)
   */
  protected logVerbose(message: string): void {
    if (this.config.verbose) {
      console.log(`[${this.config.name}] 🔍 ${message}`);
    }
  }
}
