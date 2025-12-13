/**
 * SimpleMiner Tool Integration
 *
 * Provides access to SimpleMiner game engine tools via KADI broker.
 * These tools allow spawning AI agents in the game world and controlling them.
 *
 * Available SimpleMiner tools (exposed via kadi-local):
 * - simpleminer_spawn_agent: Spawn a new AI agent at specified position
 * - simpleminer_queue_command: Queue a command for an agent (MOVE, MINE, PLACE, CRAFT, WAIT)
 * - simpleminer_get_nearby_blocks: Query blocks near an agent
 * - simpleminer_get_agent_inventory: Get agent's inventory contents
 * - simpleminer_get_agent_status: Get agent position, current command, queue size
 * - simpleminer_list_agents: List all active agents in the world
 * - simpleminer_despawn_agent: Remove an agent from the world
 */

import type { KadiClient } from '@kadi.build/core';
import { z } from 'zod';

// ============================================================================
// Types
// ============================================================================

/**
 * Simple tool invocation result (matches ShrimpToolResult pattern)
 */
interface ToolResult {
  success: boolean;
  data?: any;
  error?: {
    type: 'transient' | 'permanent';
    message: string;
  };
}

// ============================================================================
// Schemas
// ============================================================================

// Spawn Agent
export const spawnAgentInputSchema = z.object({
  name: z.string().describe('Agent name (e.g., "MinerBot", "BuilderBot")'),
  x: z.number().describe('X world coordinate'),
  y: z.number().describe('Y world coordinate'),
  z: z.number().describe('Z world coordinate')
});

export const spawnAgentOutputSchema = z.object({
  success: z.boolean(),
  agent_id: z.number().optional(),
  message: z.string()
});

// List Agents
export const listAgentsInputSchema = z.object({});

export const listAgentsOutputSchema = z.object({
  success: z.boolean(),
  agents: z.array(z.object({
    id: z.number(),
    name: z.string(),
    position: z.object({
      x: z.number(),
      y: z.number(),
      z: z.number()
    })
  })).optional(),
  message: z.string()
});

// Queue Command
export const queueCommandInputSchema = z.object({
  agent_id: z.number().describe('Agent ID'),
  command_type: z.enum(['MOVE', 'MINE', 'PLACE', 'CRAFT', 'WAIT']).describe('Command type'),
  params: z.record(z.string(), z.any()).describe('Command-specific parameters')
});

export const queueCommandOutputSchema = z.object({
  success: z.boolean(),
  message: z.string()
});

// Get Agent Status
export const getAgentStatusInputSchema = z.object({
  agent_id: z.number().describe('Agent ID')
});

export const getAgentStatusOutputSchema = z.object({
  success: z.boolean(),
  status: z.object({
    position: z.object({
      x: z.number(),
      y: z.number(),
      z: z.number()
    }),
    current_command: z.string().optional(),
    queue_size: z.number()
  }).optional(),
  message: z.string()
});

export type SpawnAgentInput = z.infer<typeof spawnAgentInputSchema>;
export type ListAgentsInput = z.infer<typeof listAgentsInputSchema>;
export type QueueCommandInput = z.infer<typeof queueCommandInputSchema>;
export type GetAgentStatusInput = z.infer<typeof getAgentStatusInputSchema>;

// ============================================================================
// Helper: Invoke SimpleMiner Tool via KADI
// ============================================================================

/**
 * Invoke a SimpleMiner tool via KADI broker protocol
 *
 * Uses the same pattern as invokeShrimTool but targets SimpleMiner agent.
 */
async function invokeSimpleMinerTool(
  protocol: any,
  toolName: string,
  params: any,
  timeout: number = 30000
): Promise<ToolResult> {
  // Target agent that provides SimpleMiner tools (registered via kadi-local)
  const targetAgent = 'SimpleMiner Agent';

  try {
    console.log(`🎮 [SimpleMiner] Invoking: ${toolName}`);
    console.log(`   Target: ${targetAgent}`);
    console.log(`   Params: ${JSON.stringify(params).substring(0, 100)}...`);

    // Invoke tool via KADI protocol
    const response = await protocol.invokeTool({
      targetAgent,
      toolName,
      toolInput: params,
      timeout
    });

    console.log(`   ✅ Response received`);

    // Parse response
    const statusCode = response?.status || response?.statusCode || 200;

    if (statusCode >= 200 && statusCode < 300) {
      return {
        success: true,
        data: response?.data || response
      };
    } else {
      return {
        success: false,
        error: {
          type: statusCode >= 500 ? 'transient' : 'permanent',
          message: response?.error || response?.message || `Error: ${statusCode}`
        }
      };
    }

  } catch (error: any) {
    console.error(`   ❌ Error: ${error.message}`);
    return {
      success: false,
      error: {
        type: 'transient',
        message: error.message || String(error)
      }
    };
  }
}

// ============================================================================
// Tool Handlers
// ============================================================================

/**
 * Create spawn agent handler
 */
export function createSpawnAgentHandler(client: KadiClient) {
  return async (params: SpawnAgentInput) => {
    console.log(`🤖 [simpleminer_spawn_agent] Spawning "${params.name}" at (${params.x}, ${params.y}, ${params.z})`);

    const protocol = client.getBrokerProtocol();
    const result = await invokeSimpleMinerTool(protocol, 'simpleminer_spawn_agent', params);

    if (result.success) {
      const agentId = result.data?.content?.[0]?.text
        ? JSON.parse(result.data.content[0].text).agent_id
        : result.data?.agent_id;

      return {
        success: true,
        agent_id: agentId,
        message: `Agent "${params.name}" spawned successfully with ID: ${agentId}`
      };
    } else {
      return {
        success: false,
        message: `Failed to spawn agent: ${result.error?.message}`
      };
    }
  };
}

/**
 * Create list agents handler
 */
export function createListAgentsHandler(client: KadiClient) {
  return async (_params: ListAgentsInput) => {
    console.log(`📋 [simpleminer_list_agents] Listing all agents`);

    const protocol = client.getBrokerProtocol();
    const result = await invokeSimpleMinerTool(protocol, 'simpleminer_list_agents', {});

    if (result.success) {
      // Parse MCP response format
      let agents = [];
      try {
        const textContent = result.data?.content?.[0]?.text;
        if (textContent) {
          const parsed = JSON.parse(textContent);
          agents = parsed.agents || [];
        }
      } catch (e) {
        agents = result.data?.agents || [];
      }

      return {
        success: true,
        agents,
        message: `Found ${agents.length} agent(s) in the world`
      };
    } else {
      return {
        success: false,
        agents: [],
        message: `Failed to list agents: ${result.error?.message}`
      };
    }
  };
}

/**
 * Create queue command handler
 */
export function createQueueCommandHandler(client: KadiClient) {
  return async (params: QueueCommandInput) => {
    console.log(`🎯 [simpleminer_queue_command] Queueing ${params.command_type} for agent ${params.agent_id}`);

    const protocol = client.getBrokerProtocol();
    const result = await invokeSimpleMinerTool(protocol, 'simpleminer_queue_command', params);

    if (result.success) {
      return {
        success: true,
        message: `Command ${params.command_type} queued for agent ${params.agent_id}`
      };
    } else {
      return {
        success: false,
        message: `Failed to queue command: ${result.error?.message}`
      };
    }
  };
}

/**
 * Create get agent status handler
 */
export function createGetAgentStatusHandler(client: KadiClient) {
  return async (params: GetAgentStatusInput) => {
    console.log(`📊 [simpleminer_get_agent_status] Getting status for agent ${params.agent_id}`);

    const protocol = client.getBrokerProtocol();
    const result = await invokeSimpleMinerTool(protocol, 'simpleminer_get_agent_status', params);

    if (result.success) {
      // Parse MCP response format
      let status = null;
      try {
        const textContent = result.data?.content?.[0]?.text;
        if (textContent) {
          status = JSON.parse(textContent);
        }
      } catch (e) {
        status = result.data;
      }

      return {
        success: true,
        status,
        message: `Agent ${params.agent_id} status retrieved`
      };
    } else {
      return {
        success: false,
        message: `Failed to get agent status: ${result.error?.message}`
      };
    }
  };
}

// ============================================================================
// Tool Registration
// ============================================================================

/**
 * Register SimpleMiner tools with KADI client
 *
 * This exposes SimpleMiner tools through agent-producer, allowing
 * Discord bot and other consumers to interact with the game world.
 */
export function registerSimpleMinerTools(client: KadiClient): void {
  console.log('🎮 Registering SimpleMiner tools...');

  // 1. Spawn Agent
  client.registerTool(
    {
      name: 'sm_spawn_agent',
      description: 'Spawn a new AI agent in SimpleMiner game world at specified coordinates',
      input: spawnAgentInputSchema,
      output: spawnAgentOutputSchema
    },
    createSpawnAgentHandler(client)
  );

  // 2. List Agents
  client.registerTool(
    {
      name: 'sm_list_agents',
      description: 'List all active AI agents currently in the SimpleMiner game world',
      input: listAgentsInputSchema,
      output: listAgentsOutputSchema
    },
    createListAgentsHandler(client)
  );

  // 3. Queue Command
  client.registerTool(
    {
      name: 'sm_queue_command',
      description: 'Queue a command for an agent (MOVE, MINE, PLACE, CRAFT, WAIT)',
      input: queueCommandInputSchema,
      output: queueCommandOutputSchema
    },
    createQueueCommandHandler(client)
  );

  // 4. Get Agent Status
  client.registerTool(
    {
      name: 'sm_agent_status',
      description: 'Get current status of an agent including position and command queue',
      input: getAgentStatusInputSchema,
      output: getAgentStatusOutputSchema
    },
    createGetAgentStatusHandler(client)
  );

  console.log('✅ SimpleMiner tools registered: sm_spawn_agent, sm_list_agents, sm_queue_command, sm_agent_status');
}
