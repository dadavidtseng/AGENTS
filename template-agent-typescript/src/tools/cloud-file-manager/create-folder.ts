/**
 * Create Folder Tool (1:1 mapping)
 *
 * Direct mapping to cloud-file-manager-ability's create_folder() method.
 */

import { z, logger, MODULE_AGENT, timer, getCloudFileManagerAbilityPath } from './utils.js';
import type { KadiClient } from '@kadi.build/core';

export const createFolderInputSchema = z.object({
  serviceName: z.enum(['dropbox', 'googledrive', 'box']).describe('Cloud service name'),
  remotePath: z.string().describe('Remote folder path to create')
});

export const createFolderOutputSchema = z.object({
  success: z.boolean().describe('Whether the operation succeeded'),
  result: z.any().optional().describe('Create result'),
  error: z.string().optional().describe('Error message if operation failed')
});

export type CreateFolderInput = z.infer<typeof createFolderInputSchema>;
export type CreateFolderOutput = z.infer<typeof createFolderOutputSchema>;

export function registerCreateFolderTool(client: KadiClient) {
  client.registerTool(
    {
      name: 'cloud_create_folder',
      description: 'Create a folder in cloud storage. Direct mapping to cloud-file-manager-ability.',
      input: createFolderInputSchema,
      output: createFolderOutputSchema,
    },
    async (params: CreateFolderInput): Promise<CreateFolderOutput> => {
      logger.info(MODULE_AGENT, `Executing create_folder: ${params.serviceName}:${params.remotePath}`, timer.elapsed('main'));

      try {
        const abilityPath = getCloudFileManagerAbilityPath();
        const cloudManager = await client.loadNative('cloud-file-manager-ability', {
          path: process.env.CLOUD_FILE_MANAGER_ABILITY_PATH!
        });

        const result = await cloudManager.invoke('cloud_create_folder', params);
        await cloudManager.disconnect();

        logger.info(MODULE_AGENT, `Create folder completed successfully`, timer.elapsed('main'));
        return result;

      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.info(MODULE_AGENT, `Create folder failed: ${errorMessage}`, timer.elapsed('main'));

        return {
          success: false,
          error: `Create folder failed: ${errorMessage}`
        };
      }
    }
  );
}
