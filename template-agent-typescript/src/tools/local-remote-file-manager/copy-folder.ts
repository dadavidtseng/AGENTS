/**
 * Copy Folder Tool
 *
 * Copies a folder using local-remote-file-manager ability.
 * Uses native transport for development with 1:1 mapping to ability method.
 */

import { z, logger, timer, MODULE_AGENT, getLocalRemoteFileManagerAbilityPath } from './utils.js';
import type { KadiClient } from '@kadi.build/core';

export function registerCopyFolder(client: KadiClient) {
  client.registerTool({
    name: 'local_remote_copy_folder',
    description: 'Copy a folder using local-remote-file-manager',
    input: z.object({
      sourcePath: z.string().describe('Source folder path'),
      targetPath: z.string().describe('Target folder path'),
      providerName: z.string().optional().default('local').describe('Provider to use (local)')
    }),
    output: z.object({
      success: z.boolean(),
      message: z.string()
    })
  },
  async (params) => {
    logger.info(MODULE_AGENT, `Copying folder: ${params.sourcePath} -> ${params.targetPath}`, timer.elapsed('main'));

    const abilityPath = getLocalRemoteFileManagerAbilityPath();
    const ability = await client.loadNative('local-remote-file-manager-ability', {
      path: process.env.LOCAL_REMOTE_FILE_MANAGER_ABILITY_PATH!
    });

    try {
      const result = await ability.invoke('copy_folder', params);
      logger.info(MODULE_AGENT, 'Folder copied successfully', timer.elapsed('main'));
      return result;
    } finally {
      await ability.disconnect();
    }
  });
}
