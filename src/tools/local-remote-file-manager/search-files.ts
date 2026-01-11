/**
 * Search Files Tool
 *
 * Searches for files by query using local-remote-file-manager ability.
 * Uses native transport for development with 1:1 mapping to ability method.
 */

import { z, logger, timer, MODULE_AGENT, getLocalRemoteFileManagerAbilityPath } from './utils.js';
import type { KadiClient } from '@kadi.build/core';

export function registerSearchFiles(client: KadiClient) {
  client.registerTool({
    name: 'local_remote_search_files',
    description: 'Search for files by query using local-remote-file-manager',
    input: z.object({
      query: z.string().describe('Search query'),
      providerName: z.string().optional().default('local').describe('Provider to use (local)'),
      recursive: z.boolean().optional().default(true).describe('Search recursively'),
      caseSensitive: z.boolean().optional().default(false).describe('Case sensitive search'),
      fileTypesOnly: z.boolean().optional().default(false).describe('Return only files (exclude directories)'),
      limit: z.number().optional().default(30).describe('Limit results (default: 30 for optimal performance)')
    }),
    output: z.object({
      results: z.array(z.object({
        name: z.string(),
        path: z.string(),
        size: z.number(),
        modifiedTime: z.string()
      }))
    })
  },
  async (params) => {
    logger.info(MODULE_AGENT, `Searching files: ${params.query}`, timer.elapsed('main'));

    const abilityPath = getLocalRemoteFileManagerAbilityPath();
    const ability = await client.load('local-remote-file-manager-ability', 'native', {
      path: abilityPath
    });

    try {
      const result = await ability.search_files(params);
      logger.info(MODULE_AGENT, `Found ${result.results.length} files`, timer.elapsed('main'));
      return result;
    } finally {
      await ability.__disconnect();
    }
  });
}
