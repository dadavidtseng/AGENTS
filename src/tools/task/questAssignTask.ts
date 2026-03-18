/**
 * quest_assign_task MCP Tool
 * Assigns tasks to agents based on capabilities and availability
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { QuestModel } from '../../models/questModel.js';
import { AgentModel } from '../../models/agentModel.js';
import type { Agent, AgentRole, Task } from '../../types';

/**
 * Tool definition for MCP protocol
 */
export const questAssignTaskTool: Tool = {
  name: 'quest_assign_task',
  description: 'Assign tasks to agents based on capabilities and availability. Only assigns tasks with all dependencies completed (status=completed). Tasks with unresolved dependencies are skipped with clear feedback.',
  inputSchema: {
    type: 'object',
    properties: {
      questId: {
        type: 'string',
        description: 'Quest ID (UUID) containing tasks to assign',
      },
      role: {
        type: 'string',
        enum: ['artist', 'designer', 'programmer'],
        description: 'Optional role filter — only assign tasks matching this role. Used by agent-lead to scope assignment to its own role.',
      },
      assignments: {
        type: 'array',
        description: 'Optional manual assignment overrides. Provide agentId for explicit assignment, or agentRole for role-based selection.',
        items: {
          type: 'object',
          properties: {
            taskId: {
              type: 'string',
              description: 'Task ID to assign',
            },
            agentId: {
              type: 'string',
              description: 'Explicit agent ID to assign to (e.g. "agent-worker-programmer-1")',
            },
            agentRole: {
              type: 'string',
              enum: ['artist', 'designer', 'programmer'],
              description: 'Agent role to assign task to (used when agentId is not provided)',
            },
          },
          required: ['taskId'],
        },
      },
    },
    required: ['questId'],
  },
};

/**
 * Input parameters for quest_assign_task tool
 */
interface QuestAssignTaskInput {
  questId: string;
  role?: AgentRole;
  assignments?: Array<{
    taskId: string;
    agentId?: string;
    agentRole?: AgentRole;
  }>;
}

/**
 * Assignment result for a single task
 */
interface AssignmentResult {
  taskId: string;
  taskName: string;
  assignedTo: string | null;
  reason: string;
}

/**
 * Extract keywords from task description for capability matching
 */
function extractKeywords(description: string): string[] {
  // Convert to lowercase and split into words
  const words = description.toLowerCase().split(/\s+/);
  
  // Common technical keywords to look for
  const keywords: string[] = [];
  const technicalTerms = [
    'react', 'vue', 'angular', 'typescript', 'javascript', 'python', 'java', 'rust', 'go',
    'api', 'rest', 'graphql', 'database', 'sql', 'nosql', 'mongodb', 'postgresql',
    'frontend', 'backend', 'fullstack', 'ui', 'ux', 'design', 'art', '2d', '3d',
    'animation', 'illustration', 'modeling', 'testing', 'ci/cd', 'docker', 'kubernetes',
    'aws', 'azure', 'gcp', 'server', 'client', 'mobile', 'web', 'desktop'
  ];
  
  for (const word of words) {
    const cleanWord = word.replace(/[^a-z0-9]/g, '');
    if (technicalTerms.includes(cleanWord)) {
      keywords.push(cleanWord);
    }
  }
  
  return keywords;
}

/**
 * Calculate capability match score between task and agent
 */
function calculateMatchScore(task: Task, agent: Agent): number {
  let score = 0;
  
  // Extract keywords from task description
  const taskKeywords = extractKeywords(task.description + ' ' + task.implementationGuide);
  
  // Match keywords against agent capabilities
  for (const keyword of taskKeywords) {
    for (const capability of agent.capabilities) {
      if (capability.toLowerCase().includes(keyword) || keyword.includes(capability.toLowerCase())) {
        score += 10;
      }
    }
  }
  
  // Bonus for agent not at max capacity
  const workloadRatio = agent.currentTasks.length / agent.maxConcurrentTasks;
  if (workloadRatio < 0.5) {
    score += 20; // Lightly loaded
  } else if (workloadRatio < 0.8) {
    score += 10; // Moderately loaded
  }
  
  return score;
}

/**
 * Find best agent for a task
 */
function findBestAgent(task: Task, agents: Agent[]): Agent | null {
  // Filter agents that are not at max capacity
  const availableAgents = agents.filter(
    (agent) => agent.currentTasks.length < agent.maxConcurrentTasks
  );
  
  if (availableAgents.length === 0) {
    return null;
  }
  
  // Calculate scores for each agent
  const scoredAgents = availableAgents.map((agent) => ({
    agent,
    score: calculateMatchScore(task, agent),
  }));
  
  // Sort by score (descending) and then by current workload (ascending)
  scoredAgents.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    return a.agent.currentTasks.length - b.agent.currentTasks.length;
  });
  
  // Return best match
  return scoredAgents[0].agent;
}

/**
 * Handle quest_assign_task tool call
 */
export async function handleQuestAssignTask(args: unknown) {
  // Validate input
  const input = args as QuestAssignTaskInput;
  
  if (!input.questId) {
    throw new Error('questId is required');
  }

  // Wrap the entire load-modify-save cycle in a per-quest lock
  return QuestModel.withLock(input.questId, async () => {
  // Load quest and tasks
  const quest = await QuestModel.load(input.questId);
  
  if (quest.tasks.length === 0) {
    throw new Error('Quest has no tasks to assign');
  }
  
  // Load available agents
  const allAgents = await AgentModel.listAll();
  
  if (allAgents.length === 0) {
    throw new Error('No agents registered in the system');
  }
  
  // Build manual assignment map
  const manualAssignments = new Map<string, { agentId?: string; agentRole?: AgentRole }>();
  if (input.assignments) {
    for (const assignment of input.assignments) {
      manualAssignments.set(assignment.taskId, {
        agentId: assignment.agentId,
        agentRole: assignment.agentRole,
      });
    }
  }

  // Apply role filter if provided — only process tasks matching the requested role
  const tasksToProcess = input.role
    ? quest.tasks.filter((t) => t.role === input.role)
    : quest.tasks;

  // Assignment results
  const results: AssignmentResult[] = [];

  // Process each task
  for (const task of tasksToProcess) {
    // Skip already assigned tasks
    if (task.assignedAgent) {
      results.push({
        taskId: task.id,
        taskName: task.name,
        assignedTo: task.assignedAgent,
        reason: 'Already assigned',
      });
      continue;
    }
    
    // Check for unresolved dependencies
    const unresolvedDeps = task.dependencies.filter(depId => {
      const depTask = quest.tasks.find(t => t.id === depId);
      return !depTask || depTask.status !== 'completed';
    });
    
    if (unresolvedDeps.length > 0) {
      // Get dependency task names for better error message
      const depNames = unresolvedDeps.map(depId => {
        const depTask = quest.tasks.find(t => t.id === depId);
        return depTask ? depTask.name : depId;
      });
      
      results.push({
        taskId: task.id,
        taskName: task.name,
        assignedTo: null,
        reason: `Blocked by ${unresolvedDeps.length} unresolved dependencies: ${depNames.join(', ')}`,
      });
      continue;
    }
    
    // Check for manual assignment override
    const manualOverride = manualAssignments.get(task.id);
    let selectedAgent: Agent | null = null;
    let reason = '';

    if (manualOverride?.agentId) {
      // Explicit agent ID assignment — find and validate the agent
      const targetAgent = allAgents.find((a) => a.agentId === manualOverride.agentId);
      if (!targetAgent) {
        reason = `Agent "${manualOverride.agentId}" not found`;
      } else if (targetAgent.currentTasks.length >= targetAgent.maxConcurrentTasks) {
        reason = `Agent "${manualOverride.agentId}" is at max capacity (${targetAgent.currentTasks.length}/${targetAgent.maxConcurrentTasks})`;
      } else {
        selectedAgent = targetAgent;
        reason = `Explicit assignment to ${manualOverride.agentId}`;
      }
    } else if (manualOverride?.agentRole) {
      // Role-based manual override — exclude lead agents
      const roleAgents = allAgents.filter(
        (agent) => agent.role === manualOverride.agentRole
          && !agent.agentId.includes('-lead-')
          && agent.currentTasks.length < agent.maxConcurrentTasks
      );

      if (roleAgents.length > 0) {
        // Pick agent with least workload
        roleAgents.sort((a, b) => a.currentTasks.length - b.currentTasks.length);
        selectedAgent = roleAgents[0];
        reason = `Manual role assignment to ${manualOverride.agentRole}`;
      } else {
        reason = `No available ${manualOverride.agentRole} worker agent found`;
      }
    } else {
      // Automatic assignment — only consider agents whose role matches the task's role,
      // and exclude lead agents as a safety net
      const roleMatchedAgents = (task.role
        ? allAgents.filter((a) => a.role === task.role)
        : allAgents
      ).filter((a) => !a.agentId.includes('-lead-'));
      selectedAgent = findBestAgent(task, roleMatchedAgents);

      if (selectedAgent) {
        reason = `Best capability match (role: ${selectedAgent.role})`;
      } else {
        reason = task.role
          ? `No available ${task.role} agent found`
          : 'No available agents with capacity';
      }
    }
    
    // Assign task if agent found
    if (selectedAgent) {
      task.assignedAgent = selectedAgent.agentId;
      task.status = 'in_progress';
      task.updatedAt = new Date();
      
      // Update agent's current tasks
      await AgentModel.addTaskToAgent(selectedAgent.agentId, task.id);
      
      results.push({
        taskId: task.id,
        taskName: task.name,
        assignedTo: selectedAgent.agentId,
        reason,
      });
    } else {
      // No agent found — check if ANY agent could handle this task (ignoring capacity)
      // If no agent matches at all, auto-fail the task to prevent orphaned tasks
      const anyMatchingAgent = (task.role
        ? allAgents.filter((a) => a.role === task.role)
        : allAgents
      ).some((agent) => calculateMatchScore(task, agent) > 0);

      if (!anyMatchingAgent) {
        // No agent in the system can handle this task — auto-fail it
        task.status = 'failed' as any;
        task.updatedAt = new Date();
        results.push({
          taskId: task.id,
          taskName: task.name,
          assignedTo: null,
          reason: `Auto-failed: no registered agent has capabilities matching this task`,
        });
      } else {
        // Agents exist but are at capacity — leave unassigned for later
        results.push({
          taskId: task.id,
          taskName: task.name,
          assignedTo: null,
          reason,
        });
      }
    }
  }
  
  // Save quest with updated task assignments
  await QuestModel.save(quest);
  
  // Return results — only count NEWLY assigned tasks, not "Already assigned" ones
  const alreadyAssigned = results.filter((r) => r.reason === 'Already assigned');
  const newlyAssigned = results.filter((r) => r.assignedTo !== null && r.reason !== 'Already assigned');
  const assignedCount = newlyAssigned.length;
  const unassignedCount = results.length - assignedCount - alreadyAssigned.length;
  const assignedTaskIds = newlyAssigned.map((r) => r.taskId);

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            success: true,
            assigned: assignedCount,
            unassigned: unassignedCount,
            total: results.length,
            assignedTaskIds,
            assignments: results,
            message: `Assigned ${assignedCount} out of ${results.length} tasks`,
            nextStep: assignedCount > 0
              ? `${assignedCount} task(s) assigned successfully. You MUST call task_execution with questId="${input.questId}" and taskIds=${JSON.stringify(assignedTaskIds)} to dispatch these tasks to worker agents. Assignment alone does NOT trigger execution.${unassignedCount > 0 ? ` Note: ${unassignedCount} task(s) could not be assigned yet (see "reason" field). If any mentions "No available {role} agent found", notify the human via discord_server_send_message listing the missing roles. DO NOT retry in a loop.` : ''}`
              : `No tasks could be assigned. Check the "reason" field for each task. If any mentions "No available {role} agent found", notify the human via discord_server_send_message listing the missing roles. DO NOT retry in a loop.`,
          },
          null,
          2
        ),
      },
    ],
  };
  }); // end QuestModel.withLock
}
