/**
 * Merged Tool Schema Tests
 *
 * Validates the input schemas and tool definitions for tools that were
 * merged in task 3.37:
 * - quest_query_quest (merged quest_get_status + quest_get_details)
 * - quest_query_task (merged quest_query_tasks + quest_get_task_details)
 * - quest_update_task (merged quest_update_task + quest_update_task_status)
 * - quest_request_task_approval (new tool added in task 3.37)
 */

import { describe, it, expect } from 'vitest';
import { questQueryQuestTool } from '../../src/tools/quest/questQueryQuest.js';
import { questQueryTaskTool } from '../../src/tools/task/questQueryTask.js';
import { questUpdateTaskTool } from '../../src/tools/task/questUpdateTask.js';
import { questRequestTaskApprovalTool } from '../../src/tools/approval/questRequestTaskApproval.js';

describe('quest_query_quest (merged tool)', () => {
  it('should have correct tool name', () => {
    expect(questQueryQuestTool.name).toBe('quest_query_quest');
  });

  it('should require questId', () => {
    const schema = questQueryQuestTool.inputSchema;
    expect(schema.required).toContain('questId');
  });

  it('should have optional detail parameter with summary/full enum', () => {
    const props = questQueryQuestTool.inputSchema.properties as Record<string, any>;
    expect(props.detail).toBeDefined();
    expect(props.detail.enum).toEqual(['summary', 'full']);
  });

  it('should describe both modes in description', () => {
    expect(questQueryQuestTool.description).toContain('summary');
    expect(questQueryQuestTool.description).toContain('full');
  });
});

describe('quest_query_task (merged tool)', () => {
  it('should have correct tool name', () => {
    expect(questQueryTaskTool.name).toBe('quest_query_task');
  });

  it('should have no required parameters (flexible query)', () => {
    const schema = questQueryTaskTool.inputSchema;
    expect(schema.required).toEqual([]);
  });

  it('should support taskId for single-task lookup', () => {
    const props = questQueryTaskTool.inputSchema.properties as Record<string, any>;
    expect(props.taskId).toBeDefined();
  });

  it('should support query for keyword search', () => {
    const props = questQueryTaskTool.inputSchema.properties as Record<string, any>;
    expect(props.query).toBeDefined();
  });

  it('should support status filter including pending_approval', () => {
    const props = questQueryTaskTool.inputSchema.properties as Record<string, any>;
    expect(props.status).toBeDefined();
    expect(props.status.enum).toContain('pending_approval');
  });

  it('should describe both modes in description', () => {
    expect(questQueryTaskTool.description).toContain('Get Task by ID');
    expect(questQueryTaskTool.description).toContain('Search Tasks');
  });
});

describe('quest_update_task (merged tool)', () => {
  it('should have correct tool name', () => {
    expect(questUpdateTaskTool.name).toBe('quest_update_task');
  });

  it('should require questId and taskId', () => {
    const schema = questUpdateTaskTool.inputSchema;
    expect(schema.required).toContain('questId');
    expect(schema.required).toContain('taskId');
  });

  it('should support status parameter for status updates', () => {
    const props = questUpdateTaskTool.inputSchema.properties as Record<string, any>;
    expect(props.status).toBeDefined();
    expect(props.status.enum).toContain('in_progress');
    expect(props.status.enum).toContain('pending_approval');
    expect(props.status.enum).toContain('completed');
    expect(props.status.enum).toContain('failed');
  });

  it('should support agentId for authorization', () => {
    const props = questUpdateTaskTool.inputSchema.properties as Record<string, any>;
    expect(props.agentId).toBeDefined();
  });

  it('should support metadata fields (name, description, etc.)', () => {
    const props = questUpdateTaskTool.inputSchema.properties as Record<string, any>;
    expect(props.name).toBeDefined();
    expect(props.description).toBeDefined();
    expect(props.implementationGuide).toBeDefined();
    expect(props.verificationCriteria).toBeDefined();
  });

  it('should describe both metadata and status updates', () => {
    expect(questUpdateTaskTool.description).toContain('Metadata updates');
    expect(questUpdateTaskTool.description).toContain('Status updates');
  });
});

describe('quest_request_task_approval (new tool)', () => {
  it('should have correct tool name', () => {
    expect(questRequestTaskApprovalTool.name).toBe('quest_request_task_approval');
  });

  it('should require questId, taskId, and agentId', () => {
    const schema = questRequestTaskApprovalTool.inputSchema;
    expect(schema.required).toContain('questId');
    expect(schema.required).toContain('taskId');
    expect(schema.required).toContain('agentId');
  });

  it('should have optional summary parameter', () => {
    const props = questRequestTaskApprovalTool.inputSchema.properties as Record<string, any>;
    expect(props.summary).toBeDefined();
    const required = questRequestTaskApprovalTool.inputSchema.required as string[];
    expect(required).not.toContain('summary');
  });

  it('should describe the task-level approval workflow', () => {
    expect(questRequestTaskApprovalTool.description).toContain('task-level approval');
    expect(questRequestTaskApprovalTool.description).toContain('pending_approval');
  });
});
