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

import type { KadiClient, RegisterToolOptions } from '@kadi.build/core';
import { logger, timer, MODULE_TOOLS } from 'agents-library';
import type { LlmOrchestrator } from '../services/llm-orchestrator.js';
import { registerEchoTool } from './echo.js';
import { registerListToolsTool } from './list-tools.js';
import { registerTaskExecutionTool } from './task-execution.js';
import { registerQuestApproveTool, registerQuestRequestRevisionTool, registerQuestRejectTool, setQuestApprovalOrchestrator } from './quest-approval.js';
import { registerTaskApproveTool, registerTaskRequestRevisionTool, registerTaskRejectTool } from './task-approval.js';

/**
 * Network scoping map: tool name → networks where the tool should be discoverable.
 *
 * - `global`: core orchestration tools + approval tools (dashboard access)
 * - `slack, discord`: user-facing approval tools invoked via chat bots
 *
 * Approval tools include `global` so the dashboard (mcp-client-quest), which
 * connects as a plain MCP client on the `global` network, can invoke them.
 *
 * Tools NOT in this map register on ALL networks (default kadi-core behavior).
 */
const TOOL_NETWORK_SCOPE: Record<string, string[]> = {
  echo: ['global'],
  list_tools: ['global'],
  task_execution: ['global'],
  quest_approve: ['global', 'slack', 'discord'],
  quest_request_revision: ['global', 'slack', 'discord'],
  quest_reject: ['global', 'slack', 'discord'],
  task_approve: ['global', 'slack', 'discord'],
  task_request_revision: ['global', 'slack', 'discord'],
  task_reject: ['global', 'slack', 'discord'],
};

/**
 * Tool Registry Array
 *
 * Add your tool registration functions here.
 * They will be called automatically during agent initialization.
 */
export const toolRegistry: Array<(client: KadiClient) => void> = [
  registerEchoTool,
  registerListToolsTool,
  registerTaskExecutionTool,
  // Quest-level approval tools (workflow steps 10a/10b/10c)
  registerQuestApproveTool,
  registerQuestRequestRevisionTool,
  registerQuestRejectTool,
  // Task-level approval tools (workflow steps 23a/23b/23c)
  registerTaskApproveTool,
  registerTaskRequestRevisionTool,
  registerTaskRejectTool,
];

/**
 * Register all tools from the registry with network-scoped visibility.
 *
 * Uses a Proxy to intercept registerTool() calls and inject per-tool
 * network scoping from TOOL_NETWORK_SCOPE. Individual tool files remain
 * unchanged — scoping is applied transparently at registration time.
 *
 * When multiple brokers are configured, scoping is applied to each broker
 * that shares at least one network with the tool's scope. Brokers with no
 * overlapping networks simply won't receive the tool.
 *
 * @param client - KadiClient instance to register tools on
 * @param brokerNetworks - Map of broker name → available networks (default: { default: all })
 */
export function registerAllTools(
  client: KadiClient,
  brokerNetworks: Record<string, string[]> = { default: [] },
): void {
  timer.start('tools-registry');
  logger.info(MODULE_TOOLS, `Registering ${toolRegistry.length} custom tool(s) with network scoping...`, timer.elapsed('tools-registry'));

  // Create proxy that injects network scoping into registerTool calls
  const scopedClient = new Proxy(client, {
    get(target, prop, receiver) {
      if (prop === 'registerTool') {
        return (definition: any, handler: any, options: RegisterToolOptions = {}) => {
          const scopedNetworks = TOOL_NETWORK_SCOPE[definition.name];
          if (scopedNetworks) {
            // Build per-broker scoping: intersect tool networks with each broker's networks.
            // When intersection is empty the tool is still registered on that broker
            // without network restriction so it remains discoverable (e.g. in observer).
            const brokers: Record<string, { networks: string[] }> = {};
            for (const [name, available] of Object.entries(brokerNetworks)) {
              const intersection = available.length > 0
                ? scopedNetworks.filter(n => available.includes(n))
                : scopedNetworks; // empty = unknown, pass through
              brokers[name] = { networks: intersection };
            }
            options = { ...options, brokers };
            const summary = Object.entries(brokers)
              .map(([b, s]) => `${b}:[${s.networks.length > 0 ? s.networks : '*'}]`)
              .join(', ');
            logger.info(MODULE_TOOLS, `  → ${definition.name} → ${summary}`, timer.elapsed('tools-registry'));
          } else {
            logger.info(MODULE_TOOLS, `  → ${definition.name} → [all networks]`, timer.elapsed('tools-registry'));
          }
          return target.registerTool(definition, handler, options);
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });

  for (const registerTool of toolRegistry) {
    registerTool(scopedClient);
  }

  if (toolRegistry.length > 0) {
    logger.info(MODULE_TOOLS, `Registered ${toolRegistry.length} custom tool(s)`, timer.elapsed('tools-registry'));
  } else {
    logger.info(MODULE_TOOLS, 'No custom tools registered (add tools to src/tools/ to extend functionality)', timer.elapsed('tools-registry'));
  }
}

/**
 * Inject LlmOrchestrator into tool handlers that need it.
 *
 * Called AFTER providerManager is initialized (inside the setTimeout block in index.ts).
 * Tools are registered synchronously at startup, but the orchestrator is created later
 * once the broker connection and providers are ready.
 */
export function injectOrchestrator(orchestrator: LlmOrchestrator): void {
  setQuestApprovalOrchestrator(orchestrator);
  logger.info(MODULE_TOOLS, 'LlmOrchestrator injected into quest-approval tools', timer.elapsed('tools-registry'));
}
