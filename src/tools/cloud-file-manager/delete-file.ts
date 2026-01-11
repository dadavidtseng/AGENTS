/**
 * Delete File Tool (1:1 mapping)
 *
 * Direct mapping to cloud-file-manager-ability's delete_file() method.
 */

import { z, logger, MODULE_AGENT, timer, getCloudFileManagerAbilityPath } from './utils.js';
import type { KadiClient } from '@kadi.build/core';

export const deleteFileInputSchema = z.object({
  serviceName: z.enum(['dropbox', 'googledrive', 'box']).describe('Cloud service name'),
  remotePath: z.string().describe('Remote file path to delete')
});

export const deleteFileOutputSchema = z.object({
  success: z.boolean().describe('Whether the operation succeeded'),
  message: z.string().describe('Result message')
});

export type DeleteFileInput = z.infer<typeof deleteFileInputSchema>;
export type DeleteFileOutput = z.infer<typeof deleteFileOutputSchema>;

export function registerDeleteFileTool(client: KadiClient) {
  client.registerTool(
    {
      name: 'cloud_delete_file',
      description: 'Delete a file from cloud storage. Direct mapping to cloud-file-manager-ability.',
      input: deleteFileInputSchema,
      output: deleteFileOutputSchema,
    },
    async (params: DeleteFileInput): Promise<DeleteFileOutput> => {
      logger.info(MODULE_AGENT, `Executing delete_file: ${params.serviceName}:${params.remotePath}`, timer.elapsed('main'));

      try {
        const abilityPath = getCloudFileManagerAbilityPath();
        const cloudManager = await client.load('cloud-file-manager-ability', 'native', {
          path: abilityPath
        });

        const result = await cloudManager.cloud_delete_file(params);
        await cloudManager.__disconnect();

        logger.info(MODULE_AGENT, `Delete completed successfully`, timer.elapsed('main'));
        return result;

      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.info(MODULE_AGENT, `Delete failed: ${errorMessage}`, timer.elapsed('main'));

        return {
          success: false,
          message: `Delete failed: ${errorMessage}`
        };
      }
    }
  );
}
