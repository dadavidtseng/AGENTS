/**
 * Destroy Tunnel Tool (1:1 mapping)
 *
 * Direct mapping to kadi-tunnel-ability's destroy_tunnel() method.
 * Destroys an existing tunnel.
 */

import { z, logger, MODULE_AGENT, timer, getKadiTunnelAbilityPath } from './utils.js';
import type { KadiClient } from '@kadi.build/core';

// Native transport - types inferred from Zod schemas via proxy

export const destroyTunnelInputSchema = z.object({
  tunnelId: z.string().optional().describe('Tunnel ID to destroy (optional, defaults to current tunnel)')
});

export const destroyTunnelOutputSchema = z.object({
  success: z.boolean().describe('Whether the operation succeeded'),
  message: z.string().describe('Success message or error details')
});

export type DestroyTunnelInput = z.infer<typeof destroyTunnelInputSchema>;
export type DestroyTunnelOutput = z.infer<typeof destroyTunnelOutputSchema>;

/**
 * Register the destroy_tunnel tool
 *
 * This tool provides direct 1:1 mapping to kadi-tunnel-ability's
 * destroy_tunnel() method without any proxy layers.
 */
export function registerDestroyTunnelTool(client: KadiClient) {
  client.registerTool(
    {
      name: 'destroy_tunnel',
      description: 'Destroy an existing tunnel. Direct mapping to kadi-tunnel-ability.',
      input: destroyTunnelInputSchema,
      output: destroyTunnelOutputSchema,
    },
    async (params: DestroyTunnelInput): Promise<DestroyTunnelOutput> => {
      logger.info(
        MODULE_AGENT,
        `Executing destroy_tunnel: tunnelId=${params.tunnelId || 'current'}`,
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
        const result = await tunnelAbility.destroy_tunnel(params);

        // Disconnect after use
        await tunnelAbility.__disconnect();

        logger.info(MODULE_AGENT, `Destroy tunnel completed: ${result.message}`, timer.elapsed('main'));

        return result;

      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        logger.info(
          MODULE_AGENT,
          `Destroy tunnel failed: ${errorMessage}`,
          timer.elapsed('main')
        );

        return {
          success: false,
          message: `Destroy tunnel failed: ${errorMessage}`
        };
      }
    }
  );
}
