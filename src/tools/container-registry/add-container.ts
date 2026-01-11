/**
 * Add Container Tool (1:1 mapping)
 *
 * Direct mapping to container-registry-ability's add_container() method.
 * Adds a container to the registry for sharing.
 */

import { z, logger, MODULE_AGENT, timer, getContainerRegistryAbilityPath } from './utils.js';
import type { KadiClient } from '@kadi.build/core';

export const addContainerInputSchema = z.object({
  name: z.string().describe('Container name (e.g., "nginx:latest")'),
  type: z.enum(['docker', 'podman', 'tar', 'mock']).optional().default('docker').describe('Container type'),
  image: z.string().optional().describe('Container image name (for docker/podman)'),
  tarPath: z.string().optional().describe('Path to tar file (for tar type)')
});

export const addContainerOutputSchema = z.object({
  success: z.boolean().describe('Whether the operation succeeded'),
  alias: z.string().optional().describe('Container alias in registry'),
  originalName: z.string().optional().describe('Original container name'),
  type: z.string().optional().describe('Container type'),
  layers: z.number().optional().describe('Number of layers'),
  message: z.string().describe('Success message or error details')
});

export type AddContainerInput = z.infer<typeof addContainerInputSchema>;
export type AddContainerOutput = z.infer<typeof addContainerOutputSchema>;

/**
 * Register the add_container tool
 */
export function registerAddContainerTool(client: KadiClient) {
  client.registerTool(
    {
      name: 'add_container',
      description: 'Add container to registry for sharing. Direct mapping to container-registry-ability.',
      input: addContainerInputSchema,
      output: addContainerOutputSchema,
    },
    async (params: AddContainerInput): Promise<AddContainerOutput> => {
      logger.info(
        MODULE_AGENT,
        `Executing add_container: ${params.name}`,
        timer.elapsed('main')
      );

      try {
        const abilityPath = getContainerRegistryAbilityPath();

        const registryAbility = await client.load('container-registry-ability', 'native', {
          path: abilityPath
        });

        const result = await registryAbility.add_container(params);
        await registryAbility.__disconnect();

        logger.info(MODULE_AGENT, `Add container completed: ${result.message}`, timer.elapsed('main'));

        return result;

      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        logger.info(
          MODULE_AGENT,
          `Add container failed: ${errorMessage}`,
          timer.elapsed('main')
        );

        return {
          success: false,
          message: `Add container failed: ${errorMessage}`
        };
      }
    }
  );
}
