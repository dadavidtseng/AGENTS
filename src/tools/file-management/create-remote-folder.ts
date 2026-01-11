/**
 * Create Remote Folder Tool (1:1 mapping)
 *
 * Direct mapping to file-management-ability's create_remote_folder() method.
 * Creates a folder on a remote server via SSH.
 */

import { z, logger, MODULE_AGENT, timer, getFileManagementAbilityPath } from './utils.js';
import type { KadiClient } from '@kadi.build/core';

// Native transport - types inferred from Zod schemas via proxy

export const createRemoteFolderInputSchema = z.object({
  username: z.string().describe('SSH username for authentication'),
  host: z.string().describe('Remote host address'),
  remoteFolderPath: z.string().describe('Remote folder path to create'),
  privateKey: z.string().optional().describe('Optional: Path to SSH private key file')
});

export const createRemoteFolderOutputSchema = z.object({
  success: z.boolean().describe('Whether the operation succeeded'),
  message: z.string().describe('Success message or error details')
});

export type CreateRemoteFolderInput = z.infer<typeof createRemoteFolderInputSchema>;
export type CreateRemoteFolderOutput = z.infer<typeof createRemoteFolderOutputSchema>;

/**
 * Register the create_remote_folder tool
 *
 * This tool provides direct 1:1 mapping to file-management-ability's
 * create_remote_folder() method without any proxy layers.
 */
export function registerCreateRemoteFolderTool(client: KadiClient) {
  client.registerTool(
    {
      name: 'create_remote_folder',
      description: 'Create a folder on a remote server via SSH. Direct mapping to file-management-ability.',
      input: createRemoteFolderInputSchema,
      output: createRemoteFolderOutputSchema,
    },
    async (params: CreateRemoteFolderInput): Promise<CreateRemoteFolderOutput> => {
      logger.info(
        MODULE_AGENT,
        `Executing create_remote_folder: ${params.username}@${params.host}:${params.remoteFolderPath}`,
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
        const result = await fileManager.create_remote_folder(params);

        // Disconnect after use
        await fileManager.__disconnect();

        logger.info(MODULE_AGENT, `Create remote folder completed: ${result.message}`, timer.elapsed('main'));

        return result;

      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        logger.info(
          MODULE_AGENT,
          `Create remote folder failed: ${errorMessage}`,
          timer.elapsed('main')
        );

        return {
          success: false,
          message: `Create remote folder failed: ${errorMessage}`
        };
      }
    }
  );
}
