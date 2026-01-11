/**
 * Shutdown Tool
 *
 * Gracefully shuts down the manager and cleanups resources using local-remote-file-manager ability.
 * Uses native transport for development with 1:1 mapping to ability method.
 */

import { z, logger, timer, MODULE_AGENT, getLocalRemoteFileManagerAbilityPath } from './utils.js';
import type { KadiClient } from '@kadi.build/core';

export function registerShutdown(client: KadiClient) {
  client.registerTool({
    name: 'local_remote_shutdown',
    description: 'Gracefully shutdown the manager and cleanup resources using local-remote-file-manager',
    input: z.object({}),
    output: z.object({
      success: z.boolean(),
      message: z.string()
    })
  },
  async (params) => {
    logger.info(MODULE_AGENT, 'Shutting down manager', timer.elapsed('main'));

    const abilityPath = getLocalRemoteFileManagerAbilityPath();
    const ability = await client.load('local-remote-file-manager-ability', 'native', {
      path: abilityPath
    });

    try {
      const result = await ability.shutdown(params);
      logger.info(MODULE_AGENT, 'Manager shutdown completed', timer.elapsed('main'));
      return result;
    } finally {
      await ability.__disconnect();
    }
  });
}
