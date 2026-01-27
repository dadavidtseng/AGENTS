/**
 * Decompress File Tool
 *
 * Decompresses an archive file using local-remote-file-manager ability.
 * Uses native transport for development with 1:1 mapping to ability method.
 */

import { z, logger, timer, MODULE_AGENT, getLocalRemoteFileManagerAbilityPath } from './utils.js';
import type { KadiClient } from '@kadi.build/core';

export function registerDecompressFile(client: KadiClient) {
  client.registerTool({
    name: 'local_remote_decompress_file',
    description: 'Decompress an archive file using local-remote-file-manager',
    input: z.object({
      archivePath: z.string().describe('Archive file path'),
      outputDirectory: z.string().describe('Output directory path'),
      preserveStructure: z.boolean().optional().default(true).describe('Preserve directory structure')
    }),
    output: z.object({
      success: z.boolean(),
      extractedFiles: z.number(),
      totalSize: z.number(),
      outputDirectory: z.string()
    })
  },
  async (params) => {
    logger.info(MODULE_AGENT, `Decompressing: ${params.archivePath} -> ${params.outputDirectory}`, timer.elapsed('main'));

    const abilityPath = getLocalRemoteFileManagerAbilityPath();
    const ability = await client.loadNative('local-remote-file-manager-ability', {
      path: process.env.LOCAL_REMOTE_FILE_MANAGER_ABILITY_PATH!
    });

    try {
      const result = await ability.invoke('decompress_file', params);
      logger.info(MODULE_AGENT, `Decompression completed: ${result.extractedFiles} files`, timer.elapsed('main'));
      return result;
    } finally {
      await ability.disconnect();
    }
  });
}
