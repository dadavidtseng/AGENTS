/**
 * Mock Data Generators
 * 
 * Utilities for generating test data for quests, tasks, agents, and approvals.
 */

import { randomUUID } from 'crypto';

// ============================================================================
// Quest Mock Data
// ============================================================================

export interface MockQuest {
  id: string;
  name: string;
  description: string;
  status: 'draft' | 'active' | 'completed' | 'cancelled';
  createdAt: string;
  updatedAt: string;
}

export function createMockQuest(overrides?: Partial<MockQuest>): MockQuest {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    name: 'Test Quest',
    description: 'A test quest for unit testing',
    status: 'draft',
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

// ============================================================================
// Task Mock Data
// ============================================================================

export interface MockTask {
  id: string;
  questId: string;
  name: string;
  description: string;
  status: 'pending' | 'assigned' | 'in_progress' | 'pending_approval' | 'completed' | 'failed';
  assignedTo?: string;
  dependencies: string[];
  createdAt: string;
  updatedAt: string;
}

export function createMockTask(overrides?: Partial<MockTask>): MockTask {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    questId: randomUUID(),
    name: 'Test Task',
    description: 'A test task for unit testing',
    status: 'pending',
    dependencies: [],
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

// ============================================================================
// Agent Mock Data
// ============================================================================

export interface MockAgent {
  id: string;
  name: string;
  type: 'human' | 'ai' | 'system';
  status: 'online' | 'offline' | 'busy';
  capabilities: string[];
  createdAt: string;
}

export function createMockAgent(overrides?: Partial<MockAgent>): MockAgent {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    name: 'Test Agent',
    type: 'ai',
    status: 'online',
    capabilities: ['coding', 'testing'],
    createdAt: now,
    ...overrides
  };
}

// ============================================================================
// Approval Mock Data
// ============================================================================

export interface MockApproval {
  id: string;
  questId: string;
  type: 'requirements' | 'design' | 'implementation';
  status: 'pending' | 'approved' | 'rejected';
  requestedBy: string;
  requestedAt: string;
  respondedBy?: string;
  respondedAt?: string;
  comments?: string;
}

export function createMockApproval(overrides?: Partial<MockApproval>): MockApproval {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    questId: randomUUID(),
    type: 'requirements',
    status: 'pending',
    requestedBy: 'test-agent',
    requestedAt: now,
    ...overrides
  };
}

// ============================================================================
// Batch Generators
// ============================================================================

/**
 * Generate multiple mock quests
 */
export function createMockQuests(count: number, overrides?: Partial<MockQuest>): MockQuest[] {
  return Array.from({ length: count }, () => createMockQuest(overrides));
}

/**
 * Generate multiple mock tasks
 */
export function createMockTasks(count: number, overrides?: Partial<MockTask>): MockTask[] {
  return Array.from({ length: count }, () => createMockTask(overrides));
}

/**
 * Generate multiple mock agents
 */
export function createMockAgents(count: number, overrides?: Partial<MockAgent>): MockAgent[] {
  return Array.from({ length: count }, () => createMockAgent(overrides));
}

/**
 * Generate multiple mock approvals
 */
export function createMockApprovals(count: number, overrides?: Partial<MockApproval>): MockApproval[] {
  return Array.from({ length: count }, () => createMockApproval(overrides));
}
