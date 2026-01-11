/**
 * Create File Tool (1:1 mapping)
 *
 * Direct mapping to file-management-ability's create_file() method.
 * Creates a local file with content.
 */

import { z, logger, MODULE_AGENT, timer, getFileManagementAbilityPath } from './utils.js';
import type { KadiClient } from '@kadi.build/core';

// Native transport - types inferred from Zod schemas via proxy

export const createFileInputSchema = z.object({
  filePath: z.string().describe('File path to create'),
  content: z.string().describe('File content')
});

export const createFileOutputSchema = z.object({
  success: z.boolean().describe('Whether the operation succeeded'),
  message: z.string().describe('Success message or error details')
});

export type CreateFileInput = z.infer<typeof createFileInputSchema>;
export type CreateFileOutput = z.infer<typeof createFileOutputSchema>;

/**
 * Register the create_file tool
 *
 * This tool provides direct 1:1 mapping to file-management-ability's
 * create_file() method without any proxy layers.
 */
export function registerCreateFileTool(client: KadiClient) {
  client.registerTool(
    {
      name: 'create_file',
      description: 'Create a local file with content. Direct mapping to file-management-ability.',
      input: createFileInputSchema,
      output: createFileOutputSchema,
    },
    async (params: CreateFileInput): Promise<CreateFileOutput> => {
      logger.info(
        MODULE_AGENT,
        `Executing create_file: ${params.filePath}`,
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
        const result = await fileManager.create_file(params);

        // Disconnect after use
        await fileManager.__disconnect();

        logger.info(MODULE_AGENT, `Create file completed: ${result.message}`, timer.elapsed('main'));

        return result;

      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        logger.info(
          MODULE_AGENT,
          `Create file failed: ${errorMessage}`,
          timer.elapsed('main')
        );

        return {
          success: false,
          message: `Create file failed: ${errorMessage}`
        };
      }
    }
  );
}
