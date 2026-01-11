/**
 * Container Registry Tools - Entry Point
 *
 * Exports all container registry tool registration functions.
 */

import type { KadiClient } from '@kadi.build/core';

export { registerStartRegistryTool } from './start-registry.js';
export { registerStopRegistryTool } from './stop-registry.js';
export { registerAddContainerTool } from './add-container.js';
export { registerRemoveContainerTool } from './remove-container.js';
export { registerListContainersTool } from './list-containers.js';
export { registerGetRegistryUrlsTool } from './get-registry-urls.js';
export { registerGetDockerCommandsTool } from './get-docker-commands.js';
export { registerGetRegistryStatusTool } from './get-registry-status.js';

import { registerStartRegistryTool } from './start-registry.js';
import { registerStopRegistryTool } from './stop-registry.js';
import { registerAddContainerTool } from './add-container.js';
import { registerRemoveContainerTool } from './remove-container.js';
import { registerListContainersTool } from './list-containers.js';
import { registerGetRegistryUrlsTool } from './get-registry-urls.js';
import { registerGetDockerCommandsTool } from './get-docker-commands.js';
import { registerGetRegistryStatusTool } from './get-registry-status.js';

/**
 * Register all container registry tools at once
 *
 * @param client - The KadiClient instance to register tools with
 */
export function registerAllContainerRegistryTools(client: KadiClient) {
  registerStartRegistryTool(client);
  registerStopRegistryTool(client);
  registerAddContainerTool(client);
  registerRemoveContainerTool(client);
  registerListContainersTool(client);
  registerGetRegistryUrlsTool(client);
  registerGetDockerCommandsTool(client);
  registerGetRegistryStatusTool(client);
}
