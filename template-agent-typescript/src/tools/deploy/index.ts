/**
 * Deploy Tools
 *
 * Tools that provide direct 1:1 mapping to deploy-ability methods.
 * No proxy layers - direct calls to ability methods.
 *
 * Supports Akash Network and local Docker deployments.
 *
 * @module tools/deploy
 */

import type { KadiClient } from '@kadi.build/core';

// Deployment operations
import { registerDeployToAkashTool } from './deploy-to-akash.js';
import { registerDeployToLocalTool } from './deploy-to-local.js';

// Re-export all registration functions
export {
  registerDeployToAkashTool,
  registerDeployToLocalTool
};

/**
 * Register all deploy tools at once
 *
 * @param client - The KadiClient instance to register tools with
 */
export function registerAllDeployTools(client: KadiClient) {
  // Deployment operations (2 tools)
  registerDeployToAkashTool(client);
  registerDeployToLocalTool(client);
}
