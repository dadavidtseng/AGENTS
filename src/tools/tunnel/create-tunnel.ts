/**
 * Create Tunnel Tool (1:1 mapping)
 *
 * Direct mapping to kadi-tunnel-ability's create_tunnel() method.
 * Creates a new HTTP tunnel and returns a public HTTPS URL.
 */

import { z, logger, MODULE_AGENT, timer, getKadiTunnelAbilityPath } from './utils.js';
import type { KadiClient } from '@kadi.build/core';

// Native transport - types inferred from Zod schemas via proxy

export const createTunnelInputSchema = z.object({
  localPort: z.number().optional().describe('Local port to tunnel (default: 3000)'),
  subdomain: z.string().optional().describe('Requested subdomain (optional)'),
  agentId: z.string().optional().describe('Agent ID (default: from environment)')
});

export const createTunnelOutputSchema = z.object({
  success: z.boolean().describe('Whether the operation succeeded'),
  tunnelId: z.string().optional().describe('Unique tunnel identifier'),
  publicUrl: z.string().optional().describe('Public HTTPS URL'),
  localUrl: z.string().optional().describe('Local URL being tunneled'),
  subdomain: z.string().optional().describe('Assigned subdomain'),
  status: z.string().optional().describe('Tunnel status'),
  expiresAt: z.string().optional().describe('Expiration timestamp (ISO 8601)'),
  message: z.string().describe('Success message or error details')
});

export type CreateTunnelInput = z.infer<typeof createTunnelInputSchema>;
export type CreateTunnelOutput = z.infer<typeof createTunnelOutputSchema>;

/**
 * Register the create_tunnel tool
 *
 * This tool provides direct 1:1 mapping to kadi-tunnel-ability's
 * create_tunnel() method without any proxy layers.
 */
export function registerCreateTunnelTool(client: KadiClient) {
  client.registerTool(
    {
      name: 'create_tunnel',
      description: 'Create a new HTTP tunnel and get a public HTTPS URL. Direct mapping to kadi-tunnel-ability.',
      input: createTunnelInputSchema,
      output: createTunnelOutputSchema,
    },
    async (params: CreateTunnelInput): Promise<CreateTunnelOutput> => {
      logger.info(
        MODULE_AGENT,
        `Executing create_tunnel: port=${params.localPort || 'default'}`,
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
        const result = await tunnelAbility.create_tunnel(params);

        // Disconnect after use
        await tunnelAbility.__disconnect();

        logger.info(MODULE_AGENT, `Create tunnel completed: ${result.message}`, timer.elapsed('main'));

        return result;

      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        logger.info(
          MODULE_AGENT,
          `Create tunnel failed: ${errorMessage}`,
          timer.elapsed('main')
        );

        return {
          success: false,
          message: `Create tunnel failed: ${errorMessage}`
        };
      }
    }
  );
}
