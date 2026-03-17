/**
 * Tool Registry
 *
 * This file serves as a central registry for all KADI tools provided by this agent.
 *
 * To add a new tool:
 * 1. Create a new file in src/tools/ (e.g., my-tool.ts)
 * 2. Export a registration function: export function registerMyTool(client: KadiClient)
 * 3. Import and add the function to the toolRegistry array below
 * 4. The tool will be automatically registered when the agent starts
 *
 * Template pattern for creating new tools:
 *
 * ```typescript
 * import { z } from 'zod';
 * import type { KadiClient } from '@kadi.build/core';
 *
 * export const myToolInputSchema = z.object({
 *   param: z.string().describe('Parameter description')
 * });
 *
 * export const myToolOutputSchema = z.object({
 *   result: z.string().describe('Result description')
 * });
 *
 * export function registerMyTool(client: KadiClient) {
 *   client.registerTool(
 *     {
 *       name: 'my_tool',
 *       description: 'What this tool does',
 *       input: myToolInputSchema,
 *       output: myToolOutputSchema,
 *     },
 *     async (params) => {
 *       // Tool implementation
 *       return { result: 'success' };
 *     }
 *   );
 * }
 * ```
 */

import type { KadiClient } from '@kadi.build/core';
import { logger, MODULE_TOOLS, timer } from 'agents-library';
import { registerEchoTool } from './echo.js';
import { registerListToolsTool } from './list-tools.js';

// File management tools (1:1 mapping to file-management-ability)
// Local operations
import {
  registerListFilesAndFoldersTool,
  registerMoveAndRenameTool,
  registerCopyFileTool,
  registerCopyFolderTool,
  registerDeleteFileTool,
  registerCreateFolderTool,
  registerDeleteFolderTool,
  registerWatchFolderTool,
  registerCreateFileTool,
  // Remote operations
  // registerSendFileToRemoteServerTool,
  registerDownloadFileFromRemoteTool,
  registerCreateRemoteFolderTool,
  registerDeleteRemoteFolderTool,
  registerMoveRemoteFileOrFolderTool,
  registerCopyRemoteFileTool,
  registerCopyRemoteFolderTool,
  registerDeleteRemoteFileTool,
  registerDownloadFolderFromRemoteTool,
} from './file-management/index.js';

// Local Remote File Manager tools (1:1 mapping to local-remote-file-manager-ability)
// Provides 33 comprehensive file management tools across 6 categories
import { registerAllLocalRemoteFileManagerTools } from './local-remote-file-manager/index.js';

// Cloud File Manager tools (1:1 mapping to cloud-file-manager-ability)
// Provides 15 cloud storage tools for Dropbox, Google Drive, and Box
import { registerAllCloudFileManagerTools } from './cloud-file-manager/index.js';

// Deploy tools (1:1 mapping to deploy-ability)
// Provides 2 deployment tools for Akash Network and local Docker
import { registerAllDeployTools } from './deploy/index.js';

// Tunnel tools (1:1 mapping to kadi-tunnel-ability)
// Provides 5 tunnel management tools for creating HTTP tunnels
import { registerAllTunnelTools } from './tunnel/index.js';

// Container Registry tools (1:1 mapping to container-registry-ability)
// Provides 8 container registry tools for managing temporary Docker registries
import { registerAllContainerRegistryTools } from './container-registry/index.js';

// ArcadeDB tools (1:1 mapping to arcadedb-ability)
// Provides 11 database management tools for ArcadeDB operations
import { registerAllArcadeDbTools } from './arcadedb/index.js';

/**
 * Tool Registry Array
 *
 * Add your tool registration functions here.
 * They will be called automatically during agent initialization.
 */
export const toolRegistry: Array<(client: KadiClient) => void> = [
  registerEchoTool,
  registerListToolsTool,
  // File management tools - Local operations (1:1 mapping)
  registerListFilesAndFoldersTool,
  registerMoveAndRenameTool,
  registerCopyFileTool,
  registerCopyFolderTool,
  registerDeleteFileTool,
  registerCreateFolderTool,
  registerDeleteFolderTool,
  registerWatchFolderTool,
  registerCreateFileTool,
  // File management tools - Remote operations (1:1 mapping)
  // registerSendFileToRemoteServerTool,
  registerDownloadFileFromRemoteTool,
  registerCreateRemoteFolderTool,
  registerDeleteRemoteFolderTool,
  registerMoveRemoteFileOrFolderTool,
  registerCopyRemoteFileTool,
  registerCopyRemoteFolderTool,
  registerDeleteRemoteFileTool,
  registerDownloadFolderFromRemoteTool,
  // Local Remote File Manager tools (33 tools across 6 categories)
  registerAllLocalRemoteFileManagerTools,
  // Cloud File Manager tools (15 tools for Dropbox, Google Drive, Box)
  registerAllCloudFileManagerTools,
  // Deploy tools (2 tools for Akash Network, local Docker)
  registerAllDeployTools,
  // Tunnel tools (5 tools for tunnel management)
  registerAllTunnelTools,
  // Container Registry tools (8 tools for container registry management)
  registerAllContainerRegistryTools,
  // ArcadeDB tools (11 tools for ArcadeDB database management)
  registerAllArcadeDbTools,
  // Add your custom tools here
];

/**
 * Register all tools from the registry
 *
 * This function is called by the main agent to register all tools.
 * You don't need to modify this function - just add your tools to the array above.
 */
export function registerAllTools(client: KadiClient): void {
  // Start timer for tool registration tracking
  timer.start('tools-registry');

  logger.info(MODULE_TOOLS, `Registering ${toolRegistry.length} custom tool(s)...`, timer.elapsed('tools-registry'));

  for (const registerTool of toolRegistry) {
    registerTool(client);
  }

  if (toolRegistry.length > 0) {
    logger.info(MODULE_TOOLS, `Registered ${toolRegistry.length} custom tool(s)`, timer.elapsed('tools-registry'));
  } else {
    logger.info(MODULE_TOOLS, 'No custom tools registered (add tools to src/tools/ to extend functionality)', timer.elapsed('tools-registry'));
  }
}
