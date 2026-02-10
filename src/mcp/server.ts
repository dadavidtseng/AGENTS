/**
 * MCP Server - Model Context Protocol server implementation
 * Provides quest management tools for AI agents
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

// Import all tools and handlers from categorized structure
import { allTools } from '../tools/index.js';

// Import handlers by category
import {
  handleQuestRegisterAgent,
  handleQuestUnregisterAgent,
  handleQuestListAgents,
  handleQuestAgentHeartbeat,
} from '../tools/agent/index.js';

import {
  handleQuestCreateQuest,
  handleQuestQueryQuest,
  handleQuestListQuest,
  handleQuestArchiveQuest,
  handleQuestDeleteQuest,
  handleQuestUpdateQuest,
} from '../tools/quest/index.js';

import {
  handleQuestAssignTask,
  handleQuestQueryTask,
  handleQuestUpdateTask,
  handleQuestDeleteTask,
  handleQuestSubmitTaskResult,
  handleQuestVerifyTask,
  handleQuestLogImplementation,
  handleQuestSplitTask,
  handleQuestPlanTask,
  handleQuestAnalyzeTask,
  handleQuestReflectTask,
} from '../tools/task/index.js';

import {
  handleQuestRequestQuestApproval,
  handleQuestSubmitApproval,
  handleQuestQueryApproval,
  handleQuestRequestTaskApproval,
} from '../tools/approval/index.js';

import {
  handleQuestWorkflowGuide,
} from '../tools/workflow/index.js';

/**
 * Initialize and start MCP server
 */
export async function startMCPServer() {
  const server = new Server(
    {
      name: 'mcp-server-quest',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  /**
   * List available tools
   * All tools are imported from categorized structure
   */
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: allTools,
    };
  });

  /**
   * Handle tool calls
   */
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        case 'quest_create_quest':
          return await handleQuestCreateQuest(args);

        case 'quest_update_quest':
          return await handleQuestUpdateQuest(args);

        case 'quest_request_quest_approval':
          return await handleQuestRequestQuestApproval(args);

        case 'quest_submit_approval':
          return await handleQuestSubmitApproval(args);

        case 'quest_split_task':
          return await handleQuestSplitTask(args);

        case 'quest_list_quest':
          return await handleQuestListQuest(args);

        case 'quest_query_quest':
          return await handleQuestQueryQuest(args);

        case 'quest_assign_task':
          return await handleQuestAssignTask(args);

        case 'quest_submit_task_result':
          return await handleQuestSubmitTaskResult(args);

        case 'quest_verify_task':
          return await handleQuestVerifyTask(args);

        case 'quest_register_agent':
          return await handleQuestRegisterAgent(args);

        case 'quest_list_agents':
          return await handleQuestListAgents(args);

        case 'quest_archive_quest':
          return await handleQuestArchiveQuest(args);

        case 'quest_delete_quest':
          return await handleQuestDeleteQuest(args);

        case 'quest_delete_task':
          return await handleQuestDeleteTask(args);

        case 'quest_log_implementation':
          return await handleQuestLogImplementation(args || {});

        case 'quest_query_approval':
          return await handleQuestQueryApproval(args);

        case 'quest_request_task_approval':
          return await handleQuestRequestTaskApproval(args);

        case 'quest_analyze_task':
          return await handleQuestAnalyzeTask(args || {});

        case 'quest_plan_task':
          return await handleQuestPlanTask(args || {});

        case 'quest_query_task':
          return await handleQuestQueryTask(args || {});

        case 'quest_update_task':
          return await handleQuestUpdateTask(args || {});

        case 'quest_reflect_task':
          return await handleQuestReflectTask(args || {});

        case 'quest_agent_heartbeat':
          return await handleQuestAgentHeartbeat(args || {});

        case 'quest_unregister_agent':
          return await handleQuestUnregisterAgent(args || {});

        case 'quest_workflow_guide':
          return await handleQuestWorkflowGuide();

        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${errorMessage}`,
          },
        ],
        isError: true,
      };
    }
  });

  // Start server with stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error('[MCP] Server started');
}
