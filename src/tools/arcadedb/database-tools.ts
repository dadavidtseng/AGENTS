/**
 * ArcadeDB Database Management Tools (1:1 mapping)
 *
 * Direct mapping to arcadedb-ability database management methods.
 */

import { z, logger, MODULE_AGENT, timer, getArcadeDBAbilityPath } from './utils.js';
import type { KadiClient } from '@kadi.build/core';

// Create Database
export const createDatabaseInputSchema = z.object({
  name: z.string().describe('Database name'),
  schema: z.string().optional().describe('Optional schema file path')
});

export const createDatabaseOutputSchema = z.object({
  success: z.boolean().describe('Whether the operation succeeded'),
  message: z.string().describe('Success message or error details')
});

export type CreateDatabaseInput = z.infer<typeof createDatabaseInputSchema>;
export type CreateDatabaseOutput = z.infer<typeof createDatabaseOutputSchema>;

export function registerCreateDatabaseTool(client: KadiClient) {
  client.registerTool(
    {
      name: 'create_database',
      description: 'Create new ArcadeDB database. Direct mapping to arcadedb-ability.',
      input: createDatabaseInputSchema,
      output: createDatabaseOutputSchema,
    },
    async (params: CreateDatabaseInput): Promise<CreateDatabaseOutput> => {
      logger.info(MODULE_AGENT, `Executing create_database: ${params.name}`, timer.elapsed('main'));

      try {
        const abilityPath = getArcadeDBAbilityPath();
        const arcadeAbility = await client.load('arcadedb-ability', 'native', { path: abilityPath });
        const result = await arcadeAbility.create_database(params);
        await arcadeAbility.__disconnect();
        logger.info(MODULE_AGENT, `Create database completed: ${result.message}`, timer.elapsed('main'));
        return result;
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return { success: false, message: `Create database failed: ${errorMessage}` };
      }
    }
  );
}

// List Databases
export const listDatabasesInputSchema = z.object({});

export const listDatabasesOutputSchema = z.object({
  success: z.boolean().describe('Whether the operation succeeded'),
  databases: z.array(z.string()).optional().describe('List of database names'),
  message: z.string().describe('Success message or error details')
});

export type ListDatabasesInput = z.infer<typeof listDatabasesInputSchema>;
export type ListDatabasesOutput = z.infer<typeof listDatabasesOutputSchema>;

export function registerListDatabasesTool(client: KadiClient) {
  client.registerTool(
    {
      name: 'list_databases',
      description: 'List all ArcadeDB databases. Direct mapping to arcadedb-ability.',
      input: listDatabasesInputSchema,
      output: listDatabasesOutputSchema,
    },
    async (params: ListDatabasesInput): Promise<ListDatabasesOutput> => {
      logger.info(MODULE_AGENT, `Executing list_databases`, timer.elapsed('main'));

      try {
        const abilityPath = getArcadeDBAbilityPath();
        const arcadeAbility = await client.load('arcadedb-ability', 'native', { path: abilityPath });
        const result = await arcadeAbility.list_databases(params);
        await arcadeAbility.__disconnect();
        logger.info(MODULE_AGENT, `List databases completed`, timer.elapsed('main'));
        return result;
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return { success: false, message: `List databases failed: ${errorMessage}` };
      }
    }
  );
}

// Drop Database
export const dropDatabaseInputSchema = z.object({
  name: z.string().describe('Database name'),
  confirm: z.boolean().optional().default(false).describe('Confirm deletion')
});

export const dropDatabaseOutputSchema = z.object({
  success: z.boolean().describe('Whether the operation succeeded'),
  message: z.string().describe('Success message or error details')
});

export type DropDatabaseInput = z.infer<typeof dropDatabaseInputSchema>;
export type DropDatabaseOutput = z.infer<typeof dropDatabaseOutputSchema>;

export function registerDropDatabaseTool(client: KadiClient) {
  client.registerTool(
    {
      name: 'drop_database',
      description: 'Delete ArcadeDB database. Direct mapping to arcadedb-ability.',
      input: dropDatabaseInputSchema,
      output: dropDatabaseOutputSchema,
    },
    async (params: DropDatabaseInput): Promise<DropDatabaseOutput> => {
      logger.info(MODULE_AGENT, `Executing drop_database: ${params.name}`, timer.elapsed('main'));

      try {
        const abilityPath = getArcadeDBAbilityPath();
        const arcadeAbility = await client.load('arcadedb-ability', 'native', { path: abilityPath });
        const result = await arcadeAbility.drop_database(params);
        await arcadeAbility.__disconnect();
        logger.info(MODULE_AGENT, `Drop database completed: ${result.message}`, timer.elapsed('main'));
        return result;
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return { success: false, message: `Drop database failed: ${errorMessage}` };
      }
    }
  );
}
