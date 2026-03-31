/**
 * Tool Registry
 *
 * Central registry for all tools provided by this agent.
 *
 * Tools can be registered in two ways:
 * 1. Manual registration: Create a tool file, export a register function, add to toolRegistry
 * 2. Native ability bridge: Load an ability via loadNative() and bridge its tools
 *
 * See native-ability-bridge.ts for the bridge pattern.
 */

import type { KadiClient } from '@kadi.build/core';
import { logger, MODULE_TOOLS, timer } from 'agents-library';
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
  // Add your custom tools here
];

/**
 * Register all tools from the registry
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
    logger.info(MODULE_TOOLS, 'No custom tools registered', timer.elapsed('tools-registry'));
  }
}
