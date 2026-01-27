/**
 * Get Registry URLs Tool (1:1 mapping)
 *
 * Direct mapping to container-registry-ability's get_registry_urls() method.
 * Gets registry access URLs (public and local).
 */

import { z, logger, MODULE_AGENT, timer, getContainerRegistryAbilityPath } from './utils.js';
import type { KadiClient } from '@kadi.build/core';

export const getRegistryUrlsInputSchema = z.object({});

export const getRegistryUrlsOutputSchema = z.object({
  success: z.boolean().describe('Whether the operation succeeded'),
  publicUrl: z.string().optional().describe('Public tunnel URL'),
  localUrl: z.string().optional().describe('Local registry URL'),
  tunnelType: z.string().optional().describe('Tunnel service type'),
  message: z.string().describe('Success message or error details')
});

export type GetRegistryUrlsInput = z.infer<typeof getRegistryUrlsInputSchema>;
export type GetRegistryUrlsOutput = z.infer<typeof getRegistryUrlsOutputSchema>;

/**
 * Register the get_registry_urls tool
 */
export function registerGetRegistryUrlsTool(client: KadiClient) {
  client.registerTool(
    {
      name: 'get_registry_urls',
      description: 'Get registry access URLs. Direct mapping to container-registry-ability.',
      input: getRegistryUrlsInputSchema,
      output: getRegistryUrlsOutputSchema,
    },
    async (params: GetRegistryUrlsInput): Promise<GetRegistryUrlsOutput> => {
      logger.info(MODULE_AGENT, `Executing get_registry_urls`, timer.elapsed('main'));

      try {
        const abilityPath = getContainerRegistryAbilityPath();

        const registryAbility = await client.loadNative('container-registry-ability', {
          path: process.env.CONTAINER_REGISTRY_ABILITY_PATH!
        });

        const result = await registryAbility.invoke('get_registry_urls', params);
        await registryAbility.disconnect();

        logger.info(MODULE_AGENT, `Get registry URLs completed: ${result.message}`, timer.elapsed('main'));

        return result;

      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        logger.info(
          MODULE_AGENT,
          `Get registry URLs failed: ${errorMessage}`,
          timer.elapsed('main')
        );

        return {
          success: false,
          message: `Get registry URLs failed: ${errorMessage}`
        };
      }
    }
  );
}
