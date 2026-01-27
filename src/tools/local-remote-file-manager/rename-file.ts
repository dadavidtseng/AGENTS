/**
 * Rename File Tool
 *
 * Renames a file using local-remote-file-manager ability.
 * Uses native transport for development with 1:1 mapping to ability method.
 */

import { z, logger, timer, MODULE_AGENT, getLocalRemoteFileManagerAbilityPath } from './utils.js';
import type { KadiClient } from '@kadi.build/core';

export function registerRenameFile(client: KadiClient) {
  client.registerTool({
    name: 'local_remote_rename_file',
    description: 'Rename a file using local-remote-file-manager',
    input: z.object({
      oldPath: z.string().describe('Current file path'),
      newName: z.string().describe('New file name'),
      providerName: z.string().optional().default('local').describe('Provider to use (local)')
    }),
    output: z.object({
      success: z.boolean(),
      message: z.string(),
      newPath: z.string()
    })
  },
  async (params) => {
    logger.info(MODULE_AGENT, `Renaming file: ${params.oldPath} -> ${params.newName}`, timer.elapsed('main'));

    const abilityPath = getLocalRemoteFileManagerAbilityPath();
    const ability = await client.loadNative('local-remote-file-manager-ability', {
      path: process.env.LOCAL_REMOTE_FILE_MANAGER_ABILITY_PATH!
    });

    try {
      const result = await ability.invoke('rename_file', params);
      logger.info(MODULE_AGENT, `File renamed to: ${result.newPath}`, timer.elapsed('main'));
      return result;
    } finally {
      await ability.disconnect();
    }
  });
}
