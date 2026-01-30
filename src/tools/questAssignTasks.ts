/**
 * quest_assign_tasks MCP Tool
 * Assigns tasks to agents based on capabilities and availability
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { QuestModel } from '../models/questModel.js';
import { AgentModel } from '../models/agentModel.js';
import type { Agent, AgentRole, Task } from '../types';

/**
 * Tool definition for MCP protocol
 */
export const questAssignTasksTool: Tool = {
  name: 'quest_assign_tasks',
  description: 'Assign tasks to agents based on capabilities and availability',
  inputSchema: {
    type: 'object',
    properties: {
      questId: {
        type: 'string',
        description: 'Quest ID (UUID) containing tasks to assign',
      },
      assignments: {
        type: 'array',
        description: 'Optional manual assignment overrides',
        items: {
          type: 'object',
          properties: {
            taskId: {
              type: 'string',
              description: 'Task ID to assign',
            },
            agentRole: {
              type: 'string',
              enum: ['artist', 'designer', 'programmer'],
              description: 'Agent role to assign task to',
            },
          },
          required: ['taskId', 'agentRole'],
        },
      },
    },
    required: ['questId'],
  },
};

/**
 * Input parameters for quest_assign_tasks tool
 */
interface QuestAssignTasksInput {
  questId: string;
  assignments?: Array<{
    taskId: string;
    agentRole: AgentRole;
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
 * Handle quest_assign_tasks tool call
 */
export async function handleQuestAssignTasks(args: unknown) {
  // Validate input
  const input = args as QuestAssignTasksInput;
  
  if (!input.questId) {
    throw new Error('questId is required');
  }
  
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
  const manualAssignments = new Map<string, AgentRole>();
  if (input.assignments) {
    for (const assignment of input.assignments) {
      manualAssignments.set(assignment.taskId, assignment.agentRole);
    }
  }
  
  // Assignment results
  const results: AssignmentResult[] = [];
  
  // Process each task
  for (const task of quest.tasks) {
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
    
    // Check for manual assignment override
    const manualRole = manualAssignments.get(task.id);
    let selectedAgent: Agent | null = null;
    let reason = '';
    
    if (manualRole) {
      // Find agent with matching role
      const roleAgents = allAgents.filter(
        (agent) => agent.role === manualRole && agent.currentTasks.length < agent.maxConcurrentTasks
      );
      
      if (roleAgents.length > 0) {
        // Pick agent with least workload
        roleAgents.sort((a, b) => a.currentTasks.length - b.currentTasks.length);
        selectedAgent = roleAgents[0];
        reason = `Manual assignment to ${manualRole}`;
      } else {
        reason = `No available ${manualRole} agent found`;
      }
    } else {
      // Automatic assignment based on capability matching
      selectedAgent = findBestAgent(task, allAgents);
      
      if (selectedAgent) {
        reason = `Best capability match (role: ${selectedAgent.role})`;
      } else {
        reason = 'No available agents with capacity';
      }
    }
    
    // Assign task if agent found
    if (selectedAgent) {
      task.assignedAgent = selectedAgent.agentId;
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
      // Leave task unassigned
      results.push({
        taskId: task.id,
        taskName: task.name,
        assignedTo: null,
        reason,
      });
    }
  }
  
  // Save quest with updated task assignments
  await QuestModel.save(quest);
  
  // Return results
  const assignedCount = results.filter((r) => r.assignedTo !== null).length;
  const unassignedCount = results.length - assignedCount;
  
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
            assignments: results,
            message: `Assigned ${assignedCount} out of ${results.length} tasks`,
          },
          null,
          2
        ),
      },
    ],
  };
}
