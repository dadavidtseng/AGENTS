/**
 * quest_register_agent MCP Tool
 * Registers worker agents with capabilities for task assignment
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { AgentModel } from '../../models/agentModel.js';
import type { Agent, AgentRole } from '../../types';

/**
 * Tool definition for MCP protocol
 */
export const questRegisterAgentTool: Tool = {
  name: 'quest_register_agent',
  description: 'Register agent with capabilities for task assignment',
  inputSchema: {
    type: 'object',
    properties: {
      agentId: {
        type: 'string',
        description: 'Unique agent identifier',
      },
      name: {
        type: 'string',
        description: 'Agent name',
      },
      role: {
        type: 'string',
        enum: ['artist', 'designer', 'programmer'],
        description: 'Agent role for capability matching',
      },
      capabilities: {
        type: 'array',
        description: 'Agent capabilities (e.g., ["TypeScript", "React", "Node.js"])',
        items: {
          type: 'string',
        },
        minItems: 1,
      },
      maxConcurrentTasks: {
        type: 'number',
        description: 'Maximum concurrent tasks this agent can handle',
        default: 3,
        minimum: 1,
      },
    },
    required: ['agentId', 'name', 'role', 'capabilities'],
  },
};

/**
 * Input parameters for quest_register_agent tool
 */
interface QuestRegisterAgentInput {
  agentId: string;
  name: string;
  role: AgentRole;
  capabilities: string[];
  maxConcurrentTasks?: number;
}

/**
 * Handle quest_register_agent tool call
 */
export async function handleQuestRegisterAgent(args: unknown) {
  // Validate input
  const input = args as QuestRegisterAgentInput;
  
  if (!input.agentId) {
    throw new Error('agentId is required');
  }
  
  if (typeof input.agentId !== 'string' || input.agentId.trim().length === 0) {
    throw new Error('agentId must be a non-empty string');
  }
  
  if (!input.name) {
    throw new Error('name is required');
  }
  
  if (typeof input.name !== 'string' || input.name.trim().length === 0) {
    throw new Error('name must be a non-empty string');
  }
  
  if (!input.role) {
    throw new Error('role is required');
  }
  
  const validRoles: AgentRole[] = ['artist', 'designer', 'programmer'];
  if (!validRoles.includes(input.role)) {
    throw new Error(`role must be one of: ${validRoles.join(', ')}`);
  }
  
  if (!input.capabilities) {
    throw new Error('capabilities is required');
  }
  
  if (!Array.isArray(input.capabilities)) {
    throw new Error('capabilities must be an array');
  }
  
  if (input.capabilities.length === 0) {
    throw new Error('capabilities must contain at least one item');
  }
  
  // Validate each capability is a non-empty string
  for (let i = 0; i < input.capabilities.length; i++) {
    if (typeof input.capabilities[i] !== 'string' || input.capabilities[i].trim().length === 0) {
      throw new Error(`capabilities[${i}] must be a non-empty string`);
    }
  }
  
  // Validate maxConcurrentTasks if provided
  const maxConcurrentTasks = input.maxConcurrentTasks !== undefined ? input.maxConcurrentTasks : 3;
  if (typeof maxConcurrentTasks !== 'number') {
    throw new Error('maxConcurrentTasks must be a number');
  }
  if (maxConcurrentTasks < 1) {
    throw new Error('maxConcurrentTasks must be at least 1');
  }
  
  // Check if agent already exists to determine if this is new or update
  const existingAgents = await AgentModel.listAll();
  const existingAgent = existingAgents.find((a) => a.agentId === input.agentId);
  const isNewAgent = !existingAgent;
  
  // Create agent object
  const agent: Agent = {
    agentId: input.agentId,
    name: input.name,
    role: input.role,
    capabilities: input.capabilities,
    status: 'available', // Will be set by AgentModel.register()
    currentTasks: existingAgent?.currentTasks || [], // Preserve existing tasks
    maxConcurrentTasks,
    lastSeen: new Date(), // Will be updated by AgentModel.register()
  };
  
  // Register agent (upsert pattern)
  await AgentModel.register(agent);
  
  // Return success
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            success: true,
            agentId: input.agentId,
            registered: isNewAgent,
            message: isNewAgent
              ? `Agent '${input.name}' registered successfully`
              : `Agent '${input.name}' updated successfully`,
          },
          null,
          2
        ),
      },
    ],
  };
}
