/**
 * Delete Remote Folder Tool (1:1 mapping)
 *
 * Direct mapping to file-management-ability's delete_remote_folder() method.
 * Deletes a folder on a remote server via SSH.
 */

import { z, logger, MODULE_AGENT, timer, getFileManagementAbilityPath } from './utils.js';
import type { KadiClient } from '@kadi.build/core';

// Native transport - types inferred from Zod schemas via proxy

export const deleteRemoteFolderInputSchema = z.object({
  username: z.string().describe('SSH username for authentication'),
  host: z.string().describe('Remote host address'),
  remoteFolderPath: z.string().describe('Remote folder path to delete'),
  privateKey: z.string().optional().describe('Optional: Path to SSH private key file')
});

export const deleteRemoteFolderOutputSchema = z.object({
  success: z.boolean().describe('Whether the operation succeeded'),
  message: z.string().describe('Success message or error details')
});

export type DeleteRemoteFolderInput = z.infer<typeof deleteRemoteFolderInputSchema>;
export type DeleteRemoteFolderOutput = z.infer<typeof deleteRemoteFolderOutputSchema>;

/**
 * Register the delete_remote_folder tool
 *
 * This tool provides direct 1:1 mapping to file-management-ability's
 * delete_remote_folder() method without any proxy layers.
 */
export function registerDeleteRemoteFolderTool(client: KadiClient) {
  client.registerTool(
    {
      name: 'delete_remote_folder',
      description: 'Delete a folder on a remote server via SSH. Direct mapping to file-management-ability.',
      input: deleteRemoteFolderInputSchema,
      output: deleteRemoteFolderOutputSchema,
    },
    async (params: DeleteRemoteFolderInput): Promise<DeleteRemoteFolderOutput> => {
      logger.info(
        MODULE_AGENT,
        `Executing delete_remote_folder: ${params.username}@${params.host}:${params.remoteFolderPath}`,
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
        const result = await fileManager.invoke('delete_remote_folder', params);

        // Disconnect after use
        await fileManager.disconnect();

        logger.info(MODULE_AGENT, `Delete remote folder completed: ${result.message}`, timer.elapsed('main'));

        return result;

      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        logger.info(
          MODULE_AGENT,
          `Delete remote folder failed: ${errorMessage}`,
          timer.elapsed('main')
        );

        return {
          success: false,
          message: `Delete remote folder failed: ${errorMessage}`
        };
      }
    }
  );
}
