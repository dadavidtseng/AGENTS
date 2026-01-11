/**
 * Delete Folder Tool (1:1 mapping)
 *
 * Direct mapping to cloud-file-manager-ability's delete_folder() method.
 */

import { z, logger, MODULE_AGENT, timer, getCloudFileManagerAbilityPath } from './utils.js';
import type { KadiClient } from '@kadi.build/core';

export const deleteFolderInputSchema = z.object({
  serviceName: z.enum(['dropbox', 'googledrive', 'box']).describe('Cloud service name'),
  remotePath: z.string().describe('Remote folder path to delete'),
  recursive: z.boolean().optional().describe('Delete folder and all contents (default: false)')
});

export const deleteFolderOutputSchema = z.object({
  success: z.boolean().describe('Whether the operation succeeded'),
  message: z.string().describe('Result message')
});

export type DeleteFolderInput = z.infer<typeof deleteFolderInputSchema>;
export type DeleteFolderOutput = z.infer<typeof deleteFolderOutputSchema>;

export function registerDeleteFolderTool(client: KadiClient) {
  client.registerTool(
    {
      name: 'cloud_delete_folder',
      description: 'Delete a folder from cloud storage. Direct mapping to cloud-file-manager-ability.',
      input: deleteFolderInputSchema,
      output: deleteFolderOutputSchema,
    },
    async (params: DeleteFolderInput): Promise<DeleteFolderOutput> => {
      logger.info(MODULE_AGENT, `Executing delete_folder: ${params.serviceName}:${params.remotePath}`, timer.elapsed('main'));

      try {
        const abilityPath = getCloudFileManagerAbilityPath();
        const cloudManager = await client.load('cloud-file-manager-ability', 'native', {
          path: abilityPath
        });

        const result = await cloudManager.cloud_delete_folder(params);
        await cloudManager.__disconnect();

        logger.info(MODULE_AGENT, `Delete folder completed successfully`, timer.elapsed('main'));
        return result;

      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.info(MODULE_AGENT, `Delete folder failed: ${errorMessage}`, timer.elapsed('main'));

        return {
          success: false,
          message: `Delete folder failed: ${errorMessage}`
        };
      }
    }
  );
}
