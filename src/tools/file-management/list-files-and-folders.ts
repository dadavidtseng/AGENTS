/**
 * List Files and Folders Tool (1:1 mapping)
 *
 * Direct mapping to file-management-ability's list_files_and_folders() method.
 * Lists files and folders in a local directory.
 */

import { z, logger, MODULE_AGENT, timer, getFileManagementAbilityPath } from './utils.js';
import type { KadiClient } from '@kadi.build/core';

// Native transport - types inferred from Zod schemas via proxy

export const listFilesAndFoldersInputSchema = z.object({
  dirPath: z.string().describe('Directory path to list')
});

export const listFilesAndFoldersOutputSchema = z.object({
  success: z.boolean().describe('Whether the operation succeeded'),
  files: z.array(z.object({
    name: z.string(),
    type: z.string()
  })).optional().describe('List of files and folders'),
  error: z.string().optional().describe('Error message if operation failed')
});

export type ListFilesAndFoldersInput = z.infer<typeof listFilesAndFoldersInputSchema>;
export type ListFilesAndFoldersOutput = z.infer<typeof listFilesAndFoldersOutputSchema>;

/**
 * Register the list_files_and_folders tool
 *
 * This tool provides direct 1:1 mapping to file-management-ability's
 * list_files_and_folders() method without any proxy layers.
 */
export function registerListFilesAndFoldersTool(client: KadiClient) {
  client.registerTool(
    {
      name: 'list_files_and_folders',
      description: 'List files and folders in a local directory. Direct mapping to file-management-ability.',
      input: listFilesAndFoldersInputSchema,
      output: listFilesAndFoldersOutputSchema,
    },
    async (params: ListFilesAndFoldersInput): Promise<ListFilesAndFoldersOutput> => {
      logger.info(
        MODULE_AGENT,
        `Executing list_files_and_folders: ${params.dirPath}`,
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
        const result = await fileManager.list_files_and_folders(params);

        // Disconnect after use
        await fileManager.__disconnect();

        logger.info(MODULE_AGENT, `List completed: ${result.files?.length || 0} items found`, timer.elapsed('main'));

        return result;

      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        logger.info(
          MODULE_AGENT,
          `List failed: ${errorMessage}`,
          timer.elapsed('main')
        );

        return {
          success: false,
          error: `List failed: ${errorMessage}`
        };
      }
    }
  );
}
