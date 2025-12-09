/**
 * List Active Tasks Tool Implementation (Simple Wrapper)
 *
 * Queries active tasks from mcp-shrimp-task-manager with optional status filtering.
 * This is a simple query operation that doesn't require Claude API orchestration.
 */

import type { KadiClient } from '@kadi.build/core';
import { z } from 'zod';
import { invokeShrimTool, publishToolEvent } from 'agents-library';

// ============================================================================
// Types
// ============================================================================

export const listActiveTasksInputSchema = z.object({
  status: z.enum(['all', 'pending', 'in_progress', 'completed', 'blocked']).optional().describe('Optional status filter (defaults to "all")')
});

export const listActiveTasksOutputSchema = z.object({
  tasks: z.array(z.any()).describe('Array of tasks matching filter criteria'),
  total: z.number().describe('Total number of tasks returned')
});

export type ListActiveTasksInput = z.infer<typeof listActiveTasksInputSchema>;
export type ListActiveTasksOutput = z.infer<typeof listActiveTasksOutputSchema>;

// ============================================================================
// List Active Tasks Handler
// ============================================================================

export async function createListActiveTasksHandler(
  client: KadiClient
): Promise<(params: ListActiveTasksInput) => Promise<ListActiveTasksOutput>> {
  return async (params: ListActiveTasksInput): Promise<ListActiveTasksOutput> => {
    console.log(`📋 [list_active_tasks HANDLER CALLED] Status filter: ${params.status || 'all'}`);

    try {
      const protocol = client.getBrokerProtocol();

      // Forward to shrimp_list_tasks via agents-library
      const result = await invokeShrimTool(protocol, 'shrimp_list_tasks', {
        status: params.status || 'all',
      }, { client }); // Pass client for async response handling

      if (!result.success) {
        throw new Error(result.error?.message || 'Failed to invoke shrimp_list_tasks');
      }

      // Extract task list from MCP response
      // The MCP response contains the task list in text format
      const listContent = Array.isArray(result.data.content)
        ? result.data.content.filter((item: any) => item.type === 'text').map((item: any) => item.text).join('\n')
        : String(result.data);

      // Parse tasks from markdown format
      // Expected format: ### Task Name \n **ID:** `uuid`
      const tasks: Array<{id: string, name: string, status: string}> = [];
      const taskPattern = /###\s+([^\n]+)\s+\*\*ID:\*\*\s*`?([a-f0-9\-]{36})`?/gi;
      let match;

      while ((match = taskPattern.exec(listContent)) !== null) {
        const name = match[1].trim();
        const id = match[2];

        // Extract status if available (defaults to pending)
        let status = 'pending';

        // Look for status in the text following the ID
        const taskBlock = listContent.substring(match.index, match.index + 500);
        const statusMatch = taskBlock.match(/\*\*Status:\*\*\s*(\w+)/i);
        if (statusMatch) {
          status = statusMatch[1].toLowerCase();
        }

        tasks.push({ id, name, status });
      }

      console.log(`✅ Found ${tasks.length} task(s)`);

      return {
        tasks,
        total: tasks.length,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`❌ Failed to list tasks: ${errorMsg}`);

      // Publish failure event using publishToolEvent from agents-library
      await publishToolEvent(client, 'failed',
        { error: errorMsg },
        { toolName: 'list_active_tasks' }
      );

      throw new Error(`Failed to list tasks: ${errorMsg}`);
    }
  };
}
