/**
 * Tunnel Tools - Entry Point
 *
 * Exports all tunnel-related tool registration functions.
 */

import type { KadiClient } from '@kadi.build/core';

export { registerCreateTunnelTool } from './create-tunnel.js';
export { registerDestroyTunnelTool } from './destroy-tunnel.js';
export { registerGetTunnelStatusTool } from './get-tunnel-status.js';
export { registerListTunnelsTool } from './list-tunnels.js';
export { registerCheckHealthTool } from './check-health.js';

import { registerCreateTunnelTool } from './create-tunnel.js';
import { registerDestroyTunnelTool } from './destroy-tunnel.js';
import { registerGetTunnelStatusTool } from './get-tunnel-status.js';
import { registerListTunnelsTool } from './list-tunnels.js';
import { registerCheckHealthTool } from './check-health.js';

/**
 * Register all tunnel tools at once
 *
 * @param client - The KadiClient instance to register tools with
 */
export function registerAllTunnelTools(client: KadiClient) {
  registerCreateTunnelTool(client);
  registerDestroyTunnelTool(client);
  registerGetTunnelStatusTool(client);
  registerListTunnelsTool(client);
  registerCheckHealthTool(client);
}
