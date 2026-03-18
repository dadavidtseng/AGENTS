/**
 * quest_list_agents MCP Tool
 * Lists ALL registered agents — no filters, no ambiguity
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { AgentModel } from '../../models/agentModel.js';

/**
 * Tool definition for MCP protocol
 *
 * No filter parameters — always returns the complete agent roster.
 * This prevents LLMs from accidentally filtering out agents.
 */
export const questListAgentsTool: Tool = {
  name: 'quest_list_agents',
  description:
    'List ALL registered agents in the system. Always returns every agent regardless of status or role. Use this to discover the full agent roster before planning or assigning tasks. No parameters needed.',
  inputSchema: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
};

/**
 * Handle quest_list_agents tool call
 *
 * Always returns all agents — the LLM can reason about
 * status/role in its own context after seeing the full list.
 */
export async function handleQuestListAgents(_args: unknown) {
  // Mark offline agents (5 minute timeout)
  await AgentModel.markOfflineAgents(5);

  // Always list ALL agents — no filters
  const agents = await AgentModel.listAll({});

  // Convert to response format with Date serialization
  const agentList = agents.map((agent) => ({
    agentId: agent.agentId,
    name: agent.name,
    role: agent.role,
    status: agent.status,
    currentTasks: agent.currentTasks,
    capabilities: agent.capabilities,
    maxConcurrentTasks: agent.maxConcurrentTasks,
    lastSeen:
      typeof agent.lastSeen === 'string'
        ? agent.lastSeen
        : agent.lastSeen.toISOString(),
  }));

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            agents: agentList,
            total: agentList.length,
          },
          null,
          2
        ),
      },
    ],
  };
}
