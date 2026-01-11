/**
 * Delete File Tool (1:1 mapping)
 *
 * Direct mapping to file-management-ability's delete_file() method.
 * Deletes a file locally.
 */

import { z, logger, MODULE_AGENT, timer, getFileManagementAbilityPath } from './utils.js';
import type { KadiClient } from '@kadi.build/core';

// Native transport - types inferred from Zod schemas via proxy

export const deleteFileInputSchema = z.object({
  filePath: z.string().describe('File path to delete')
});

export const deleteFileOutputSchema = z.object({
  success: z.boolean().describe('Whether the operation succeeded'),
  message: z.string().describe('Success message or error details')
});

export type DeleteFileInput = z.infer<typeof deleteFileInputSchema>;
export type DeleteFileOutput = z.infer<typeof deleteFileOutputSchema>;

/**
 * Register the delete_file tool
 *
 * This tool provides direct 1:1 mapping to file-management-ability's
 * delete_file() method without any proxy layers.
 */
export function registerDeleteFileTool(client: KadiClient) {
  client.registerTool(
    {
      name: 'delete_file',
      description: 'Delete a file locally. Direct mapping to file-management-ability.',
      input: deleteFileInputSchema,
      output: deleteFileOutputSchema,
    },
    async (params: DeleteFileInput): Promise<DeleteFileOutput> => {
      logger.info(
        MODULE_AGENT,
        `Executing delete_file: ${params.filePath}`,
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
        const result = await fileManager.delete_file(params);

        // Disconnect after use
        await fileManager.__disconnect();

        logger.info(MODULE_AGENT, `Delete completed: ${result.message}`, timer.elapsed('main'));

        return result;

      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        logger.info(
          MODULE_AGENT,
          `Delete failed: ${errorMessage}`,
          timer.elapsed('main')
        );

        return {
          success: false,
          message: `Delete failed: ${errorMessage}`
        };
      }
    }
  );
}
