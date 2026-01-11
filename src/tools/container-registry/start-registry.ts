/**
 * Start Registry Tool (1:1 mapping)
 *
 * Direct mapping to container-registry-ability's start_registry() method.
 * Starts a container registry with optional public tunnel access.
 */

import { z, logger, MODULE_AGENT, timer, getContainerRegistryAbilityPath } from './utils.js';
import type { KadiClient } from '@kadi.build/core';

export const startRegistryInputSchema = z.object({
  port: z.number().optional().describe('Local server port (0 = random)'),
  tunnelService: z.enum(['serveo', 'ngrok', 'localtunnel', 'none']).optional().describe('Tunnel service to use'),
  preferredEngine: z.enum(['docker', 'podman', 'auto']).optional().describe('Preferred container engine')
});

export const startRegistryOutputSchema = z.object({
  success: z.boolean().describe('Whether the operation succeeded'),
  publicUrl: z.string().optional().describe('Public tunnel URL'),
  localUrl: z.string().optional().describe('Local registry URL'),
  port: z.number().optional().describe('Local server port'),
  engine: z.string().optional().describe('Container engine in use'),
  message: z.string().describe('Success message or error details')
});

export type StartRegistryInput = z.infer<typeof startRegistryInputSchema>;
export type StartRegistryOutput = z.infer<typeof startRegistryOutputSchema>;

/**
 * Register the start_registry tool
 */
export function registerStartRegistryTool(client: KadiClient) {
  client.registerTool(
    {
      name: 'start_registry',
      description: 'Start container registry with optional public tunnel. Direct mapping to container-registry-ability.',
      input: startRegistryInputSchema,
      output: startRegistryOutputSchema,
    },
    async (params: StartRegistryInput): Promise<StartRegistryOutput> => {
      logger.info(
        MODULE_AGENT,
        `Executing start_registry: tunnel=${params.tunnelService || 'serveo'}`,
        timer.elapsed('main')
      );

      try {
        const abilityPath = getContainerRegistryAbilityPath();
        logger.info(MODULE_AGENT, `Loading ability from path: ${abilityPath}`, timer.elapsed('main'));

        const registryAbility = await client.load('container-registry-ability', 'native', {
          path: abilityPath
        });

        const result = await registryAbility.start_registry(params);
        await registryAbility.__disconnect();

        logger.info(MODULE_AGENT, `Start registry completed: ${result.message}`, timer.elapsed('main'));

        return result;

      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        logger.info(
          MODULE_AGENT,
          `Start registry failed: ${errorMessage}`,
          timer.elapsed('main')
        );

        return {
          success: false,
          message: `Start registry failed: ${errorMessage}`
        };
      }
    }
  );
}
