/**
 * Upload Multiple Files Tool
 *
 * Uploads multiple files using local-remote-file-manager ability.
 * Uses native transport for development with 1:1 mapping to ability method.
 */

import { z, logger, timer, MODULE_AGENT, getLocalRemoteFileManagerAbilityPath } from './utils.js';
import type { KadiClient } from '@kadi.build/core';

export function registerUploadMultipleFiles(client: KadiClient) {
  client.registerTool({
    name: 'local_remote_upload_multiple_files',
    description: 'Upload multiple files using local-remote-file-manager',
    input: z.object({
      fileList: z.array(z.object({
        sourcePath: z.string(),
        targetPath: z.string()
      })).describe('List of files to upload'),
      targetDirectory: z.string().optional().default('/').describe('Target directory'),
      providerName: z.string().optional().default('local').describe('Provider to use (local)')
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
    logger.info(MODULE_AGENT, `Uploading ${params.fileList.length} files`, timer.elapsed('main'));

    const abilityPath = getLocalRemoteFileManagerAbilityPath();
    const ability = await client.loadNative('local-remote-file-manager-ability', {
      path: process.env.LOCAL_REMOTE_FILE_MANAGER_ABILITY_PATH!
    });

    try {
      const result = await ability.invoke('upload_multiple_files', params);
      logger.info(MODULE_AGENT, `Multiple file upload completed`, timer.elapsed('main'));
      return result;
    } finally {
      await ability.disconnect();
    }
  });
}
