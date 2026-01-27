/**
 * Search Files Tool (1:1 mapping)
 *
 * Direct mapping to cloud-file-manager-ability's search_files() method.
 */

import { z, logger, MODULE_AGENT, timer, getCloudFileManagerAbilityPath } from './utils.js';
import type { KadiClient } from '@kadi.build/core';

export const searchFilesInputSchema = z.object({
  serviceName: z.enum(['dropbox', 'googledrive', 'box']).describe('Cloud service name'),
  query: z.string().describe('Search query'),
  options: z.any().optional().describe('Additional search options')
});

export const searchFilesOutputSchema = z.object({
  success: z.boolean().describe('Whether the operation succeeded'),
  results: z.array(z.any()).optional().describe('Search results'),
  error: z.string().optional().describe('Error message if operation failed')
});

export type SearchFilesInput = z.infer<typeof searchFilesInputSchema>;
export type SearchFilesOutput = z.infer<typeof searchFilesOutputSchema>;

export function registerSearchFilesTool(client: KadiClient) {
  client.registerTool(
    {
      name: 'cloud_search_files',
      description: 'Search for files in cloud storage. Direct mapping to cloud-file-manager-ability.',
      input: searchFilesInputSchema,
      output: searchFilesOutputSchema,
    },
    async (params: SearchFilesInput): Promise<SearchFilesOutput> => {
      logger.info(MODULE_AGENT, `Executing search_files: ${params.serviceName} with query "${params.query}"`, timer.elapsed('main'));

      try {
        const abilityPath = getCloudFileManagerAbilityPath();
        const cloudManager = await client.loadNative('cloud-file-manager-ability', {
          path: process.env.CLOUD_FILE_MANAGER_ABILITY_PATH!
        });

        const result = await cloudManager.invoke('cloud_search_files', params);
        await cloudManager.disconnect();

        logger.info(MODULE_AGENT, `Search completed: ${result.results?.length || 0} results found`, timer.elapsed('main'));
        return result;

      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.info(MODULE_AGENT, `Search failed: ${errorMessage}`, timer.elapsed('main'));

        return {
          success: false,
          error: `Search failed: ${errorMessage}`
        };
      }
    }
  );
}
