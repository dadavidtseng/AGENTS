/**
 * Create Folder Tool
 *
 * Creates a new folder using local-remote-file-manager ability.
 * Uses native transport for development with 1:1 mapping to ability method.
 */

import { z, logger, timer, MODULE_AGENT, getLocalRemoteFileManagerAbilityPath } from './utils.js';
import type { KadiClient } from '@kadi.build/core';

export function registerCreateFolder(client: KadiClient) {
  client.registerTool({
    name: 'local_remote_create_folder',
    description: 'Create a new folder using local-remote-file-manager',
    input: z.object({
      folderPath: z.string().describe('Folder path to create'),
      providerName: z.string().optional().default('local').describe('Provider to use (local)')
    }),
    output: z.object({
      success: z.boolean(),
      message: z.string()
    })
  },
  async (params) => {
    logger.info(MODULE_AGENT, `Creating folder: ${params.folderPath}`, timer.elapsed('main'));

    const abilityPath = getLocalRemoteFileManagerAbilityPath();
    const ability = await client.load('local-remote-file-manager-ability', 'native', {
      path: abilityPath
    });

    try {
      const result = await ability.create_folder(params);
      logger.info(MODULE_AGENT, 'Folder created successfully', timer.elapsed('main'));
      return result;
    } finally {
      await ability.__disconnect();
    }
  });
}
