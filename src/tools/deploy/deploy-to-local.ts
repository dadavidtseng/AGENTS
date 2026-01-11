/**
 * Deploy to Local Tool (1:1 mapping)
 *
 * Direct mapping to deploy-ability's deploy_to_local() method.
 */

import { z, logger, MODULE_AGENT, timer, getDeployAbilityPath } from './utils.js';
import type { KadiClient } from '@kadi.build/core';

export const deployToLocalInputSchema = z.object({
  projectRoot: z.string().describe('Project root directory path'),
  profile: z.string().default('local-dev').describe('Deployment profile name'),
  engine: z.enum(['docker', 'podman']).default('docker').describe('Container engine to use'),
  recreate: z.boolean().default(false).describe('Force recreate containers'),
  build: z.boolean().default(true).describe('Build images before deploying'),
  detach: z.boolean().default(true).describe('Run in detached mode')
});

export const deployToLocalOutputSchema = z.object({
  success: z.boolean().describe('Whether deployment succeeded'),
  data: z.any().optional().describe('Deployment data (services, endpoints, networks)'),
  error: z.string().optional().describe('Error message if failed')
});

export type DeployToLocalInput = z.infer<typeof deployToLocalInputSchema>;
export type DeployToLocalOutput = z.infer<typeof deployToLocalOutputSchema>;

export function registerDeployToLocalTool(client: KadiClient) {
  client.registerTool(
    {
      name: 'deploy_to_local',
      description: 'Deploy application to local Docker environment for development and testing. Direct mapping to deploy-ability.',
      input: deployToLocalInputSchema,
      output: deployToLocalOutputSchema,
    },
    async (params: DeployToLocalInput): Promise<DeployToLocalOutput> => {
      logger.info(
        MODULE_AGENT,
        `Executing deploy_to_local: ${params.projectRoot} (profile: ${params.profile}, engine: ${params.engine})`,
        timer.elapsed('main')
      );

      try {
        const abilityPath = getDeployAbilityPath();
        const deployManager = await client.load('deploy-ability', 'native', {
          path: abilityPath
        });

        const result = await deployManager.deploy_to_local(params);
        await deployManager.__disconnect();

        if (result.success) {
          logger.info(
            MODULE_AGENT,
            `Local deployment completed successfully. Services: ${result.data?.services?.length || 0}`,
            timer.elapsed('main')
          );
        } else {
          logger.info(
            MODULE_AGENT,
            `Local deployment failed: ${result.error || 'Unknown error'}`,
            timer.elapsed('main')
          );
        }

        return result;

      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.info(MODULE_AGENT, `Local deployment failed: ${errorMessage}`, timer.elapsed('main'));

        return {
          success: false,
          error: `Deployment failed: ${errorMessage}`
        };
      }
    }
  );
}
