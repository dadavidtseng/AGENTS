/**
 * Create Tunnel Tool
 *
 * Creates a tunnel for sharing local server using local-remote-file-manager ability.
 * Uses native transport for development with 1:1 mapping to ability method.
 */

import { z, logger, timer, MODULE_AGENT, getLocalRemoteFileManagerAbilityPath } from './utils.js';
import type { KadiClient } from '@kadi.build/core';

export function registerCreateTunnel(client: KadiClient) {
  client.registerTool({
    name: 'local_remote_create_tunnel',
    description: 'Create a tunnel for sharing local server using local-remote-file-manager',
    input: z.object({
      port: z.number().optional().describe('Local port to tunnel'),
      service: z.enum(['ngrok', 'localtunnel', 'serveo', 'localhost.run', 'pinggy']).optional().default('ngrok').describe('Tunnel service to use'),
      subdomain: z.string().optional().describe('Custom subdomain'),
      authToken: z.string().optional().describe('Authentication token for service')
    }),
    output: z.object({
      success: z.boolean(),
      tunnelId: z.string(),
      publicUrl: z.string(),
      localPort: z.number(),
      service: z.string()
    })
  },
  async (params) => {
    logger.info(MODULE_AGENT, `Creating tunnel on port: ${params.port}`, timer.elapsed('main'));

    const abilityPath = getLocalRemoteFileManagerAbilityPath();
    const ability = await client.load('local-remote-file-manager-ability', 'native', {
      path: abilityPath
    });

    try {
      const result = await ability.create_tunnel(params);
      logger.info(MODULE_AGENT, `Tunnel created: ${result.publicUrl}`, timer.elapsed('main'));
      return result;
    } finally {
      await ability.__disconnect();
    }
  });
}
