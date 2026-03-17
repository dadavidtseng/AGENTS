/**
 * Test Connection Tool
 *
 * Tests connection to a provider using local-remote-file-manager ability.
 * Uses native transport for development with 1:1 mapping to ability method.
 */

import { z, logger, timer, MODULE_AGENT, getLocalRemoteFileManagerAbilityPath } from './utils.js';
import type { KadiClient } from '@kadi.build/core';

export function registerTestConnection(client: KadiClient) {
  client.registerTool({
    name: 'local_remote_test_connection',
    description: 'Test connection to a provider using local-remote-file-manager',
    input: z.object({
      providerName: z.string().optional().default('local').describe('Provider to test (local)')
    }),
    output: z.object({
      provider: z.string(),
      accessible: z.boolean(),
      writable: z.boolean(),
      totalSize: z.number().optional(),
      freeSpace: z.number().optional()
    })
  },
  async (params) => {
    logger.info(MODULE_AGENT, `Testing connection to: ${params.providerName}`, timer.elapsed('main'));

    const abilityPath = getLocalRemoteFileManagerAbilityPath();
    const ability = await client.loadNative('local-remote-file-manager-ability', {
      path: process.env.LOCAL_REMOTE_FILE_MANAGER_ABILITY_PATH!
    });

    try {
      const result = await ability.invoke('test_connection', params);
      logger.info(MODULE_AGENT, `Connection test completed: ${result.accessible ? 'accessible' : 'not accessible'}`, timer.elapsed('main'));
      return result;
    } finally {
      await ability.disconnect();
    }
  });
}
