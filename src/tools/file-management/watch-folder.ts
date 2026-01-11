/**
 * Watch Folder Tool (1:1 mapping)
 *
 * Direct mapping to file-management-ability's watch_folder() method.
 * Watches a folder for changes (returns watcher info).
 */

import { z, logger, MODULE_AGENT, timer, getFileManagementAbilityPath } from './utils.js';
import type { KadiClient } from '@kadi.build/core';

// Native transport - types inferred from Zod schemas via proxy

export const watchFolderInputSchema = z.object({
  dirPath: z.string().describe('Directory path to watch')
});

export const watchFolderOutputSchema = z.object({
  success: z.boolean().describe('Whether the operation succeeded'),
  message: z.string().describe('Success message or error details')
});

export type WatchFolderInput = z.infer<typeof watchFolderInputSchema>;
export type WatchFolderOutput = z.infer<typeof watchFolderOutputSchema>;

/**
 * Register the watch_folder tool
 *
 * This tool provides direct 1:1 mapping to file-management-ability's
 * watch_folder() method without any proxy layers.
 * Note: This is a simplified version - real watcher would need event stream support.
 */
export function registerWatchFolderTool(client: KadiClient) {
  client.registerTool(
    {
      name: 'watch_folder',
      description: 'Watch a folder for changes. Direct mapping to file-management-ability. Note: Event stream support needed for full implementation.',
      input: watchFolderInputSchema,
      output: watchFolderOutputSchema,
    },
    async (params: WatchFolderInput): Promise<WatchFolderOutput> => {
      logger.info(
        MODULE_AGENT,
        `Executing watch_folder: ${params.dirPath}`,
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
        const result = await fileManager.watch_folder(params);

        // Disconnect after use
        await fileManager.__disconnect();

        logger.info(MODULE_AGENT, `Watch folder completed: ${result.message}`, timer.elapsed('main'));

        return result;

      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        logger.info(
          MODULE_AGENT,
          `Watch folder failed: ${errorMessage}`,
          timer.elapsed('main')
        );

        return {
          success: false,
          message: `Watch folder failed: ${errorMessage}`
        };
      }
    }
  );
}
