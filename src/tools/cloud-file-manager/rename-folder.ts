/**
 * Rename Folder Tool (1:1 mapping)
 *
 * Direct mapping to cloud-file-manager-ability's rename_folder() method.
 */

import { z, logger, MODULE_AGENT, timer, getCloudFileManagerAbilityPath } from './utils.js';
import type { KadiClient } from '@kadi.build/core';

export const renameFolderInputSchema = z.object({
  serviceName: z.enum(['dropbox', 'googledrive', 'box']).describe('Cloud service name'),
  remotePath: z.string().describe('Current folder path'),
  newName: z.string().describe('New folder name')
});

export const renameFolderOutputSchema = z.object({
  success: z.boolean().describe('Whether the operation succeeded'),
  result: z.any().optional().describe('Rename result'),
  error: z.string().optional().describe('Error message if operation failed')
});

export type RenameFolderInput = z.infer<typeof renameFolderInputSchema>;
export type RenameFolderOutput = z.infer<typeof renameFolderOutputSchema>;

export function registerRenameFolderTool(client: KadiClient) {
  client.registerTool(
    {
      name: 'cloud_rename_folder',
      description: 'Rename a folder in cloud storage. Direct mapping to cloud-file-manager-ability.',
      input: renameFolderInputSchema,
      output: renameFolderOutputSchema,
    },
    async (params: RenameFolderInput): Promise<RenameFolderOutput> => {
      logger.info(MODULE_AGENT, `Executing rename_folder: ${params.serviceName}:${params.remotePath} to ${params.newName}`, timer.elapsed('main'));

      try {
        const abilityPath = getCloudFileManagerAbilityPath();
        const cloudManager = await client.load('cloud-file-manager-ability', 'native', {
          path: abilityPath
        });

        const result = await cloudManager.cloud_rename_folder(params);
        await cloudManager.__disconnect();

        logger.info(MODULE_AGENT, `Rename folder completed successfully`, timer.elapsed('main'));
        return result;

      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.info(MODULE_AGENT, `Rename folder failed: ${errorMessage}`, timer.elapsed('main'));

        return {
          success: false,
          error: `Rename folder failed: ${errorMessage}`
        };
      }
    }
  );
}
