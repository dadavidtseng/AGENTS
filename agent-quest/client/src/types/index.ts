/**
 * TypeScript type definitions for dashboard
 */

export type QuestStatus =
  | 'draft'
  | 'pending_approval'
  | 'approved'
  | 'rejected'
  | 'in_progress'
  | 'completed'
  | 'cancelled';

export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'pending_approval';

export type AgentRole = 'artist' | 'designer' | 'programmer';

export type AgentStatus = 'available' | 'busy' | 'offline';

export interface Quest {
  questId: string;
  questName: string;
  description: string;
  status: QuestStatus;
  requirements: string;
  design: string;
  /** Full task array — available in detail response, absent in list response */
  tasks?: Task[];
  /** Task count summary — available in list response */
  taskCount?: number;
  /** Approval count summary — available in list response */
  approvalCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface Task {
  id: string;
  questId: string;
  name: string;
  description: string;
  status: TaskStatus;
  assignedAgent?: string;
  role?: string;
  dependencies: string[];
  startedAt?: string;
  completedAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

/** Flattened task with parent quest context for backlog view. */
export interface BacklogTask extends Task {
  questName: string;
}

export interface Agent {
  agentId: string;
  name: string;
  role: AgentRole;
  capabilities: string[];
  status: AgentStatus;
  currentTasks: string[];
  maxConcurrentTasks: number;
  lastSeen: string;
}
