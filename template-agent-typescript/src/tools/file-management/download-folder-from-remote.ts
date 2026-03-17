/**
 * Download Folder from Remote Tool (1:1 mapping)
 *
 * Direct mapping to file-management-ability's download_folder_from_remote() method.
 * Downloads a folder from a remote server via SCP.
 */

import { z, logger, MODULE_AGENT, timer, getFileManagementAbilityPath } from './utils.js';
import type { KadiClient } from '@kadi.build/core';

// Native transport - types inferred from Zod schemas via proxy

export const downloadFolderFromRemoteInputSchema = z.object({
  username: z.string().describe('SSH username for authentication'),
  host: z.string().describe('Remote host address'),
  remoteFolderPath: z.string().describe('Remote folder path to download'),
  localFolderPath: z.string().describe('Local destination folder path'),
  privateKey: z.string().optional().describe('Optional: Path to SSH private key file')
});

export const downloadFolderFromRemoteOutputSchema = z.object({
  success: z.boolean().describe('Whether the operation succeeded'),
  message: z.string().describe('Success message or error details')
});

export type DownloadFolderFromRemoteInput = z.infer<typeof downloadFolderFromRemoteInputSchema>;
export type DownloadFolderFromRemoteOutput = z.infer<typeof downloadFolderFromRemoteOutputSchema>;

/**
 * Register the download_folder_from_remote tool
 *
 * This tool provides direct 1:1 mapping to file-management-ability's
 * download_folder_from_remote() method without any proxy layers.
 */
export function registerDownloadFolderFromRemoteTool(client: KadiClient) {
  client.registerTool(
    {
      name: 'download_folder_from_remote',
      description: 'Download a folder from a remote server via SCP. Direct mapping to file-management-ability.',
      input: downloadFolderFromRemoteInputSchema,
      output: downloadFolderFromRemoteOutputSchema,
    },
    async (params: DownloadFolderFromRemoteInput): Promise<DownloadFolderFromRemoteOutput> => {
      logger.info(
        MODULE_AGENT,
        `Executing download_folder_from_remote: ${params.username}@${params.host}:${params.remoteFolderPath} -> ${params.localFolderPath}`,
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
        const result = await fileManager.invoke('download_folder_from_remote', params);

        // Disconnect after use
        await fileManager.disconnect();

        logger.info(MODULE_AGENT, `Download folder completed: ${result.message}`, timer.elapsed('main'));

        return result;

      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        logger.info(
          MODULE_AGENT,
          `Download folder failed: ${errorMessage}`,
          timer.elapsed('main')
        );

        return {
          success: false,
          message: `Download folder failed: ${errorMessage}`
        };
      }
    }
  );
}
