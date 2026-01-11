/**
 * Get Registry Status Tool (1:1 mapping)
 *
 * Direct mapping to container-registry-ability's get_registry_status() method.
 * Gets current registry status and information.
 */

import { z, logger, MODULE_AGENT, timer, getContainerRegistryAbilityPath } from './utils.js';
import type { KadiClient } from '@kadi.build/core';

export const getRegistryStatusInputSchema = z.object({});

export const getRegistryStatusOutputSchema = z.object({
  success: z.boolean().describe('Whether the operation succeeded'),
  state: z.string().optional().describe('Registry state (running, stopped, etc)'),
  port: z.number().optional().describe('Local server port'),
  containerCount: z.number().optional().describe('Number of containers'),
  engine: z.string().optional().describe('Container engine in use'),
  tunnelActive: z.boolean().optional().describe('Whether tunnel is active'),
  message: z.string().describe('Success message or error details')
});

export type GetRegistryStatusInput = z.infer<typeof getRegistryStatusInputSchema>;
export type GetRegistryStatusOutput = z.infer<typeof getRegistryStatusOutputSchema>;

/**
 * Register the get_registry_status tool
 */
export function registerGetRegistryStatusTool(client: KadiClient) {
  client.registerTool(
    {
      name: 'get_registry_status',
      description: 'Get current registry status and information. Direct mapping to container-registry-ability.',
      input: getRegistryStatusInputSchema,
      output: getRegistryStatusOutputSchema,
    },
    async (params: GetRegistryStatusInput): Promise<GetRegistryStatusOutput> => {
      logger.info(MODULE_AGENT, `Executing get_registry_status`, timer.elapsed('main'));

      try {
        const abilityPath = getContainerRegistryAbilityPath();

        const registryAbility = await client.load('container-registry-ability', 'native', {
          path: abilityPath
        });

        const result = await registryAbility.get_registry_status(params);
        await registryAbility.__disconnect();

        logger.info(MODULE_AGENT, `Get registry status completed: ${result.message}`, timer.elapsed('main'));

        return result;

      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        logger.info(
          MODULE_AGENT,
          `Get registry status failed: ${errorMessage}`,
          timer.elapsed('main')
        );

        return {
          success: false,
          message: `Get registry status failed: ${errorMessage}`
        };
      }
    }
  );
}
