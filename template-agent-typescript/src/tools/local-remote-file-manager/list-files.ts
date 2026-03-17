/**
 * List Files Tool
 *
 * Lists files in a directory using local-remote-file-manager ability.
 * Uses native transport for development with 1:1 mapping to ability method.
 */

import { z, logger, timer, MODULE_AGENT, getLocalRemoteFileManagerAbilityPath } from './utils.js';
import type { KadiClient } from '@kadi.build/core';

export function registerListFiles(client: KadiClient) {
  client.registerTool({
    name: 'local_remote_list_files',
    description: 'List files in a directory using local-remote-file-manager',
    input: z.object({
      directoryPath: z.string().optional().default('/').describe('Directory path to list'),
      providerName: z.string().optional().default('local').describe('Provider to use (local)'),
      recursive: z.boolean().optional().default(false).describe('List recursively'),
      includeHidden: z.boolean().optional().default(false).describe('Include hidden files'),
      fileTypesOnly: z.boolean().optional().default(false).describe('Return only files (exclude directories)'),
      limit: z.number().optional().default(100).describe('Limit results (default: 100 for optimal performance)')
    }),
    output: z.object({
      files: z.array(z.object({
        name: z.string(),
        path: z.string(),
        size: z.number(),
        modifiedTime: z.string(),
        isDirectory: z.boolean()
      }))
    })
  },
  async (params) => {
    logger.info(MODULE_AGENT, `Listing files in: ${params.directoryPath}`, timer.elapsed('main'));

    const abilityPath = getLocalRemoteFileManagerAbilityPath();
    const ability = await client.loadNative('local-remote-file-manager-ability', {
      path: process.env.LOCAL_REMOTE_FILE_MANAGER_ABILITY_PATH!
    });

    try {
      const result = await ability.invoke('list_files', params);
      logger.info(MODULE_AGENT, `Listed ${result.files.length} items`, timer.elapsed('main'));
      return result;
    } finally {
      await ability.disconnect();
    }
  });
}
