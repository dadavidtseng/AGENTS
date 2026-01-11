/**
 * Copy Folder Tool (1:1 mapping)
 *
 * Direct mapping to file-management-ability's copy_folder() method.
 * Copies a folder and its contents locally.
 */

import { z, logger, MODULE_AGENT, timer, getFileManagementAbilityPath } from './utils.js';
import type { KadiClient } from '@kadi.build/core';

// Native transport - types inferred from Zod schemas via proxy

export const copyFolderInputSchema = z.object({
  sourcePath: z.string().describe('Source folder path'),
  destinationPath: z.string().describe('Destination folder path')
});

export const copyFolderOutputSchema = z.object({
  success: z.boolean().describe('Whether the operation succeeded'),
  message: z.string().describe('Success message or error details')
});

export type CopyFolderInput = z.infer<typeof copyFolderInputSchema>;
export type CopyFolderOutput = z.infer<typeof copyFolderOutputSchema>;

/**
 * Register the copy_folder tool
 *
 * This tool provides direct 1:1 mapping to file-management-ability's
 * copy_folder() method without any proxy layers.
 */
export function registerCopyFolderTool(client: KadiClient) {
  client.registerTool(
    {
      name: 'copy_folder',
      description: 'Copy a folder and its contents locally. Direct mapping to file-management-ability.',
      input: copyFolderInputSchema,
      output: copyFolderOutputSchema,
    },
    async (params: CopyFolderInput): Promise<CopyFolderOutput> => {
      logger.info(
        MODULE_AGENT,
        `Executing copy_folder: ${params.sourcePath} -> ${params.destinationPath}`,
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
        const result = await fileManager.copy_folder(params);

        // Disconnect after use
        await fileManager.__disconnect();

        logger.info(MODULE_AGENT, `Copy folder completed: ${result.message}`, timer.elapsed('main'));

        return result;

      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        logger.info(
          MODULE_AGENT,
          `Copy folder failed: ${errorMessage}`,
          timer.elapsed('main')
        );

        return {
          success: false,
          message: `Copy folder failed: ${errorMessage}`
        };
      }
    }
  );
}
