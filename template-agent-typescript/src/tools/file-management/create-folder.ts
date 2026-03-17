/**
 * Create Folder Tool (1:1 mapping)
 *
 * Direct mapping to file-management-ability's create_folder() method.
 * Creates a folder locally.
 */

import { z, logger, MODULE_AGENT, timer, getFileManagementAbilityPath } from './utils.js';
import type { KadiClient } from '@kadi.build/core';

// Native transport - types inferred from Zod schemas via proxy

export const createFolderInputSchema = z.object({
  folderPath: z.string().describe('Folder path to create')
});

export const createFolderOutputSchema = z.object({
  success: z.boolean().describe('Whether the operation succeeded'),
  message: z.string().describe('Success message or error details')
});

export type CreateFolderInput = z.infer<typeof createFolderInputSchema>;
export type CreateFolderOutput = z.infer<typeof createFolderOutputSchema>;

/**
 * Register the create_folder tool
 *
 * This tool provides direct 1:1 mapping to file-management-ability's
 * create_folder() method without any proxy layers.
 */
export function registerCreateFolderTool(client: KadiClient) {
  client.registerTool(
    {
      name: 'create_folder',
      description: 'Create a folder locally. Direct mapping to file-management-ability.',
      input: createFolderInputSchema,
      output: createFolderOutputSchema,
    },
    async (params: CreateFolderInput): Promise<CreateFolderOutput> => {
      logger.info(
        MODULE_AGENT,
        `Executing create_folder: ${params.folderPath}`,
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
        const result = await fileManager.invoke('create_folder', params);

        // Disconnect after use
        await fileManager.disconnect();

        logger.info(MODULE_AGENT, `Create folder completed: ${result.message}`, timer.elapsed('main'));

        return result;

      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        logger.info(
          MODULE_AGENT,
          `Create folder failed: ${errorMessage}`,
          timer.elapsed('main')
        );

        return {
          success: false,
          message: `Create folder failed: ${errorMessage}`
        };
      }
    }
  );
}
