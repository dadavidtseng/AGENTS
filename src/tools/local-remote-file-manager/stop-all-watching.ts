/**
 * Stop All Watching Tool
 *
 * Stops all active watchers using local-remote-file-manager ability.
 * Uses native transport for development with 1:1 mapping to ability method.
 */

import { z, logger, timer, MODULE_AGENT, getLocalRemoteFileManagerAbilityPath } from './utils.js';
import type { KadiClient } from '@kadi.build/core';

export function registerStopAllWatching(client: KadiClient) {
  client.registerTool({
    name: 'local_remote_stop_all_watching',
    description: 'Stop all active watchers using local-remote-file-manager',
    input: z.object({}),
    output: z.object({
      success: z.boolean(),
      message: z.string(),
      stoppedCount: z.number()
    })
  },
  async (params) => {
    logger.info(MODULE_AGENT, 'Stopping all watchers', timer.elapsed('main'));

    const abilityPath = getLocalRemoteFileManagerAbilityPath();
    const ability = await client.loadNative('local-remote-file-manager-ability', {
      path: process.env.LOCAL_REMOTE_FILE_MANAGER_ABILITY_PATH!
    });

    try {
      const result = await ability.invoke('stop_all_watching', params);
      logger.info(MODULE_AGENT, `All watchers stopped: ${result.stoppedCount}`, timer.elapsed('main'));
      return result;
    } finally {
      await ability.disconnect();
    }
  });
}
