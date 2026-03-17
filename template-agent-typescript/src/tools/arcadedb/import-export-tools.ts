/**
 * ArcadeDB Import/Export Tools (1:1 mapping)
 *
 * Direct mapping to arcadedb-ability import/export methods.
 */

import { z, logger, MODULE_AGENT, timer, getArcadeDBAbilityPath } from './utils.js';
import type { KadiClient } from '@kadi.build/core';

// Import Data
export const importDataInputSchema = z.object({
  databaseName: z.string().describe('Database name'),
  filePath: z.string().describe('Import file path'),
  format: z.enum(['json', 'csv', 'tsv']).optional().describe('File format'),
  vertexType: z.string().optional().describe('Vertex type name')
});

export const importDataOutputSchema = z.object({
  success: z.boolean().describe('Whether the operation succeeded'),
  imported: z.number().optional().describe('Number of records imported'),
  message: z.string().describe('Success message or error details')
});

export type ImportDataInput = z.infer<typeof importDataInputSchema>;
export type ImportDataOutput = z.infer<typeof importDataOutputSchema>;

export function registerImportDataTool(client: KadiClient) {
  client.registerTool(
    {
      name: 'import_data',
      description: 'Import data into database. Direct mapping to arcadedb-ability.',
      input: importDataInputSchema,
      output: importDataOutputSchema,
    },
    async (params: ImportDataInput): Promise<ImportDataOutput> => {
      logger.info(MODULE_AGENT, `Executing import_data: ${params.databaseName}`, timer.elapsed('main'));

      try {
        const abilityPath = getArcadeDBAbilityPath();
        const arcadeAbility = await client.loadNative('arcadedb-ability', { path: abilityPath });
        const result = await arcadeAbility.invoke('import_data', params);
        await arcadeAbility.disconnect();
        logger.info(MODULE_AGENT, `Import data completed`, timer.elapsed('main'));
        return result;
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return { success: false, message: `Import data failed: ${errorMessage}` };
      }
    }
  );
}

// Export Data
export const exportDataInputSchema = z.object({
  databaseName: z.string().describe('Database name'),
  outputPath: z.string().describe('Output file path'),
  format: z.enum(['json', 'csv', 'tsv']).optional().describe('File format'),
  query: z.string().optional().describe('Optional SQL query for filtering')
});

export const exportDataOutputSchema = z.object({
  success: z.boolean().describe('Whether the operation succeeded'),
  exported: z.number().optional().describe('Number of records exported'),
  message: z.string().describe('Success message or error details')
});

export type ExportDataInput = z.infer<typeof exportDataInputSchema>;
export type ExportDataOutput = z.infer<typeof exportDataOutputSchema>;

export function registerExportDataTool(client: KadiClient) {
  client.registerTool(
    {
      name: 'export_data',
      description: 'Export data from database. Direct mapping to arcadedb-ability.',
      input: exportDataInputSchema,
      output: exportDataOutputSchema,
    },
    async (params: ExportDataInput): Promise<ExportDataOutput> => {
      logger.info(MODULE_AGENT, `Executing export_data: ${params.databaseName}`, timer.elapsed('main'));

      try {
        const abilityPath = getArcadeDBAbilityPath();
        const arcadeAbility = await client.loadNative('arcadedb-ability', { path: abilityPath });
        const result = await arcadeAbility.invoke('export_data', params);
        await arcadeAbility.disconnect();
        logger.info(MODULE_AGENT, `Export data completed`, timer.elapsed('main'));
        return result;
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return { success: false, message: `Export data failed: ${errorMessage}` };
      }
    }
  );
}
