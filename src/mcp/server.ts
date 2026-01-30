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

// Import tool handlers
import { questCreateTool, handleQuestCreate } from '../tools/questCreate.js';
import { questReviseTool, handleQuestRevise } from '../tools/questRevise.js';
import { questRequestApprovalTool, handleQuestRequestApproval } from '../tools/questRequestApproval.js';
import { questSubmitApprovalTool, handleQuestSubmitApproval } from '../tools/questSubmitApproval.js';
import { questSplitTasksTool, handleQuestSplitTasks } from '../tools/questSplitTasks.js';
import { questListTool, handleQuestList } from '../tools/questList.js';
import { questGetDetailsTool, handleQuestGetDetails } from '../tools/questGetDetails.js';
import { questAssignTasksTool, handleQuestAssignTasks } from '../tools/questAssignTasks.js';
import { questGetTaskDetailsTool, handleQuestGetTaskDetails } from '../tools/questGetTaskDetails.js';
import { questUpdateTaskStatusTool, handleQuestUpdateTaskStatus } from '../tools/questUpdateTaskStatus.js';
import { questSubmitTaskResultTool, handleQuestSubmitTaskResult } from '../tools/questSubmitTaskResult.js';
import { questVerifyTaskTool, handleQuestVerifyTask } from '../tools/questVerifyTask.js';
import { questRegisterAgentTool, handleQuestRegisterAgent } from '../tools/questRegisterAgent.js';
import { questListAgentsTool, handleQuestListAgents } from '../tools/questListAgents.js';
import { questCreateFromTemplateTool, handleQuestCreateFromTemplate } from '../tools/questCreateFromTemplate.js';
import { questListTemplatesTool, handleQuestListTemplates } from '../tools/questListTemplates.js';
import { questCancelQuestTool, handleQuestCancelQuest } from '../tools/questCancelQuest.js';
import { questDeleteQuestTool, handleQuestDeleteQuest } from '../tools/questDeleteQuest.js';
import { questDeleteTaskTool, handleQuestDeleteTask } from '../tools/questDeleteTask.js';
import { questLogImplementationTool, handleQuestLogImplementation } from '../tools/questLogImplementation.js';
import { questGetStatusTool, handleQuestGetStatus } from '../tools/questGetStatus.js';
import { questApprovalStatusTool, handleQuestApprovalStatus } from '../tools/questApprovalStatus.js';
import { questDeleteApprovalTool, handleQuestDeleteApproval } from '../tools/questDeleteApproval.js';
import { questAnalyzeTaskTool, handleQuestAnalyzeTask } from '../tools/questAnalyzeTask.js';
import { questPlanTaskTool, handleQuestPlanTask } from '../tools/questPlanTask.js';
import { questQueryTasksTool, handleQuestQueryTasks } from '../tools/questQueryTasks.js';
import { questUpdateTaskTool, handleQuestUpdateTask } from '../tools/questUpdateTask.js';
import { questReflectTaskTool, handleQuestReflectTask } from '../tools/questReflectTask.js';
import { questClearCompletedTool, handleQuestClearCompleted } from '../tools/questClearCompleted.js';
import { questAgentHeartbeatTool, handleQuestAgentHeartbeat } from '../tools/questAgentHeartbeat.js';
import { questUnregisterAgentTool, handleQuestUnregisterAgent } from '../tools/questUnregisterAgent.js';
import { questWorkflowGuideTool, handleQuestWorkflowGuide } from '../tools/questWorkflowGuide.js';
import { questResearchModeTool, handleQuestResearchMode } from '../tools/questResearchMode.js';

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
   */
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        questCreateTool,
        questReviseTool,
        questRequestApprovalTool,
        questSubmitApprovalTool,
        questSplitTasksTool,
        questListTool,
        questGetDetailsTool,
        questAssignTasksTool,
        questGetTaskDetailsTool,
        questUpdateTaskStatusTool,
        questSubmitTaskResultTool,
        questVerifyTaskTool,
        questRegisterAgentTool,
        questListAgentsTool,
        questCreateFromTemplateTool,
        questListTemplatesTool,
        questCancelQuestTool,
        questDeleteQuestTool,
        questDeleteTaskTool,
        questLogImplementationTool,
        questGetStatusTool,
        questApprovalStatusTool,
        questDeleteApprovalTool,
        questAnalyzeTaskTool,
        questPlanTaskTool,
        questQueryTasksTool,
        questUpdateTaskTool,
        questReflectTaskTool,
        questClearCompletedTool,
        questAgentHeartbeatTool,
        questUnregisterAgentTool,
        questWorkflowGuideTool,
        questResearchModeTool,
        // Future tools will be added here
      ],
    };
  });

  /**
   * Handle tool calls
   */
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        case 'quest_create':
          return await handleQuestCreate(args);

        case 'quest_revise':
          return await handleQuestRevise(args);

        case 'quest_request_approval':
          return await handleQuestRequestApproval(args);

        case 'quest_submit_approval':
          return await handleQuestSubmitApproval(args);

        case 'quest_split_tasks':
          return await handleQuestSplitTasks(args);

        case 'quest_list':
          return await handleQuestList(args);

        case 'quest_get_details':
          return await handleQuestGetDetails(args);

        case 'quest_assign_tasks':
          return await handleQuestAssignTasks(args);

        case 'quest_get_task_details':
          return await handleQuestGetTaskDetails(args);

        case 'quest_update_task_status':
          return await handleQuestUpdateTaskStatus(args);

        case 'quest_submit_task_result':
          return await handleQuestSubmitTaskResult(args);

        case 'quest_verify_task':
          return await handleQuestVerifyTask(args);

        case 'quest_register_agent':
          return await handleQuestRegisterAgent(args);

        case 'quest_list_agents':
          return await handleQuestListAgents(args);

        case 'quest_create_from_template':
          return await handleQuestCreateFromTemplate(args);

        case 'quest_list_templates':
          return await handleQuestListTemplates(args);

        case 'quest_cancel_quest':
          return await handleQuestCancelQuest(args);

        case 'quest_delete_quest':
          return await handleQuestDeleteQuest(args);

        case 'quest_delete_task':
          return await handleQuestDeleteTask(args);

        case 'quest_log_implementation':
          return await handleQuestLogImplementation(args || {});

        case 'quest_get_status':
          return await handleQuestGetStatus(args);

        case 'quest_approval_status':
          return await handleQuestApprovalStatus(args);

        case 'quest_delete_approval':
          return await handleQuestDeleteApproval(args);

        case 'quest_analyze_task':
          return await handleQuestAnalyzeTask(args || {});

        case 'quest_plan_task':
          return await handleQuestPlanTask(args || {});

        case 'quest_query_tasks':
          return await handleQuestQueryTasks(args || {});

        case 'quest_update_task':
          return await handleQuestUpdateTask(args || {});

        case 'quest_reflect_task':
          return await handleQuestReflectTask(args || {});

        case 'quest_clear_completed':
          return await handleQuestClearCompleted(args || {});

        case 'quest_agent_heartbeat':
          return await handleQuestAgentHeartbeat(args || {});

        case 'quest_unregister_agent':
          return await handleQuestUnregisterAgent(args || {});

        case 'quest_workflow_guide':
          return await handleQuestWorkflowGuide();

        case 'quest_research_mode':
          return await handleQuestResearchMode(args || {});

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
