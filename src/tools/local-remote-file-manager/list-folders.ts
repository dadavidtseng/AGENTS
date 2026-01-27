/**
 * List Folders Tool
 *
 * Lists folders in a directory using local-remote-file-manager ability.
 * Uses native transport for development with 1:1 mapping to ability method.
 */

import { z, logger, timer, MODULE_AGENT, getLocalRemoteFileManagerAbilityPath } from './utils.js';
import type { KadiClient } from '@kadi.build/core';

export function registerListFolders(client: KadiClient) {
  client.registerTool({
    name: 'local_remote_list_folders',
    description: 'List folders in a directory using local-remote-file-manager',
    input: z.object({
      directoryPath: z.string().optional().default('/').describe('Directory path to list'),
      providerName: z.string().optional().default('local').describe('Provider to use (local)'),
      limit: z.number().optional().default(100).describe('Limit results (default: 100 for optimal performance)')
    }),
    output: z.object({
      folders: z.array(z.object({
        name: z.string(),
        path: z.string(),
        modifiedTime: z.string()
      }))
    })
  },
  async (params) => {
    logger.info(MODULE_AGENT, `Listing folders in: ${params.directoryPath}`, timer.elapsed('main'));

    const abilityPath = getLocalRemoteFileManagerAbilityPath();
    const ability = await client.loadNative('local-remote-file-manager-ability', {
      path: process.env.LOCAL_REMOTE_FILE_MANAGER_ABILITY_PATH!
    });

    try {
      const result = await ability.invoke('list_folders', params);
      logger.info(MODULE_AGENT, `Listed ${result.folders.length} folders`, timer.elapsed('main'));
      return result;
    } finally {
      await ability.disconnect();
    }
  });
}
