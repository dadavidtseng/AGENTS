/**
 * Delete Remote File Tool (1:1 mapping)
 *
 * Direct mapping to file-management-ability's delete_remote_file() method.
 * Deletes a file on a remote server via SSH.
 */

import { z, logger, MODULE_AGENT, timer, getFileManagementAbilityPath } from './utils.js';
import type { KadiClient } from '@kadi.build/core';

// Native transport - types inferred from Zod schemas via proxy

export const deleteRemoteFileInputSchema = z.object({
  username: z.string().describe('SSH username for authentication'),
  host: z.string().describe('Remote host address'),
  remoteFilePath: z.string().describe('Remote file path to delete'),
  privateKey: z.string().optional().describe('Optional: Path to SSH private key file')
});

export const deleteRemoteFileOutputSchema = z.object({
  success: z.boolean().describe('Whether the operation succeeded'),
  message: z.string().describe('Success message or error details')
});

export type DeleteRemoteFileInput = z.infer<typeof deleteRemoteFileInputSchema>;
export type DeleteRemoteFileOutput = z.infer<typeof deleteRemoteFileOutputSchema>;

/**
 * Register the delete_remote_file tool
 *
 * This tool provides direct 1:1 mapping to file-management-ability's
 * delete_remote_file() method without any proxy layers.
 */
export function registerDeleteRemoteFileTool(client: KadiClient) {
  client.registerTool(
    {
      name: 'delete_remote_file',
      description: 'Delete a file on a remote server via SSH. Direct mapping to file-management-ability.',
      input: deleteRemoteFileInputSchema,
      output: deleteRemoteFileOutputSchema,
    },
    async (params: DeleteRemoteFileInput): Promise<DeleteRemoteFileOutput> => {
      logger.info(
        MODULE_AGENT,
        `Executing delete_remote_file: ${params.username}@${params.host}:${params.remoteFilePath}`,
        timer.elapsed('main')
      );

      try {
        // Load ability via native transport
        const abilityPath = getFileManagementAbilityPath();

        logger.info(MODULE_AGENT, `Loading ability from path: ${abilityPath}`, timer.elapsed('main'));

        const fileManager = await client.load('file-management-ability', 'native', {
          path: abilityPath
        });

        // Call through native transport proxy
        const result = await fileManager.delete_remote_file(params);

        // Disconnect after use
        await fileManager.__disconnect();

        logger.info(MODULE_AGENT, `Delete remote file completed: ${result.message}`, timer.elapsed('main'));

        return result;

      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        logger.info(
          MODULE_AGENT,
          `Delete remote file failed: ${errorMessage}`,
          timer.elapsed('main')
        );

        return {
          success: false,
          message: `Delete remote file failed: ${errorMessage}`
        };
      }
    }
  );
}
