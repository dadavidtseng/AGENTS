/**
 * Delete Folder Tool
 *
 * Deletes a folder using local-remote-file-manager ability.
 * Uses native transport for development with 1:1 mapping to ability method.
 */

import { z, logger, timer, MODULE_AGENT, getLocalRemoteFileManagerAbilityPath } from './utils.js';
import type { KadiClient } from '@kadi.build/core';

export function registerDeleteFolder(client: KadiClient) {
  client.registerTool({
    name: 'local_remote_delete_folder',
    description: 'Delete a folder using local-remote-file-manager',
    input: z.object({
      folderPath: z.string().describe('Folder path to delete'),
      recursive: z.boolean().optional().default(false).describe('Delete recursively'),
      providerName: z.string().optional().default('local').describe('Provider to use (local)')
    }),
    output: z.object({
      success: z.boolean(),
      message: z.string()
    })
  },
  async (params) => {
    logger.info(MODULE_AGENT, `Deleting folder: ${params.folderPath}`, timer.elapsed('main'));

    const abilityPath = getLocalRemoteFileManagerAbilityPath();
    const ability = await client.load('local-remote-file-manager-ability', 'native', {
      path: abilityPath
    });

    try {
      const result = await ability.delete_folder(params);
      logger.info(MODULE_AGENT, 'Folder deleted successfully', timer.elapsed('main'));
      return result;
    } finally {
      await ability.__disconnect();
    }
  });
}
