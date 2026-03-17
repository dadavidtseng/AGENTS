/**
 * Start Watching Tool
 *
 * Starts watching a directory for changes using local-remote-file-manager ability.
 * Uses native transport for development with 1:1 mapping to ability method.
 */

import { z, logger, timer, MODULE_AGENT, getLocalRemoteFileManagerAbilityPath } from './utils.js';
import type { KadiClient } from '@kadi.build/core';

export function registerStartWatching(client: KadiClient) {
  client.registerTool({
    name: 'local_remote_start_watching',
    description: 'Start watching a directory for changes using local-remote-file-manager',
    input: z.object({
      directoryPath: z.string().describe('Directory path to watch'),
      recursive: z.boolean().optional().default(true).describe('Watch recursively'),
      ignoreInitial: z.boolean().optional().default(true).describe('Ignore initial add events'),
      ignored: z.array(z.string()).optional().describe('Patterns to ignore')
    }),
    output: z.object({
      success: z.boolean(),
      watchId: z.string(),
      path: z.string(),
      message: z.string()
    })
  },
  async (params) => {
    logger.info(MODULE_AGENT, `Starting watch on: ${params.directoryPath}`, timer.elapsed('main'));

    const abilityPath = getLocalRemoteFileManagerAbilityPath();
    const ability = await client.loadNative('local-remote-file-manager-ability', {
      path: process.env.LOCAL_REMOTE_FILE_MANAGER_ABILITY_PATH!
    });

    try {
      const result = await ability.invoke('start_watching', params);
      logger.info(MODULE_AGENT, `Watcher started: ${result.watchId}`, timer.elapsed('main'));
      return result;
    } finally {
      await ability.disconnect();
    }
  });
}
