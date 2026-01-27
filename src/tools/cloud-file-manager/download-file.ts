/**
 * Download File Tool (1:1 mapping)
 *
 * Direct mapping to cloud-file-manager-ability's download_file() method.
 * Downloads a file from cloud storage.
 */

import { z, logger, MODULE_AGENT, timer, getCloudFileManagerAbilityPath } from './utils.js';
import type { KadiClient } from '@kadi.build/core';

export const downloadFileInputSchema = z.object({
  serviceName: z.enum(['dropbox', 'googledrive', 'box']).describe('Cloud service name'),
  remotePath: z.string().describe('Remote file path'),
  localPath: z.string().describe('Local destination path')
});

export const downloadFileOutputSchema = z.object({
  success: z.boolean().describe('Whether the operation succeeded'),
  message: z.string().describe('Result message')
});

export type DownloadFileInput = z.infer<typeof downloadFileInputSchema>;
export type DownloadFileOutput = z.infer<typeof downloadFileOutputSchema>;

/**
 * Register the download_file tool
 */
export function registerDownloadFileTool(client: KadiClient) {
  client.registerTool(
    {
      name: 'cloud_download_file',
      description: 'Download a file from cloud storage. Direct mapping to cloud-file-manager-ability.',
      input: downloadFileInputSchema,
      output: downloadFileOutputSchema,
    },
    async (params: DownloadFileInput): Promise<DownloadFileOutput> => {
      logger.info(
        MODULE_AGENT,
        `Executing download_file: ${params.serviceName}:${params.remotePath} to ${params.localPath}`,
        timer.elapsed('main')
      );

      try {
        const abilityPath = getCloudFileManagerAbilityPath();
        const cloudManager = await client.loadNative('cloud-file-manager-ability', {
          path: process.env.CLOUD_FILE_MANAGER_ABILITY_PATH!
        });

        const result = await cloudManager.invoke('cloud_download_file', params);
        await cloudManager.disconnect();

        logger.info(MODULE_AGENT, `Download completed successfully`, timer.elapsed('main'));

        return result;

      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.info(MODULE_AGENT, `Download failed: ${errorMessage}`, timer.elapsed('main'));

        return {
          success: false,
          message: `Download failed: ${errorMessage}`
        };
      }
    }
  );
}
