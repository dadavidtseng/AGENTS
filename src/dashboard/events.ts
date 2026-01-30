/**
 * WebSocket event broadcasting utilities
 * Provides type-safe event helpers for real-time dashboard updates
 */

import type { Quest, Agent, ApprovalDecision, QuestStatus, TaskStatus, AgentStatus } from '../types/index.js';

/**
 * Event payload interfaces
 */
export interface QuestCreatedEvent {
  questId: string;
  questName: string;
  status: QuestStatus;
}

export interface QuestUpdatedEvent {
  questId: string;
  status: QuestStatus;
  updatedAt: string;
}

export interface ApprovalRequestedEvent {
  questId: string;
  questName: string;
}

export interface ApprovalDecisionEvent {
  questId: string;
  decision: string;
  approvedBy: string;
}

export interface TaskAssignedEvent {
  taskId: string;
  taskName: string;
  assignedTo: string;
}

export interface TaskStatusChangedEvent {
  taskId: string;
  status: TaskStatus;
  updatedAt: string;
}

export interface AgentRegisteredEvent {
  agentId: string;
  name: string;
  role: string;
}

export interface AgentStatusChangedEvent {
  agentId: string;
  status: AgentStatus;
}

/**
 * Get dashboard server instance for broadcasting
 * Uses dynamic import to avoid circular dependencies
 */
async function getDashboardServer() {
  try {
    const { dashboardServer } = await import('./server.js');
    return dashboardServer;
  } catch (error) {
    console.warn('[Events] Dashboard server not available:', error instanceof Error ? error.message : 'Unknown error');
    return null;
  }
}

/**
 * Safe broadcast wrapper - handles errors gracefully
 */
async function safeBroadcast(eventName: string, data: any): Promise<void> {
  try {
    const server = await getDashboardServer();
    if (server) {
      server.broadcast(eventName, data);
    }
  } catch (error) {
    // Log but don't throw - broadcasting failures shouldn't block operations
    console.warn(`[Events] Failed to broadcast ${eventName}:`, error instanceof Error ? error.message : 'Unknown error');
  }
}

/**
 * Broadcast quest created event
 * @param quest - The newly created quest
 */
export async function broadcastQuestCreated(quest: Quest): Promise<void> {
  const payload: QuestCreatedEvent = {
    questId: quest.questId,
    questName: quest.questName,
    status: quest.status,
  };
  await safeBroadcast('quest_created', payload);
}

/**
 * Broadcast quest updated event
 * @param questId - Quest identifier
 * @param status - New quest status
 */
export async function broadcastQuestUpdated(questId: string, status: QuestStatus): Promise<void> {
  const payload: QuestUpdatedEvent = {
    questId,
    status,
    updatedAt: new Date().toISOString(),
  };
  await safeBroadcast('quest_updated', payload);
}

/**
 * Broadcast approval requested event
 * @param questId - Quest identifier
 * @param questName - Quest name
 */
export async function broadcastApprovalRequested(questId: string, questName: string): Promise<void> {
  const payload: ApprovalRequestedEvent = {
    questId,
    questName,
  };
  await safeBroadcast('approval_requested', payload);
}

/**
 * Broadcast approval decision event
 * @param questId - Quest identifier
 * @param decision - Approval decision object
 */
export async function broadcastApprovalDecision(questId: string, decision: ApprovalDecision): Promise<void> {
  const payload: ApprovalDecisionEvent = {
    questId,
    decision: decision.decision,
    approvedBy: decision.approvedBy,
  };
  await safeBroadcast('approval_decision', payload);
}

/**
 * Broadcast task assigned event
 * @param taskId - Task identifier
 * @param taskName - Task name
 * @param agentId - Agent identifier
 */
export async function broadcastTaskAssigned(taskId: string, taskName: string, agentId: string): Promise<void> {
  const payload: TaskAssignedEvent = {
    taskId,
    taskName,
    assignedTo: agentId,
  };
  await safeBroadcast('task_assigned', payload);
}

/**
 * Broadcast task status changed event
 * @param taskId - Task identifier
 * @param status - New task status
 */
export async function broadcastTaskStatusChanged(taskId: string, status: TaskStatus): Promise<void> {
  const payload: TaskStatusChangedEvent = {
    taskId,
    status,
    updatedAt: new Date().toISOString(),
  };
  await safeBroadcast('task_status_changed', payload);
}

/**
 * Broadcast agent registered event
 * @param agent - The newly registered agent
 */
export async function broadcastAgentRegistered(agent: Agent): Promise<void> {
  const payload: AgentRegisteredEvent = {
    agentId: agent.agentId,
    name: agent.name,
    role: agent.role,
  };
  await safeBroadcast('agent_registered', payload);
}

/**
 * Broadcast agent status changed event
 * @param agentId - Agent identifier
 * @param status - New agent status
 */
export async function broadcastAgentStatusChanged(agentId: string, status: AgentStatus): Promise<void> {
  const payload: AgentStatusChangedEvent = {
    agentId,
    status,
  };
  await safeBroadcast('agent_status_changed', payload);
}
