/**
 * Copy File Tool
 *
 * Copies a file using local-remote-file-manager ability.
 * Uses native transport for development with 1:1 mapping to ability method.
 */

import { z, logger, timer, MODULE_AGENT, getLocalRemoteFileManagerAbilityPath } from './utils.js';
import type { KadiClient } from '@kadi.build/core';

export function registerCopyFile(client: KadiClient) {
  client.registerTool({
    name: 'local_remote_copy_file',
    description: 'Copy a file using local-remote-file-manager',
    input: z.object({
      sourcePath: z.string().describe('Source file path'),
      targetPath: z.string().describe('Target file path'),
      providerName: z.string().optional().default('local').describe('Provider to use (local)')
    }),
    output: z.object({
      success: z.boolean(),
      message: z.string()
    })
  },
  async (params) => {
    logger.info(MODULE_AGENT, `Copying file: ${params.sourcePath} -> ${params.targetPath}`, timer.elapsed('main'));

    const abilityPath = getLocalRemoteFileManagerAbilityPath();
    const ability = await client.loadNative('local-remote-file-manager-ability', {
      path: process.env.LOCAL_REMOTE_FILE_MANAGER_ABILITY_PATH!
    });

    try {
      const result = await ability.invoke('copy_file', params);
      logger.info(MODULE_AGENT, `File copied successfully`, timer.elapsed('main'));
      return result;
    } finally {
      await ability.disconnect();
    }
  });
}
