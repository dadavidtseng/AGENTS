/**
 * Get File Info Tool (1:1 mapping)
 *
 * Direct mapping to cloud-file-manager-ability's get_file_info() method.
 */

import { z, logger, MODULE_AGENT, timer, getCloudFileManagerAbilityPath } from './utils.js';
import type { KadiClient } from '@kadi.build/core';

export const getFileInfoInputSchema = z.object({
  serviceName: z.enum(['dropbox', 'googledrive', 'box']).describe('Cloud service name'),
  remotePath: z.string().describe('Remote file path')
});

export const getFileInfoOutputSchema = z.object({
  success: z.boolean().describe('Whether the operation succeeded'),
  fileInfo: z.any().optional().describe('File information'),
  error: z.string().optional().describe('Error message if operation failed')
});

export type GetFileInfoInput = z.infer<typeof getFileInfoInputSchema>;
export type GetFileInfoOutput = z.infer<typeof getFileInfoOutputSchema>;

export function registerGetFileInfoTool(client: KadiClient) {
  client.registerTool(
    {
      name: 'cloud_get_file_info',
      description: 'Get information about a file in cloud storage. Direct mapping to cloud-file-manager-ability.',
      input: getFileInfoInputSchema,
      output: getFileInfoOutputSchema,
    },
    async (params: GetFileInfoInput): Promise<GetFileInfoOutput> => {
      logger.info(MODULE_AGENT, `Executing get_file_info: ${params.serviceName}:${params.remotePath}`, timer.elapsed('main'));

      try {
        const abilityPath = getCloudFileManagerAbilityPath();
        const cloudManager = await client.load('cloud-file-manager-ability', 'native', {
          path: abilityPath
        });

        const result = await cloudManager.cloud_get_file_info(params);
        await cloudManager.__disconnect();

        logger.info(MODULE_AGENT, `Get file info completed successfully`, timer.elapsed('main'));
        return result;

      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.info(MODULE_AGENT, `Get file info failed: ${errorMessage}`, timer.elapsed('main'));

        return {
          success: false,
          error: `Get file info failed: ${errorMessage}`
        };
      }
    }
  );
}
