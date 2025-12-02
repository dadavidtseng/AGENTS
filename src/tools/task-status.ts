/**
 * Get Task Status Tool Implementation
 *
 * Retrieves detailed status information for a specific task from mcp-shrimp-task-manager.
 * Simple wrapper that forwards to shrimp_get_task_detail.
 */

import type { KadiClient } from '@kadi.build/core';
import { z } from 'zod';

// ============================================================================
// Types
// ============================================================================

export const getTaskStatusInputSchema = z.object({
  taskId: z.string().describe('Task ID to query')
});

export const getTaskStatusOutputSchema = z.object({
  taskId: z.string(),
  description: z.string(),
  status: z.string(),
  role: z.string().optional(),
  progress: z.object({
    filesCreated: z.array(z.string()).optional(),
    filesModified: z.array(z.string()).optional(),
    commitSha: z.string().optional(),
    errorMessage: z.string().optional()
  }).optional()
});

export type GetTaskStatusInput = z.infer<typeof getTaskStatusInputSchema>;
export type GetTaskStatusOutput = z.infer<typeof getTaskStatusOutputSchema>;

// ============================================================================
// Get Task Status Handler
// ============================================================================

export async function createGetTaskStatusHandler(
  client: KadiClient
): Promise<(params: GetTaskStatusInput) => Promise<GetTaskStatusOutput>> {
  return async (params: GetTaskStatusInput): Promise<GetTaskStatusOutput> => {
    console.log(`🔍 Getting status for task: ${params.taskId}`);

    try {
      const protocol = client.getBrokerProtocol();

      // Forward to shrimp_get_task_detail via broker protocol
      const result: any = await protocol.invokeTool({
        targetAgent: 'mcp-server-shrimp-agent-playground',
        toolName: 'shrimp_get_task_detail',
        toolInput: {
          taskId: params.taskId
        },
        timeout: 30000
      });

      // Extract task details from MCP response
      // The MCP response contains the task details in text format
      const detailContent = Array.isArray(result.content)
        ? result.content.filter((item: any) => item.type === 'text').map((item: any) => item.text).join('\n')
        : String(result);

      console.log(`✅ Retrieved status for task ${params.taskId}`);

      // Parse task details from markdown format
      // Expected format: ### Task Name \n **ID:** `uuid` \n **Status:** status ...
      const nameMatch = detailContent.match(/###\s+([^\n]+)/);
      const idMatch = detailContent.match(/\*\*ID:\*\*\s*`?([a-f0-9\-]{36})`?/i);
      const statusMatch = detailContent.match(/\*\*Status:\*\*\s*(\w+)/i);
      const roleMatch = detailContent.match(/\*\*Role:\*\*\s*(\w+)/i);

      // Parse progress information if available
      let progress: any = undefined;
      const filesCreatedMatch = detailContent.match(/\*\*Files Created:\*\*\s*([^\n]+)/i);
      const filesModifiedMatch = detailContent.match(/\*\*Files Modified:\*\*\s*([^\n]+)/i);
      const commitShaMatch = detailContent.match(/\*\*Commit SHA:\*\*\s*([^\n]+)/i);
      const errorMatch = detailContent.match(/\*\*Error:\*\*\s*([^\n]+)/i);

      if (filesCreatedMatch || filesModifiedMatch || commitShaMatch || errorMatch) {
        progress = {};
        if (filesCreatedMatch) {
          progress.filesCreated = filesCreatedMatch[1].split(',').map((f: string) => f.trim());
        }
        if (filesModifiedMatch) {
          progress.filesModified = filesModifiedMatch[1].split(',').map((f: string) => f.trim());
        }
        if (commitShaMatch) {
          progress.commitSha = commitShaMatch[1].trim();
        }
        if (errorMatch) {
          progress.errorMessage = errorMatch[1].trim();
        }
      }

      return {
        taskId: idMatch ? idMatch[1] : params.taskId,
        description: nameMatch ? nameMatch[1].trim() : 'No description available',
        status: statusMatch ? statusMatch[1].toLowerCase() : 'unknown',
        role: roleMatch ? roleMatch[1].toLowerCase() : undefined,
        progress
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`❌ Failed to get task status: ${errorMsg}`);
      throw new Error(`Failed to get task status: ${errorMsg}`);
    }
  };
}
