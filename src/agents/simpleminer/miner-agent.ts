/**
 * Miner Agent - Autonomous ore discovery and extraction
 *
 * This agent connects to SimpleMiner via KADI broker, spawns an in-game agent,
 * and executes an autonomous mining loop:
 *
 * 1. Get nearby blocks using vision system (20-block radius)
 * 2. Filter for valuable ores (diamond, iron, coal, gold)
 * 3. Queue MOVE command to ore position
 * 4. Queue MINE command to break block
 * 5. Wait for commands to complete
 * 6. Repeat mining loop
 *
 * @module agents/simpleminer/miner-agent
 */

import type { KadiClient } from '@kadi.build/core';
import { BaseAgent, type AgentConfig, type BlockInfo, type Position } from './base-agent.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Configuration for Miner Agent
 */
export interface MinerConfig extends AgentConfig {
  /** Ore types to mine (default: diamond, iron, coal, gold) */
  targetOres?: string[];
  /** Vision radius in blocks (default: 20) */
  visionRadius?: number;
  /** Delay between mining cycles in ms (default: 3000) */
  cycleDelayMs?: number;
  /** Maximum mining iterations (default: unlimited) */
  maxIterations?: number;
}

/**
 * Priority values for different ore types (higher = more valuable)
 */
const ORE_PRIORITY: Record<string, number> = {
  'diamond_ore': 100,
  'emerald_ore': 90,
  'gold_ore': 60,
  'iron_ore': 40,
  'copper_ore': 30,
  'coal_ore': 20,
  'lapis_ore': 50,
  'redstone_ore': 45
};

// ============================================================================
// Miner Agent Class
// ============================================================================

/**
 * Miner Agent - Autonomous ore discovery and extraction
 *
 * Implements mining behavior by scanning nearby blocks for ores,
 * prioritizing valuable resources, and systematically extracting them.
 */
export class MinerAgent extends BaseAgent {
  private readonly minerConfig: MinerConfig;
  private iterationCount: number = 0;
  private oresMined: Map<string, number> = new Map();

  constructor(client: KadiClient, config: MinerConfig) {
    super(client, config);
    this.minerConfig = {
      targetOres: ['diamond_ore', 'iron_ore', 'coal_ore', 'gold_ore'],
      visionRadius: 20,
      cycleDelayMs: 3000,
      ...config
    };
  }

  // ============================================================================
  // Main Behavior Loop
  // ============================================================================

  /**
   * Main mining behavior loop
   *
   * Continuously scans for ores and mines them until stopped
   * or max iterations reached.
   */
  protected async runBehaviorLoop(): Promise<void> {
    this.log('Starting mining behavior loop');
    this.log(`Target ores: ${this.minerConfig.targetOres?.join(', ')}`);
    this.log(`Vision radius: ${this.minerConfig.visionRadius} blocks`);

    while (this.isRunning) {
      try {
        // Check iteration limit
        if (this.minerConfig.maxIterations !== undefined &&
            this.iterationCount >= this.minerConfig.maxIterations) {
          this.log(`Reached max iterations (${this.minerConfig.maxIterations})`);
          break;
        }

        this.iterationCount++;
        this.log(`--- Mining iteration ${this.iterationCount} ---`);

        // Execute one mining cycle
        const minedOre = await this.executeMiningCycle();

        if (minedOre) {
          // Track statistics
          const count = this.oresMined.get(minedOre) || 0;
          this.oresMined.set(minedOre, count + 1);
          this.log(`Total ${minedOre} mined: ${count + 1}`);
        }

        // Delay before next cycle
        await this.sleep(this.minerConfig.cycleDelayMs || 3000);

      } catch (error) {
        this.logError('Mining cycle error:', error);
        await this.sleep(5000); // Wait longer after error
      }
    }

    this.logStats();
  }

  // ============================================================================
  // Mining Cycle
  // ============================================================================

  /**
   * Execute one mining cycle
   *
   * @returns Name of ore mined, or null if no ore found
   */
  private async executeMiningCycle(): Promise<string | null> {
    // Step 1: Scan nearby blocks
    const blocks = await this.getNearbyBlocks(this.minerConfig.visionRadius || 20);
    this.log(`Scanned ${blocks.length} blocks`);

    if (blocks.length === 0) {
      this.log('No blocks in range');
      return null;
    }

    // Step 2: Find target ores
    const oreBlocks = this.findTargetOres(blocks);

    if (oreBlocks.length === 0) {
      this.log('No target ores found nearby');
      return null;
    }

    this.log(`Found ${oreBlocks.length} ore block(s)`);

    // Step 3: Select best ore (by priority and distance)
    const targetOre = this.selectBestOre(oreBlocks);
    this.log(`Target: ${targetOre.block_name} at (${targetOre.position.x}, ${targetOre.position.y}, ${targetOre.position.z})`);

    // Step 4: Move to ore
    const moveSuccess = await this.queueMove(this.getApproachPosition(targetOre.position));
    if (!moveSuccess) {
      this.logError('Failed to queue move command');
      return null;
    }

    // Step 5: Mine the ore
    const mineSuccess = await this.queueMine(targetOre.position);
    if (!mineSuccess) {
      this.logError('Failed to queue mine command');
      return null;
    }

    // Step 6: Wait for completion
    this.log('Waiting for commands to complete...');
    const completed = await this.waitForCommandsComplete(15000);

    if (completed) {
      this.log(`✅ Mined ${targetOre.block_name}`);
      return targetOre.block_name;
    } else {
      this.logError('Commands did not complete in time');
      return null;
    }
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  /**
   * Filter blocks to find target ores
   */
  private findTargetOres(blocks: BlockInfo[]): BlockInfo[] {
    const targetOres = this.minerConfig.targetOres || [];

    return blocks.filter(block => {
      const blockName = block.block_name.toLowerCase();
      return targetOres.some(ore => blockName.includes(ore.toLowerCase()));
    });
  }

  /**
   * Select best ore based on priority and distance
   */
  private selectBestOre(ores: BlockInfo[]): BlockInfo {
    // Sort by priority (descending), then by distance (ascending)
    return ores.sort((a, b) => {
      const priorityA = this.getOrePriority(a.block_name);
      const priorityB = this.getOrePriority(b.block_name);

      if (priorityA !== priorityB) {
        return priorityB - priorityA; // Higher priority first
      }

      // TODO: Calculate actual distance from agent position
      return 0;
    })[0];
  }

  /**
   * Get priority value for an ore type
   */
  private getOrePriority(blockName: string): number {
    const name = blockName.toLowerCase();

    for (const [ore, priority] of Object.entries(ORE_PRIORITY)) {
      if (name.includes(ore)) {
        return priority;
      }
    }

    return 10; // Default priority for unknown ores
  }

  /**
   * Calculate approach position (1 block away from target)
   */
  private getApproachPosition(targetPos: Position): Position {
    // Stand next to the block (1 block offset in X)
    return {
      x: targetPos.x - 1,
      y: targetPos.y,
      z: targetPos.z
    };
  }

  /**
   * Log mining statistics
   */
  private logStats(): void {
    this.log('=== Mining Session Statistics ===');
    this.log(`Total iterations: ${this.iterationCount}`);
    this.log('Ores mined:');

    for (const [ore, count] of this.oresMined) {
      this.log(`  ${ore}: ${count}`);
    }
  }
}
