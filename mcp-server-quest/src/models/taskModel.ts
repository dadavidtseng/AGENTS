/**
 * Task Model - Task operations and dependency validation
 * Includes circular dependency detection using graph algorithms
 */

import { Task, TaskArtifacts, TaskStatus } from '../types/index.js';
import { QuestModel } from './questModel.js';
import { commitQuestChanges } from '../utils/git.js';
import { config } from '../utils/config.js';
import { broadcastTaskStatusChanged, broadcastTaskAssigned } from '../events/broadcast.js';

/**
 * Validation result for dependency checks
 */
export interface ValidationResult {
  /** Whether validation passed */
  valid: boolean;
  /** List of validation errors */
  errors: string[];
}

/**
 * Task Model - Handles task operations and dependency validation
 */
export class TaskModel {
  /**
   * Update task status with automatic timestamp management
   * 
   * @param taskId - Task identifier
   * @param questId - Parent quest identifier
   * @param status - New task status
   * 
   * @example
   * await TaskModel.updateStatus('task-123', 'quest-456', 'in_progress');
   */
  static async updateStatus(
    taskId: string,
    questId: string,
    status: TaskStatus
  ): Promise<void> {
    // Load quest
    const quest = await QuestModel.load(questId);

    // Find task
    const task = quest.tasks.find((t) => t.id === taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId} in quest ${questId}`);
    }

    // Update status
    const oldStatus = task.status;
    task.status = status;

    // Update timestamps based on status
    if (status === 'in_progress' && !task.startedAt) {
      task.startedAt = new Date();
    }
    if (status === 'completed' && !task.completedAt) {
      task.completedAt = new Date();
    }

    // Save quest
    await QuestModel.save(quest);

    // Git commit
    await commitQuestChanges(
      config.questDataDir,
      `chore: update task ${task.name} status to ${status}`,
      `Task ID: ${taskId}\nPrevious status: ${oldStatus}\nNew status: ${status}`
    );

    // Broadcast task status changed event (after commit succeeds)
    await broadcastTaskStatusChanged(taskId, status);
  }

  /**
   * Submit task completion result with artifacts
   * 
   * @param taskId - Task identifier
   * @param questId - Parent quest identifier
   * @param artifacts - Task artifacts (APIs, components, functions, etc.)
   * @param summary - Completion summary
   * 
   * @example
   * await TaskModel.submitResult('task-123', 'quest-456', {
   *   apiEndpoints: [{ method: 'GET', path: '/api/quests', ... }],
   *   components: [{ name: 'QuestList', ... }]
   * }, 'Implemented quest listing feature');
   */
  static async submitResult(
    taskId: string,
    questId: string,
    artifacts: TaskArtifacts,
    summary: string
  ): Promise<void> {
    // Load quest
    const quest = await QuestModel.load(questId);

    // Find task
    const task = quest.tasks.find((t) => t.id === taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId} in quest ${questId}`);
    }

    // Update task
    task.artifacts = artifacts;
    task.status = 'completed';
    task.completedAt = new Date();

    // Save quest
    await QuestModel.save(quest);

    // Git commit
    await commitQuestChanges(
      config.questDataDir,
      `feat: complete task ${task.name} - ${summary}`,
      `Task ID: ${taskId}\nQuest ID: ${questId}`
    );
  }

  /**
   * Validate task dependencies for circular references
   * Uses depth-first search to detect cycles in dependency graph
   * 
   * @param tasks - Array of tasks to validate
   * @returns Validation result with errors if any
   * 
   * @example
   * const result = TaskModel.validateDependencies(quest.tasks);
   * if (!result.valid) {
   *   console.error('Circular dependencies:', result.errors);
   * }
   */
  static validateDependencies(tasks: Task[]): ValidationResult {
    const errors: string[] = [];

    // Build dependency graph
    const graph = TaskModel.buildDependencyGraph(tasks);

    // Detect cycles
    const cycles = TaskModel.detectCycles(graph);

    // Generate error messages for each cycle
    for (const cycle of cycles) {
      const taskNames = cycle.map((taskId) => {
        const task = tasks.find((t) => t.id === taskId);
        return task ? task.name : taskId;
      });
      errors.push(
        `Circular dependency detected: ${taskNames.join(' → ')} → ${taskNames[0]}`
      );
    }

    // Check for invalid dependencies (references to non-existent tasks)
    const taskIds = new Set(tasks.map((t) => t.id));
    for (const task of tasks) {
      for (const depId of task.dependencies) {
        if (!taskIds.has(depId)) {
          errors.push(
            `Task "${task.name}" (${task.id}) depends on non-existent task: ${depId}`
          );
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Get task by ID from a quest
   * 
   * @param taskId - Task identifier
   * @param questId - Parent quest identifier
   * @returns Task object
   * @throws Error if task or quest not found
   * 
   * @example
   * const task = await TaskModel.getTaskById('task-123', 'quest-456');
   */
  static async getTaskById(taskId: string, questId: string): Promise<Task> {
    const quest = await QuestModel.load(questId);
    const task = quest.tasks.find((t) => t.id === taskId);

    if (!task) {
      throw new Error(`Task not found: ${taskId} in quest ${questId}`);
    }

    return task;
  }

  /**
   * Build dependency graph from task array
   * Maps task ID to array of dependent task IDs
   * 
   * @param tasks - Array of tasks
   * @returns Dependency graph as adjacency list
   * 
   * @internal
   */
  static buildDependencyGraph(tasks: Task[]): Map<string, string[]> {
    const graph = new Map<string, string[]>();

    // Initialize graph with all task IDs
    for (const task of tasks) {
      graph.set(task.id, task.dependencies);
    }

    return graph;
  }

  /**
   * Detect circular dependencies using depth-first search
   * Returns all cycles found in the graph
   * 
   * Algorithm: Uses DFS with color marking (white/gray/black)
   * - White: unvisited
   * - Gray: currently being explored (in recursion stack)
   * - Black: fully explored
   * 
   * Time Complexity: O(V + E) where V = vertices, E = edges
   * 
   * @param graph - Dependency graph as adjacency list
   * @returns Array of cycles (each cycle is array of task IDs)
   * 
   * @internal
   */
  static detectCycles(graph: Map<string, string[]>): string[][] {
    const cycles: string[][] = [];
    const visited = new Set<string>();
    const recursionStack = new Set<string>();
    const pathStack: string[] = [];

    /**
     * DFS visit function
     * @param node - Current node being visited
     */
    function dfs(node: string): void {
      visited.add(node);
      recursionStack.add(node);
      pathStack.push(node);

      const dependencies = graph.get(node) || [];
      for (const dep of dependencies) {
        if (!visited.has(dep)) {
          // Unvisited node, recurse
          dfs(dep);
        } else if (recursionStack.has(dep)) {
          // Back edge detected - cycle found
          const cycleStart = pathStack.indexOf(dep);
          const cycle = pathStack.slice(cycleStart);
          cycles.push(cycle);
        }
      }

      pathStack.pop();
      recursionStack.delete(node);
    }

    // Run DFS from each unvisited node
    for (const [node] of graph) {
      if (!visited.has(node)) {
        dfs(node);
      }
    }

    return cycles;
  }
}
