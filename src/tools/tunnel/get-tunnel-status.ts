/**
 * Get Tunnel Status Tool (1:1 mapping)
 *
 * Direct mapping to kadi-tunnel-ability's get_tunnel_status() method.
 * Gets the status of a tunnel.
 */

import { z, logger, MODULE_AGENT, timer, getKadiTunnelAbilityPath } from './utils.js';
import type { KadiClient } from '@kadi.build/core';

// Native transport - types inferred from Zod schemas via proxy

export const getTunnelStatusInputSchema = z.object({
  tunnelId: z.string().optional().describe('Tunnel ID (optional, defaults to current tunnel)')
});

export const getTunnelStatusOutputSchema = z.object({
  success: z.boolean().describe('Whether the operation succeeded'),
  connected: z.boolean().optional().describe('Whether tunnel is connected'),
  connecting: z.boolean().optional().describe('Whether tunnel is connecting'),
  tunnelId: z.string().optional().describe('Tunnel identifier'),
  publicUrl: z.string().optional().describe('Public URL'),
  localPort: z.number().optional().describe('Local port'),
  uptime: z.number().optional().describe('Uptime in milliseconds'),
  message: z.string().describe('Status message or error details')
});

export type GetTunnelStatusInput = z.infer<typeof getTunnelStatusInputSchema>;
export type GetTunnelStatusOutput = z.infer<typeof getTunnelStatusOutputSchema>;

/**
 * Register the get_tunnel_status tool
 *
 * This tool provides direct 1:1 mapping to kadi-tunnel-ability's
 * get_tunnel_status() method without any proxy layers.
 */
export function registerGetTunnelStatusTool(client: KadiClient) {
  client.registerTool(
    {
      name: 'get_tunnel_status',
      description: 'Get the status of a tunnel. Direct mapping to kadi-tunnel-ability.',
      input: getTunnelStatusInputSchema,
      output: getTunnelStatusOutputSchema,
    },
    async (params: GetTunnelStatusInput): Promise<GetTunnelStatusOutput> => {
      logger.info(
        MODULE_AGENT,
        `Executing get_tunnel_status: tunnelId=${params.tunnelId || 'current'}`,
        timer.elapsed('main')
      );

      try {
        // Load ability via native transport
        const abilityPath = getKadiTunnelAbilityPath();

        logger.info(MODULE_AGENT, `Loading ability from path: ${abilityPath}`, timer.elapsed('main'));

        const tunnelAbility = await client.load('kadi-tunnel-ability', 'native', {
          path: abilityPath
        });

        // Call through native transport proxy
        const result = await tunnelAbility.get_tunnel_status(params);

        // Disconnect after use
        await tunnelAbility.__disconnect();

        logger.info(MODULE_AGENT, `Get tunnel status completed: ${result.message}`, timer.elapsed('main'));

        return result;

      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        logger.info(
          MODULE_AGENT,
          `Get tunnel status failed: ${errorMessage}`,
          timer.elapsed('main')
        );

        return {
          success: false,
          message: `Get tunnel status failed: ${errorMessage}`
        };
      }
    }
  );
}
