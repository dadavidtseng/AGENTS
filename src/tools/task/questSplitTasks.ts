/**
 * quest_split_tasks MCP Tool
 * Splits approved quest into executable tasks with pre-generated task list
 */

import { randomUUID } from 'node:crypto';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { QuestModel } from '../../models/questModel.js';
import { TaskModel } from '../../models/taskModel.js';
import type { Task } from '../../types';

/**
 * Tool definition for MCP protocol
 */
export const questSplitTasksTool: Tool = {
  name: 'quest_split_tasks',
  description: `Split approved quest into executable tasks (Step 4 of four-step workflow).

**Purpose:**
Creates executable tasks in the system with analysis and reflection data attached.

**Four-Step Workflow:**
1. quest_plan_task (Get planning prompt)
2. quest_analyze_task (Analyze task concepts)
3. quest_reflect_task (Critical review)
4. **quest_split_tasks** ← You are here (Create tasks with analysis)

**When to Use:**
- After quest_reflect_task returns reflection results
- To create tasks in the system with analysis attached
- Task IDs are auto-generated as UUIDs - do not provide task IDs in the input

**Required Parameters:**
- questId: Quest ID to split into tasks
- tasks: Array of task objects with name, description, implementationGuide, verificationCriteria, dependencies, relatedFiles
- globalAnalysisResult (optional): Combined analysis and reflection results from quest_analyze_task and quest_reflect_task. This will be stored in each task's metadata for reference during execution.

**Dependencies:**
- Specify dependencies using task NAMES (not IDs, as IDs don't exist yet during task creation)
- Example: "dependencies": ["Setup database schema", "Create API routes"]
- The system will automatically resolve task names to UUIDs during task creation
- Both task names and UUIDs are supported for flexibility
- Ensure no circular dependencies

**Task Creation:**
Each task will be created with:
- Auto-generated UUID as task ID
- Status set to 'pending'
- All provided fields (name, description, implementationGuide, etc.)
- globalAnalysisResult stored in task.metadata if provided

**Next Steps:**
After tasks are created, you can:
- Assign tasks to agents using quest_assign_tasks
- Execute tasks using quest_execute_task
- Monitor task progress using quest_get_status`,
  inputSchema: {
    type: 'object',
    properties: {
      questId: {
        type: 'string',
        description: 'Quest ID to split into tasks',
      },
      tasks: {
        type: 'array',
        description: 'Array of tasks to create. Task IDs will be auto-generated as UUIDs.',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            description: { type: 'string' },
            implementationGuide: { type: 'string' },
            verificationCriteria: { type: 'string' },
            dependencies: {
              type: 'array',
              items: { type: 'string' },
            },
            relatedFiles: { 
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: true,
              },
            },
          },
          required: ['name', 'description'],
        },
      },
      globalAnalysisResult: {
        type: 'string',
        description: 'Combined analysis and reflection results from quest_analyze_task and quest_reflect_task. This will be stored in each task\'s analysis field for reference during execution.',
      },
    },
    required: ['questId', 'tasks'],
  },
};

/**
 * Input parameters for quest_split_tasks tool
 */
interface QuestSplitTasksInput {
  questId: string;
  tasks: Array<{
    name: string;
    description: string;
    implementationGuide?: string;
    verificationCriteria?: string;
    dependencies?: string[];
    relatedFiles?: any[];
  }>;
  globalAnalysisResult?: string;
}

/**
 * Generate dependency graph visualization
 */
function generateDependencyGraph(tasks: Task[]): string {
  const lines: string[] = ['Task Dependency Graph:', ''];

  for (const task of tasks) {
    lines.push(`${task.id}: ${task.name}`);
    if (task.dependencies.length > 0) {
      lines.push(`  Depends on: ${task.dependencies.join(', ')}`);
    }
  }

  return lines.join('\n');
}

/**
 * Handle quest_split_tasks tool call
 */
export async function handleQuestSplitTasks(args: unknown) {
  // Validate input
  const input = args as QuestSplitTasksInput;

  if (!input.questId) {
    throw new Error('questId is required');
  }

  if (!input.tasks || !Array.isArray(input.tasks)) {
    throw new Error('tasks array is required');
  }

  if (input.tasks.length === 0) {
    throw new Error('tasks array cannot be empty');
  }

  // Load quest
  let quest;
  try {
    quest = await QuestModel.load(input.questId);
  } catch (error) {
    throw new Error(`Quest not found: ${input.questId}`);
  }

  // Validate quest status
  if (quest.status !== 'approved') {
    throw new Error(
      `Quest must be in 'approved' status to split tasks (current status: ${quest.status})`
    );
  }

  // Convert input tasks to Task objects with auto-generated UUIDs
  const now = new Date();
  const tasks: Task[] = input.tasks.map((taskData) => {
    if (!taskData.name || !taskData.description) {
      throw new Error('Each task must have name and description');
    }

    // Create task object
    const task: Task = {
      id: randomUUID(),
      questId: input.questId,
      name: taskData.name,
      description: taskData.description,
      status: 'pending' as const,
      implementationGuide: taskData.implementationGuide || '',
      verificationCriteria: taskData.verificationCriteria || '',
      dependencies: Array.isArray(taskData.dependencies) ? taskData.dependencies : [],
      relatedFiles: Array.isArray(taskData.relatedFiles) ? taskData.relatedFiles : [],
      createdAt: now,
      updatedAt: now,
    };

    // Store globalAnalysisResult in task metadata for reference during execution
    if (input.globalAnalysisResult) {
      task.metadata = {
        globalAnalysisResult: input.globalAnalysisResult,
      };
    }

    return task;
  });

  // Build name-to-ID mapping for dependency resolution
  console.log('[quest_split_tasks] Building task name-to-ID mapping...');
  const taskNameToIdMap = new Map<string, string>();
  tasks.forEach((task) => {
    taskNameToIdMap.set(task.name, task.id);
  });

  // Resolve dependencies: convert task names to task IDs
  console.log('[quest_split_tasks] Resolving dependencies...');
  for (const task of tasks) {
    const resolvedDependencies: string[] = [];

    for (const dep of task.dependencies) {
      // Check if dependency is already a UUID
      if (dep.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
        // Already a UUID - keep it
        resolvedDependencies.push(dep);
      } else {
        // It's a task name - resolve to ID
        if (taskNameToIdMap.has(dep)) {
          const resolvedId = taskNameToIdMap.get(dep)!;
          resolvedDependencies.push(resolvedId);
          console.log(`[quest_split_tasks] Resolved dependency "${dep}" to ${resolvedId}`);
        } else {
          console.warn(`[quest_split_tasks] Warning: Dependency "${dep}" not found in task list, skipping`);
          // Skip this dependency - validation will catch if it's critical
        }
      }
    }

    task.dependencies = resolvedDependencies;
  }

  // Validate dependencies (now all should be UUIDs)
  console.log('[quest_split_tasks] Validating dependencies...');
  const validation = TaskModel.validateDependencies(tasks);

  if (!validation.valid) {
    throw new Error(
      `Task dependency validation failed:\n${validation.errors.join('\n')}`
    );
  }

  // Update quest with tasks
  quest.tasks = tasks;
  quest.status = 'in_progress';
  await QuestModel.save(quest);

  // Generate dependency graph
  const dependencyGraph = generateDependencyGraph(tasks);

  // Return result
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            success: true,
            questId: quest.questId,
            questName: quest.questName,
            taskCount: tasks.length,
            tasks: tasks.map((t) => ({
              id: t.id,
              name: t.name,
              description: t.description,
              dependencies: t.dependencies,
              status: t.status,
            })),
            dependencyGraph,
            message: `Quest "${quest.questName}" split into ${tasks.length} tasks`,
          },
          null,
          2
        ),
      },
    ],
  };
}
