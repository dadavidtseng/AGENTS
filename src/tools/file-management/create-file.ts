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
  status: z.enum(['complete', 'partial', 'error']).describe('Task completion status'),
  result: z.object({
    filePath: z.string().describe('Path to the created file'),
    success: z.boolean().describe('Whether the file was created successfully')
  }).describe('File creation result'),
  presentation: z.object({
    summary: z.string().describe('Short success/error message'),
    details: z.string().describe('Detailed information about the operation'),
    format_hint: z.string().describe('Guidance for LLM on how to present this result')
  }).describe('Presentation layer for LLM to customize output')
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
      description: 'Create a local file with content. This is a one-time operation that completes immediately. Do not retry on success.',
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

        // Return structured output with completion status
        return {
          status: 'complete',
          result: {
            filePath: params.filePath,
            success: true
          },
          presentation: {
            summary: `File successfully created at: ${params.filePath}`,
            details: `✅ File creation completed.\n\nPath: ${params.filePath}\nStatus: Success\n\nThe file has been created and is ready to use.`,
            format_hint: 'Inform the user that the file was created successfully. This task is complete and requires no further action.'
          }
        };

      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        logger.info(
          MODULE_AGENT,
          `Create file failed: ${errorMessage}`,
          timer.elapsed('main')
        );

        return {
          status: 'error',
          result: {
            filePath: params.filePath,
            success: false
          },
          presentation: {
            summary: `File creation failed: ${errorMessage}`,
            details: `❌ File creation failed.\n\nPath: ${params.filePath}\nError: ${errorMessage}\n\nPlease check the path and try again.`,
            format_hint: 'Inform the user that file creation failed and provide the error message.'
          }
        };
      }
    }
  );
}
