/**
 * MCP Server Quest Tools
 *
 * All tools organized by category:
 * - agent: Agent management (5 tools)
 * - quest: Quest lifecycle (10 tools)
 * - task: Task management (14 tools)
 * - approval: Approval workflow (4 tools)
 * - workflow: Workflow guidance (1 tool)
 *
 * Total: 34 tools
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';

// Re-export all category exports
export * from './agent/index.js';
export * from './quest/index.js';
export * from './task/index.js';
export * from './approval/index.js';
export * from './workflow/index.js';

// Import all tools for aggregation
import {
  questRegisterAgentTool,
  questUnregisterAgentTool,
  questListAgentsTool,
  questAgentHeartbeatTool,
} from './agent/index.js';

import {
  questCreateTool,
  questCreateFromTemplateTool,
  questGetDetailsTool,
  questGetStatusTool,
  questListTool,
  questListTemplatesTool,
  questCancelQuestTool,
  questDeleteQuestTool,
  questClearCompletedTool,
  questReviseTool,
} from './quest/index.js';

import {
  questAssignTasksTool,
  questGetTaskDetailsTool,
  questUpdateTaskStatusTool,
  questQueryTasksTool,
  questUpdateTaskTool,
  questDeleteTaskTool,
  questSubmitTaskResultTool,
  questVerifyTaskTool,
  questLogImplementationTool,
  questSplitTasksTool,
  questPlanTaskTool,
  questAnalyzeTaskTool,
  questReflectTaskTool,
  questResearchModeTool,
} from './task/index.js';

import {
  questRequestApprovalTool,
  questSubmitApprovalTool,
  questApprovalStatusTool,
  questDeleteApprovalTool,
} from './approval/index.js';

import {
  questWorkflowGuideTool,
} from './workflow/index.js';

/**
 * All MCP tools organized by category
 */
export const allTools: Tool[] = [
  // Agent tools (4)
  questRegisterAgentTool,
  questUnregisterAgentTool,
  questListAgentsTool,
  questAgentHeartbeatTool,

  // Quest tools (10)
  questCreateTool,
  questCreateFromTemplateTool,
  questGetDetailsTool,
  questGetStatusTool,
  questListTool,
  questListTemplatesTool,
  questCancelQuestTool,
  questDeleteQuestTool,
  questClearCompletedTool,
  questReviseTool,

  // Task tools (14)
  questAssignTasksTool,
  questGetTaskDetailsTool,
  questUpdateTaskStatusTool,
  questQueryTasksTool,
  questUpdateTaskTool,
  questDeleteTaskTool,
  questSubmitTaskResultTool,
  questVerifyTaskTool,
  questLogImplementationTool,
  questSplitTasksTool,
  questPlanTaskTool,
  questAnalyzeTaskTool,
  questReflectTaskTool,
  questResearchModeTool,

  // Approval tools (4)
  questRequestApprovalTool,
  questSubmitApprovalTool,
  questApprovalStatusTool,
  questDeleteApprovalTool,

  // Workflow tools (1)
  questWorkflowGuideTool,
];

/**
 * Tool categories for documentation and filtering
 */
export const toolCategories = {
  agent: [
    questRegisterAgentTool,
    questUnregisterAgentTool,
    questListAgentsTool,
    questAgentHeartbeatTool,
  ],
  quest: [
    questCreateTool,
    questCreateFromTemplateTool,
    questGetDetailsTool,
    questGetStatusTool,
    questListTool,
    questListTemplatesTool,
    questCancelQuestTool,
    questDeleteQuestTool,
    questClearCompletedTool,
    questReviseTool,
  ],
  task: [
    questAssignTasksTool,
    questGetTaskDetailsTool,
    questUpdateTaskStatusTool,
    questQueryTasksTool,
    questUpdateTaskTool,
    questDeleteTaskTool,
    questSubmitTaskResultTool,
    questVerifyTaskTool,
    questLogImplementationTool,
    questSplitTasksTool,
    questPlanTaskTool,
    questAnalyzeTaskTool,
    questReflectTaskTool,
    questResearchModeTool,
  ],
  approval: [
    questRequestApprovalTool,
    questSubmitApprovalTool,
    questApprovalStatusTool,
    questDeleteApprovalTool,
  ],
  workflow: [
    questWorkflowGuideTool,
  ],
};

/**
 * Get tools by category
 */
export function getToolsByCategory(category: keyof typeof toolCategories): Tool[] {
  return toolCategories[category];
}

/**
 * Get all tool names
 */
export function getAllToolNames(): string[] {
  return allTools.map(tool => tool.name);
}

/**
 * Get tool count by category
 */
export function getToolCountByCategory(): Record<string, number> {
  return {
    agent: toolCategories.agent.length,
    quest: toolCategories.quest.length,
    task: toolCategories.task.length,
    approval: toolCategories.approval.length,
    workflow: toolCategories.workflow.length,
    total: allTools.length,
  };
}
