/**
 * Revoke Temporary URL Tool
 *
 * Revokes a temporary shareable URL using local-remote-file-manager ability.
 * Uses native transport for development with 1:1 mapping to ability method.
 */

import { z, logger, timer, MODULE_AGENT, getLocalRemoteFileManagerAbilityPath } from './utils.js';
import type { KadiClient } from '@kadi.build/core';

export function registerRevokeTemporaryUrl(client: KadiClient) {
  client.registerTool({
    name: 'local_remote_revoke_temporary_url',
    description: 'Revoke a temporary shareable URL using local-remote-file-manager',
    input: z.object({
      urlId: z.string().describe('URL ID to revoke')
    }),
    output: z.object({
      success: z.boolean(),
      message: z.string()
    })
  },
  async (params) => {
    logger.info(MODULE_AGENT, `Revoking temporary URL: ${params.urlId}`, timer.elapsed('main'));

    const abilityPath = getLocalRemoteFileManagerAbilityPath();
    const ability = await client.loadNative('local-remote-file-manager-ability', {
      path: process.env.LOCAL_REMOTE_FILE_MANAGER_ABILITY_PATH!
    });

    try {
      const result = await ability.invoke('revoke_temporary_url', params);
      logger.info(MODULE_AGENT, 'Temporary URL revoked', timer.elapsed('main'));
      return result;
    } finally {
      await ability.disconnect();
    }
  });
}
