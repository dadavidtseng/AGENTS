/**
 * MCP Server Quest Tools
 *
 * All tools organized by category:
 * - agent: Agent management (4 tools)
 * - quest: Quest lifecycle (6 tools)
 * - task: Task management (11 tools)
 * - approval: Approval workflow (4 tools)
 * - workflow: Workflow guidance (1 tool)
 *
 * Total: 26 tools
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
  questCreateQuestTool,
  questQueryQuestTool,
  questListQuestTool,
  questArchiveQuestTool,
  questDeleteQuestTool,
  questUpdateQuestTool,
} from './quest/index.js';

import {
  questAssignTaskTool,
  questQueryTaskTool,
  questUpdateTaskTool,
  questDeleteTaskTool,
  questSubmitTaskResultTool,
  questVerifyTaskTool,
  questLogImplementationTool,
  questSplitTaskTool,
  questPlanTaskTool,
  questAnalyzeTaskTool,
  questReflectTaskTool,
} from './task/index.js';

import {
  questRequestQuestApprovalTool,
  questSubmitApprovalTool,
  questQueryApprovalTool,
  questRequestTaskApprovalTool,
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

  // Quest tools (6)
  questCreateQuestTool,
  questQueryQuestTool,
  questListQuestTool,
  questArchiveQuestTool,
  questDeleteQuestTool,
  questUpdateQuestTool,

  // Task tools (11)
  questAssignTaskTool,
  questQueryTaskTool,
  questUpdateTaskTool,
  questDeleteTaskTool,
  questSubmitTaskResultTool,
  questVerifyTaskTool,
  questLogImplementationTool,
  questSplitTaskTool,
  questPlanTaskTool,
  questAnalyzeTaskTool,
  questReflectTaskTool,

  // Approval tools (4)
  questRequestQuestApprovalTool,
  questSubmitApprovalTool,
  questQueryApprovalTool,
  questRequestTaskApprovalTool,

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
    questCreateQuestTool,
    questQueryQuestTool,
    questListQuestTool,
    questArchiveQuestTool,
    questDeleteQuestTool,
    questUpdateQuestTool,
  ],
  task: [
    questAssignTaskTool,
    questQueryTaskTool,
    questUpdateTaskTool,
    questDeleteTaskTool,
    questSubmitTaskResultTool,
    questVerifyTaskTool,
    questLogImplementationTool,
    questSplitTaskTool,
    questPlanTaskTool,
    questAnalyzeTaskTool,
    questReflectTaskTool,
  ],
  approval: [
    questRequestQuestApprovalTool,
    questSubmitApprovalTool,
    questQueryApprovalTool,
    questRequestTaskApprovalTool,
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
