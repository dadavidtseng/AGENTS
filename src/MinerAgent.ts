/**
 * MinerAgent - Standalone Autonomous Mining Agent
 *
 * This script creates an autonomous mining agent that connects to SimpleMiner
 * via KADI broker and executes a continuous mining loop.
 *
 * Mining Loop:
 * 1. Get nearby blocks using simpleminer_get_nearby_blocks (20-block radius)
 * 2. Find diamond/iron/coal ore by filtering block_name
 * 3. Queue MOVE command to ore position (+0.5 offset for centering)
 * 4. Queue MINE command to break the block
 * 5. Wait 3 seconds for execution
 * 6. Check agent status and repeat
 *
 * Usage:
 *   npm run miner
 *   # or
 *   npx tsx src/MinerAgent.ts
 *
 * @module MinerAgent
 */

import 'dotenv/config';
import { KadiClient } from '@kadi.build/core';

// ============================================================================
// Configuration
// ============================================================================

const BROKER_URL = process.env.KADI_BROKER_URL || 'ws://localhost:8080/kadi';
const AGENT_NAME = process.env.SIMPLEMINER_AGENT_PREFIX
  ? `${process.env.SIMPLEMINER_AGENT_PREFIX}-miner`
  : 'miner-agent';
const NETWORKS = ['global'];  // SimpleMiner connects to 'global' network

// Target agent name (as registered by SimpleMiner via kadi-local)
const TARGET_AGENT = 'SimpleMiner Agent';

// Mining configuration
const VISION_RADIUS = parseFloat(process.env.SIMPLEMINER_VISION_RADIUS || '20');
const CYCLE_DELAY_MS = parseInt(process.env.SIMPLEMINER_CYCLE_DELAY_MS || '3000', 10);
const TARGET_ORES = (process.env.SIMPLEMINER_TARGET_ORES || 'Diamond_Ore,Iron_Ore,Coal_Ore')
  .split(',')
  .map(s => s.trim());

// Spawn position
const SPAWN_X = parseFloat(process.env.SIMPLEMINER_SPAWN_X || '0');
const SPAWN_Y = parseFloat(process.env.SIMPLEMINER_SPAWN_Y || '0');
const SPAWN_Z = parseFloat(process.env.SIMPLEMINER_SPAWN_Z || '90');  // In air above ground, agent will fall to surface

// Tool invocation timeout
const TOOL_TIMEOUT_MS = 60000;  // 60 seconds

// ============================================================================
// Types
// ============================================================================

interface BlockInfo {
  block_coords: {
    x: number;
    y: number;
    z: number;
  };
  block_id: number;
  block_name: string;
}

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

// ============================================================================
// State
// ============================================================================

let client: KadiClient | null = null;
let protocol: any = null;
let agentId: number | null = null;
let isRunning = true;
let iterationCount = 0;
const oresMined: Map<string, number> = new Map();

// Pending tool requests waiting for async response
const pendingRequests = new Map<string, PendingRequest>();

// Stuck detection - track previous positions
let previousPosition: { x: number; y: number; z: number } | null = null;
let stuckCounter = 0;
const STUCK_THRESHOLD = 0.5;  // If moved less than 0.5 blocks, consider stuck
const STUCK_COUNT_TRIGGER = 3;  // After 3 iterations of being stuck, force mine adjacent

// ============================================================================
// Logging Helpers
// ============================================================================

function log(message: string): void {
  const timestamp = new Date().toISOString().substring(11, 19);
  console.log(`[${timestamp}] ${message}`);
}

function logSuccess(message: string): void {
  log(`✅ ${message}`);
}

function logTarget(message: string): void {
  log(`🎯 ${message}`);
}

function logMining(message: string): void {
  log(`⛏️ ${message}`);
}

function logSearch(message: string): void {
  log(`🔍 ${message}`);
}

function logStatus(message: string): void {
  log(`📊 ${message}`);
}

function logError(message: string): void {
  log(`❌ ${message}`);
}

function logShutdown(message: string): void {
  log(`🛑 ${message}`);
}

// ============================================================================
// SimpleMiner Tool Invocation
// ============================================================================

/**
 * Setup broker message listener for async tool responses
 *
 * The KADI broker uses an async mailbox pattern:
 * 1. Client sends kadi.ability.request
 * 2. Broker immediately responds with {status: "pending", requestId}
 * 3. Broker sends kadi.ability.response notification when tool completes
 *
 * This function sets up the listener for step 3.
 */
function setupAsyncResponseHandler(): void {
  if (!client) return;

  const brokerManager = client.getBrokerManager();

  brokerManager.on('brokerMessage', (_brokerName: string, message: any) => {
    // Handle kadi.ability.response notifications
    if (message?.method === 'kadi.ability.response' && message.params) {
      const { requestId, result, error } = message.params;

      log(`📨 Received async response for requestId: ${requestId}`);

      const pending = pendingRequests.get(requestId);
      if (pending) {
        clearTimeout(pending.timeout);
        pendingRequests.delete(requestId);

        if (error) {
          pending.reject(new Error(error));
        } else {
          pending.resolve(result);
        }
      } else {
        log(`⚠️ No pending request found for requestId: ${requestId}`);
      }
    }
  });

  log('Async response handler configured');
}

/**
 * Invoke a SimpleMiner tool via KADI protocol
 *
 * Uses async mailbox pattern:
 * 1. Send kadi.ability.request
 * 2. Get {status: "pending", requestId} immediately
 * 3. Wait for kadi.ability.response notification with matching requestId
 */
async function invokeSimpleMinerTool(toolName: string, params: any): Promise<any> {
  if (!protocol) {
    throw new Error('Protocol not initialized');
  }

  try {
    log(`🎮 Invoking ${toolName}...`);

    // Step 1: Send request and get pending acknowledgment
    const ackResponse = await protocol.invokeTool({
      targetAgent: TARGET_AGENT,
      toolName,
      toolInput: params,
      timeout: 30000
    });

    // Step 2: Extract requestId from pending response
    const requestId = ackResponse?.requestId;
    if (!requestId) {
      // If no requestId, the response might be synchronous (MCP upstream)
      // Try to parse it directly
      log(`📦 Direct response (no requestId): ${JSON.stringify(ackResponse).substring(0, 300)}`);
      return { success: true, data: parseToolResponse(ackResponse) };
    }

    log(`📦 Request acknowledged, waiting for result (requestId: ${requestId})...`);

    // Step 3: Wait for async response via kadi.ability.response notification
    const result = await waitForAsyncResponse(requestId);

    log(`📦 Received result: ${JSON.stringify(result).substring(0, 300)}`);
    return { success: true, data: parseToolResponse(result) };

  } catch (error: any) {
    logError(`Tool error: ${error.message}`);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Wait for async response with matching requestId
 */
function waitForAsyncResponse(requestId: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingRequests.delete(requestId);
      reject(new Error(`Tool invocation timeout after ${TOOL_TIMEOUT_MS}ms`));
    }, TOOL_TIMEOUT_MS);

    pendingRequests.set(requestId, { resolve, reject, timeout });
  });
}

/**
 * Parse tool response from MCP format
 */
function parseToolResponse(response: any): any {
  // Try to extract from MCP content format
  if (response?.content?.[0]?.text) {
    try {
      return JSON.parse(response.content[0].text);
    } catch {
      return response.content[0].text;
    }
  }
  return response;
}

/**
 * Spawn agent in SimpleMiner world
 */
async function spawnAgent(name: string, x: number, y: number, z: number): Promise<{ success: boolean; agent_id?: number; message?: string }> {
  const result = await invokeSimpleMinerTool('simpleminer_spawn_agent', { name, x, y, z });

  log(`🔍 Spawn result.success: ${result.success}`);
  log(`🔍 Spawn result.data: ${JSON.stringify(result.data).substring(0, 300)}`);

  if (result.success && result.data) {
    // Try multiple paths to find agent_id
    const agentId = result.data.agent_id
      ?? result.data.data?.agent_id
      ?? result.data.result?.agent_id
      ?? (typeof result.data === 'number' ? result.data : undefined);

    log(`🔍 Extracted agent_id: ${agentId}`);

    if (agentId !== undefined) {
      return { success: true, agent_id: agentId };
    }

    // If we got a response but couldn't extract agent_id, show the data
    return { success: false, message: `Could not extract agent_id from response: ${JSON.stringify(result.data).substring(0, 200)}` };
  }

  return { success: false, message: result.error || 'Unknown error' };
}

/**
 * Despawn agent from SimpleMiner world
 */
async function despawnAgent(agent_id: number): Promise<{ success: boolean }> {
  const result = await invokeSimpleMinerTool('simpleminer_despawn_agent', { agent_id });
  return { success: result.success };
}

/**
 * Get nearby blocks (vision system)
 */
async function getNearbyBlocks(agent_id: number, radius: number): Promise<{ success: boolean; blocks?: BlockInfo[] }> {
  const result = await invokeSimpleMinerTool('simpleminer_get_nearby_blocks', { agent_id, radius });

  if (result.success && result.data) {
    const blocks = result.data.blocks ?? result.data.data?.blocks ?? [];
    return { success: true, blocks };
  }

  return { success: false, blocks: [] };
}

/**
 * Queue a command for the agent
 */
async function queueCommand(agent_id: number, command_type: string, params: Record<string, any>): Promise<{ success: boolean }> {
  const result = await invokeSimpleMinerTool('simpleminer_queue_command', {
    agent_id,
    command_type,
    params
  });

  return { success: result.success };
}

/**
 * Get agent status
 */
async function getAgentStatus(agent_id: number): Promise<{ success: boolean; position?: { x: number; y: number; z: number }; queue_size?: number }> {
  const result = await invokeSimpleMinerTool('simpleminer_get_agent_status', { agent_id });

  if (result.success && result.data) {
    const data = result.data.data ?? result.data;
    return {
      success: true,
      position: data.position,
      queue_size: data.queue_size ?? 0
    };
  }

  return { success: false };
}

// ============================================================================
// Mining Logic
// ============================================================================

/**
 * Find target block from vision results (mines everything except air and water)
 * Returns the highest priority mineable block within vision range
 */
function findTargetOre(blocks: BlockInfo[]): BlockInfo | null {
  // Priority order: Ores first, then solid blocks, avoid water
  const priorities: Record<string, number> = {
    'diamond_ore': 100,
    'gold_ore': 80,
    'iron_ore': 60,
    'coal_ore': 40,
    'wood': 30,  // Logs
    'stone': 20,
    'dirt': 15,
    'grass': 15,
    'sand': 10,
    'gravel': 10,
    'leaves': 5,
  };

  // Find all mineable blocks (exclude air and water)
  const mineableBlocks = blocks.filter(block => {
    const name = block.block_name.toLowerCase();
    // Exclude water and air
    return !name.includes('water') && !name.includes('air');
  });

  if (mineableBlocks.length === 0) {
    return null;
  }

  // Sort by priority (highest first)
  mineableBlocks.sort((a, b) => {
    const nameA = a.block_name.toLowerCase();
    const nameB = b.block_name.toLowerCase();

    // Get priority (default to 5 for unknown blocks)
    const prioA = Object.entries(priorities).find(([k]) => nameA.includes(k))?.[1] || 5;
    const prioB = Object.entries(priorities).find(([k]) => nameB.includes(k))?.[1] || 5;

    return prioB - prioA;  // Higher priority first
  });

  return mineableBlocks[0];
}

/**
 * Find blocks immediately adjacent to the agent (within 2 blocks)
 * Used for stuck detection - mines any solid block the agent is touching
 */
function findAdjacentBlocks(
  blocks: BlockInfo[],
  agentPos: { x: number; y: number; z: number }
): BlockInfo[] {
  const ADJACENT_RANGE = 2.0;  // Blocks within 2 meters of agent

  return blocks.filter(block => {
    const name = block.block_name.toLowerCase();
    // Exclude water and air
    if (name.includes('water') || name.includes('air')) {
      return false;
    }

    const blockCenter = {
      x: block.block_coords.x + 0.5,
      y: block.block_coords.y + 0.5,
      z: block.block_coords.z + 0.5
    };

    // Calculate distance from agent to block
    const dx = blockCenter.x - agentPos.x;
    const dy = blockCenter.y - agentPos.y;
    const dz = blockCenter.z - agentPos.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

    return dist <= ADJACENT_RANGE;
  }).sort((a, b) => {
    // Sort by distance (closest first)
    const distA = Math.sqrt(
      Math.pow(a.block_coords.x + 0.5 - agentPos.x, 2) +
      Math.pow(a.block_coords.y + 0.5 - agentPos.y, 2) +
      Math.pow(a.block_coords.z + 0.5 - agentPos.z, 2)
    );
    const distB = Math.sqrt(
      Math.pow(b.block_coords.x + 0.5 - agentPos.x, 2) +
      Math.pow(b.block_coords.y + 0.5 - agentPos.y, 2) +
      Math.pow(b.block_coords.z + 0.5 - agentPos.z, 2)
    );
    return distA - distB;
  });
}

/**
 * Find the block obstructing the path to the target
 * Returns the closest solid block between agent and target (within mining range)
 */
function findObstructingBlock(
  blocks: BlockInfo[],
  agentPos: { x: number; y: number; z: number },
  targetPos: { x: number; y: number; z: number }
): BlockInfo | null {
  const MAX_MINING_RANGE = 5.0;

  // Calculate direction vector to target
  const dx = targetPos.x - agentPos.x;
  const dy = targetPos.y - agentPos.y;
  const dz = targetPos.z - agentPos.z;
  const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

  if (distance === 0) return null;

  const dirX = dx / distance;
  const dirY = dy / distance;
  const dirZ = dz / distance;

  // Find solid blocks along the ray from agent to target
  const obstructingBlocks = blocks.filter(block => {
    const name = block.block_name.toLowerCase();
    // Exclude water and air
    if (name.includes('water') || name.includes('air')) {
      return false;
    }

    const blockCenter = {
      x: block.block_coords.x + 0.5,
      y: block.block_coords.y + 0.5,
      z: block.block_coords.z + 0.5
    };

    // Calculate distance from agent to block
    const blockDx = blockCenter.x - agentPos.x;
    const blockDy = blockCenter.y - agentPos.y;
    const blockDz = blockCenter.z - agentPos.z;
    const blockDist = Math.sqrt(blockDx * blockDx + blockDy * blockDy + blockDz * blockDz);

    // Must be within mining range
    if (blockDist > MAX_MINING_RANGE) {
      return false;
    }

    // Check if block is roughly along the path to target
    // Calculate dot product to see if block is in the direction we're heading
    const blockDirX = blockDx / blockDist;
    const blockDirY = blockDy / blockDist;
    const blockDirZ = blockDz / blockDist;
    const dotProduct = dirX * blockDirX + dirY * blockDirY + dirZ * blockDirZ;

    // Block must be in front of us (dotProduct > 0.5 = within ~60 degrees - more permissive)
    return dotProduct > 0.5;
  });

  if (obstructingBlocks.length === 0) {
    return null;
  }

  // Return closest obstructing block
  obstructingBlocks.sort((a, b) => {
    const distA = Math.sqrt(
      Math.pow(a.block_coords.x + 0.5 - agentPos.x, 2) +
      Math.pow(a.block_coords.y + 0.5 - agentPos.y, 2) +
      Math.pow(a.block_coords.z + 0.5 - agentPos.z, 2)
    );
    const distB = Math.sqrt(
      Math.pow(b.block_coords.x + 0.5 - agentPos.x, 2) +
      Math.pow(b.block_coords.y + 0.5 - agentPos.y, 2) +
      Math.pow(b.block_coords.z + 0.5 - agentPos.z, 2)
    );
    return distA - distB;
  });

  return obstructingBlocks[0];
}

/**
 * Execute one mining cycle
 */
async function executeMiningCycle(): Promise<string | null> {
  if (agentId === null) {
    throw new Error('Agent not initialized');
  }

  // Step 1: Get agent status (position + queue info)
  const statusResult = await getAgentStatus(agentId);
  if (!statusResult.success || !statusResult.position) {
    logError('Failed to get agent position');
    return null;
  }
  const agentPos = statusResult.position;
  const queueSize = statusResult.queue_size || 0;

  // Stuck detection: Check if agent moved significantly since last iteration
  if (previousPosition) {
    const distanceMoved = Math.sqrt(
      Math.pow(agentPos.x - previousPosition.x, 2) +
      Math.pow(agentPos.y - previousPosition.y, 2) +
      Math.pow(agentPos.z - previousPosition.z, 2)
    );

    if (distanceMoved < STUCK_THRESHOLD) {
      stuckCounter++;
      log(`🚧 Agent stuck! Moved only ${distanceMoved.toFixed(2)} blocks (stuck count: ${stuckCounter})`);
    } else {
      stuckCounter = 0;  // Reset if moved
    }
  }
  previousPosition = { ...agentPos };

  // Detect stuck commands - if queue > 10, something is blocking
  if (queueSize > 10) {
    logError(`⚠️ Command queue overflow (${queueSize} commands) - agent may be stuck!`);
    // Note: No clear_queue tool available, agent will need to work through backlog
  }

  // Step 2: Get nearby blocks (vision)
  logSearch(`Scanning ${VISION_RADIUS}-block radius for blocks to mine...`);
  const visionResult = await getNearbyBlocks(agentId, VISION_RADIUS);

  if (!visionResult.success || !visionResult.blocks) {
    logError('Vision failed');
    return null;
  }

  log(`Scanned ${visionResult.blocks.length} blocks`);

  // STUCK HANDLING: If stuck for too long, mine nearest adjacent block regardless of target
  if (stuckCounter >= STUCK_COUNT_TRIGGER) {
    const adjacentBlocks = findAdjacentBlocks(visionResult.blocks, agentPos);
    if (adjacentBlocks.length > 0) {
      const blockToMine = adjacentBlocks[0];  // Closest adjacent block
      const blockDist = Math.sqrt(
        Math.pow(blockToMine.block_coords.x + 0.5 - agentPos.x, 2) +
        Math.pow(blockToMine.block_coords.y + 0.5 - agentPos.y, 2) +
        Math.pow(blockToMine.block_coords.z + 0.5 - agentPos.z, 2)
      );

      log(`🔨 STUCK! Force mining adjacent ${blockToMine.block_name} at (${blockToMine.block_coords.x}, ${blockToMine.block_coords.y}, ${blockToMine.block_coords.z}) - ${blockDist.toFixed(1)} blocks away`);

      await queueCommand(agentId, 'MINE', {
        x: blockToMine.block_coords.x,
        y: blockToMine.block_coords.y,
        z: blockToMine.block_coords.z
      });

      stuckCounter = 0;  // Reset stuck counter after mining
      await sleep(CYCLE_DELAY_MS);
      return blockToMine.block_name;
    } else {
      log(`🚧 Stuck but no adjacent blocks to mine!`);
      stuckCounter = 0;  // Reset anyway to try different approach
    }
  }

  // Step 3: Find highest priority target (ores first, then solid blocks)
  const target = findTargetOre(visionResult.blocks);

  if (!target) {
    logSearch('No mineable blocks found, exploring...');

    // Move to random nearby location
    const randomOffset = {
      x: (Math.random() - 0.5) * 20,  // Wider search
      y: (Math.random() - 0.5) * 20,
      z: (Math.random() - 0.5) * 10
    };

    await queueCommand(agentId, 'MOVE', {
      x: agentPos.x + randomOffset.x,
      y: agentPos.y + randomOffset.y,
      z: agentPos.z + randomOffset.z
    });

    await sleep(CYCLE_DELAY_MS);
    return null;
  }

  const targetCenter = {
    x: target.block_coords.x + 0.5,
    y: target.block_coords.y + 0.5,
    z: target.block_coords.z + 0.5
  };

  const distanceToTarget = Math.sqrt(
    Math.pow(targetCenter.x - agentPos.x, 2) +
    Math.pow(targetCenter.y - agentPos.y, 2) +
    Math.pow(targetCenter.z - agentPos.z, 2)
  );

  logTarget(`Target: ${target.block_name} at (${target.block_coords.x}, ${target.block_coords.y}, ${target.block_coords.z}) - ${distanceToTarget.toFixed(1)} blocks away`);

  // Step 4: Find obstacle blocking path (within mining range)
  const obstacle = findObstructingBlock(visionResult.blocks, agentPos, targetCenter);

  if (obstacle) {
    // Mine the obstacle first (clear the path)
    const obstacleDist = Math.sqrt(
      Math.pow(obstacle.block_coords.x + 0.5 - agentPos.x, 2) +
      Math.pow(obstacle.block_coords.y + 0.5 - agentPos.y, 2) +
      Math.pow(obstacle.block_coords.z + 0.5 - agentPos.z, 2)
    );

    logMining(`⛏️ Mining obstacle ${obstacle.block_name} at (${obstacle.block_coords.x}, ${obstacle.block_coords.y}, ${obstacle.block_coords.z}) - ${obstacleDist.toFixed(1)} blocks away`);

    await queueCommand(agentId, 'MINE', {
      x: obstacle.block_coords.x,
      y: obstacle.block_coords.y,
      z: obstacle.block_coords.z
    });

    await sleep(CYCLE_DELAY_MS);
    return obstacle.block_name;
  }

  // Step 5: No obstacles in mining range
  if (distanceToTarget <= 5.0) {
    // Target is in range - mine it directly
    logMining(`⛏️ Mining target ${target.block_name}`);

    await queueCommand(agentId, 'MINE', {
      x: target.block_coords.x,
      y: target.block_coords.y,
      z: target.block_coords.z
    });

    await sleep(CYCLE_DELAY_MS);
    return target.block_name;
  } else {
    // Target too far - move closer (path is clear)
    logTarget(`🚶 Moving toward ${target.block_name} (${distanceToTarget.toFixed(1)} blocks away)`);

    await queueCommand(agentId, 'MOVE', {
      x: targetCenter.x,
      y: targetCenter.y,
      z: targetCenter.z
    });

    await sleep(CYCLE_DELAY_MS);
    return null;
  }
}

/**
 * Main mining loop
 */
async function miningLoop(): Promise<void> {
  log('Starting autonomous mining loop...');
  log(`Priority: Ores > Wood > Stone > Dirt/Grass > Sand/Gravel > Leaves`);
  log(`Vision radius: ${VISION_RADIUS} blocks`);
  log(`Cycle delay: ${CYCLE_DELAY_MS}ms`);

  while (isRunning) {
    try {
      iterationCount++;
      log(`--- Mining iteration ${iterationCount} ---`);

      const minedOre = await executeMiningCycle();

      if (minedOre) {
        // Track statistics
        const count = oresMined.get(minedOre) || 0;
        oresMined.set(minedOre, count + 1);
        logSuccess(`Mined ${minedOre}! Total: ${count + 1}`);
      }

      // Small delay before next iteration
      await sleep(500);

    } catch (error: any) {
      logError(`Mining cycle error: ${error.message}`);
      // Wait longer after error before retrying
      await sleep(5000);
    }
  }
}

// ============================================================================
// Lifecycle
// ============================================================================

/**
 * Sleep helper
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Cleanup and shutdown
 */
async function cleanup(): Promise<void> {
  logShutdown('Shutting down MinerAgent...');
  isRunning = false;

  // Print statistics
  log('=== Mining Session Statistics ===');
  log(`Total iterations: ${iterationCount}`);
  log('Ores mined:');
  for (const [ore, count] of oresMined) {
    log(`  ${ore}: ${count}`);
  }

  // Despawn agent
  if (protocol && agentId !== null) {
    try {
      await despawnAgent(agentId);
      logSuccess('Agent despawned');
    } catch (error: any) {
      logError(`Failed to despawn agent: ${error.message}`);
    }
  }

  // Disconnect from broker
  if (client) {
    try {
      await client.disconnect();
      logSuccess('Disconnected from KADI broker');
    } catch (error: any) {
      logError(`Failed to disconnect: ${error.message}`);
    }
  }

  process.exit(0);
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  log('========================================');
  log('  MinerAgent - Autonomous Mining Bot');
  log('========================================');
  log(`Broker URL: ${BROKER_URL}`);
  log(`Agent name: ${AGENT_NAME}`);
  log(`Networks: ${NETWORKS.join(', ')}`);
  log(`Target: ${TARGET_AGENT}`);
  log('');

  try {
    // Step 1: Create KADI client
    log('Step 1: Creating KADI client...');
    try {
      client = new KadiClient({
        name: AGENT_NAME,
        version: '1.0.0',
        role: 'agent',
        broker: BROKER_URL,
        networks: NETWORKS,
        advanced: {
          connectionTimeout: 15000,  // 15 seconds
          requestTimeout: 30000,
          verbose: true
        }
      });
      log('Step 1: KADI client created successfully');
    } catch (createError: any) {
      logError(`Failed to create KADI client: ${createError.message}`);
      throw createError;
    }

    // Step 2: Connect to broker
    log('Step 2: Connecting to KADI broker...');
    try {
      const agentIdResult = await client.connect();
      logSuccess(`Step 2: Connected to KADI broker (agentId: ${agentIdResult})`);
    } catch (connectError: any) {
      logError(`Failed to connect to broker: ${connectError.message}`);
      throw connectError;
    }

    // Step 3: Get protocol for tool invocation
    log('Step 3: Getting broker protocol...');
    protocol = client.getBrokerProtocol();
    logSuccess('Step 3: Protocol ready');

    // Step 4: Setup async response handler for tool invocations
    log('Step 4: Setting up async response handler...');
    setupAsyncResponseHandler();
    logSuccess('Step 4: Async handler ready');

    // Step 5: Spawn agent in game world
    log(`Spawning agent at (${SPAWN_X}, ${SPAWN_Y}, ${SPAWN_Z})...`);
    const spawnResult = await spawnAgent('MinerBot', SPAWN_X, SPAWN_Y, SPAWN_Z);

    if (!spawnResult.success || spawnResult.agent_id === undefined) {
      throw new Error(`Failed to spawn agent: ${spawnResult.message}`);
    }

    agentId = spawnResult.agent_id;
    logSuccess(`Spawned agent with ID: ${agentId}`);

    // Step 6: Start mining loop
    await miningLoop();

  } catch (error: any) {
    logError(`Fatal error: ${error.message}`);
    await cleanup();
  }
}

// ============================================================================
// Signal Handlers
// ============================================================================

// Graceful shutdown on CTRL+C
process.on('SIGINT', async () => {
  log('');
  log('Received SIGINT (CTRL+C)');
  await cleanup();
});

// Handle uncaught errors
process.on('unhandledRejection', (reason: any) => {
  logError(`Unhandled rejection: ${reason}`);
});

// ============================================================================
// Entry Point
// ============================================================================

main().catch(async (error) => {
  logError(`Startup error: ${error.message}`);
  await cleanup();
});
