/**
 * quest_unregister_agent MCP Tool
 * Graceful agent shutdown and cleanup
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { AgentModel } from '../../models/agentModel.js';
import { commitQuestChanges } from '../../utils/git.js';
import { config } from '../../utils/config.js';

/**
 * Tool definition for MCP protocol
 */
export const questUnregisterAgentTool: Tool = {
  name: 'quest_unregister_agent',
  description: `Gracefully unregister agent on shutdown for clean state management.

**Purpose:**
- Enable graceful agent shutdown notification
- Clean up agent state and task assignments
- Record shutdown reason for audit trail
- Maintain accurate agent availability status

**Usage:**
- Call when agent is shutting down (normal or error)
- Provide optional reason for shutdown
- Agent status set to 'offline'
- Current tasks cleared for reassignment

**Parameters:**
- agentId (required): Agent identifier
- reason (optional): Shutdown reason (e.g., "normal shutdown", "error", "restart")

**Returns:**
- success: Boolean indicating if unregistration succeeded
- agentId: Agent identifier
- status: Updated status ('offline')
- clearedTasks: Number of tasks cleared
- message: Confirmation message`,
  inputSchema: {
    type: 'object',
    properties: {
      agentId: {
        type: 'string',
        description: 'Agent identifier',
      },
      reason: {
        type: 'string',
        description: 'Shutdown reason (optional)',
      },
    },
    required: ['agentId'],
  },
};

/**
 * Zod schema for input validation
 */
const InputSchema = z.object({
  agentId: z.string(),
  reason: z.string().optional(),
});

type QuestUnregisterAgentInput = z.infer<typeof InputSchema>;

/**
 * Handle quest_unregister_agent tool call
 */
export async function handleQuestUnregisterAgent(args: unknown) {
  // Validate input
  const input = InputSchema.parse(args);

  // Load all agents
  const agents = await AgentModel.listAll();
  
  // Find the agent
  const agent = agents.find((a) => a.agentId === input.agentId);
  if (!agent) {
    throw new Error(
      `Agent '${input.agentId}' not found. ` +
      `Agent may have already been unregistered or never registered.`
    );
  }

  // Record current state for response
  const clearedTasksCount = agent.currentTasks.length;
  const previousStatus = agent.status;

  // Update agent to offline status
  await AgentModel.updateStatus(input.agentId, 'offline');

  // Clear current tasks (reload agent after status update)
  const updatedAgents = await AgentModel.listAll();
  const updatedAgent = updatedAgents.find((a) => a.agentId === input.agentId);
  
  if (updatedAgent) {
    updatedAgent.currentTasks = [];
    // Save through heartbeat method with offline status
    await AgentModel.heartbeat(
      input.agentId,
      'offline',
      [],
      new Date()
    );
  }

  // Commit to Git
  const commitMessage = `chore: unregister agent ${input.agentId}`;
  const commitBody = [
    `Agent: ${agent.name}`,
    `Previous Status: ${previousStatus}`,
    `Cleared Tasks: ${clearedTasksCount}`,
  ];
  if (input.reason) {
    commitBody.push(`Reason: ${input.reason}`);
  }

  try {
    await commitQuestChanges(
      config.questDataDir,
      commitMessage,
      commitBody.join('\n')
    );
  } catch (error) {
    console.warn(
      `[quest_unregister_agent] Failed to commit unregistration to Git: ${error}. ` +
      `Agent was unregistered successfully.`
    );
  }

  // Return success
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            success: true,
            agentId: input.agentId,
            agentName: agent.name,
            status: 'offline',
            previousStatus,
            clearedTasks: clearedTasksCount,
            reason: input.reason || 'No reason provided',
            timestamp: new Date().toISOString(),
            message: `Agent '${agent.name}' (${input.agentId}) unregistered successfully. ${clearedTasksCount} task(s) cleared.`,
          },
          null,
          2
        ),
      },
    ],
  };
}
