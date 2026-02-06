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

export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

export type AgentRole = 'artist' | 'designer' | 'programmer';

export type AgentStatus = 'available' | 'busy' | 'offline';

export interface Quest {
  questId: string;
  questName: string;
  description: string;
  status: QuestStatus;
  requirements: string;
  design: string;
  tasks: Task[];
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
  dependencies: string[];
  startedAt?: string;
  completedAt?: string;
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
