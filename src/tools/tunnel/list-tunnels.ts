/**
 * List Tunnels Tool (1:1 mapping)
 *
 * Direct mapping to kadi-tunnel-ability's list_tunnels() method.
 * Lists all active tunnels for the agent.
 */

import { z, logger, MODULE_AGENT, timer, getKadiTunnelAbilityPath } from './utils.js';
import type { KadiClient } from '@kadi.build/core';

// Native transport - types inferred from Zod schemas via proxy

export const listTunnelsInputSchema = z.object({});

export const listTunnelsOutputSchema = z.object({
  success: z.boolean().describe('Whether the operation succeeded'),
  tunnels: z.array(z.object({
    id: z.string(),
    agentId: z.string(),
    localPort: z.number(),
    subdomain: z.string(),
    hostname: z.string(),
    security: z.string(),
    status: z.string(),
    expiresAt: z.string()
  })).optional().describe('List of active tunnels'),
  message: z.string().describe('Success message or error details')
});

export type ListTunnelsInput = z.infer<typeof listTunnelsInputSchema>;
export type ListTunnelsOutput = z.infer<typeof listTunnelsOutputSchema>;

/**
 * Register the list_tunnels tool
 *
 * This tool provides direct 1:1 mapping to kadi-tunnel-ability's
 * list_tunnels() method without any proxy layers.
 */
export function registerListTunnelsTool(client: KadiClient) {
  client.registerTool(
    {
      name: 'list_tunnels',
      description: 'List all active tunnels for the agent. Direct mapping to kadi-tunnel-ability.',
      input: listTunnelsInputSchema,
      output: listTunnelsOutputSchema,
    },
    async (params: ListTunnelsInput): Promise<ListTunnelsOutput> => {
      logger.info(
        MODULE_AGENT,
        `Executing list_tunnels`,
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
        const result = await tunnelAbility.list_tunnels(params);

        // Disconnect after use
        await tunnelAbility.__disconnect();

        logger.info(MODULE_AGENT, `List tunnels completed: ${result.message}`, timer.elapsed('main'));

        return result;

      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        logger.info(
          MODULE_AGENT,
          `List tunnels failed: ${errorMessage}`,
          timer.elapsed('main')
        );

        return {
          success: false,
          message: `List tunnels failed: ${errorMessage}`
        };
      }
    }
  );
}
