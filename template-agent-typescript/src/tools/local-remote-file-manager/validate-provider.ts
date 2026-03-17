/**
 * Validate Provider Tool
 *
 * Validates provider configuration using local-remote-file-manager ability.
 * Uses native transport for development with 1:1 mapping to ability method.
 */

import { z, logger, timer, MODULE_AGENT, getLocalRemoteFileManagerAbilityPath } from './utils.js';
import type { KadiClient } from '@kadi.build/core';

export function registerValidateProvider(client: KadiClient) {
  client.registerTool({
    name: 'local_remote_validate_provider',
    description: 'Validate provider configuration using local-remote-file-manager',
    input: z.object({
      providerName: z.string().optional().default('local').describe('Provider to validate (local)')
    }),
    output: z.object({
      isValid: z.boolean(),
      errors: z.array(z.string()),
      warnings: z.array(z.string())
    })
  },
  async (params) => {
    logger.info(MODULE_AGENT, `Validating provider: ${params.providerName}`, timer.elapsed('main'));

    const abilityPath = getLocalRemoteFileManagerAbilityPath();
    const ability = await client.loadNative('local-remote-file-manager-ability', {
      path: process.env.LOCAL_REMOTE_FILE_MANAGER_ABILITY_PATH!
    });

    try {
      const result = await ability.invoke('validate_provider', params);
      logger.info(MODULE_AGENT, `Provider validation: ${result.isValid ? 'valid' : 'invalid'}`, timer.elapsed('main'));
      return result;
    } finally {
      await ability.disconnect();
    }
  });
}
