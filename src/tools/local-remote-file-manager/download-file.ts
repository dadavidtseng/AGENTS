/**
 * Download File Tool
 *
 * Downloads a file from source to target location using local-remote-file-manager ability.
 * Uses native transport for development with 1:1 mapping to ability method.
 */

import { z, logger, timer, MODULE_AGENT, getLocalRemoteFileManagerAbilityPath } from './utils.js';
import type { KadiClient } from '@kadi.build/core';

export function registerDownloadFile(client: KadiClient) {
  client.registerTool({
    name: 'local_remote_download_file',
    description: 'Download a file from source to target location using local-remote-file-manager',
    input: z.object({
      sourcePath: z.string().describe('Source file path'),
      targetPath: z.string().describe('Target file path'),
      providerName: z.string().optional().default('local').describe('Provider to use (local)')
    }),
    output: z.object({
      name: z.string(),
      path: z.string(),
      size: z.number(),
      modifiedTime: z.string(),
      hash: z.string()
    })
  },
  async (params) => {
    logger.info(MODULE_AGENT, `Downloading file: ${params.sourcePath} -> ${params.targetPath}`, timer.elapsed('main'));

    const abilityPath = getLocalRemoteFileManagerAbilityPath();
    const ability = await client.loadNative('local-remote-file-manager-ability', {
      path: process.env.LOCAL_REMOTE_FILE_MANAGER_ABILITY_PATH!
    });

    try {
      const result = await ability.invoke('download_file', params);
      logger.info(MODULE_AGENT, `Download completed: ${result.name}`, timer.elapsed('main'));
      return result;
    } finally {
      await ability.disconnect();
    }
  });
}
