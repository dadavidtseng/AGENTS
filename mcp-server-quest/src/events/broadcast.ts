/**
 * Event broadcasting utilities for real-time updates.
 *
 * Broadcast functions are called by models and tools whenever quest/task/agent
 * state changes. The actual delivery mechanism is pluggable via
 * `setBroadcastHandler`. When no handler is registered the calls are silent
 * no-ops, which keeps the MCP-only server path lightweight.
 *
 * Previously these lived in `dashboard/events.ts` and were tightly coupled to
 * the Fastify WebSocket server. That server has been removed in favour of the
 * standalone mcp-client-quest dashboard.
 */

import type { Quest, Agent, ApprovalDecision, QuestStatus, TaskStatus, AgentStatus } from '../types/index.js';

// ---------------------------------------------------------------------------
// Event payload interfaces
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Pluggable broadcast handler
// ---------------------------------------------------------------------------

/** Signature for the low-level broadcast function. */
export type BroadcastHandler = (eventName: string, data: unknown) => void;

let _handler: BroadcastHandler | null = null;

/**
 * Register a broadcast handler (e.g. a WebSocket broadcaster).
 * Pass `null` to unregister.
 */
export function setBroadcastHandler(handler: BroadcastHandler | null): void {
  _handler = handler;
}

/**
 * Safe broadcast wrapper — delegates to the registered handler.
 * If no handler is set the call is a silent no-op.
 */
function safeBroadcast(eventName: string, data: unknown): void {
  if (!_handler) return;
  try {
    _handler(eventName, data);
  } catch (error) {
    console.warn(
      `[Events] Failed to broadcast ${eventName}:`,
      error instanceof Error ? error.message : 'Unknown error',
    );
  }
}

// ---------------------------------------------------------------------------
// Typed broadcast helpers
// ---------------------------------------------------------------------------

export function broadcastQuestCreated(quest: Quest): void {
  const payload: QuestCreatedEvent = {
    questId: quest.questId,
    questName: quest.questName,
    status: quest.status,
  };
  safeBroadcast('quest_created', payload);
}

export function broadcastQuestUpdated(questId: string, status: QuestStatus): void {
  const payload: QuestUpdatedEvent = {
    questId,
    status,
    updatedAt: new Date().toISOString(),
  };
  safeBroadcast('quest_updated', payload);
}

export function broadcastApprovalRequested(questId: string, questName: string): void {
  const payload: ApprovalRequestedEvent = {
    questId,
    questName,
  };
  safeBroadcast('approval_requested', payload);
}

export function broadcastApprovalDecision(questId: string, decision: ApprovalDecision): void {
  const payload: ApprovalDecisionEvent = {
    questId,
    decision: decision.decision,
    approvedBy: decision.approvedBy,
  };
  safeBroadcast('approval_decision', payload);
}

export function broadcastTaskAssigned(taskId: string, taskName: string, agentId: string): void {
  const payload: TaskAssignedEvent = {
    taskId,
    taskName,
    assignedTo: agentId,
  };
  safeBroadcast('task_assigned', payload);
}

export function broadcastTaskStatusChanged(taskId: string, status: TaskStatus): void {
  const payload: TaskStatusChangedEvent = {
    taskId,
    status,
    updatedAt: new Date().toISOString(),
  };
  safeBroadcast('task_status_changed', payload);
}

export function broadcastAgentRegistered(agent: Agent): void {
  const payload: AgentRegisteredEvent = {
    agentId: agent.agentId,
    name: agent.name,
    role: agent.role,
  };
  safeBroadcast('agent_registered', payload);
}

export function broadcastAgentStatusChanged(agentId: string, status: AgentStatus): void {
  const payload: AgentStatusChangedEvent = {
    agentId,
    status,
  };
  safeBroadcast('agent_status_changed', payload);
}
