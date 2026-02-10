/**
 * Tool Inventory Test
 *
 * Validates that all 26 MCP tools are properly registered and exported.
 * This test serves as a safety net against accidental tool removal or
 * misconfiguration during refactoring.
 */

import { describe, it, expect } from 'vitest';
import { allTools, toolCategories, getAllToolNames, getToolCountByCategory } from '../../src/tools/index.js';

/**
 * Expected tool names after task 3.36 (rename) and 3.37 (merge/remove/add)
 */
const EXPECTED_TOOLS = [
  // Agent tools (4)
  'quest_register_agent',
  'quest_unregister_agent',
  'quest_list_agents',
  'quest_agent_heartbeat',

  // Quest tools (6)
  'quest_create_quest',
  'quest_query_quest',
  'quest_list_quest',
  'quest_archive_quest',
  'quest_delete_quest',
  'quest_update_quest',

  // Task tools (11)
  'quest_assign_task',
  'quest_query_task',
  'quest_update_task',
  'quest_delete_task',
  'quest_submit_task_result',
  'quest_verify_task',
  'quest_log_implementation',
  'quest_split_task',
  'quest_plan_task',
  'quest_analyze_task',
  'quest_reflect_task',

  // Approval tools (4)
  'quest_request_quest_approval',
  'quest_submit_approval',
  'quest_query_approval',
  'quest_request_task_approval',

  // Workflow tools (1)
  'quest_workflow_guide',
];

describe('Tool Inventory', () => {
  it('should have exactly 26 tools registered', () => {
    expect(allTools).toHaveLength(26);
  });

  it('should export all expected tool names', () => {
    const toolNames = allTools.map((t) => t.name).sort();
    const expected = [...EXPECTED_TOOLS].sort();
    expect(toolNames).toEqual(expected);
  });

  it('should have correct category counts', () => {
    const counts = getToolCountByCategory();
    expect(counts.agent).toBe(4);
    expect(counts.quest).toBe(6);
    expect(counts.task).toBe(11);
    expect(counts.approval).toBe(4);
    expect(counts.workflow).toBe(1);
    expect(counts.total).toBe(26);
  });

  it('should have no duplicate tool names', () => {
    const names = getAllToolNames();
    const unique = new Set(names);
    expect(unique.size).toBe(names.length);
  });

  it('should have valid tool definitions (name + description + inputSchema)', () => {
    for (const tool of allTools) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.inputSchema).toBeDefined();
      expect(tool.inputSchema.type).toBe('object');
    }
  });

  describe('Category: agent', () => {
    it('should have 4 agent tools', () => {
      expect(toolCategories.agent).toHaveLength(4);
    });
  });

  describe('Category: quest', () => {
    it('should have 6 quest tools', () => {
      expect(toolCategories.quest).toHaveLength(6);
    });

    it('should NOT contain removed tools', () => {
      const names = toolCategories.quest.map((t) => t.name);
      // Removed in task 3.37
      expect(names).not.toContain('quest_clear_completed');
      expect(names).not.toContain('quest_list_templates');
      expect(names).not.toContain('quest_create_from_template');
      // Merged in task 3.37
      expect(names).not.toContain('quest_get_details');
      expect(names).not.toContain('quest_get_status');
    });

    it('should NOT contain old tool names from task 3.36', () => {
      const names = toolCategories.quest.map((t) => t.name);
      expect(names).not.toContain('quest_list');
      expect(names).not.toContain('quest_create');
      expect(names).not.toContain('quest_revise');
      expect(names).not.toContain('quest_cancel_quest');
    });
  });

  describe('Category: task', () => {
    it('should have 11 task tools', () => {
      expect(toolCategories.task).toHaveLength(11);
    });

    it('should NOT contain removed/merged tools', () => {
      const names = toolCategories.task.map((t) => t.name);
      expect(names).not.toContain('quest_get_task_details');
      expect(names).not.toContain('quest_update_task_status');
      expect(names).not.toContain('quest_research_mode');
      // Old names from task 3.36
      expect(names).not.toContain('quest_assign_tasks');
      expect(names).not.toContain('quest_split_tasks');
      expect(names).not.toContain('quest_query_tasks');
    });
  });

  describe('Category: approval', () => {
    it('should have 4 approval tools', () => {
      expect(toolCategories.approval).toHaveLength(4);
    });

    it('should include new quest_request_task_approval tool', () => {
      const names = toolCategories.approval.map((t) => t.name);
      expect(names).toContain('quest_request_task_approval');
    });

    it('should NOT contain removed tools', () => {
      const names = toolCategories.approval.map((t) => t.name);
      expect(names).not.toContain('quest_delete_approval');
      // Old names from task 3.36
      expect(names).not.toContain('quest_request_approval');
      expect(names).not.toContain('quest_approval_status');
    });
  });

  describe('Category: workflow', () => {
    it('should have 1 workflow tool', () => {
      expect(toolCategories.workflow).toHaveLength(1);
    });
  });
});
