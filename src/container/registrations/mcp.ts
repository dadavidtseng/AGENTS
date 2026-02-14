/**
 * @fileoverview MCP service registrations (tools, server factory).
 */
import { container } from 'tsyringe';
import { ToolDefinitions, CreateMcpServerInstance } from '@/container/tokens.js';
import { allToolDefinitions } from '@/mcp-server/tools/definitions/index.js';
import { createMcpServerInstance } from '@/mcp-server/server.js';

export function registerMcpServices(): void {
  // Register all tool definitions for multi-injection
  for (const tool of allToolDefinitions) {
    container.register(ToolDefinitions as unknown as string, { useValue: tool });
  }

  // Register server factory
  container.register(CreateMcpServerInstance as unknown as string, {
    useValue: createMcpServerInstance,
  });
}
