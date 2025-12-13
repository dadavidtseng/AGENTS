/**
 * Builder Agent - Automated structure construction
 *
 * This agent connects to SimpleMiner via KADI broker, spawns an in-game agent,
 * and executes building patterns for automated construction:
 *
 * 1. Load blueprint (wall, floor, pillar patterns)
 * 2. Check inventory for required materials
 * 3. Queue MOVE commands to placement positions
 * 4. Queue PLACE commands with appropriate blocks
 * 5. Execute build sequence
 *
 * Supports:
 * - Wall construction (vertical or horizontal)
 * - Floor construction (rectangular areas)
 * - Pillar construction (vertical columns)
 * - Custom block patterns via blueprint arrays
 *
 * @module agents/simpleminer/builder-agent
 */

import type { KadiClient } from '@kadi.build/core';
import { BaseAgent, type AgentConfig, type Position } from './base-agent.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Configuration for Builder Agent
 */
export interface BuilderConfig extends AgentConfig {
  /** Default building material item ID */
  defaultMaterialId?: number;
  /** Delay between placements in ms (default: 500) */
  placementDelayMs?: number;
}

/**
 * Material mapping for common block types
 */
export const MATERIALS: Record<string, number> = {
  'stone': 1,
  'cobblestone': 4,
  'dirt': 3,
  'oak_planks': 5,
  'spruce_planks': 6,
  'birch_planks': 7,
  'jungle_planks': 8,
  'oak_log': 17,
  'spruce_log': 18,
  'glass': 20,
  'sandstone': 24,
  'wool': 35,
  'brick': 45,
  'stone_brick': 98
};

/**
 * Blueprint entry for building
 */
export interface BlueprintEntry {
  position: Position;
  materialId: number;
}

// ============================================================================
// Builder Agent Class
// ============================================================================

/**
 * Builder Agent - Automated structure construction
 *
 * Implements building behavior for constructing walls, floors,
 * and custom patterns in the SimpleMiner world.
 */
export class BuilderAgent extends BaseAgent {
  private readonly builderConfig: BuilderConfig;
  private blocksPlaced: number = 0;

  constructor(client: KadiClient, config: BuilderConfig) {
    super(client, config);
    this.builderConfig = {
      defaultMaterialId: MATERIALS['cobblestone'],
      placementDelayMs: 500,
      ...config
    };
  }

  // ============================================================================
  // Main Behavior Loop
  // ============================================================================

  /**
   * Main behavior loop - waits for build commands
   *
   * Unlike MinerAgent which runs autonomously, BuilderAgent
   * exposes methods for external callers to trigger builds.
   */
  protected async runBehaviorLoop(): Promise<void> {
    this.log('Builder agent ready');
    this.log('Use buildWall(), buildFloor(), or executeBlueprintAsync() to construct');

    // Keep agent alive until stopped
    while (this.isRunning) {
      await this.sleep(1000);
    }

    this.log(`Session complete. Blocks placed: ${this.blocksPlaced}`);
  }

  // ============================================================================
  // Building Methods
  // ============================================================================

  /**
   * Build a wall from start to end position
   *
   * @param start Starting corner position
   * @param end Ending corner position
   * @param materialId Block type to use (default: config default)
   * @returns Number of blocks placed
   */
  async buildWall(
    start: Position,
    end: Position,
    materialId?: number
  ): Promise<number> {
    const material = materialId ?? this.builderConfig.defaultMaterialId!;
    this.log(`Building wall from (${start.x},${start.y},${start.z}) to (${end.x},${end.y},${end.z})`);

    const blueprint = this.generateWallBlueprint(start, end, material);
    return this.executeBlueprint(blueprint);
  }

  /**
   * Build a floor (horizontal surface)
   *
   * @param corner1 First corner
   * @param corner2 Opposite corner
   * @param z Height level
   * @param materialId Block type to use
   * @returns Number of blocks placed
   */
  async buildFloor(
    corner1: Position,
    corner2: Position,
    materialId?: number
  ): Promise<number> {
    const material = materialId ?? this.builderConfig.defaultMaterialId!;
    this.log(`Building floor from (${corner1.x},${corner1.y}) to (${corner2.x},${corner2.y}) at z=${corner1.z}`);

    const blueprint = this.generateFloorBlueprint(corner1, corner2, material);
    return this.executeBlueprint(blueprint);
  }

  /**
   * Build a vertical pillar
   *
   * @param base Base position
   * @param height Number of blocks tall
   * @param materialId Block type to use
   * @returns Number of blocks placed
   */
  async buildPillar(
    base: Position,
    height: number,
    materialId?: number
  ): Promise<number> {
    const material = materialId ?? this.builderConfig.defaultMaterialId!;
    this.log(`Building pillar at (${base.x},${base.y},${base.z}) height ${height}`);

    const blueprint: BlueprintEntry[] = [];

    for (let z = 0; z < height; z++) {
      blueprint.push({
        position: { x: base.x, y: base.y, z: base.z + z },
        materialId: material
      });
    }

    return this.executeBlueprint(blueprint);
  }

  /**
   * Execute a custom blueprint
   *
   * @param blueprint Array of positions and materials
   * @returns Number of blocks placed
   */
  async executeBlueprint(blueprint: BlueprintEntry[]): Promise<number> {
    this.log(`Executing blueprint with ${blueprint.length} blocks`);

    let placed = 0;

    for (const entry of blueprint) {
      if (!this.isRunning) {
        this.log('Build interrupted');
        break;
      }

      // Check if we have the material
      const hasItem = await this.checkInventoryForItem(entry.materialId);
      if (!hasItem) {
        this.logError(`Missing material ID ${entry.materialId} in inventory`);
        continue;
      }

      // Move to placement position
      const approachPos = this.getPlacementPosition(entry.position);
      await this.queueMove(approachPos);

      // Place block
      const success = await this.queuePlace(entry.position, entry.materialId);

      if (success) {
        placed++;
        this.blocksPlaced++;
      }

      // Wait for commands to complete
      await this.waitForCommandsComplete(10000);

      // Small delay between placements
      await this.sleep(this.builderConfig.placementDelayMs || 500);
    }

    this.log(`Blueprint complete. Placed ${placed}/${blueprint.length} blocks`);
    return placed;
  }

  // ============================================================================
  // Blueprint Generators
  // ============================================================================

  /**
   * Generate blueprint for a wall
   */
  private generateWallBlueprint(start: Position, end: Position, materialId: number): BlueprintEntry[] {
    const blueprint: BlueprintEntry[] = [];

    const minX = Math.min(start.x, end.x);
    const maxX = Math.max(start.x, end.x);
    const minY = Math.min(start.y, end.y);
    const maxY = Math.max(start.y, end.y);
    const minZ = Math.min(start.z, end.z);
    const maxZ = Math.max(start.z, end.z);

    // Determine wall orientation
    const isXWall = (maxX - minX) > (maxY - minY);

    if (isXWall) {
      // Wall along X axis
      for (let x = minX; x <= maxX; x++) {
        for (let z = minZ; z <= maxZ; z++) {
          blueprint.push({
            position: { x, y: minY, z },
            materialId
          });
        }
      }
    } else {
      // Wall along Y axis
      for (let y = minY; y <= maxY; y++) {
        for (let z = minZ; z <= maxZ; z++) {
          blueprint.push({
            position: { x: minX, y, z },
            materialId
          });
        }
      }
    }

    return blueprint;
  }

  /**
   * Generate blueprint for a floor
   */
  private generateFloorBlueprint(corner1: Position, corner2: Position, materialId: number): BlueprintEntry[] {
    const blueprint: BlueprintEntry[] = [];

    const minX = Math.min(corner1.x, corner2.x);
    const maxX = Math.max(corner1.x, corner2.x);
    const minY = Math.min(corner1.y, corner2.y);
    const maxY = Math.max(corner1.y, corner2.y);
    const z = corner1.z;

    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        blueprint.push({
          position: { x, y, z },
          materialId
        });
      }
    }

    return blueprint;
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  /**
   * Check if inventory contains item
   */
  private async checkInventoryForItem(itemId: number): Promise<boolean> {
    const inventory = await this.getInventory();

    return inventory.some(slot => slot.item_id === itemId && slot.quantity > 0);
  }

  /**
   * Get position to stand when placing a block
   */
  private getPlacementPosition(targetPos: Position): Position {
    // Stand 1 block away in X direction
    return {
      x: targetPos.x - 1,
      y: targetPos.y,
      z: targetPos.z
    };
  }

  /**
   * Get material ID by name
   */
  static getMaterialId(name: string): number | undefined {
    return MATERIALS[name.toLowerCase()];
  }
}
