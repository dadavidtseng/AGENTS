/**
 * Delete Folder Tool (1:1 mapping)
 *
 * Direct mapping to file-management-ability's delete_folder() method.
 * Deletes a folder locally.
 */

import { z, logger, MODULE_AGENT, timer, getFileManagementAbilityPath } from './utils.js';
import type { KadiClient } from '@kadi.build/core';

// Native transport - types inferred from Zod schemas via proxy

export const deleteFolderInputSchema = z.object({
  folderPath: z.string().describe('Folder path to delete')
});

export const deleteFolderOutputSchema = z.object({
  success: z.boolean().describe('Whether the operation succeeded'),
  message: z.string().describe('Success message or error details')
});

export type DeleteFolderInput = z.infer<typeof deleteFolderInputSchema>;
export type DeleteFolderOutput = z.infer<typeof deleteFolderOutputSchema>;

/**
 * Register the delete_folder tool
 *
 * This tool provides direct 1:1 mapping to file-management-ability's
 * delete_folder() method without any proxy layers.
 */
export function registerDeleteFolderTool(client: KadiClient) {
  client.registerTool(
    {
      name: 'delete_folder',
      description: 'Delete a folder locally. Direct mapping to file-management-ability.',
      input: deleteFolderInputSchema,
      output: deleteFolderOutputSchema,
    },
    async (params: DeleteFolderInput): Promise<DeleteFolderOutput> => {
      logger.info(
        MODULE_AGENT,
        `Executing delete_folder: ${params.folderPath}`,
        timer.elapsed('main')
      );

      try {
        // Load ability via native transport
        const abilityPath = getFileManagementAbilityPath();

        logger.info(MODULE_AGENT, `Loading ability from path: ${abilityPath}`, timer.elapsed('main'));

        const fileManager = await client.loadNative('file-management-ability', {
          path: process.env.FILE_MANAGEMENT_ABILITY_PATH!
        });

        // Call through native transport proxy
        const result = await fileManager.invoke('delete_folder', params);

        // Disconnect after use
        await fileManager.disconnect();

        logger.info(MODULE_AGENT, `Delete folder completed: ${result.message}`, timer.elapsed('main'));

        return result;

      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        logger.info(
          MODULE_AGENT,
          `Delete folder failed: ${errorMessage}`,
          timer.elapsed('main')
        );

        return {
          success: false,
          message: `Delete folder failed: ${errorMessage}`
        };
      }
    }
  );
}
