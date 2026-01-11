/**
 * List Folders Tool (1:1 mapping)
 *
 * Direct mapping to cloud-file-manager-ability's list_folders() method.
 */

import { z, logger, MODULE_AGENT, timer, getCloudFileManagerAbilityPath } from './utils.js';
import type { KadiClient } from '@kadi.build/core';

export const listFoldersInputSchema = z.object({
  serviceName: z.enum(['dropbox', 'googledrive', 'box']).describe('Cloud service name'),
  remotePath: z.string().optional().describe('Remote directory path (default: "/")')
});

export const listFoldersOutputSchema = z.object({
  success: z.boolean().describe('Whether the operation succeeded'),
  folders: z.array(z.any()).optional().describe('List of folders'),
  error: z.string().optional().describe('Error message if operation failed')
});

export type ListFoldersInput = z.infer<typeof listFoldersInputSchema>;
export type ListFoldersOutput = z.infer<typeof listFoldersOutputSchema>;

export function registerListFoldersTool(client: KadiClient) {
  client.registerTool(
    {
      name: 'cloud_list_folders',
      description: 'List folders in a cloud storage directory. Direct mapping to cloud-file-manager-ability.',
      input: listFoldersInputSchema,
      output: listFoldersOutputSchema,
    },
    async (params: ListFoldersInput): Promise<ListFoldersOutput> => {
      logger.info(MODULE_AGENT, `Executing list_folders: ${params.serviceName}:${params.remotePath || '/'}`, timer.elapsed('main'));

      try {
        const abilityPath = getCloudFileManagerAbilityPath();
        const cloudManager = await client.load('cloud-file-manager-ability', 'native', {
          path: abilityPath
        });

        const result = await cloudManager.cloud_list_folders(params);
        await cloudManager.__disconnect();

        logger.info(MODULE_AGENT, `List folders completed: ${result.folders?.length || 0} folders found`, timer.elapsed('main'));
        return result;

      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.info(MODULE_AGENT, `List folders failed: ${errorMessage}`, timer.elapsed('main'));

        return {
          success: false,
          error: `List folders failed: ${errorMessage}`
        };
      }
    }
  );
}
