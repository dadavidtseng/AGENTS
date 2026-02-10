/**
 * quest_query_task Tool
 * Search and filter tasks across all quests
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { QuestModel } from '../../models/questModel.js';
import type { Task, TaskStatus } from '../../types/index.js';

const InputSchema = z.object({
  taskId: z.string().uuid().optional().describe('Get specific task by ID with full details and quest context (optional)'),
  query: z
    .string()
    .min(1)
    .optional()
    .describe('Search query: keywords to search in task name/description (optional, ignored if taskId is provided)'),
  questId: z.string().uuid().optional().describe('Filter by specific quest (optional)'),
  status: z
    .enum(['pending', 'assigned', 'in_progress', 'pending_approval', 'completed', 'failed'])
    .optional()
    .describe('Filter by task status (optional)'),
  agentId: z.string().optional().describe('Filter by assigned agent (optional)'),
  page: z
    .number()
    .int()
    .positive()
    .optional()
    .default(1)
    .describe('Page number for pagination (default: 1)'),
  pageSize: z
    .number()
    .int()
    .positive()
    .min(1)
    .max(20)
    .optional()
    .default(10)
    .describe('Results per page (default: 10, max: 20)'),
});

type Input = z.infer<typeof InputSchema>;

export const questQueryTaskTool: Tool = {
  name: 'quest_query_task',
  description: `Query tasks: get a specific task by ID or search/filter tasks across quests.

**Mode 1: Get Task by ID** (provide taskId)
Returns full task details with quest context (requirements, design).
Use when you know the exact task ID.

**Mode 2: Search Tasks** (provide query and/or filters)
Search by keywords or filter by status/agent/quest.
Use for discovering tasks across quests.

**Parameters:**
- taskId (optional): Get specific task with full details and quest context
- query (optional): Search keywords (ignored if taskId provided)
- questId (optional): Filter by quest
- status (optional): Filter by status (pending, assigned, in_progress, completed, failed)
- agentId (optional): Filter by assigned agent
- page/pageSize: Pagination for search results`,
  inputSchema: {
    type: 'object',
    properties: {
      taskId: {
        type: 'string',
        description: 'Get specific task by ID with full details (optional)',
      },
      query: {
        type: 'string',
        description: 'Search keywords (optional, ignored if taskId provided)',
      },
      questId: {
        type: 'string',
        description: 'Filter by quest ID (optional)',
      },
      status: {
        type: 'string',
        enum: ['pending', 'assigned', 'in_progress', 'pending_approval', 'completed', 'failed'],
        description: 'Filter by task status (optional)',
      },
      agentId: {
        type: 'string',
        description: 'Filter by assigned agent (optional)',
      },
      page: {
        type: 'number',
        description: 'Page number (default: 1)',
      },
      pageSize: {
        type: 'number',
        description: 'Results per page (default: 10, max: 20)',
      },
    },
    required: [],
  },
};

interface TaskSearchResult {
  task: Task;
  questId: string;
  questName: string;
  questStatus: string;
}

export async function handleQuestQueryTask(args: unknown) {
  // Validate input
  const input = InputSchema.parse(args) as Input;

  // Mode 1: Get specific task by ID
  if (input.taskId) {
    return await handleGetTaskById(input.taskId);
  }

  // Mode 2: Search/filter tasks (need at least query or a filter)
  if (!input.query && !input.questId && !input.status && !input.agentId) {
    throw new Error('Provide taskId for specific task, or query/questId/status/agentId for search');
  }

  const searchQuery = input.query || '*';

  // Load all quests (or specific quest if filtered)
  let quests;
  if (input.questId) {
    const quest = await QuestModel.load(input.questId);
    quests = [quest];
  } else {
    quests = await QuestModel.listAll();
  }

  // Determine if query is a UUID (task ID search)
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const isTaskIdSearch = uuidRegex.test(searchQuery);

  // Search tasks across quests
  const allResults: TaskSearchResult[] = [];

  for (const quest of quests) {
    for (const task of quest.tasks) {
      let matches = false;

      // Task ID search (exact match)
      if (isTaskIdSearch) {
        matches = task.id.toLowerCase() === searchQuery.toLowerCase();
      } else if (searchQuery === '*') {
        // No query filter — match all (rely on status/agent/quest filters)
        matches = true;
      } else {
        // Keyword search (case-insensitive, in name and description)
        const queryLower = searchQuery.toLowerCase();
        const keywords = queryLower.split(/\s+/);
        const searchText = `${task.name} ${task.description}`.toLowerCase();

        matches = keywords.every((keyword) => searchText.includes(keyword));
      }

      // Apply filters
      if (matches) {
        // Status filter
        if (input.status && task.status !== input.status) {
          matches = false;
        }

        // Agent filter
        if (input.agentId && task.assignedAgent !== input.agentId) {
          matches = false;
        }
      }

      if (matches) {
        allResults.push({
          task,
          questId: quest.questId,
          questName: quest.questName,
          questStatus: quest.status,
        });
      }
    }
  }

  // Sort by quest name, then task name
  allResults.sort((a, b) => {
    const questCompare = a.questName.localeCompare(b.questName);
    if (questCompare !== 0) return questCompare;
    return a.task.name.localeCompare(b.task.name);
  });

  // Pagination
  const totalResults = allResults.length;
  const totalPages = Math.ceil(totalResults / input.pageSize);
  const startIndex = (input.page - 1) * input.pageSize;
  const endIndex = startIndex + input.pageSize;
  const paginatedResults = allResults.slice(startIndex, endIndex);

  // Format results
  const tasks = paginatedResults.map((result) => ({
    taskId: result.task.id,
    taskName: result.task.name,
    taskDescription: result.task.description,
    status: result.task.status,
    assignedAgent: result.task.assignedAgent,
    questId: result.questId,
    questName: result.questName,
    questStatus: result.questStatus,
    dependencies: result.task.dependencies,
    createdAt: result.task.createdAt,
    updatedAt: result.task.updatedAt,
    startedAt: result.task.startedAt,
    completedAt: result.task.completedAt,
  }));

  // Return success
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            success: true,
            query: searchQuery,
            searchMode: isTaskIdSearch ? 'taskId' : (searchQuery === '*' ? 'filter' : 'keyword'),
            filters: {
              questId: input.questId,
              status: input.status,
              agentId: input.agentId,
            },
            pagination: {
              page: input.page,
              pageSize: input.pageSize,
              totalResults,
              totalPages,
              hasNextPage: input.page < totalPages,
              hasPreviousPage: input.page > 1,
            },
            tasks,
            message: `Found ${totalResults} task(s)${searchQuery !== '*' ? ` matching "${searchQuery}"` : ''}. Showing page ${input.page} of ${totalPages}.`,
          },
          null,
          2
        ),
      },
    ],
  };
}

/**
 * Get specific task by ID with full details and quest context
 * (Migrated from former quest_get_task_details tool)
 */
async function handleGetTaskById(taskId: string) {
  // Search for task across all quests
  const allQuests = await QuestModel.listAll();

  for (const quest of allQuests) {
    const task = quest.tasks.find((t) => t.id === taskId);
    if (task) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                task: {
                  ...task,
                  createdAt: typeof task.createdAt === 'string'
                    ? task.createdAt
                    : task.createdAt.toISOString(),
                  updatedAt: typeof task.updatedAt === 'string'
                    ? task.updatedAt
                    : task.updatedAt.toISOString(),
                  startedAt: task.startedAt
                    ? (typeof task.startedAt === 'string'
                      ? task.startedAt
                      : task.startedAt.toISOString())
                    : undefined,
                  completedAt: task.completedAt
                    ? (typeof task.completedAt === 'string'
                      ? task.completedAt
                      : task.completedAt.toISOString())
                    : undefined,
                },
                questContext: {
                  questId: quest.questId,
                  questName: quest.questName,
                  requirements: quest.requirements,
                  design: quest.design,
                },
              },
              null,
              2
            ),
          },
        ],
      };
    }
  }

  throw new Error(`Task with ID '${taskId}' not found in any quest`);
}
