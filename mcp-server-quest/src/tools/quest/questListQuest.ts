/**
 * quest_list_quest MCP Tool
 * Lists all quests with optional filters and pagination
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { QuestModel } from '../../models/questModel.js';
import type { QuestStatus } from '../../types/index.js';

/**
 * Tool definition for MCP protocol
 */
export const questListQuestTool: Tool = {
  name: 'quest_list_quest',
  description: `List all quests with optional filters and pagination.

**Usage Guidelines:**
- **Omit the 'status' parameter to retrieve ALL quests** (recommended default behavior)
- Only use 'status' filter when user explicitly requests quests with a specific status
- Examples:
  - User: "show me all quests" → Call without status parameter
  - User: "show me draft quests" → Call with status: "draft"
  - User: "show me approved quests" → Call with status: "approved"
  - User: "list quests" → Call without status parameter (get all)

**Parameters:**
- status (optional): Filter by quest status. If omitted, returns all quests regardless of status.
- limit (optional): Maximum number of results to return (default: 50, max: 100)
- offset (optional): Number of quests to skip for pagination (default: 0)

**Returns:**
- quests: Array of quest summaries (questId, questName, status, createdAt, taskCount, approvalCount)
- total: Total number of quests matching the filter (or all quests if no filter)
- limit: Applied limit value
- offset: Applied offset value
- message: Human-readable summary of results`,
  inputSchema: {
    type: 'object',
    properties: {
      status: {
        type: 'string',
        enum: ['draft', 'pending_approval', 'approved', 'rejected', 'in_progress', 'completed', 'cancelled'],
        description: 'Filter quests by status (optional)',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of quests to return (default: 50, max: 100)',
        default: 50,
      },
      offset: {
        type: 'number',
        description: 'Number of quests to skip for pagination (default: 0)',
        default: 0,
      },
    },
    required: [],
  },
};

/**
 * Input parameters for quest_list_quest tool
 */
interface QuestListQuestInput {
  status?: QuestStatus;
  limit?: number;
  offset?: number;
}

/**
 * Quest summary returned by the tool
 */
interface QuestSummary {
  questId: string;
  questName: string;
  status: QuestStatus;
  createdAt: Date;
  taskCount: number;
  approvalCount: number;
}

/**
 * Handle quest_list_quest tool call
 */
export async function handleQuestListQuest(args: unknown) {
  // Parse and validate input
  const input = (args as QuestListQuestInput) || {};

  // Validate limit
  const limit = input.limit !== undefined ? input.limit : 50;
  if (limit < 1) {
    throw new Error('limit must be at least 1');
  }
  if (limit > 100) {
    throw new Error('limit must not exceed 100 (to prevent abuse)');
  }

  // Validate offset
  const offset = input.offset !== undefined ? input.offset : 0;
  if (offset < 0) {
    throw new Error('offset must be non-negative');
  }

  // Validate status filter
  const validStatuses: QuestStatus[] = [
    'draft',
    'pending_approval',
    'approved',
    'rejected',
    'in_progress',
    'completed',
    'cancelled',
  ];
  if (input.status && !validStatuses.includes(input.status)) {
    throw new Error(`status must be one of: ${validStatuses.join(', ')}`);
  }

  // Load all quests (already sorted by createdAt descending)
  const allQuests = await QuestModel.listAll();

  // Filter by status if provided
  let filteredQuests = input.status
    ? allQuests.filter((quest) => quest.status === input.status)
    : allQuests;

  // Auto-fallback: if status filter returned 0 results, return ALL quests instead.
  // This prevents LLMs from looping when they pass a wrong status filter —
  // the tool always returns useful data regardless of what parameters the LLM sends.
  let usedFallback = false;
  if (filteredQuests.length === 0 && input.status && allQuests.length > 0) {
    filteredQuests = allQuests;
    usedFallback = true;
  }

  // Get total count before pagination
  const total = filteredQuests.length;

  // Apply pagination
  const paginatedQuests = filteredQuests.slice(offset, offset + limit);

  // Convert to quest summaries (without full requirements/design)
  const questSummaries: QuestSummary[] = paginatedQuests.map((quest) => ({
    questId: quest.questId,
    questName: quest.questName,
    status: quest.status,
    createdAt: quest.createdAt,
    taskCount: quest.tasks.length,
    approvalCount: quest.approvalHistory.length,
  }));

  // Build message and nextStep based on whether fallback was used
  let message: string;
  let nextStep: string;
  if (usedFallback) {
    message = `No quests found with status '${input.status}', showing all ${total} quest(s) instead`;
    nextStep = 'Present these quest results to the user. Do not call quest_list_quest again.';
  } else {
    message = `Found ${total} quest(s)${input.status ? ` with status '${input.status}'` : ''}`;
    nextStep = 'Present these quest results to the user. Do not call quest_list_quest again.';
  }

  // Return result
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            quests: questSummaries,
            total,
            limit,
            offset,
            message,
            nextStep,
          },
          null,
          2
        ),
      },
    ],
  };
}
