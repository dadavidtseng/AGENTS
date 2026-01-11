/**
 * Copy File Tool (1:1 mapping)
 *
 * Direct mapping to file-management-ability's copy_file() method.
 * Copies a file locally.
 */

import { z, logger, MODULE_AGENT, timer, getFileManagementAbilityPath } from './utils.js';
import type { KadiClient } from '@kadi.build/core';

// Native transport - types inferred from Zod schemas via proxy

export const copyFileInputSchema = z.object({
  sourcePath: z.string().describe('Source file path'),
  destinationPath: z.string().describe('Destination file path')
});

export const copyFileOutputSchema = z.object({
  success: z.boolean().describe('Whether the operation succeeded'),
  message: z.string().describe('Success message or error details')
});

export type CopyFileInput = z.infer<typeof copyFileInputSchema>;
export type CopyFileOutput = z.infer<typeof copyFileOutputSchema>;

/**
 * Register the copy_file tool
 *
 * This tool provides direct 1:1 mapping to file-management-ability's
 * copy_file() method without any proxy layers.
 */
export function registerCopyFileTool(client: KadiClient) {
  client.registerTool(
    {
      name: 'copy_file',
      description: 'Copy a file locally. Direct mapping to file-management-ability.',
      input: copyFileInputSchema,
      output: copyFileOutputSchema,
    },
    async (params: CopyFileInput): Promise<CopyFileOutput> => {
      logger.info(
        MODULE_AGENT,
        `Executing copy_file: ${params.sourcePath} -> ${params.destinationPath}`,
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
        const result = await fileManager.copy_file(params);

        // Disconnect after use
        await fileManager.__disconnect();

        logger.info(MODULE_AGENT, `Copy completed: ${result.message}`, timer.elapsed('main'));

        return result;

      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        logger.info(
          MODULE_AGENT,
          `Copy failed: ${errorMessage}`,
          timer.elapsed('main')
        );

        return {
          success: false,
          message: `Copy failed: ${errorMessage}`
        };
      }
    }
  );
}
