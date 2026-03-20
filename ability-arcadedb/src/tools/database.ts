/**
 * Database management tools -- create, list, info, drop, and stats.
 */

import { KadiClient, z } from '@kadi.build/core';

import { errorMessage } from '../lib/errors.js';
import type {
  ArcadeManagers,
  DbCreateResponse,
  DbDropResponse,
  DbInfoResponse,
  DbListResponse,
  DbStatsResponse,
} from '../lib/types.js';

/**
 * Register database management tools (create, list, info, drop, stats) with a
 * {@link KadiClient}.
 *
 * @param client   - The KADI client to register tools on.
 * @param managers - Vendored CJS manager instances.
 */
export function registerDatabaseTools(
  client: KadiClient,
  managers: ArcadeManagers,
): void {
  // ---- arcade-db-create ----------------------------------------------------

  client.registerTool(
    {
      name: 'arcade-db-create',
      description: 'Create a new ArcadeDB database.',
      input: z.object({
        name: z.string().describe('Database name to create'),
        schema: z.string().optional().describe('Optional SQL schema to execute after creation'),
      }),
    },
    async (input): Promise<DbCreateResponse> => {
      try {
        const created = await managers.database.createDatabase(input.name);
        if (!created) {
          return { success: false, error: `Failed to create database "${input.name}"` };
        }
        return { success: true, database: input.name };
      } catch (err: unknown) {
        return { success: false, error: errorMessage(err) };
      }
    },
  );

  // ---- arcade-db-list ------------------------------------------------------

  client.registerTool(
    {
      name: 'arcade-db-list',
      description: 'List all databases on the ArcadeDB server.',
      input: z.object({}),
    },
    async (): Promise<DbListResponse> => {
      try {
        const databases = await managers.database.listDatabases();
        return { success: true, databases };
      } catch (err: unknown) {
        return { success: false, error: errorMessage(err) };
      }
    },
  );

  // ---- arcade-db-info ------------------------------------------------------

  client.registerTool(
    {
      name: 'arcade-db-info',
      description: 'Get schema, types, indexes, and stats for a database.',
      input: z.object({
        database: z.string().describe('Database name'),
      }),
    },
    async (input): Promise<DbInfoResponse> => {
      try {
        const info = await managers.database.getDatabaseInfo(input.database);
        return { success: true, ...info };
      } catch (err: unknown) {
        return { success: false, error: errorMessage(err) };
      }
    },
  );

  // ---- arcade-db-drop ------------------------------------------------------

  client.registerTool(
    {
      name: 'arcade-db-drop',
      description: 'Drop (delete) a database. Requires confirm: true as a safety check.',
      input: z.object({
        database: z.string().describe('Database name to drop'),
        confirm: z.boolean().describe('Must be true to confirm deletion'),
      }),
    },
    async (input): Promise<DbDropResponse> => {
      if (!input.confirm) {
        return {
          success: false,
          error: 'Refused: confirm must be true to drop a database',
          hint: 'Set confirm: true to confirm deletion',
        };
      }
      try {
        const dropped = await managers.database.dropDatabase(input.database, { confirm: true });
        return { success: dropped };
      } catch (err: unknown) {
        return { success: false, error: errorMessage(err) };
      }
    },
  );

  // ---- arcade-db-stats -----------------------------------------------------

  client.registerTool(
    {
      name: 'arcade-db-stats',
      description: 'Get statistics (records, size) for all databases or a specific one.',
      input: z.object({
        database: z.string().optional().describe('Specific database name, or omit for all'),
      }),
    },
    async (input): Promise<DbStatsResponse> => {
      try {
        const stats = await managers.database.getDatabaseStats();

        if (input.database) {
          const entry = stats.databases?.find(
            (d) => d.name === input.database
          );
          if (!entry) {
            return { success: false, error: `Database "${input.database}" not found` };
          }
          return { success: true, databases: [entry] };
        }

        return { success: true, ...stats };
      } catch (err: unknown) {
        return { success: false, error: errorMessage(err) };
      }
    },
  );
}
