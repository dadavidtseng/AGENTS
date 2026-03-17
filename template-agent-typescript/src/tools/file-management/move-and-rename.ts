/**
 * Move and Rename Tool (1:1 mapping)
 *
 * Direct mapping to file-management-ability's move_and_rename() method.
 * Moves or renames a file or folder locally.
 */

import { z, logger, MODULE_AGENT, timer, getFileManagementAbilityPath } from './utils.js';
import type { KadiClient } from '@kadi.build/core';

// Native transport - types inferred from Zod schemas via proxy

export const moveAndRenameInputSchema = z.object({
  oldPath: z.string().describe('Current path of the file or folder'),
  newPath: z.string().describe('New path for the file or folder')
});

export const moveAndRenameOutputSchema = z.object({
  success: z.boolean().describe('Whether the operation succeeded'),
  message: z.string().describe('Success message or error details')
});

export type MoveAndRenameInput = z.infer<typeof moveAndRenameInputSchema>;
export type MoveAndRenameOutput = z.infer<typeof moveAndRenameOutputSchema>;

/**
 * Register the move_and_rename tool
 *
 * This tool provides direct 1:1 mapping to file-management-ability's
 * move_and_rename() method without any proxy layers.
 */
export function registerMoveAndRenameTool(client: KadiClient) {
  client.registerTool(
    {
      name: 'move_and_rename',
      description: 'Move or rename a file or folder locally. Direct mapping to file-management-ability.',
      input: moveAndRenameInputSchema,
      output: moveAndRenameOutputSchema,
    },
    async (params: MoveAndRenameInput): Promise<MoveAndRenameOutput> => {
      logger.info(
        MODULE_AGENT,
        `Executing move_and_rename: ${params.oldPath} -> ${params.newPath}`,
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
        const result = await fileManager.invoke('move_and_rename', params);

        // Disconnect after use
        await fileManager.disconnect();

        logger.info(MODULE_AGENT, `Move/Rename completed: ${result.message}`, timer.elapsed('main'));

        return result;

      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        logger.info(
          MODULE_AGENT,
          `Move/Rename failed: ${errorMessage}`,
          timer.elapsed('main')
        );

        return {
          success: false,
          message: `Move/Rename failed: ${errorMessage}`
        };
      }
    }
  );
}
