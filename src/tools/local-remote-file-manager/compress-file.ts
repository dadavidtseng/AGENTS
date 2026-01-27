/**
 * Compress File Tool
 *
 * Compresses a file or folder into an archive using local-remote-file-manager ability.
 * Uses native transport for development with 1:1 mapping to ability method.
 */

import { z, logger, timer, MODULE_AGENT, getLocalRemoteFileManagerAbilityPath } from './utils.js';
import type { KadiClient } from '@kadi.build/core';

export function registerCompressFile(client: KadiClient) {
  client.registerTool({
    name: 'local_remote_compress_file',
    description: 'Compress a file or folder into an archive using local-remote-file-manager',
    input: z.object({
      inputPath: z.string().describe('Input file or folder path'),
      outputPath: z.string().describe('Output archive path'),
      format: z.enum(['zip', 'tar.gz']).optional().default('zip').describe('Archive format'),
      compressionLevel: z.number().optional().default(6).describe('Compression level (0-9)')
    }),
    output: z.object({
      success: z.boolean(),
      archivePath: z.string(),
      originalSize: z.number(),
      compressedSize: z.number(),
      compressionRatio: z.string(),
      format: z.string()
    })
  },
  async (params) => {
    logger.info(MODULE_AGENT, `Compressing: ${params.inputPath} -> ${params.outputPath}`, timer.elapsed('main'));

    const abilityPath = getLocalRemoteFileManagerAbilityPath();
    const ability = await client.loadNative('local-remote-file-manager-ability', {
      path: process.env.LOCAL_REMOTE_FILE_MANAGER_ABILITY_PATH!
    });

    try {
      const result = await ability.invoke('compress_file', params);
      logger.info(MODULE_AGENT, `Compression completed: ${result.compressionRatio}`, timer.elapsed('main'));
      return result;
    } finally {
      await ability.disconnect();
    }
  });
}
