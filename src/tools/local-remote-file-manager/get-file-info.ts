/**
 * Get File Info Tool
 *
 * Gets information about a file using local-remote-file-manager ability.
 * Uses native transport for development with 1:1 mapping to ability method.
 */

import { z, logger, timer, MODULE_AGENT, getLocalRemoteFileManagerAbilityPath } from './utils.js';
import type { KadiClient } from '@kadi.build/core';

export function registerGetFileInfo(client: KadiClient) {
  client.registerTool({
    name: 'local_remote_get_file_info',
    description: 'Get information about a file using local-remote-file-manager',
    input: z.object({
      filePath: z.string().describe('File path to get info for'),
      providerName: z.string().optional().default('local').describe('Provider to use (local)')
    }),
    output: z.object({
      name: z.string(),
      path: z.string(),
      size: z.number(),
      modifiedTime: z.string(),
      isDirectory: z.boolean()
    })
  },
  async (params) => {
    logger.info(MODULE_AGENT, `Getting file info: ${params.filePath}`, timer.elapsed('main'));

    const abilityPath = getLocalRemoteFileManagerAbilityPath();
    const ability = await client.load('local-remote-file-manager-ability', 'native', {
      path: abilityPath
    });

    try {
      const result = await ability.get_file_info(params);
      logger.info(MODULE_AGENT, `File info retrieved: ${result.name}`, timer.elapsed('main'));
      return result;
    } finally {
      await ability.__disconnect();
    }
  });
}
