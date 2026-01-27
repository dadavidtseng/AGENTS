/**
 * Rename Folder Tool
 *
 * Renames a folder using local-remote-file-manager ability.
 * Uses native transport for development with 1:1 mapping to ability method.
 */

import { z, logger, timer, MODULE_AGENT, getLocalRemoteFileManagerAbilityPath } from './utils.js';
import type { KadiClient } from '@kadi.build/core';

export function registerRenameFolder(client: KadiClient) {
  client.registerTool({
    name: 'local_remote_rename_folder',
    description: 'Rename a folder using local-remote-file-manager',
    input: z.object({
      oldPath: z.string().describe('Current folder path'),
      newName: z.string().describe('New folder name'),
      providerName: z.string().optional().default('local').describe('Provider to use (local)')
    }),
    output: z.object({
      success: z.boolean(),
      message: z.string(),
      newPath: z.string()
    })
  },
  async (params) => {
    logger.info(MODULE_AGENT, `Renaming folder: ${params.oldPath} -> ${params.newName}`, timer.elapsed('main'));

    const abilityPath = getLocalRemoteFileManagerAbilityPath();
    const ability = await client.loadNative('local-remote-file-manager-ability', {
      path: process.env.LOCAL_REMOTE_FILE_MANAGER_ABILITY_PATH!
    });

    try {
      const result = await ability.invoke('rename_folder', params);
      logger.info(MODULE_AGENT, `Folder renamed to: ${result.newPath}`, timer.elapsed('main'));
      return result;
    } finally {
      await ability.disconnect();
    }
  });
}
