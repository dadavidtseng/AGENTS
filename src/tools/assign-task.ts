/**
 * Assign Task Tool Implementation
 *
 * Assigns tasks to worker agents (artist, designer, programmer) by validating
 * task existence and publishing KĀDI events for worker agent consumption.
 */

import type { KadiClient } from '@kadi.build/core';
import { z } from 'zod';

// ============================================================================
// Types
// ============================================================================

export const assignTaskInputSchema = z.object({
  taskId: z.string().describe('Task ID to assign'),
  role: z.enum(['artist', 'designer', 'programmer']).optional().describe('Worker role to assign to (auto-detected if not provided)')
});

export const assignTaskOutputSchema = z.object({
  taskId: z.string(),
  role: z.string(),
  message: z.string(),
  status: z.literal('assigned')
});

export type AssignTaskInput = z.infer<typeof assignTaskInputSchema>;
export type AssignTaskOutput = z.infer<typeof assignTaskOutputSchema>;

// ============================================================================
// Assign Task Handler
// ============================================================================

export async function createAssignTaskHandler(
  client: KadiClient
): Promise<(params: AssignTaskInput) => Promise<AssignTaskOutput>> {
  return async (params: AssignTaskInput): Promise<AssignTaskOutput> => {
    console.log(`🎯 Assigning task: ${params.taskId}`);

    try {
      // Step 1: Validate task exists via get_task_status
      // Get the task status handler from registered tools
      const toolHandlers = client.getAllRegisteredTools();
      const getTaskStatusTool = toolHandlers.find(t => t.definition.name === 'get_task_status');

      if (!getTaskStatusTool) {
        throw new Error('get_task_status tool not found - dependency missing');
      }

      const taskStatus: any = await getTaskStatusTool.handler({ taskId: params.taskId });

      // Step 2: Determine worker role
      let role = params.role;
      if (!role) {
        // Try to get role from task metadata
        role = taskStatus.role;

        if (!role) {
          // Fallback: keyword detection in description
          const desc = taskStatus.description.toLowerCase();
          if (/design|ui|ux|mockup/.test(desc)) {
            role = 'designer';
          } else if (/art|visual|graphics/.test(desc)) {
            role = 'artist';
          } else if (/code|implement|program|dev/.test(desc)) {
            role = 'programmer';
          } else {
            // Final fallback: default to programmer for generic tasks
            role = 'programmer';
            console.log(`⚠️  No role detected, defaulting to 'programmer' for generic task`);
          }
        }
      }

      // Step 3: Validate task status (prevent assigning completed tasks)
      if (taskStatus.status === 'completed') {
        throw new Error(`Task ${params.taskId} is already completed`);
      }

      // Step 4: Publish KĀDI event
      client.publishEvent(`${role}.task.assigned`, {
        taskId: params.taskId,
        role,
        description: taskStatus.description,
        status: taskStatus.status,
        assignedAt: new Date().toISOString(),
        agent: 'agent-producer'
      });
      console.log(`📤 Published ${role}.task.assigned event for task ${params.taskId}`);

      // Step 5: Return success response
      return {
        taskId: params.taskId,
        role,
        message: `Task assigned to ${role} agent`,
        status: 'assigned'
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`❌ Failed to assign task: ${errorMsg}`);

      // Publish failure event
      client.publishEvent('task.assignment.failed', {
        taskId: params.taskId,
        error: errorMsg,
        agent: 'agent-producer'
      });

      throw new Error(`Failed to assign task: ${errorMsg}`);
    }
  };
}
