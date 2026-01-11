/**
 * Copy File Tool (1:1 mapping)
 *
 * Direct mapping to cloud-file-manager-ability's copy_file() method.
 */

import { z, logger, MODULE_AGENT, timer, getCloudFileManagerAbilityPath } from './utils.js';
import type { KadiClient } from '@kadi.build/core';

export const copyFileInputSchema = z.object({
  serviceName: z.enum(['dropbox', 'googledrive', 'box']).describe('Cloud service name'),
  sourcePath: z.string().describe('Source file path'),
  destinationPath: z.string().describe('Destination file path')
});

export const copyFileOutputSchema = z.object({
  success: z.boolean().describe('Whether the operation succeeded'),
  result: z.any().optional().describe('Copy result'),
  error: z.string().optional().describe('Error message if operation failed')
});

export type CopyFileInput = z.infer<typeof copyFileInputSchema>;
export type CopyFileOutput = z.infer<typeof copyFileOutputSchema>;

export function registerCopyFileTool(client: KadiClient) {
  client.registerTool(
    {
      name: 'cloud_copy_file',
      description: 'Copy a file within cloud storage. Direct mapping to cloud-file-manager-ability.',
      input: copyFileInputSchema,
      output: copyFileOutputSchema,
    },
    async (params: CopyFileInput): Promise<CopyFileOutput> => {
      logger.info(MODULE_AGENT, `Executing copy_file: ${params.serviceName}:${params.sourcePath} to ${params.destinationPath}`, timer.elapsed('main'));

      try {
        const abilityPath = getCloudFileManagerAbilityPath();
        const cloudManager = await client.load('cloud-file-manager-ability', 'native', {
          path: abilityPath
        });

        const result = await cloudManager.cloud_copy_file(params);
        await cloudManager.__disconnect();

        logger.info(MODULE_AGENT, `Copy completed successfully`, timer.elapsed('main'));
        return result;

      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.info(MODULE_AGENT, `Copy failed: ${errorMessage}`, timer.elapsed('main'));

        return {
          success: false,
          error: `Copy failed: ${errorMessage}`
        };
      }
    }
  );
}
