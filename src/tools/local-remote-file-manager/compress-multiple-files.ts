/**
 * Compress Multiple Files Tool
 *
 * Compresses multiple files into archives using local-remote-file-manager ability.
 * Uses native transport for development with 1:1 mapping to ability method.
 */

import { z, logger, timer, MODULE_AGENT, getLocalRemoteFileManagerAbilityPath } from './utils.js';
import type { KadiClient } from '@kadi.build/core';

export function registerCompressMultipleFiles(client: KadiClient) {
  client.registerTool({
    name: 'local_remote_compress_multiple_files',
    description: 'Compress multiple files into archives using local-remote-file-manager',
    input: z.object({
      fileList: z.array(z.object({
        inputPath: z.string(),
        outputPath: z.string()
      })).describe('List of files to compress'),
      outputDirectory: z.string().describe('Output directory for archives'),
      format: z.enum(['zip', 'tar.gz']).optional().default('zip').describe('Archive format')
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
    logger.info(MODULE_AGENT, `Compressing ${params.fileList.length} files`, timer.elapsed('main'));

    const abilityPath = getLocalRemoteFileManagerAbilityPath();
    const ability = await client.load('local-remote-file-manager-ability', 'native', {
      path: abilityPath
    });

    try {
      const result = await ability.compress_multiple_files(params);
      logger.info(MODULE_AGENT, 'Multiple file compression completed', timer.elapsed('main'));
      return result;
    } finally {
      await ability.__disconnect();
    }
  });
}
