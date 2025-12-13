/**
 * BuilderAgent - Automated Construction Agent
 *
 * This script creates an autonomous building agent that connects to SimpleMiner
 * via KADI broker and executes construction commands.
 *
 * Capabilities:
 * - Build simple structures (walls, floors, pillars)
 * - Manage inventory for construction materials
 * - Follow blueprint commands via PLACE commands
 *
 * Build Loop:
 * 1. Connect to KADI broker
 * 2. Spawn BuilderBot at specified position
 * 3. Execute buildWall() with specified parameters
 * 4. Move to each block position and place blocks sequentially
 *
 * Usage:
 *   npm run builder
 *   # or
 *   npx tsx src/BuilderAgent.ts
 *
 * @module BuilderAgent
 */

import 'dotenv/config';
import { KadiClient } from '@kadi.build/core';

// ============================================================================
// Configuration
// ============================================================================

const BROKER_URL = process.env.KADI_BROKER_URL || 'ws://localhost:8080/kadi';
const AGENT_NAME = process.env.SIMPLEMINER_AGENT_PREFIX
  ? `${process.env.SIMPLEMINER_AGENT_PREFIX}-builder`
  : 'builder-agent';
const NETWORKS = ['global'];  // SimpleMiner connects to 'global' network

// Target agent name (as registered by SimpleMiner via kadi-local)
const TARGET_AGENT = 'SimpleMiner Agent';

// Spawn position
const SPAWN_X = parseFloat(process.env.SIMPLEMINER_SPAWN_X || '0');
const SPAWN_Y = parseFloat(process.env.SIMPLEMINER_SPAWN_Y || '0');
const SPAWN_Z = parseFloat(process.env.SIMPLEMINER_SPAWN_Z || '90');

// Tool invocation timeout
const TOOL_TIMEOUT_MS = 60000;  // 60 seconds

// Build delay between commands
const BUILD_DELAY_MS = parseInt(process.env.SIMPLEMINER_BUILD_DELAY_MS || '1000', 10);

// ============================================================================
// Types
// ============================================================================

interface BuildTask {
  type: 'wall' | 'floor' | 'pillar';
  material: string;  // e.g., "Stone", "Oak_Planks"
  start: { x: number; y: number; z: number };
  end: { x: number; y: number; z: number };
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

// Pending tool requests waiting for async response
const pendingRequests = new Map<string, PendingRequest>();

// Build statistics
let blocksPlaced = 0;
let buildErrors = 0;

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

function logBuilding(message: string): void {
  log(`🧱 ${message}`);
}

function logMove(message: string): void {
  log(`🚶 ${message}`);
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
    const agentIdValue = result.data.agent_id
      ?? result.data.data?.agent_id
      ?? result.data.result?.agent_id
      ?? (typeof result.data === 'number' ? result.data : undefined);

    log(`🔍 Extracted agent_id: ${agentIdValue}`);

    if (agentIdValue !== undefined) {
      return { success: true, agent_id: agentIdValue };
    }

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
// Material Mapping
// ============================================================================

/**
 * Get material item ID from material name
 * In production, this would query SimpleMiner's ItemRegistry via MCP tool
 */
function getMaterialID(materialName: string): number {
  // Map material names to item IDs (hardcoded for demo)
  // These IDs should match SimpleMiner's ItemRegistry
  const materials: { [key: string]: number } = {
    'Stone': 1,
    'Dirt': 2,
    'Grass': 3,
    'Cobblestone': 4,
    'Oak_Planks': 5,
    'Oak_Log': 6,
    'Sand': 7,
    'Gravel': 8,
    'Glass': 9,
    'Brick': 10
  };

  const id = materials[materialName];
  if (id === undefined) {
    log(`⚠️ Unknown material "${materialName}", defaulting to Stone (ID: 1)`);
    return 1;  // Default to Stone
  }

  return id;
}

// ============================================================================
// Building Functions
// ============================================================================

/**
 * Sleep helper
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Build a wall between two points
 * Iterates column-by-column, placing blocks sequentially
 */
async function buildWall(agent_id: number, task: BuildTask): Promise<void> {
  const { start, end, material } = task;
  const materialID = getMaterialID(material);

  logBuilding(`Building ${material} wall from (${start.x}, ${start.y}, ${start.z}) to (${end.x}, ${end.y}, ${end.z})`);
  logBuilding(`Material ID: ${materialID}`);

  // Calculate wall dimensions
  const minX = Math.min(start.x, end.x);
  const maxX = Math.max(start.x, end.x);
  const minY = Math.min(start.y, end.y);
  const maxY = Math.max(start.y, end.y);
  const minZ = Math.min(start.z, end.z);
  const maxZ = Math.max(start.z, end.z);

  const totalBlocks = (maxX - minX + 1) * (maxY - minY + 1) * (maxZ - minZ + 1);
  logBuilding(`Total blocks to place: ${totalBlocks}`);

  let blockCount = 0;

  // Build wall column by column
  for (let x = minX; x <= maxX; x++) {
    for (let y = minY; y <= maxY; y++) {
      for (let z = minZ; z <= maxZ; z++) {
        blockCount++;
        logBuilding(`Placing block ${blockCount}/${totalBlocks} at (${x}, ${y}, ${z})`);

        // Move to position adjacent to the block
        logMove(`Moving to (${x + 0.5}, ${y}, ${z})`);
        const moveResult = await queueCommand(agent_id, 'MOVE', {
          x: x + 0.5,
          y: y,
          z: z
        });

        if (!moveResult.success) {
          logError(`Failed to queue MOVE command`);
          buildErrors++;
          continue;
        }

        // Wait for movement
        await sleep(BUILD_DELAY_MS);

        // Place block
        logBuilding(`Placing ${material} block at (${x}, ${y}, ${z})`);
        const placeResult = await queueCommand(agent_id, 'PLACE', {
          x: x,
          y: y,
          z: z,
          item_id: materialID
        });

        if (!placeResult.success) {
          logError(`Failed to queue PLACE command at (${x}, ${y}, ${z})`);
          buildErrors++;
        } else {
          blocksPlaced++;
        }

        // Wait for placement
        await sleep(BUILD_DELAY_MS);
      }
    }
  }

  logSuccess(`Wall built from (${start.x}, ${start.y}, ${start.z}) to (${end.x}, ${end.y}, ${end.z})`);
}

/**
 * Build a floor (horizontal plane)
 */
async function buildFloor(agent_id: number, task: BuildTask): Promise<void> {
  const { start, end, material } = task;
  const materialID = getMaterialID(material);

  logBuilding(`Building ${material} floor from (${start.x}, ${start.y}, ${start.z}) to (${end.x}, ${start.y}, ${end.z})`);

  const minX = Math.min(start.x, end.x);
  const maxX = Math.max(start.x, end.x);
  const minZ = Math.min(start.z, end.z);
  const maxZ = Math.max(start.z, end.z);
  const y = start.y;

  const totalBlocks = (maxX - minX + 1) * (maxZ - minZ + 1);
  logBuilding(`Total blocks to place: ${totalBlocks}`);

  let blockCount = 0;

  for (let x = minX; x <= maxX; x++) {
    for (let z = minZ; z <= maxZ; z++) {
      blockCount++;
      logBuilding(`Placing block ${blockCount}/${totalBlocks} at (${x}, ${y}, ${z})`);

      // Move to position
      await queueCommand(agent_id, 'MOVE', { x: x + 0.5, y: y, z: z });
      await sleep(BUILD_DELAY_MS);

      // Place block
      const placeResult = await queueCommand(agent_id, 'PLACE', {
        x, y, z, item_id: materialID
      });

      if (placeResult.success) {
        blocksPlaced++;
      } else {
        buildErrors++;
      }

      await sleep(BUILD_DELAY_MS);
    }
  }

  logSuccess(`Floor built from (${start.x}, ${y}, ${start.z}) to (${end.x}, ${y}, ${end.z})`);
}

/**
 * Build a pillar (vertical column)
 */
async function buildPillar(agent_id: number, task: BuildTask): Promise<void> {
  const { start, end, material } = task;
  const materialID = getMaterialID(material);

  logBuilding(`Building ${material} pillar from (${start.x}, ${start.y}, ${start.z}) to (${start.x}, ${end.y}, ${start.z})`);

  const x = start.x;
  const z = start.z;
  const minY = Math.min(start.y, end.y);
  const maxY = Math.max(start.y, end.y);

  const totalBlocks = maxY - minY + 1;
  logBuilding(`Total blocks to place: ${totalBlocks}`);

  let blockCount = 0;

  for (let y = minY; y <= maxY; y++) {
    blockCount++;
    logBuilding(`Placing block ${blockCount}/${totalBlocks} at (${x}, ${y}, ${z})`);

    // Move to position
    await queueCommand(agent_id, 'MOVE', { x: x + 0.5, y: y, z: z });
    await sleep(BUILD_DELAY_MS);

    // Place block
    const placeResult = await queueCommand(agent_id, 'PLACE', {
      x, y, z, item_id: materialID
    });

    if (placeResult.success) {
      blocksPlaced++;
    } else {
      buildErrors++;
    }

    await sleep(BUILD_DELAY_MS);
  }

  logSuccess(`Pillar built from (${x}, ${minY}, ${z}) to (${x}, ${maxY}, ${z})`);
}

/**
 * Execute a build task based on type
 */
async function executeBuildTask(agent_id: number, task: BuildTask): Promise<void> {
  switch (task.type) {
    case 'wall':
      await buildWall(agent_id, task);
      break;
    case 'floor':
      await buildFloor(agent_id, task);
      break;
    case 'pillar':
      await buildPillar(agent_id, task);
      break;
    default:
      logError(`Unknown build type: ${task.type}`);
  }
}

// ============================================================================
// Lifecycle
// ============================================================================

/**
 * Cleanup and shutdown
 */
async function cleanup(): Promise<void> {
  logShutdown('Shutting down BuilderAgent...');

  // Print statistics
  log('=== Build Session Statistics ===');
  log(`Blocks placed: ${blocksPlaced}`);
  log(`Build errors: ${buildErrors}`);

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
  log('  BuilderAgent - Automated Construction');
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
          connectionTimeout: 15000,
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

    // Step 4: Setup async response handler
    log('Step 4: Setting up async response handler...');
    setupAsyncResponseHandler();
    logSuccess('Step 4: Async handler ready');

    // Step 5: Spawn builder agent
    log(`Step 5: Spawning agent at (${SPAWN_X}, ${SPAWN_Y}, ${SPAWN_Z})...`);
    const spawnResult = await spawnAgent('BuilderBot', SPAWN_X, SPAWN_Y, SPAWN_Z);

    if (!spawnResult.success || spawnResult.agent_id === undefined) {
      throw new Error(`Failed to spawn agent: ${spawnResult.message}`);
    }

    agentId = spawnResult.agent_id;
    logSuccess(`Spawned BuilderBot with ID: ${agentId}`);

    // Check initial agent status
    const statusResult = await getAgentStatus(agentId);
    if (statusResult.success && statusResult.position) {
      log(`Agent position: (${statusResult.position.x.toFixed(1)}, ${statusResult.position.y.toFixed(1)}, ${statusResult.position.z.toFixed(1)})`);
    }

    // Step 6: Execute example build task - a simple stone wall
    log('Step 6: Executing build task...');
    await executeBuildTask(agentId, {
      type: 'wall',
      material: 'Stone',
      start: { x: 10, y: 70, z: 10 },
      end: { x: 20, y: 70, z: 10 }
    });

    // Build complete - show statistics and cleanup
    log('');
    log('=== Build Complete ===');
    log(`Total blocks placed: ${blocksPlaced}`);
    log(`Total errors: ${buildErrors}`);

    await cleanup();

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
