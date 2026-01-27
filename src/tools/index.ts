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
import { logger, timer, MODULE_TOOLS } from 'agents-library';
import { registerEchoTool } from './echo.js';
import { registerListToolsTool } from './list-tools.js';

/**
 * Tool Registry Array
 *
 * Add your tool registration functions here.
 * They will be called automatically during agent initialization.
 */
export const toolRegistry: Array<(client: KadiClient) => void> = [
  registerEchoTool,
  registerListToolsTool,
];

/**
 * Register all tools from the registry
 *
 * This function is called by the main agent to register all tools.
 * You don't need to modify this function - just add your tools to the array above.
 */
export function registerAllTools(client: KadiClient): void {
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
