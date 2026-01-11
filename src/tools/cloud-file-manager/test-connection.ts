/**
 * Test Connection Tool (1:1 mapping)
 *
 * Direct mapping to cloud-file-manager-ability's test_connection() method.
 */

import { z, logger, MODULE_AGENT, timer, getCloudFileManagerAbilityPath } from './utils.js';
import type { KadiClient } from '@kadi.build/core';

export const testConnectionInputSchema = z.object({
  serviceName: z.enum(['dropbox', 'googledrive', 'box']).describe('Cloud service name')
});

export const testConnectionOutputSchema = z.object({
  success: z.boolean().describe('Whether the operation succeeded'),
  result: z.any().optional().describe('Connection test result'),
  error: z.string().optional().describe('Error message if operation failed')
});

export type TestConnectionInput = z.infer<typeof testConnectionInputSchema>;
export type TestConnectionOutput = z.infer<typeof testConnectionOutputSchema>;

export function registerTestConnectionTool(client: KadiClient) {
  client.registerTool(
    {
      name: 'cloud_test_connection',
      description: 'Test connection to a cloud storage service. Direct mapping to cloud-file-manager-ability.',
      input: testConnectionInputSchema,
      output: testConnectionOutputSchema,
    },
    async (params: TestConnectionInput): Promise<TestConnectionOutput> => {
      logger.info(MODULE_AGENT, `Executing test_connection: ${params.serviceName}`, timer.elapsed('main'));

      try {
        const abilityPath = getCloudFileManagerAbilityPath();
        const cloudManager = await client.load('cloud-file-manager-ability', 'native', {
          path: abilityPath
        });

        const result = await cloudManager.cloud_test_connection(params);
        await cloudManager.__disconnect();

        logger.info(MODULE_AGENT, `Test connection completed successfully`, timer.elapsed('main'));
        return result;

      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.info(MODULE_AGENT, `Test connection failed: ${errorMessage}`, timer.elapsed('main'));

        return {
          success: false,
          error: `Test connection failed: ${errorMessage}`
        };
      }
    }
  );
}
