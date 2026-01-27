/**
 * List Files Tool (1:1 mapping)
 *
 * Direct mapping to cloud-file-manager-ability's list_files() method.
 * Lists files in a cloud storage directory.
 */

import { z, logger, MODULE_AGENT, timer, getCloudFileManagerAbilityPath } from './utils.js';
import type { KadiClient } from '@kadi.build/core';

export const listFilesInputSchema = z.object({
  serviceName: z.enum(['dropbox', 'googledrive', 'box']).describe('Cloud service name'),
  remotePath: z.string().optional().describe('Remote directory path (default: "/")'),
  options: z.any().optional().describe('Additional options')
});

export const listFilesOutputSchema = z.object({
  success: z.boolean().describe('Whether the operation succeeded'),
  files: z.array(z.any()).optional().describe('List of files'),
  error: z.string().optional().describe('Error message if operation failed')
});

export type ListFilesInput = z.infer<typeof listFilesInputSchema>;
export type ListFilesOutput = z.infer<typeof listFilesOutputSchema>;

/**
 * Register the list_files tool
 */
export function registerListFilesTool(client: KadiClient) {
  client.registerTool(
    {
      name: 'cloud_list_files',
      description: 'List files in a cloud storage directory. Direct mapping to cloud-file-manager-ability.',
      input: listFilesInputSchema,
      output: listFilesOutputSchema,
    },
    async (params: ListFilesInput): Promise<ListFilesOutput> => {
      logger.info(
        MODULE_AGENT,
        `Executing list_files: ${params.serviceName}:${params.remotePath || '/'}`,
        timer.elapsed('main')
      );

      try {
        const abilityPath = getCloudFileManagerAbilityPath();
        const cloudManager = await client.loadNative('cloud-file-manager-ability', {
          path: process.env.CLOUD_FILE_MANAGER_ABILITY_PATH!
        });

        const result = await cloudManager.invoke('cloud_list_files', params);
        await cloudManager.disconnect();

        logger.info(MODULE_AGENT, `List completed: ${result.files?.length || 0} files found`, timer.elapsed('main'));

        return result;

      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.info(MODULE_AGENT, `List failed: ${errorMessage}`, timer.elapsed('main'));

        return {
          success: false,
          error: `List failed: ${errorMessage}`
        };
      }
    }
  );
}
