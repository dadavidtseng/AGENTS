/**
 * Destroy Tunnel Tool
 *
 * Destroys an active tunnel using local-remote-file-manager ability.
 * Uses native transport for development with 1:1 mapping to ability method.
 */

import { z, logger, timer, MODULE_AGENT, getLocalRemoteFileManagerAbilityPath } from './utils.js';
import type { KadiClient } from '@kadi.build/core';

export function registerDestroyTunnel(client: KadiClient) {
  client.registerTool({
    name: 'local_remote_destroy_tunnel',
    description: 'Destroy an active tunnel using local-remote-file-manager',
    input: z.object({
      tunnelId: z.string().describe('Tunnel ID to destroy')
    }),
    output: z.object({
      success: z.boolean(),
      message: z.string()
    })
  },
  async (params) => {
    logger.info(MODULE_AGENT, `Destroying tunnel: ${params.tunnelId}`, timer.elapsed('main'));

    const abilityPath = getLocalRemoteFileManagerAbilityPath();
    const ability = await client.load('local-remote-file-manager-ability', 'native', {
      path: abilityPath
    });

    try {
      const result = await ability.destroy_tunnel(params);
      logger.info(MODULE_AGENT, 'Tunnel destroyed', timer.elapsed('main'));
      return result;
    } finally {
      await ability.__disconnect();
    }
  });
}
