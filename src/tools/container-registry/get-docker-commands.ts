/**
 * Get Docker Commands Tool (1:1 mapping)
 *
 * Direct mapping to container-registry-ability's get_docker_commands() method.
 * Gets Docker/Podman commands for accessing the registry.
 */

import { z, logger, MODULE_AGENT, timer, getContainerRegistryAbilityPath } from './utils.js';
import type { KadiClient } from '@kadi.build/core';

export const getDockerCommandsInputSchema = z.object({
  containerName: z.string().optional().describe('Container alias (optional, returns all if not specified)')
});

export const getDockerCommandsOutputSchema = z.object({
  success: z.boolean().describe('Whether the operation succeeded'),
  loginCommands: z.object({
    docker: z.string().optional(),
    podman: z.string().optional()
  }).optional().describe('Login commands'),
  pullCommands: z.record(z.string(), z.object({
    docker: z.string(),
    podman: z.string()
  })).optional().describe('Pull commands for each container'),
  oneLineCommands: z.record(z.string(), z.object({
    docker: z.string(),
    podman: z.string()
  })).optional().describe('One-line commands (login + pull + run)'),
  message: z.string().describe('Success message or error details')
});

export type GetDockerCommandsInput = z.infer<typeof getDockerCommandsInputSchema>;
export type GetDockerCommandsOutput = z.infer<typeof getDockerCommandsOutputSchema>;

/**
 * Register the get_docker_commands tool
 */
export function registerGetDockerCommandsTool(client: KadiClient) {
  client.registerTool(
    {
      name: 'get_docker_commands',
      description: 'Get Docker/Podman commands for registry access. Direct mapping to container-registry-ability.',
      input: getDockerCommandsInputSchema,
      output: getDockerCommandsOutputSchema,
    },
    async (params: GetDockerCommandsInput): Promise<GetDockerCommandsOutput> => {
      logger.info(
        MODULE_AGENT,
        `Executing get_docker_commands: ${params.containerName || 'all'}`,
        timer.elapsed('main')
      );

      try {
        const abilityPath = getContainerRegistryAbilityPath();

        const registryAbility = await client.load('container-registry-ability', 'native', {
          path: abilityPath
        });

        const result = await registryAbility.get_docker_commands(params);
        await registryAbility.__disconnect();

        logger.info(MODULE_AGENT, `Get Docker commands completed: ${result.message}`, timer.elapsed('main'));

        return result;

      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        logger.info(
          MODULE_AGENT,
          `Get Docker commands failed: ${errorMessage}`,
          timer.elapsed('main')
        );

        return {
          success: false,
          message: `Get Docker commands failed: ${errorMessage}`
        };
      }
    }
  );
}
