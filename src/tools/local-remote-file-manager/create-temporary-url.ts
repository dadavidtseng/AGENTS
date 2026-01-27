/**
 * Create Temporary URL Tool
 *
 * Creates a temporary shareable URL for a file using local-remote-file-manager ability.
 * Uses native transport for development with 1:1 mapping to ability method.
 */

import { z, logger, timer, MODULE_AGENT, getLocalRemoteFileManagerAbilityPath } from './utils.js';
import type { KadiClient } from '@kadi.build/core';

export function registerCreateTemporaryUrl(client: KadiClient) {
  client.registerTool({
    name: 'local_remote_create_temporary_url',
    description: 'Create a temporary shareable URL for a file using local-remote-file-manager',
    input: z.object({
      filePath: z.string().describe('File path to share'),
      expiresIn: z.string().optional().default('1h').describe('Expiration time (e.g., "1h", "30m", "2d")'),
      maxDownloads: z.number().optional().describe('Maximum number of downloads'),
      password: z.string().optional().describe('Password protection')
    }),
    output: z.object({
      success: z.boolean(),
      urlId: z.string(),
      publicUrl: z.string(),
      expiresAt: z.string(),
      accessCode: z.string().optional()
    })
  },
  async (params) => {
    logger.info(MODULE_AGENT, `Creating temporary URL for: ${params.filePath}`, timer.elapsed('main'));

    const abilityPath = getLocalRemoteFileManagerAbilityPath();
    const ability = await client.loadNative('local-remote-file-manager-ability', {
      path: process.env.LOCAL_REMOTE_FILE_MANAGER_ABILITY_PATH!
    });

    try {
      const result = await ability.invoke('create_temporary_url', params);
      logger.info(MODULE_AGENT, `Temporary URL created: ${result.publicUrl}`, timer.elapsed('main'));
      return result;
    } finally {
      await ability.disconnect();
    }
  });
}
