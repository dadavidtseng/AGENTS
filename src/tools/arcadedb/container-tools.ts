/**
 * ArcadeDB Container Management Tools (1:1 mapping)
 *
 * Direct mapping to arcadedb-ability container management methods.
 */

import { z, logger, MODULE_AGENT, timer, getArcadeDBAbilityPath } from './utils.js';
import type { KadiClient } from '@kadi.build/core';

// Start Container
export const startContainerInputSchema = z.object({
  withTestData: z.boolean().optional().describe('Load test data on startup'),
  restart: z.boolean().optional().describe('Restart if already running')
});

export const startContainerOutputSchema = z.object({
  success: z.boolean().describe('Whether the operation succeeded'),
  message: z.string().describe('Success message or error details')
});

export type StartContainerInput = z.infer<typeof startContainerInputSchema>;
export type StartContainerOutput = z.infer<typeof startContainerOutputSchema>;

export function registerStartContainerTool(client: KadiClient) {
  client.registerTool(
    {
      name: 'start_container',
      description: 'Start ArcadeDB Docker container. Direct mapping to arcadedb-ability.',
      input: startContainerInputSchema,
      output: startContainerOutputSchema,
    },
    async (params: StartContainerInput): Promise<StartContainerOutput> => {
      logger.info(MODULE_AGENT, `Executing start_container`, timer.elapsed('main'));

      try {
        const abilityPath = getArcadeDBAbilityPath();
        const arcadeAbility = await client.load('arcadedb-ability', 'native', { path: abilityPath });
        const result = await arcadeAbility.start_container(params);
        await arcadeAbility.__disconnect();
        logger.info(MODULE_AGENT, `Start container completed: ${result.message}`, timer.elapsed('main'));
        return result;
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return { success: false, message: `Start container failed: ${errorMessage}` };
      }
    }
  );
}

// Stop Container
export const stopContainerInputSchema = z.object({
  force: z.boolean().optional().describe('Force stop without cleanup')
});

export const stopContainerOutputSchema = z.object({
  success: z.boolean().describe('Whether the operation succeeded'),
  message: z.string().describe('Success message or error details')
});

export type StopContainerInput = z.infer<typeof stopContainerInputSchema>;
export type StopContainerOutput = z.infer<typeof stopContainerOutputSchema>;

export function registerStopContainerTool(client: KadiClient) {
  client.registerTool(
    {
      name: 'stop_container',
      description: 'Stop ArcadeDB Docker container. Direct mapping to arcadedb-ability.',
      input: stopContainerInputSchema,
      output: stopContainerOutputSchema,
    },
    async (params: StopContainerInput): Promise<StopContainerOutput> => {
      logger.info(MODULE_AGENT, `Executing stop_container`, timer.elapsed('main'));

      try {
        const abilityPath = getArcadeDBAbilityPath();
        const arcadeAbility = await client.load('arcadedb-ability', 'native', { path: abilityPath });
        const result = await arcadeAbility.stop_container(params);
        await arcadeAbility.__disconnect();
        logger.info(MODULE_AGENT, `Stop container completed: ${result.message}`, timer.elapsed('main'));
        return result;
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return { success: false, message: `Stop container failed: ${errorMessage}` };
      }
    }
  );
}

// Get Container Status
export const getContainerStatusInputSchema = z.object({});

export const getContainerStatusOutputSchema = z.object({
  success: z.boolean().describe('Whether the operation succeeded'),
  container: z.object({
    running: z.boolean(),
    status: z.string().optional(),
    uptime: z.string().optional()
  }).optional(),
  server: z.object({
    ready: z.boolean(),
    accessible: z.boolean()
  }).optional(),
  storage: z.object({
    exists: z.boolean()
  }).optional(),
  message: z.string().describe('Success message or error details')
});

export type GetContainerStatusInput = z.infer<typeof getContainerStatusInputSchema>;
export type GetContainerStatusOutput = z.infer<typeof getContainerStatusOutputSchema>;

export function registerGetContainerStatusTool(client: KadiClient) {
  client.registerTool(
    {
      name: 'get_container_status',
      description: 'Get ArcadeDB container status. Direct mapping to arcadedb-ability.',
      input: getContainerStatusInputSchema,
      output: getContainerStatusOutputSchema,
    },
    async (params: GetContainerStatusInput): Promise<GetContainerStatusOutput> => {
      logger.info(MODULE_AGENT, `Executing get_container_status`, timer.elapsed('main'));

      try {
        const abilityPath = getArcadeDBAbilityPath();
        const arcadeAbility = await client.load('arcadedb-ability', 'native', { path: abilityPath });
        const result = await arcadeAbility.get_container_status(params);
        await arcadeAbility.__disconnect();
        logger.info(MODULE_AGENT, `Get container status completed`, timer.elapsed('main'));
        return result;
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return { success: false, message: `Get status failed: ${errorMessage}` };
      }
    }
  );
}
