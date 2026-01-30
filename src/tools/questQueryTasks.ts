/**
 * quest_query_tasks Tool
 * Search and filter tasks across all quests
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { QuestModel } from '../models/questModel.js';
import type { Task, TaskStatus } from '../types/index.js';

const InputSchema = z.object({
  query: z
    .string()
    .min(1)
    .describe('Search query: task ID (UUID) or keywords to search in task name/description'),
  questId: z.string().uuid().optional().describe('Filter by specific quest (optional)'),
  status: z
    .enum(['pending', 'in_progress', 'completed', 'failed'])
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
    .describe('Number of results per page (default: 10, max: 20)'),
});

type Input = z.infer<typeof InputSchema>;

export const questQueryTasksTool: Tool = {
  name: 'quest_query_tasks',
  description: `Search and filter tasks across all quests.

**Purpose:**
Find tasks by keyword, task ID, or filters. Useful for discovering tasks across multiple quests.

**Search Modes:**

1. **Task ID Search** (exact match):
   - Provide full UUID: "abc-123-def-456"
   - Returns exact task if found

2. **Keyword Search** (fuzzy match):
   - Search in task name and description
   - Multiple keywords: "authentication JWT token"
   - Case-insensitive matching

**Filters:**

- **questId**: Limit search to specific quest
- **status**: Filter by task status (pending, in_progress, completed, failed)
- **agentId**: Filter by assigned agent

**Pagination:**

- **page**: Page number (default: 1)
- **pageSize**: Results per page (default: 10, max: 20)

**Use Cases:**

- "Find all tasks related to authentication"
- "Show me all pending tasks"
- "Find tasks assigned to agent-123"
- "Search for task abc-123-def"
- "Show all failed tasks across all quests"

**Returns:**

- Matching tasks with quest context
- Pagination info (total, pages, current page)
- Task summaries (name, status, quest, agent)

**Example Queries:**

- query: "database migration" → Find tasks about database
- query: "abc-123", questId: "xyz-789" → Find specific task in quest
- status: "failed" → Find all failed tasks
- agentId: "agent-1", status: "in_progress" → Find agent's active tasks`,
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search query (task ID or keywords)',
      },
      questId: {
        type: 'string',
        description: 'Filter by quest ID (optional)',
      },
      status: {
        type: 'string',
        enum: ['pending', 'in_progress', 'completed', 'failed'],
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
    required: ['query'],
  },
};

interface TaskSearchResult {
  task: Task;
  questId: string;
  questName: string;
  questStatus: string;
}

export async function handleQuestQueryTasks(args: unknown) {
  // Validate input
  const input = InputSchema.parse(args) as Input;

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
  const isTaskIdSearch = uuidRegex.test(input.query);

  // Search tasks across quests
  const allResults: TaskSearchResult[] = [];

  for (const quest of quests) {
    for (const task of quest.tasks) {
      let matches = false;

      // Task ID search (exact match)
      if (isTaskIdSearch) {
        matches = task.id.toLowerCase() === input.query.toLowerCase();
      } else {
        // Keyword search (case-insensitive, in name and description)
        const queryLower = input.query.toLowerCase();
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
            query: input.query,
            searchMode: isTaskIdSearch ? 'taskId' : 'keyword',
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
            message: `Found ${totalResults} task(s) matching query "${input.query}". Showing page ${input.page} of ${totalPages}.`,
          },
          null,
          2
        ),
      },
    ],
  };
}
