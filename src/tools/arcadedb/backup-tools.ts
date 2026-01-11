/**
 * ArcadeDB Backup & Restore Tools (1:1 mapping)
 *
 * Direct mapping to arcadedb-ability backup/restore methods.
 */

import { z, logger, MODULE_AGENT, timer, getArcadeDBAbilityPath } from './utils.js';
import type { KadiClient } from '@kadi.build/core';

// Create Backup
export const createBackupInputSchema = z.object({
  databaseName: z.string().describe('Database name to backup')
});

export const createBackupOutputSchema = z.object({
  success: z.boolean().describe('Whether the operation succeeded'),
  backupFile: z.string().optional().describe('Backup file path'),
  message: z.string().describe('Success message or error details')
});

export type CreateBackupInput = z.infer<typeof createBackupInputSchema>;
export type CreateBackupOutput = z.infer<typeof createBackupOutputSchema>;

export function registerCreateBackupTool(client: KadiClient) {
  client.registerTool(
    {
      name: 'create_backup',
      description: 'Create database backup. Direct mapping to arcadedb-ability.',
      input: createBackupInputSchema,
      output: createBackupOutputSchema,
    },
    async (params: CreateBackupInput): Promise<CreateBackupOutput> => {
      logger.info(MODULE_AGENT, `Executing create_backup: ${params.databaseName}`, timer.elapsed('main'));

      try {
        const abilityPath = getArcadeDBAbilityPath();
        const arcadeAbility = await client.load('arcadedb-ability', 'native', { path: abilityPath });
        const result = await arcadeAbility.create_backup(params);
        await arcadeAbility.__disconnect();
        logger.info(MODULE_AGENT, `Create backup completed`, timer.elapsed('main'));
        return result;
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return { success: false, message: `Create backup failed: ${errorMessage}` };
      }
    }
  );
}

// Restore Backup
export const restoreBackupInputSchema = z.object({
  databaseName: z.string().describe('Database name to restore to'),
  backupFile: z.string().describe('Backup file path'),
  overwrite: z.boolean().optional().describe('Overwrite existing database')
});

export const restoreBackupOutputSchema = z.object({
  success: z.boolean().describe('Whether the operation succeeded'),
  message: z.string().describe('Success message or error details')
});

export type RestoreBackupInput = z.infer<typeof restoreBackupInputSchema>;
export type RestoreBackupOutput = z.infer<typeof restoreBackupOutputSchema>;

export function registerRestoreBackupTool(client: KadiClient) {
  client.registerTool(
    {
      name: 'restore_backup',
      description: 'Restore database from backup. Direct mapping to arcadedb-ability.',
      input: restoreBackupInputSchema,
      output: restoreBackupOutputSchema,
    },
    async (params: RestoreBackupInput): Promise<RestoreBackupOutput> => {
      logger.info(MODULE_AGENT, `Executing restore_backup: ${params.databaseName}`, timer.elapsed('main'));

      try {
        const abilityPath = getArcadeDBAbilityPath();
        const arcadeAbility = await client.load('arcadedb-ability', 'native', { path: abilityPath });
        const result = await arcadeAbility.restore_backup(params);
        await arcadeAbility.__disconnect();
        logger.info(MODULE_AGENT, `Restore backup completed`, timer.elapsed('main'));
        return result;
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return { success: false, message: `Restore backup failed: ${errorMessage}` };
      }
    }
  );
}

// List Backups
export const listBackupsInputSchema = z.object({});

export const listBackupsOutputSchema = z.object({
  success: z.boolean().describe('Whether the operation succeeded'),
  backups: z.array(z.object({
    file: z.string(),
    database: z.string(),
    timestamp: z.string(),
    size: z.string()
  })).optional().describe('List of backups'),
  message: z.string().describe('Success message or error details')
});

export type ListBackupsInput = z.infer<typeof listBackupsInputSchema>;
export type ListBackupsOutput = z.infer<typeof listBackupsOutputSchema>;

export function registerListBackupsTool(client: KadiClient) {
  client.registerTool(
    {
      name: 'list_backups',
      description: 'List all backups. Direct mapping to arcadedb-ability.',
      input: listBackupsInputSchema,
      output: listBackupsOutputSchema,
    },
    async (params: ListBackupsInput): Promise<ListBackupsOutput> => {
      logger.info(MODULE_AGENT, `Executing list_backups`, timer.elapsed('main'));

      try {
        const abilityPath = getArcadeDBAbilityPath();
        const arcadeAbility = await client.load('arcadedb-ability', 'native', { path: abilityPath });
        const result = await arcadeAbility.list_backups(params);
        await arcadeAbility.__disconnect();
        logger.info(MODULE_AGENT, `List backups completed`, timer.elapsed('main'));
        return result;
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return { success: false, message: `List backups failed: ${errorMessage}` };
      }
    }
  );
}
