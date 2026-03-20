/**
 * Data import/export tools -- move data between ArcadeDB and files
 * (JSON, CSV, TSV).
 */

import { KadiClient, z } from '@kadi.build/core';

import { errorMessage } from '../lib/errors.js';
import type { ArcadeManagers, ExportResponse, ImportResponse } from '../lib/types.js';

/**
 * Register data import/export tools (import, export) with a
 * {@link KadiClient}.
 *
 * @param client   - The KADI client to register tools on.
 * @param managers - Vendored CJS manager instances.
 */
export function registerDataTools(
  client: KadiClient,
  managers: ArcadeManagers,
): void {
  // ---- arcade-import -------------------------------------------------------

  client.registerTool(
    {
      name: 'arcade-import',
      description: 'Import data into an ArcadeDB database from a file (JSON, CSV, or TSV).',
      input: z.object({
        database: z.string().describe('Target database name'),
        filePath: z.string().describe('Path to the import file'),
        format: z.enum(['json', 'csv', 'tsv']).optional().describe('File format (auto-detected from extension if omitted)'),
        type: z.string().optional().describe('Target vertex type name'),
        batchSize: z.number().optional().describe('Records per batch (default: 100)'),
      }),
    },
    async (input): Promise<ImportResponse> => {
      try {
        const result = await managers.importExport.importData(
          input.database,
          input.filePath,
          {
            format: input.format,
            type: input.type,
            batchSize: input.batchSize,
          },
        );
        return {
          success: true,
          imported: result.recordsImported ?? result.imported ?? 0,
        };
      } catch (err: unknown) {
        return { success: false, error: errorMessage(err) };
      }
    },
  );

  // ---- arcade-export -------------------------------------------------------

  client.registerTool(
    {
      name: 'arcade-export',
      description: 'Export data from an ArcadeDB database to a file (JSON, CSV, or TSV).',
      input: z.object({
        database: z.string().describe('Source database name'),
        outputPath: z.string().describe('Path for the output file'),
        format: z.enum(['json', 'csv', 'tsv']).optional().describe('Output format (auto-detected from extension if omitted)'),
        query: z.string().optional().describe('SQL query to select data (exports all if omitted)'),
        type: z.string().optional().describe('Export a specific vertex type'),
      }),
    },
    async (input): Promise<ExportResponse> => {
      try {
        const result = await managers.importExport.exportData(
          input.database,
          input.outputPath,
          {
            format: input.format,
            query: input.query,
            type: input.type,
          },
        );
        return {
          success: true,
          exported: result.recordsExported ?? result.exported ?? 0,
          data: result.filePath ?? input.outputPath,
        };
      } catch (err: unknown) {
        return { success: false, error: errorMessage(err) };
      }
    },
  );
}
