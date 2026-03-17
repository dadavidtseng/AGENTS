/**
 * Rename File Tool (1:1 mapping)
 *
 * Direct mapping to cloud-file-manager-ability's rename_file() method.
 */

import { z, logger, MODULE_AGENT, timer, getCloudFileManagerAbilityPath } from './utils.js';
import type { KadiClient } from '@kadi.build/core';

export const renameFileInputSchema = z.object({
  serviceName: z.enum(['dropbox', 'googledrive', 'box']).describe('Cloud service name'),
  remotePath: z.string().describe('Current file path'),
  newName: z.string().describe('New file name')
});

export const renameFileOutputSchema = z.object({
  success: z.boolean().describe('Whether the operation succeeded'),
  result: z.any().optional().describe('Rename result'),
  error: z.string().optional().describe('Error message if operation failed')
});

export type RenameFileInput = z.infer<typeof renameFileInputSchema>;
export type RenameFileOutput = z.infer<typeof renameFileOutputSchema>;

export function registerRenameFileTool(client: KadiClient) {
  client.registerTool(
    {
      name: 'cloud_rename_file',
      description: 'Rename a file in cloud storage. Direct mapping to cloud-file-manager-ability.',
      input: renameFileInputSchema,
      output: renameFileOutputSchema,
    },
    async (params: RenameFileInput): Promise<RenameFileOutput> => {
      logger.info(MODULE_AGENT, `Executing rename_file: ${params.serviceName}:${params.remotePath} to ${params.newName}`, timer.elapsed('main'));

      try {
        const abilityPath = getCloudFileManagerAbilityPath();
        const cloudManager = await client.loadNative('cloud-file-manager-ability', {
          path: process.env.CLOUD_FILE_MANAGER_ABILITY_PATH!
        });

        const result = await cloudManager.invoke('cloud_rename_file', params);
        await cloudManager.disconnect();

        logger.info(MODULE_AGENT, `Rename completed successfully`, timer.elapsed('main'));
        return result;

      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.info(MODULE_AGENT, `Rename failed: ${errorMessage}`, timer.elapsed('main'));

        return {
          success: false,
          error: `Rename failed: ${errorMessage}`
        };
      }
    }
  );
}
