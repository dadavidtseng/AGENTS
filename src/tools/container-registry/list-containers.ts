/**
 * List Containers Tool (1:1 mapping)
 *
 * Direct mapping to container-registry-ability's list_containers() method.
 * Lists all containers in the registry.
 */

import { z, logger, MODULE_AGENT, timer, getContainerRegistryAbilityPath } from './utils.js';
import type { KadiClient } from '@kadi.build/core';

export const listContainersInputSchema = z.object({});

export const listContainersOutputSchema = z.object({
  success: z.boolean().describe('Whether the operation succeeded'),
  containers: z.array(z.object({
    alias: z.string(),
    originalName: z.string(),
    type: z.string(),
    addedAt: z.string()
  })).optional().describe('List of containers'),
  count: z.number().optional().describe('Number of containers'),
  message: z.string().describe('Success message or error details')
});

export type ListContainersInput = z.infer<typeof listContainersInputSchema>;
export type ListContainersOutput = z.infer<typeof listContainersOutputSchema>;

/**
 * Register the list_containers tool
 */
export function registerListContainersTool(client: KadiClient) {
  client.registerTool(
    {
      name: 'list_containers',
      description: 'List all containers in registry. Direct mapping to container-registry-ability.',
      input: listContainersInputSchema,
      output: listContainersOutputSchema,
    },
    async (params: ListContainersInput): Promise<ListContainersOutput> => {
      logger.info(MODULE_AGENT, `Executing list_containers`, timer.elapsed('main'));

      try {
        const abilityPath = getContainerRegistryAbilityPath();

        const registryAbility = await client.load('container-registry-ability', 'native', {
          path: abilityPath
        });

        const result = await registryAbility.list_containers(params);
        await registryAbility.__disconnect();

        logger.info(MODULE_AGENT, `List containers completed: ${result.message}`, timer.elapsed('main'));

        return result;

      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        logger.info(
          MODULE_AGENT,
          `List containers failed: ${errorMessage}`,
          timer.elapsed('main')
        );

        return {
          success: false,
          message: `List containers failed: ${errorMessage}`
        };
      }
    }
  );
}
