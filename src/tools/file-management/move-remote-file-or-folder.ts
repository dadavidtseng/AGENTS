/**
 * Move Remote File or Folder Tool (1:1 mapping)
 *
 * Direct mapping to file-management-ability's move_remote_file_or_folder() method.
 * Moves or renames a file or folder on a remote server via SSH.
 */

import { z, logger, MODULE_AGENT, timer, getFileManagementAbilityPath } from './utils.js';
import type { KadiClient } from '@kadi.build/core';

// Native transport - types inferred from Zod schemas via proxy

export const moveRemoteFileOrFolderInputSchema = z.object({
  username: z.string().describe('SSH username for authentication'),
  host: z.string().describe('Remote host address'),
  oldRemotePath: z.string().describe('Current remote path'),
  newRemotePath: z.string().describe('New remote path'),
  privateKey: z.string().optional().describe('Optional: Path to SSH private key file')
});

export const moveRemoteFileOrFolderOutputSchema = z.object({
  success: z.boolean().describe('Whether the operation succeeded'),
  message: z.string().describe('Success message or error details')
});

export type MoveRemoteFileOrFolderInput = z.infer<typeof moveRemoteFileOrFolderInputSchema>;
export type MoveRemoteFileOrFolderOutput = z.infer<typeof moveRemoteFileOrFolderOutputSchema>;

/**
 * Register the move_remote_file_or_folder tool
 *
 * This tool provides direct 1:1 mapping to file-management-ability's
 * move_remote_file_or_folder() method without any proxy layers.
 */
export function registerMoveRemoteFileOrFolderTool(client: KadiClient) {
  client.registerTool(
    {
      name: 'move_remote_file_or_folder',
      description: 'Move or rename a file or folder on a remote server via SSH. Direct mapping to file-management-ability.',
      input: moveRemoteFileOrFolderInputSchema,
      output: moveRemoteFileOrFolderOutputSchema,
    },
    async (params: MoveRemoteFileOrFolderInput): Promise<MoveRemoteFileOrFolderOutput> => {
      logger.info(
        MODULE_AGENT,
        `Executing move_remote_file_or_folder: ${params.username}@${params.host}:${params.oldRemotePath} -> ${params.newRemotePath}`,
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
        const result = await fileManager.move_remote_file_or_folder(params);

        // Disconnect after use
        await fileManager.__disconnect();

        logger.info(MODULE_AGENT, `Move remote completed: ${result.message}`, timer.elapsed('main'));

        return result;

      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        logger.info(
          MODULE_AGENT,
          `Move remote failed: ${errorMessage}`,
          timer.elapsed('main')
        );

        return {
          success: false,
          message: `Move remote failed: ${errorMessage}`
        };
      }
    }
  );
}
