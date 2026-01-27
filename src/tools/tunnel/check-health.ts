/**
 * Check Health Tool (1:1 mapping)
 *
 * Direct mapping to kadi-tunnel-ability's check_health() method.
 * Checks the health status of the tunnel service.
 */

import { z, logger, MODULE_AGENT, timer, getKadiTunnelAbilityPath } from './utils.js';
import type { KadiClient } from '@kadi.build/core';

// Native transport - types inferred from Zod schemas via proxy

export const checkHealthInputSchema = z.object({});

export const checkHealthOutputSchema = z.object({
  success: z.boolean().describe('Whether the operation succeeded'),
  status: z.string().optional().describe('Health status (healthy/unhealthy)'),
  timestamp: z.string().optional().describe('Health check timestamp'),
  version: z.string().optional().describe('Service version'),
  uptime: z.number().optional().describe('Service uptime in seconds'),
  message: z.string().describe('Success message or error details')
});

export type CheckHealthInput = z.infer<typeof checkHealthInputSchema>;
export type CheckHealthOutput = z.infer<typeof checkHealthOutputSchema>;

/**
 * Register the check_health tool
 *
 * This tool provides direct 1:1 mapping to kadi-tunnel-ability's
 * check_health() method without any proxy layers.
 */
export function registerCheckHealthTool(client: KadiClient) {
  client.registerTool(
    {
      name: 'check_health',
      description: 'Check the health status of the tunnel service. Direct mapping to kadi-tunnel-ability.',
      input: checkHealthInputSchema,
      output: checkHealthOutputSchema,
    },
    async (params: CheckHealthInput): Promise<CheckHealthOutput> => {
      logger.info(
        MODULE_AGENT,
        `Executing check_health`,
        timer.elapsed('main')
      );

      try {
        // Load ability via native transport
        const abilityPath = getKadiTunnelAbilityPath();

        logger.info(MODULE_AGENT, `Loading ability from path: ${abilityPath}`, timer.elapsed('main'));

        const tunnelAbility = await client.loadNative('kadi-tunnel-ability', {
          path: process.env.KADI_TUNNEL_ABILITY_PATH!
        });

        // Call through native transport proxy
        const result = await tunnelAbility.invoke('check_health', params);

        // Disconnect after use
        await tunnelAbility.disconnect();

        logger.info(MODULE_AGENT, `Check health completed: ${result.message}`, timer.elapsed('main'));

        return result;

      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        logger.info(
          MODULE_AGENT,
          `Check health failed: ${errorMessage}`,
          timer.elapsed('main')
        );

        return {
          success: false,
          message: `Check health failed: ${errorMessage}`
        };
      }
    }
  );
}
