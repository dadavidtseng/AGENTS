/**
 * Native Ability Bridge
 *
 * Registers tools from a natively-loaded ability onto the host KadiClient,
 * making them discoverable by the LLM orchestrator and callable via invokeRemote().
 *
 * Why: loadNative() keeps ability tools isolated — only callable via ability.invoke().
 * The orchestrator discovers tools via client.readAgentJson().tools, so we need to
 * register each tool on the host client with a handler that delegates to the ability.
 *
 * Schema handling: registerTool() requires Zod schemas, but abilities provide JSON Schema.
 * We register with z.any() then patch the stored inputSchema with the original JSON Schema
 * so the LLM gets full parameter info.
 */

import { z } from '@kadi.build/core';
import type { KadiClient, LoadedAbility } from '@kadi.build/core';

/**
 * Bridge native ability tools onto the host client.
 *
 * @param client - Host KadiClient to register tools on
 * @param ability - Loaded native ability
 * @param prefix - Optional prefix for tool names (e.g. 'file' → 'file_read_file')
 * @returns Number of tools registered
 */
export function registerNativeAbilityTools(
  client: KadiClient,
  ability: LoadedAbility,
  prefix?: string,
): number {
  const tools = ability.getTools();

  for (const tool of tools) {
    const toolName = prefix ? `${prefix}_${tool.name}` : tool.name;

    // Register with z.any() — handler delegates to ability.invoke()
    client.registerTool(
      {
        name: toolName,
        description: tool.description || tool.name,
        input: z.any(),
      },
      async (params: unknown) => {
        return ability.invoke(tool.name, params as Record<string, unknown>);
      },
    );

    // Patch inputSchema with the ability's original JSON Schema
    // so the LLM knows what parameters to pass
    const registered = (client as any).tools.get(toolName);
    if (registered && tool.inputSchema) {
      registered.definition.inputSchema = tool.inputSchema;
    }
  }

  return tools.length;
}
