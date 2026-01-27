/**
 * Get Folder Info Tool
 *
 * Gets information about a folder using local-remote-file-manager ability.
 * Uses native transport for development with 1:1 mapping to ability method.
 */

import { z, logger, timer, MODULE_AGENT, getLocalRemoteFileManagerAbilityPath } from './utils.js';
import type { KadiClient } from '@kadi.build/core';

export function registerGetFolderInfo(client: KadiClient) {
  client.registerTool({
    name: 'local_remote_get_folder_info',
    description: 'Get information about a folder using local-remote-file-manager',
    input: z.object({
      folderPath: z.string().describe('Folder path to get info for'),
      providerName: z.string().optional().default('local').describe('Provider to use (local)')
    }),
    output: z.object({
      name: z.string(),
      path: z.string(),
      fileCount: z.number(),
      folderCount: z.number(),
      totalSize: z.number(),
      modifiedTime: z.string()
    })
  },
  async (params) => {
    logger.info(MODULE_AGENT, `Getting folder info: ${params.folderPath}`, timer.elapsed('main'));

    const abilityPath = getLocalRemoteFileManagerAbilityPath();
    const ability = await client.loadNative('local-remote-file-manager-ability', {
      path: process.env.LOCAL_REMOTE_FILE_MANAGER_ABILITY_PATH!
    });

    try {
      const result = await ability.invoke('get_folder_info', params);
      logger.info(MODULE_AGENT, `Folder info retrieved: ${result.name}`, timer.elapsed('main'));
      return result;
    } finally {
      await ability.disconnect();
    }
  });
}
