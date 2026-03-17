/**
 * Remove Container Tool (1:1 mapping)
 *
 * Direct mapping to container-registry-ability's remove_container() method.
 * Removes a container from the registry.
 */

import { z, logger, MODULE_AGENT, timer, getContainerRegistryAbilityPath } from './utils.js';
import type { KadiClient } from '@kadi.build/core';

export const removeContainerInputSchema = z.object({
  containerId: z.string().describe('Container alias or ID to remove')
});

export const removeContainerOutputSchema = z.object({
  success: z.boolean().describe('Whether the operation succeeded'),
  message: z.string().describe('Success message or error details')
});

export type RemoveContainerInput = z.infer<typeof removeContainerInputSchema>;
export type RemoveContainerOutput = z.infer<typeof removeContainerOutputSchema>;

/**
 * Register the remove_container tool
 */
export function registerRemoveContainerTool(client: KadiClient) {
  client.registerTool(
    {
      name: 'remove_container',
      description: 'Remove container from registry. Direct mapping to container-registry-ability.',
      input: removeContainerInputSchema,
      output: removeContainerOutputSchema,
    },
    async (params: RemoveContainerInput): Promise<RemoveContainerOutput> => {
      logger.info(
        MODULE_AGENT,
        `Executing remove_container: ${params.containerId}`,
        timer.elapsed('main')
      );

      try {
        const abilityPath = getContainerRegistryAbilityPath();

        const registryAbility = await client.loadNative('container-registry-ability', {
          path: process.env.CONTAINER_REGISTRY_ABILITY_PATH!
        });

        const result = await registryAbility.invoke('remove_container', params);
        await registryAbility.disconnect();

        logger.info(MODULE_AGENT, `Remove container completed: ${result.message}`, timer.elapsed('main'));

        return result;

      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        logger.info(
          MODULE_AGENT,
          `Remove container failed: ${errorMessage}`,
          timer.elapsed('main')
        );

        return {
          success: false,
          message: `Remove container failed: ${errorMessage}`
        };
      }
    }
  );
}
