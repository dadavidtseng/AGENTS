/**
 * Decompress Multiple Files Tool
 *
 * Decompresses multiple archive files using local-remote-file-manager ability.
 * Uses native transport for development with 1:1 mapping to ability method.
 */

import { z, logger, timer, MODULE_AGENT, getLocalRemoteFileManagerAbilityPath } from './utils.js';
import type { KadiClient } from '@kadi.build/core';

export function registerDecompressMultipleFiles(client: KadiClient) {
  client.registerTool({
    name: 'local_remote_decompress_multiple_files',
    description: 'Decompress multiple archive files using local-remote-file-manager',
    input: z.object({
      archiveList: z.array(z.string()).describe('List of archive files to decompress'),
      outputDirectory: z.string().describe('Output directory for extracted files')
    }),
    output: z.object({
      success: z.boolean(),
      results: z.array(z.object({
        file: z.string(),
        success: z.boolean(),
        error: z.string().optional()
      }))
    })
  },
  async (params) => {
    logger.info(MODULE_AGENT, `Decompressing ${params.archiveList.length} archives`, timer.elapsed('main'));

    const abilityPath = getLocalRemoteFileManagerAbilityPath();
    const ability = await client.loadNative('local-remote-file-manager-ability', {
      path: process.env.LOCAL_REMOTE_FILE_MANAGER_ABILITY_PATH!
    });

    try {
      const result = await ability.invoke('decompress_multiple_files', params);
      logger.info(MODULE_AGENT, 'Multiple file decompression completed', timer.elapsed('main'));
      return result;
    } finally {
      await ability.disconnect();
    }
  });
}
