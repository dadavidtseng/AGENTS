/**
 * quest_list_agents MCP Tool
 * Lists registered agents with optional filtering
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { AgentModel } from '../../models/agentModel.js';
import type { AgentStatus, AgentRole } from '../../types';

/**
 * Tool definition for MCP protocol
 */
export const questListAgentsTool: Tool = {
  name: 'quest_list_agents',
  description: 'List ALL registered agents in the system. Returns complete agent information including status (available/busy/offline), role, capabilities, and current task assignments. By default, shows ALL agents regardless of status or role. Optional filters can narrow results if needed, but calling without any parameters is the recommended way to see the complete agent roster.',
  inputSchema: {
    type: 'object',
    properties: {
      status: {
        type: 'string',
        enum: ['available', 'busy', 'offline'],
        description: 'OPTIONAL filter by agent status. Leave empty to see all agents.',
      },
      role: {
        type: 'string',
        enum: ['artist', 'designer', 'programmer'],
        description: 'OPTIONAL filter by agent role. Leave empty to see all roles.',
      },
    },
    additionalProperties: false,
  },
};

/**
 * Input parameters for quest_list_agents tool
 */
interface QuestListAgentsInput {
  status?: AgentStatus;
  role?: AgentRole;
}

/**
 * Handle quest_list_agents tool call
 */
export async function handleQuestListAgents(args: unknown) {
  const input = (args as QuestListAgentsInput) || {};
  
  // Validate status if provided
  if (input.status) {
    const validStatuses: AgentStatus[] = ['available', 'busy', 'offline'];
    if (!validStatuses.includes(input.status)) {
      throw new Error(`status must be one of: ${validStatuses.join(', ')}`);
    }
  }
  
  // Validate role if provided
  if (input.role) {
    const validRoles: AgentRole[] = ['artist', 'designer', 'programmer'];
    if (!validRoles.includes(input.role)) {
      throw new Error(`role must be one of: ${validRoles.join(', ')}`);
    }
  }
  
  // Mark offline agents (5 minute timeout)
  await AgentModel.markOfflineAgents(5);
  
  // List agents with filters
  const agents = await AgentModel.listAll({
    status: input.status,
    role: input.role,
  });
  
  // If filtered results are empty and filters were provided, get all agents as fallback
  let allAgents = agents;
  let usedFallback = false;
  
  if (agents.length === 0 && (input.status || input.role)) {
    allAgents = await AgentModel.listAll({});
    usedFallback = true;
  }
  
  // Convert to response format with Date serialization
  const agentList = allAgents.map((agent) => ({
    agentId: agent.agentId,
    name: agent.name,
    role: agent.role,
    status: agent.status,
    currentTasks: agent.currentTasks,
    capabilities: agent.capabilities,
    maxConcurrentTasks: agent.maxConcurrentTasks,
    lastSeen: typeof agent.lastSeen === 'string' 
      ? agent.lastSeen 
      : agent.lastSeen.toISOString(),
  }));
  
  const response: any = {
    agents: agentList,
    total: agentList.length,
    filters: {
      status: input.status || 'all',
      role: input.role || 'all',
    },
  };
  
  // Add fallback notice if we had to retrieve all agents
  if (usedFallback) {
    response.notice = `No agents found matching filters (status: ${input.status || 'any'}, role: ${input.role || 'any'}). Showing all ${agentList.length} registered agents instead.`;
  }
  
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(response, null, 2),
      },
    ],
  };
}
