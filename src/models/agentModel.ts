/**
 * Agent Model - Agent registry and workload management
 * Tracks agent capabilities, status, and task assignments
 */

import { readFile, writeFile, rename } from 'fs/promises';
import { join } from 'path';
import { Agent, AgentStatus, AgentRole } from '../types';
import { config } from '../utils/config.js';
import { broadcastAgentRegistered, broadcastAgentStatusChanged } from '../events/broadcast.js';

/**
 * Simple in-process mutex for serializing file read-modify-write cycles.
 * Prevents race conditions when multiple concurrent calls hit saveAgents().
 */
class Mutex {
  private queue: Array<() => void> = [];
  private locked = false;

  async acquire(): Promise<void> {
    if (!this.locked) {
      this.locked = true;
      return;
    }
    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
  }

  release(): void {
    if (this.queue.length > 0) {
      const next = this.queue.shift()!;
      next();
    } else {
      this.locked = false;
    }
  }
}

/** Serializes all agent registry read-modify-write operations */
const agentFileMutex = new Mutex();

/**
 * Filters for querying agents
 */
export interface AgentFilters {
  /** Filter by agent status */
  status?: AgentStatus;
  /** Filter by agent role */
  role?: AgentRole;
}

/**
 * Agent Model - Handles agent registry operations
 * Note: Agent data is transient (not versioned with Git)
 */
export class AgentModel {
  /** Path to agents.json file */
  private static get agentsFile(): string {
    return join(config.questDataDir, 'agents.json');
  }

  /**
   * Load all agents from registry
   * Creates empty registry if file doesn't exist
   * 
   * @returns Array of registered agents
   * @internal
   */
  private static async loadAgents(): Promise<Agent[]> {
    try {
      const data = await readFile(AgentModel.agentsFile, 'utf-8');
      const agents = JSON.parse(data);
      
      // Convert lastSeen from ISO string to Date
      return agents.map((agent: any) => ({
        ...agent,
        lastSeen: new Date(agent.lastSeen),
      }));
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        // File doesn't exist, return empty array
        return [];
      }
      throw error;
    }
  }

  /**
   * Save agents to registry with atomic write
   * Uses temp file + rename for atomicity
   * 
   * @param agents - Array of agents to save
   * @internal
   */
  private static async saveAgents(agents: Agent[]): Promise<void> {
    // Convert Date objects to ISO strings for JSON
    const serialized = agents.map((agent) => ({
      ...agent,
      lastSeen: agent.lastSeen.toISOString(),
    }));

    // Atomic write: write to temp file, then rename
    const tempFile = `${AgentModel.agentsFile}.tmp`;
    await writeFile(tempFile, JSON.stringify(serialized, null, 2), 'utf-8');
    await rename(tempFile, AgentModel.agentsFile);
  }

  /**
   * Register or update an agent (upsert pattern)
   * Sets status to 'available' and updates lastSeen timestamp
   * 
   * @param agent - Agent to register
   * 
   * @example
   * await AgentModel.register({
   *   agentId: 'agent-001',
   *   name: 'CodeBot',
   *   role: 'programmer',
   *   capabilities: ['TypeScript', 'React'],
   *   status: 'offline', // Will be overridden to 'available'
   *   currentTasks: [],
   *   maxConcurrentTasks: 3,
   *   lastSeen: new Date()
   * });
   */
  static async register(agent: Agent): Promise<void> {
    await agentFileMutex.acquire();
    try {
      const agents = await AgentModel.loadAgents();

      const existingIndex = agents.findIndex((a) => a.agentId === agent.agentId);

      const agentRecord: Agent = {
        ...agent,
        status: 'available',
        lastSeen: new Date(),
      };

      const isNewAgent = existingIndex === -1;

      if (existingIndex !== -1) {
        agents[existingIndex] = agentRecord;
      } else {
        agents.push(agentRecord);
      }

      await AgentModel.saveAgents(agents);

      if (isNewAgent) {
        await broadcastAgentRegistered(agentRecord);
      }
    } finally {
      agentFileMutex.release();
    }
  }

  /**
   * List all agents with optional filtering
   * 
   * @param filters - Optional filters for status and role
   * @returns Array of agents matching filters
   * 
   * @example
   * // Get all available programmers
   * const programmers = await AgentModel.listAll({
   *   status: 'available',
   *   role: 'programmer'
   * });
   */
  static async listAll(filters?: AgentFilters): Promise<Agent[]> {
    let agents = await AgentModel.loadAgents();

    // Apply filters if provided
    if (filters) {
      if (filters.status) {
        agents = agents.filter((a) => a.status === filters.status);
      }
      if (filters.role) {
        agents = agents.filter((a) => a.role === filters.role);
      }
    }

    return agents;
  }

  /**
   * Update agent status and last seen timestamp
   * 
   * @param agentId - Agent identifier
   * @param status - New agent status
   * @throws Error if agent not found
   * 
   * @example
   * await AgentModel.updateStatus('agent-001', 'busy');
   */
  static async updateStatus(agentId: string, status: AgentStatus): Promise<void> {
    await agentFileMutex.acquire();
    try {
      const agents = await AgentModel.loadAgents();

      const agent = agents.find((a) => a.agentId === agentId);
      if (!agent) {
        throw new Error(`Agent not found: ${agentId}`);
      }

      agent.status = status;
      agent.lastSeen = new Date();

      await AgentModel.saveAgents(agents);

      await broadcastAgentStatusChanged(agentId, status);
    } finally {
      agentFileMutex.release();
    }
  }

  /**
   * Add task to agent's workload
   * Updates status to 'busy' if agent reaches max concurrent tasks
   * 
   * @param agentId - Agent identifier
   * @param taskId - Task to assign
   * @throws Error if agent not found
   * 
   * @example
   * await AgentModel.addTaskToAgent('agent-001', 'task-123');
   */
  static async addTaskToAgent(agentId: string, taskId: string): Promise<void> {
    await agentFileMutex.acquire();
    try {
      const agents = await AgentModel.loadAgents();

      const agent = agents.find((a) => a.agentId === agentId);
      if (!agent) {
        throw new Error(`Agent not found: ${agentId}`);
      }

      if (!agent.currentTasks.includes(taskId)) {
        agent.currentTasks.push(taskId);
      }

      if (agent.currentTasks.length >= agent.maxConcurrentTasks) {
        agent.status = 'busy';
      }

      agent.lastSeen = new Date();

      await AgentModel.saveAgents(agents);
    } finally {
      agentFileMutex.release();
    }
  }

  /**
   * Remove task from agent's workload
   * Updates status to 'available' if agent is below capacity
   * 
   * @param agentId - Agent identifier
   * @param taskId - Task to remove
   * @throws Error if agent not found
   * 
   * @example
   * await AgentModel.removeTaskFromAgent('agent-001', 'task-123');
   */
  static async removeTaskFromAgent(agentId: string, taskId: string): Promise<void> {
    await agentFileMutex.acquire();
    try {
      const agents = await AgentModel.loadAgents();

      const agent = agents.find((a) => a.agentId === agentId);
      if (!agent) {
        throw new Error(`Agent not found: ${agentId}`);
      }

      agent.currentTasks = agent.currentTasks.filter((id) => id !== taskId);

      if (agent.currentTasks.length < agent.maxConcurrentTasks && agent.status === 'busy') {
        agent.status = 'available';
      }

      agent.lastSeen = new Date();

      await AgentModel.saveAgents(agents);
    } finally {
      agentFileMutex.release();
    }
  }

  /**
   * Mark agents as offline if they haven't been seen recently
   * Used for cleanup and status maintenance
   * 
   * @param timeoutMinutes - Minutes of inactivity before marking offline
   * 
   * @example
   * // Mark agents offline if inactive for 30 minutes
   * await AgentModel.markOfflineAgents(30);
   */
  static async markOfflineAgents(timeoutMinutes: number): Promise<void> {
    await agentFileMutex.acquire();
    try {
      const agents = await AgentModel.loadAgents();
      const now = new Date();
      const timeoutMs = timeoutMinutes * 60 * 1000;

      let updated = false;

      for (const agent of agents) {
        const inactiveDuration = now.getTime() - agent.lastSeen.getTime();

        if (inactiveDuration > timeoutMs && agent.status !== 'offline') {
          agent.status = 'offline';
          updated = true;
        }
      }

      if (updated) {
        await AgentModel.saveAgents(agents);
      }
    } finally {
      agentFileMutex.release();
    }
  }

  /**
   * Update agent heartbeat with status and current tasks
   * Lightweight operation for frequent status updates
   * 
   * @param agentId - Agent identifier
   * @param status - Current agent status
   * @param currentTasks - Array of currently assigned task IDs
   * @param timestamp - Heartbeat timestamp
   * @throws Error if agent not found
   * 
   * @example
   * await AgentModel.heartbeat('agent-001', 'busy', ['task-123'], new Date());
   */
  static async heartbeat(
    agentId: string,
    status: AgentStatus,
    currentTasks: string[],
    timestamp: Date
  ): Promise<void> {
    await agentFileMutex.acquire();
    try {
      const agents = await AgentModel.loadAgents();

      const agent = agents.find((a) => a.agentId === agentId);
      if (!agent) {
        throw new Error(`Agent not found: ${agentId}`);
      }

      agent.status = status;
      agent.currentTasks = currentTasks;
      agent.lastSeen = timestamp;

      await AgentModel.saveAgents(agents);
    } finally {
      agentFileMutex.release();
    }
  }
}
