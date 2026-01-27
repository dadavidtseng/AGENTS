/**
 * Deploy to Akash Tool (1:1 mapping)
 *
 * Direct mapping to deploy-ability's deploy_to_akash() method.
 */

import { z, logger, MODULE_AGENT, timer, getDeployAbilityPath } from './utils.js';
import type { KadiClient } from '@kadi.build/core';

export const deployToAkashInputSchema = z.object({
  projectRoot: z.string().describe('Project root directory path'),
  profile: z.string().default('production').describe('Deployment profile name'),
  dryRun: z.boolean().default(false).describe('Perform dry run without actual deployment'),
  monitorReadiness: z.boolean().default(true).describe('Monitor container readiness after deployment'),
  blacklistProviders: z.array(z.string()).optional().describe('Provider addresses to blacklist'),
  whitelistProviders: z.array(z.string()).optional().describe('Provider addresses to whitelist'),
  maxBidPrice: z.string().optional().describe('Maximum bid price in uakt'),
  minMemory: z.string().optional().describe('Minimum memory requirement (e.g., "512Mi")'),
  minStorage: z.string().optional().describe('Minimum storage requirement (e.g., "1Gi")')
});

export const deployToAkashOutputSchema = z.object({
  success: z.boolean().describe('Whether deployment succeeded'),
  data: z.any().optional().describe('Deployment data (dseq, provider, lease info)'),
  error: z.string().optional().describe('Error message if failed')
});

export type DeployToAkashInput = z.infer<typeof deployToAkashInputSchema>;
export type DeployToAkashOutput = z.infer<typeof deployToAkashOutputSchema>;

export function registerDeployToAkashTool(client: KadiClient) {
  client.registerTool(
    {
      name: 'deploy_to_akash',
      description: 'Deploy application to Akash Network decentralized cloud platform. Direct mapping to deploy-ability.',
      input: deployToAkashInputSchema,
      output: deployToAkashOutputSchema,
    },
    async (params: DeployToAkashInput): Promise<DeployToAkashOutput> => {
      logger.info(
        MODULE_AGENT,
        `Executing deploy_to_akash: ${params.projectRoot} (profile: ${params.profile}, dryRun: ${params.dryRun})`,
        timer.elapsed('main')
      );

      try {
        const abilityPath = getDeployAbilityPath();
        const deployManager = await client.loadNative('deploy-ability', {
          path: process.env.DEPLOY_ABILITY_PATH!
        });

        const result = await deployManager.invoke('deploy_to_akash', params);
        await deployManager.disconnect();

        if (result.success) {
          logger.info(
            MODULE_AGENT,
            `Akash deployment completed successfully. DSEQ: ${result.data?.dseq || 'N/A'}`,
            timer.elapsed('main')
          );
        } else {
          logger.info(
            MODULE_AGENT,
            `Akash deployment failed: ${result.error || 'Unknown error'}`,
            timer.elapsed('main')
          );
        }

        return result;

      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.info(MODULE_AGENT, `Akash deployment failed: ${errorMessage}`, timer.elapsed('main'));

        return {
          success: false,
          error: `Deployment failed: ${errorMessage}`
        };
      }
    }
  );
}
