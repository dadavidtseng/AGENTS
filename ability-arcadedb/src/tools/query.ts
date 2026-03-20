/**
 * Query and command tools -- read queries, write commands, and batched
 * transactions against ArcadeDB via the HTTP API.
 */

import { KadiClient, z } from '@kadi.build/core';

import { errorMessage } from '../lib/errors.js';
import type { ArcadeHttpClient } from '../lib/http-client.js';
import type { BatchResult, QueryResult } from '../lib/types.js';

/**
 * Register query and command tools (query, command, batch) with a
 * {@link KadiClient}.
 *
 * @param client     - The KADI client to register tools on.
 * @param httpClient - HTTP client for ArcadeDB REST API access.
 */
export function registerQueryTools(
  client: KadiClient,
  httpClient: ArcadeHttpClient,
): void {
  // ---- arcade-query --------------------------------------------------------

  client.registerTool(
    {
      name: 'arcade-query',
      description: 'Execute a read query (SELECT, MATCH, TRAVERSE) against an ArcadeDB database.',
      input: z.object({
        database: z.string().describe('Target database name'),
        query: z.string().describe('SQL query to execute'),
        language: z.string().optional().describe('Query language: sql (default), cypher, gremlin'),
        params: z.record(z.string(), z.unknown()).optional().describe('Query parameters for parameterized queries'),
      }),
    },
    async (input): Promise<QueryResult> => {
      try {
        return await httpClient.query(
          input.database,
          input.query,
          input.params,
          input.language ?? 'sql',
        );
      } catch (err: unknown) {
        return { success: false, error: errorMessage(err) };
      }
    },
  );

  // ---- arcade-command ------------------------------------------------------

  client.registerTool(
    {
      name: 'arcade-command',
      description: 'Execute a write command (CREATE, INSERT, UPDATE, DELETE, DROP) against an ArcadeDB database.',
      input: z.object({
        database: z.string().describe('Target database name'),
        command: z.string().describe('SQL command to execute'),
        language: z.string().optional().describe('Command language: sql (default), cypher, gremlin'),
        params: z.record(z.string(), z.unknown()).optional().describe('Command parameters'),
      }),
    },
    async (input): Promise<QueryResult> => {
      try {
        return await httpClient.command(
          input.database,
          input.command,
          input.params,
          input.language ?? 'sql',
        );
      } catch (err: unknown) {
        return { success: false, error: errorMessage(err) };
      }
    },
  );

  // ---- arcade-batch --------------------------------------------------------

  client.registerTool(
    {
      name: 'arcade-batch',
      description: 'Execute multiple write commands in a single transaction. All commands succeed or all are rolled back.',
      input: z.object({
        database: z.string().describe('Target database name'),
        commands: z.array(
          z.union([
            z.string(),
            z.object({
              command: z.string().describe('SQL command to execute'),
              params: z.record(z.string(), z.unknown()).optional().describe('Command parameters'),
            }),
          ]),
        ).min(1).describe('Array of SQL commands to execute in order (strings or {command, params} objects)'),
      }),
    },
    async (input): Promise<BatchResult> => {
      try {
        return await httpClient.batch(input.database, input.commands);
      } catch (err: unknown) {
        return { success: false, error: errorMessage(err), committed: false };
      }
    },
  );
}
