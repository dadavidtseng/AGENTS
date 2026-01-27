/**
 * Download File from Remote Server Tool (1:1 mapping)
 *
 * Direct mapping to file-management-ability's download_file_from_remote() method.
 * Downloads files from remote servers via SSH/SCP.
 */

import { z, logger, MODULE_AGENT, timer, getFileManagementAbilityPath } from './utils.js';
import type { KadiClient } from '@kadi.build/core';

// Native transport - types inferred from Zod schemas via proxy

export const downloadFileFromRemoteInputSchema = z.object({
  username: z.string().describe('SSH username for authentication'),
  host: z.string().describe('Remote host address (e.g., "server.example.com" or "192.168.1.100")'),
  remoteFilePath: z.string().describe('Remote file path to download'),
  localFilePath: z.string().describe('Local destination path where file will be saved'),
  privateKey: z.string().optional().describe('Optional: Path to SSH private key file (e.g., "~/.ssh/id_rsa")')
});

export const downloadFileFromRemoteOutputSchema = z.object({
  success: z.boolean().describe('Whether the download succeeded'),
  message: z.string().describe('Success message or error details')
});

export type DownloadFileFromRemoteInput = z.infer<typeof downloadFileFromRemoteInputSchema>;
export type DownloadFileFromRemoteOutput = z.infer<typeof downloadFileFromRemoteOutputSchema>;

/**
 * Register the download_file_from_remote tool
 *
 * This tool provides direct 1:1 mapping to file-management-ability's
 * download_file_from_remote() method without any proxy layers.
 */
export function registerDownloadFileFromRemoteTool(client: KadiClient) {
  client.registerTool(
    {
      name: 'download_file_from_remote',
      description: 'Download a file from a remote server via SSH/SCP. Direct mapping to file-management-ability. Supports SSH private key authentication.',
      input: downloadFileFromRemoteInputSchema,
      output: downloadFileFromRemoteOutputSchema,
    },
    async (params: DownloadFileFromRemoteInput): Promise<DownloadFileFromRemoteOutput> => {
      logger.info(
        MODULE_AGENT,
        `Executing download_file_from_remote: ${params.username}@${params.host}:${params.remoteFilePath} -> ${params.localFilePath}`,
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
        const result = await fileManager.invoke('download_file_from_remote', params);

        // Disconnect after use
        await fileManager.disconnect();

        logger.info(MODULE_AGENT, `Download completed: ${result.message}`, timer.elapsed('main'));

        return result;

      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        logger.info(
          MODULE_AGENT,
          `Download failed: ${errorMessage}`,
          timer.elapsed('main')
        );

        return {
          success: false,
          message: `Download failed: ${errorMessage}`
        };
      }
    }
  );
}
