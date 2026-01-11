/**
 * Get Usage Stats Tool
 *
 * Gets usage statistics using local-remote-file-manager ability.
 * Uses native transport for development with 1:1 mapping to ability method.
 */

import { z, logger, timer, MODULE_AGENT, getLocalRemoteFileManagerAbilityPath } from './utils.js';
import type { KadiClient } from '@kadi.build/core';

export function registerGetUsageStats(client: KadiClient) {
  client.registerTool({
    name: 'local_remote_get_usage_stats',
    description: 'Get usage statistics using local-remote-file-manager',
    input: z.object({}),
    output: z.object({
      filesUploaded: z.number(),
      filesDownloaded: z.number(),
      totalBytesTransferred: z.number(),
      activeWatchers: z.number(),
      activeTunnels: z.number()
    })
  },
  async (params) => {
    logger.info(MODULE_AGENT, 'Getting usage stats', timer.elapsed('main'));

    const abilityPath = getLocalRemoteFileManagerAbilityPath();
    const ability = await client.load('local-remote-file-manager-ability', 'native', {
      path: abilityPath
    });

    try {
      const result = await ability.get_usage_stats(params);
      logger.info(MODULE_AGENT, 'Usage stats retrieved', timer.elapsed('main'));
      return result;
    } finally {
      await ability.__disconnect();
    }
  });
}
