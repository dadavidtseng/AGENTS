/**
 * Upload File Tool (1:1 mapping)
 *
 * Direct mapping to cloud-file-manager-ability's upload_file() method.
 * Uploads a file to cloud storage (Dropbox, Google Drive, Box).
 */

import { z, logger, MODULE_AGENT, timer, getCloudFileManagerAbilityPath } from './utils.js';
import type { KadiClient } from '@kadi.build/core';

export const uploadFileInputSchema = z.object({
  serviceName: z.enum(['dropbox', 'googledrive', 'box']).describe('Cloud service name'),
  localPath: z.string().describe('Local file path to upload'),
  remotePath: z.string().describe('Remote destination path')
});

export const uploadFileOutputSchema = z.object({
  success: z.boolean().describe('Whether the operation succeeded'),
  result: z.any().optional().describe('Upload result from cloud provider'),
  error: z.string().optional().describe('Error message if operation failed')
});

export type UploadFileInput = z.infer<typeof uploadFileInputSchema>;
export type UploadFileOutput = z.infer<typeof uploadFileOutputSchema>;

/**
 * Register the upload_file tool
 *
 * This tool provides direct 1:1 mapping to cloud-file-manager-ability's
 * upload_file() method without any proxy layers.
 */
export function registerUploadFileTool(client: KadiClient) {
  client.registerTool(
    {
      name: 'cloud_upload_file',
      description: 'Upload a file to cloud storage (Dropbox, Google Drive, Box). Direct mapping to cloud-file-manager-ability.',
      input: uploadFileInputSchema,
      output: uploadFileOutputSchema,
    },
    async (params: UploadFileInput): Promise<UploadFileOutput> => {
      logger.info(
        MODULE_AGENT,
        `Executing upload_file: ${params.localPath} to ${params.serviceName}:${params.remotePath}`,
        timer.elapsed('main')
      );

      try {
        // Load ability via native transport
        const abilityPath = getCloudFileManagerAbilityPath();

        logger.info(MODULE_AGENT, `Loading ability from path: ${abilityPath}`, timer.elapsed('main'));

        const cloudManager = await client.load('cloud-file-manager-ability', 'native', {
          path: abilityPath
        });

        // Call through native transport proxy
        const result = await cloudManager.cloud_upload_file(params);

        // Disconnect after use
        await cloudManager.__disconnect();

        logger.info(MODULE_AGENT, `Upload completed successfully`, timer.elapsed('main'));

        return result;

      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        logger.info(
          MODULE_AGENT,
          `Upload failed: ${errorMessage}`,
          timer.elapsed('main')
        );

        return {
          success: false,
          error: `Upload failed: ${errorMessage}`
        };
      }
    }
  );
}
