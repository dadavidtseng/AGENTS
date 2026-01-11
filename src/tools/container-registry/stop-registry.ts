/**
 * Stop Registry Tool (1:1 mapping)
 *
 * Direct mapping to container-registry-ability's stop_registry() method.
 * Stops the container registry and cleans up resources.
 */

import { z, logger, MODULE_AGENT, timer, getContainerRegistryAbilityPath } from './utils.js';
import type { KadiClient } from '@kadi.build/core';

export const stopRegistryInputSchema = z.object({});

export const stopRegistryOutputSchema = z.object({
  success: z.boolean().describe('Whether the operation succeeded'),
  message: z.string().describe('Success message or error details')
});

export type StopRegistryInput = z.infer<typeof stopRegistryInputSchema>;
export type StopRegistryOutput = z.infer<typeof stopRegistryOutputSchema>;

/**
 * Register the stop_registry tool
 */
export function registerStopRegistryTool(client: KadiClient) {
  client.registerTool(
    {
      name: 'stop_registry',
      description: 'Stop container registry and cleanup resources. Direct mapping to container-registry-ability.',
      input: stopRegistryInputSchema,
      output: stopRegistryOutputSchema,
    },
    async (params: StopRegistryInput): Promise<StopRegistryOutput> => {
      logger.info(MODULE_AGENT, `Executing stop_registry`, timer.elapsed('main'));

      try {
        const abilityPath = getContainerRegistryAbilityPath();

        const registryAbility = await client.load('container-registry-ability', 'native', {
          path: abilityPath
        });

        const result = await registryAbility.stop_registry(params);
        await registryAbility.__disconnect();

        logger.info(MODULE_AGENT, `Stop registry completed: ${result.message}`, timer.elapsed('main'));

        return result;

      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        logger.info(
          MODULE_AGENT,
          `Stop registry failed: ${errorMessage}`,
          timer.elapsed('main')
        );

        return {
          success: false,
          message: `Stop registry failed: ${errorMessage}`
        };
      }
    }
  );
}
