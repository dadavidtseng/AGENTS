/**
 * Copy Remote File Tool (1:1 mapping)
 *
 * Direct mapping to file-management-ability's copy_remote_file() method.
 * Copies a file on a remote server via SSH.
 */

import { z, logger, MODULE_AGENT, timer, getFileManagementAbilityPath } from './utils.js';
import type { KadiClient } from '@kadi.build/core';

// Native transport - types inferred from Zod schemas via proxy

export const copyRemoteFileInputSchema = z.object({
  username: z.string().describe('SSH username for authentication'),
  host: z.string().describe('Remote host address'),
  sourcePath: z.string().describe('Remote source file path'),
  destinationPath: z.string().describe('Remote destination file path'),
  privateKey: z.string().optional().describe('Optional: Path to SSH private key file')
});

export const copyRemoteFileOutputSchema = z.object({
  success: z.boolean().describe('Whether the operation succeeded'),
  message: z.string().describe('Success message or error details')
});

export type CopyRemoteFileInput = z.infer<typeof copyRemoteFileInputSchema>;
export type CopyRemoteFileOutput = z.infer<typeof copyRemoteFileOutputSchema>;

/**
 * Register the copy_remote_file tool
 *
 * This tool provides direct 1:1 mapping to file-management-ability's
 * copy_remote_file() method without any proxy layers.
 */
export function registerCopyRemoteFileTool(client: KadiClient) {
  client.registerTool(
    {
      name: 'copy_remote_file',
      description: 'Copy a file on a remote server via SSH. Direct mapping to file-management-ability.',
      input: copyRemoteFileInputSchema,
      output: copyRemoteFileOutputSchema,
    },
    async (params: CopyRemoteFileInput): Promise<CopyRemoteFileOutput> => {
      logger.info(
        MODULE_AGENT,
        `Executing copy_remote_file: ${params.username}@${params.host}:${params.sourcePath} -> ${params.destinationPath}`,
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
        const result = await fileManager.invoke('copy_remote_file', params);

        // Disconnect after use
        await fileManager.disconnect();

        logger.info(MODULE_AGENT, `Copy remote file completed: ${result.message}`, timer.elapsed('main'));

        return result;

      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        logger.info(
          MODULE_AGENT,
          `Copy remote file failed: ${errorMessage}`,
          timer.elapsed('main')
        );

        return {
          success: false,
          message: `Copy remote file failed: ${errorMessage}`
        };
      }
    }
  );
}
