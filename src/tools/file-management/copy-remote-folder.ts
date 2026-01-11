/**
 * Copy Remote Folder Tool (1:1 mapping)
 *
 * Direct mapping to file-management-ability's copy_remote_folder() method.
 * Copies a folder and its contents on a remote server via SSH.
 */

import { z, logger, MODULE_AGENT, timer, getFileManagementAbilityPath } from './utils.js';
import type { KadiClient } from '@kadi.build/core';

// Native transport - types inferred from Zod schemas via proxy

export const copyRemoteFolderInputSchema = z.object({
  username: z.string().describe('SSH username for authentication'),
  host: z.string().describe('Remote host address'),
  sourcePath: z.string().describe('Remote source folder path'),
  destinationPath: z.string().describe('Remote destination folder path'),
  privateKey: z.string().optional().describe('Optional: Path to SSH private key file')
});

export const copyRemoteFolderOutputSchema = z.object({
  success: z.boolean().describe('Whether the operation succeeded'),
  message: z.string().describe('Success message or error details')
});

export type CopyRemoteFolderInput = z.infer<typeof copyRemoteFolderInputSchema>;
export type CopyRemoteFolderOutput = z.infer<typeof copyRemoteFolderOutputSchema>;

/**
 * Register the copy_remote_folder tool
 *
 * This tool provides direct 1:1 mapping to file-management-ability's
 * copy_remote_folder() method without any proxy layers.
 */
export function registerCopyRemoteFolderTool(client: KadiClient) {
  client.registerTool(
    {
      name: 'copy_remote_folder',
      description: 'Copy a folder and its contents on a remote server via SSH. Direct mapping to file-management-ability.',
      input: copyRemoteFolderInputSchema,
      output: copyRemoteFolderOutputSchema,
    },
    async (params: CopyRemoteFolderInput): Promise<CopyRemoteFolderOutput> => {
      logger.info(
        MODULE_AGENT,
        `Executing copy_remote_folder: ${params.username}@${params.host}:${params.sourcePath} -> ${params.destinationPath}`,
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
        const result = await fileManager.copy_remote_folder(params);

        // Disconnect after use
        await fileManager.__disconnect();

        logger.info(MODULE_AGENT, `Copy remote folder completed: ${result.message}`, timer.elapsed('main'));

        return result;

      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        logger.info(
          MODULE_AGENT,
          `Copy remote folder failed: ${errorMessage}`,
          timer.elapsed('main')
        );

        return {
          success: false,
          message: `Copy remote folder failed: ${errorMessage}`
        };
      }
    }
  );
}
