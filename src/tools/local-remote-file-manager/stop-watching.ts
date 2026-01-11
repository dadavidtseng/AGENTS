/**
 * Stop Watching Tool
 *
 * Stops watching a directory using local-remote-file-manager ability.
 * Uses native transport for development with 1:1 mapping to ability method.
 */

import { z, logger, timer, MODULE_AGENT, getLocalRemoteFileManagerAbilityPath } from './utils.js';
import type { KadiClient } from '@kadi.build/core';

export function registerStopWatching(client: KadiClient) {
  client.registerTool({
    name: 'local_remote_stop_watching',
    description: 'Stop watching a directory using local-remote-file-manager',
    input: z.object({
      watchIdOrPath: z.string().describe('Watch ID or directory path to stop watching')
    }),
    output: z.object({
      success: z.boolean(),
      message: z.string()
    })
  },
  async (params) => {
    logger.info(MODULE_AGENT, `Stopping watch: ${params.watchIdOrPath}`, timer.elapsed('main'));

    const abilityPath = getLocalRemoteFileManagerAbilityPath();
    const ability = await client.load('local-remote-file-manager-ability', 'native', {
      path: abilityPath
    });

    try {
      const result = await ability.stop_watching(params);
      logger.info(MODULE_AGENT, 'Watcher stopped', timer.elapsed('main'));
      return result;
    } finally {
      await ability.__disconnect();
    }
  });
}
