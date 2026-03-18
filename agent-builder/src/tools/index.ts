/**
 * Tool Registry for agent-builder
 *
 * Registers all game lifecycle management tools with the KĀDI client.
 */

import type { KadiClient } from '@kadi.build/core';
import { logger, MODULE_TOOLS, timer } from 'agents-library';
import { registerShutdownGameTool } from './shutdown-game.js';
import { registerRestartGameTool } from './restart-game.js';
import { registerRebuildGameTool } from './rebuild-game.js';

const toolRegistry: Array<(client: KadiClient) => void> = [
  registerShutdownGameTool,
  registerRestartGameTool,
  registerRebuildGameTool,
];

export function registerAllTools(client: KadiClient): void {
  timer.start('tools-registry');
  logger.info(MODULE_TOOLS, `Registering ${toolRegistry.length} tool(s)...`, timer.elapsed('tools-registry'));

  for (const register of toolRegistry) {
    register(client);
  }

  logger.info(MODULE_TOOLS, `Registered ${toolRegistry.length} tool(s)`, timer.elapsed('tools-registry'));
}
