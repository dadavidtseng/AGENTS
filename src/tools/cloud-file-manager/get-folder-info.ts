/**
 * Get Folder Info Tool (1:1 mapping)
 *
 * Direct mapping to cloud-file-manager-ability's get_folder_info() method.
 */

import { z, logger, MODULE_AGENT, timer, getCloudFileManagerAbilityPath } from './utils.js';
import type { KadiClient } from '@kadi.build/core';

export const getFolderInfoInputSchema = z.object({
  serviceName: z.enum(['dropbox', 'googledrive', 'box']).describe('Cloud service name'),
  remotePath: z.string().describe('Remote folder path')
});

export const getFolderInfoOutputSchema = z.object({
  success: z.boolean().describe('Whether the operation succeeded'),
  folderInfo: z.any().optional().describe('Folder information'),
  error: z.string().optional().describe('Error message if operation failed')
});

export type GetFolderInfoInput = z.infer<typeof getFolderInfoInputSchema>;
export type GetFolderInfoOutput = z.infer<typeof getFolderInfoOutputSchema>;

export function registerGetFolderInfoTool(client: KadiClient) {
  client.registerTool(
    {
      name: 'cloud_get_folder_info',
      description: 'Get information about a folder in cloud storage. Direct mapping to cloud-file-manager-ability.',
      input: getFolderInfoInputSchema,
      output: getFolderInfoOutputSchema,
    },
    async (params: GetFolderInfoInput): Promise<GetFolderInfoOutput> => {
      logger.info(MODULE_AGENT, `Executing get_folder_info: ${params.serviceName}:${params.remotePath}`, timer.elapsed('main'));

      try {
        const abilityPath = getCloudFileManagerAbilityPath();
        const cloudManager = await client.load('cloud-file-manager-ability', 'native', {
          path: abilityPath
        });

        const result = await cloudManager.cloud_get_folder_info(params);
        await cloudManager.__disconnect();

        logger.info(MODULE_AGENT, `Get folder info completed successfully`, timer.elapsed('main'));
        return result;

      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.info(MODULE_AGENT, `Get folder info failed: ${errorMessage}`, timer.elapsed('main'));

        return {
          success: false,
          error: `Get folder info failed: ${errorMessage}`
        };
      }
    }
  );
}
