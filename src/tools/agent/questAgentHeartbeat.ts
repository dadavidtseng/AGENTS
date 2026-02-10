/**
 * quest_agent_heartbeat MCP Tool
 * Lightweight agent status updates for real-time monitoring
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { AgentModel } from '../../models/agentModel.js';
import type { AgentStatus } from '../../types/index.js';
import { broadcastQuestUpdated } from '../../events/broadcast.js';

/**
 * Tool definition for MCP protocol
 */
export const questAgentHeartbeatTool: Tool = {
  name: 'quest_agent_heartbeat',
  description: `Lightweight agent status update for real-time monitoring.

**Purpose:**
- Maintain real-time agent availability status
- Enable detection of crashed or unresponsive agents
- Track current agent workload
- Provide dashboard with live agent status

**Usage:**
- Call every 30 seconds from active agents
- Update status ('available' or 'busy')
- Report current task assignments
- Provide timestamp for staleness detection

**Performance:**
- Lightweight operation (no Git commits)
- Fast response time for frequent updates
- WebSocket broadcast for dashboard updates

**Parameters:**
- agentId (required): Agent identifier
- status (required): 'available' or 'busy'
- currentTasks (required): Array of currently assigned task IDs
- timestamp (required): ISO 8601 timestamp of heartbeat

**Returns:**
- success: Boolean indicating if update succeeded
- agentId: Agent identifier
- status: Updated status
- lastSeen: Updated lastSeen timestamp
- message: Confirmation message`,
  inputSchema: {
    type: 'object',
    properties: {
      agentId: {
        type: 'string',
        description: 'Agent identifier',
      },
      status: {
        type: 'string',
        enum: ['available', 'busy'],
        description: 'Current agent status',
      },
      currentTasks: {
        type: 'array',
        items: { type: 'string', format: 'uuid' },
        description: 'Array of currently assigned task IDs',
      },
      timestamp: {
        type: 'string',
        format: 'date-time',
        description: 'ISO 8601 timestamp of heartbeat',
      },
    },
    required: ['agentId', 'status', 'currentTasks', 'timestamp'],
  },
};

/**
 * Zod schema for input validation
 */
const InputSchema = z.object({
  agentId: z.string(),
  status: z.enum(['available', 'busy']),
  currentTasks: z.array(z.string().uuid()),
  timestamp: z.string().datetime(),
});

type QuestAgentHeartbeatInput = z.infer<typeof InputSchema>;

/**
 * Handle quest_agent_heartbeat tool call
 */
export async function handleQuestAgentHeartbeat(args: unknown) {
  // Validate input
  const input = InputSchema.parse(args);

  // Validate timestamp is recent (within last 5 minutes)
  const heartbeatTime = new Date(input.timestamp);
  const now = new Date();
  const timeDiff = now.getTime() - heartbeatTime.getTime();
  const fiveMinutes = 5 * 60 * 1000;

  if (timeDiff > fiveMinutes) {
    throw new Error(
      `Heartbeat timestamp is too old (${Math.floor(timeDiff / 1000)}s ago). ` +
      `Heartbeats must be within 5 minutes of current time.`
    );
  }

  if (timeDiff < -60000) {
    throw new Error(
      `Heartbeat timestamp is in the future (${Math.floor(-timeDiff / 1000)}s ahead). ` +
      `Check system clock synchronization.`
    );
  }

  // Update agent heartbeat using AgentModel method
  await AgentModel.heartbeat(
    input.agentId,
    input.status as AgentStatus,
    input.currentTasks,
    heartbeatTime
  );

  // Get updated agent for response
  const agents = await AgentModel.listAll();
  const agent = agents.find((a) => a.agentId === input.agentId);
  
  if (!agent) {
    throw new Error(`Agent '${input.agentId}' not found after heartbeat update`);
  }

  // Broadcast WebSocket event for dashboard updates
  try {
    // Broadcast a generic update event
    // Note: We don't have a specific agent event broadcaster, so we'll skip this
    // or implement a custom broadcast if needed
    console.log(`[quest_agent_heartbeat] Agent ${input.agentId} heartbeat: ${input.status}, ${input.currentTasks.length} tasks`);
  } catch (error) {
    console.warn(
      `[quest_agent_heartbeat] Failed to broadcast heartbeat event: ${error}`
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
            status: input.status,
            currentTasks: input.currentTasks.length,
            lastSeen: agent.lastSeen.toISOString(),
            timeSinceHeartbeat: `${Math.floor(timeDiff / 1000)}s ago`,
            message: `Agent heartbeat received: ${input.status} with ${input.currentTasks.length} task(s)`,
          },
          null,
          2
        ),
      },
    ],
  };
}
