/**
 * Get Available Services Tool (1:1 mapping)
 *
 * Direct mapping to cloud-file-manager-ability's get_available_services() method.
 */

import { z, logger, MODULE_AGENT, timer, getCloudFileManagerAbilityPath } from './utils.js';
import type { KadiClient } from '@kadi.build/core';

export const getAvailableServicesInputSchema = z.object({});

export const getAvailableServicesOutputSchema = z.object({
  success: z.boolean().describe('Whether the operation succeeded'),
  services: z.array(z.string()).optional().describe('List of available services'),
  error: z.string().optional().describe('Error message if operation failed')
});

export type GetAvailableServicesInput = z.infer<typeof getAvailableServicesInputSchema>;
export type GetAvailableServicesOutput = z.infer<typeof getAvailableServicesOutputSchema>;

export function registerGetAvailableServicesTool(client: KadiClient) {
  client.registerTool(
    {
      name: 'cloud_get_available_services',
      description: 'Get list of available/configured cloud storage services. Direct mapping to cloud-file-manager-ability.',
      input: getAvailableServicesInputSchema,
      output: getAvailableServicesOutputSchema,
    },
    async (): Promise<GetAvailableServicesOutput> => {
      logger.info(MODULE_AGENT, `Executing get_available_services`, timer.elapsed('main'));

      try {
        const abilityPath = getCloudFileManagerAbilityPath();
        const cloudManager = await client.load('cloud-file-manager-ability', 'native', {
          path: abilityPath
        });

        const result = await cloudManager.cloud_get_available_services({});
        await cloudManager.__disconnect();

        logger.info(MODULE_AGENT, `Get available services completed: ${result.services?.length || 0} services`, timer.elapsed('main'));
        return result;

      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.info(MODULE_AGENT, `Get available services failed: ${errorMessage}`, timer.elapsed('main'));

        return {
          success: false,
          error: `Get available services failed: ${errorMessage}`
        };
      }
    }
  );
}
