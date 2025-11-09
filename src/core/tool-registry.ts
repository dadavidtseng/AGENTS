/**
 * Tool Registry - Manages MCP tool discovery and invocation
 */

import { z } from 'zod';
import { MCPClient } from './mcp-client.js';
import { MCPServerConfig, MCPTool, MCPToolCallResult } from '../types/mcp.js';

export interface RegisteredTool {
  name: string;
  description: string;
  schema: z.ZodObject<any>;
  source: 'mcp' | 'builtin';
  serverName?: string;
}

export class ToolRegistry {
  private mcpClients: Map<string, MCPClient> = new Map();
  private tools: Map<string, RegisteredTool> = new Map();

  /**
   * Initialize MCP servers and discover tools
   */
  async initialize(serverConfigs: MCPServerConfig[]): Promise<void> {
    console.log(`🔧 Initializing ${serverConfigs.length} MCP server(s)...`);

    for (const config of serverConfigs) {
      if (!config.enabled) {
        console.log(`⏭️  Skipping disabled server: ${config.name}`);
        continue;
      }

      try {
        await this.connectServer(config);
      } catch (error: any) {
        console.error(`❌ Failed to connect to ${config.name}:`, error.message);
        // Continue with other servers even if one fails
      }
    }

    console.log(`✅ Tool registry initialized with ${this.tools.size} tool(s)`);
  }

  /**
   * Connect to an MCP server and register its tools
   */
  private async connectServer(config: MCPServerConfig): Promise<void> {
    const client = new MCPClient(config);
    await client.start();

    this.mcpClients.set(config.id, client);

    // Register tools from this server
    const mcpTools = client.getTools();
    for (const tool of mcpTools) {
      this.registerMCPTool(tool, config.name);
    }
  }

  /**
   * Register a tool from an MCP server
   */
  private registerMCPTool(mcpTool: MCPTool, serverName: string): void {
    // Convert MCP input schema to Zod schema
    console.log(`  🔍 Converting schema for ${mcpTool.name}:`, JSON.stringify(mcpTool.inputSchema, null, 2).substring(0, 200));
    const schema = this.convertMCPSchemaToZod(mcpTool.inputSchema);

    const registeredTool: RegisteredTool = {
      name: mcpTool.name,
      description: mcpTool.description,
      schema,
      source: 'mcp',
      serverName,
    };

    this.tools.set(mcpTool.name, registeredTool);
    console.log(`  📦 Registered MCP tool: ${mcpTool.name}`);
  }

  /**
   * Convert MCP JSON schema to Zod schema
   *
   * Creates a basic Zod object schema from MCP's JSON Schema definition.
   * Falls back to a record of unknown values if conversion fails.
   */
  private convertMCPSchemaToZod(inputSchema: any): z.ZodType<any> {
    try {
      if (!inputSchema || typeof inputSchema !== 'object') {
        // If no schema provided, accept any object
        return z.record(z.unknown());
      }

      const { properties, required } = inputSchema;

      if (!properties || typeof properties !== 'object') {
        // No properties defined, accept any object
        return z.record(z.unknown());
      }

      // Build Zod schema from JSON Schema properties
      const shape: Record<string, z.ZodTypeAny> = {};

      for (const [key, propSchema] of Object.entries(properties)) {
        const prop = propSchema as any;
        let zodType: z.ZodTypeAny;

        // Convert JSON Schema type to Zod type
        switch (prop.type) {
          case 'string':
            zodType = z.string();
            if (prop.description) zodType = zodType.describe(prop.description);
            break;
          case 'number':
          case 'integer':
            zodType = z.number();
            if (prop.description) zodType = zodType.describe(prop.description);
            break;
          case 'boolean':
            zodType = z.boolean();
            if (prop.description) zodType = zodType.describe(prop.description);
            break;
          case 'array':
            zodType = z.array(z.unknown());
            if (prop.description) zodType = zodType.describe(prop.description);
            break;
          case 'object':
            zodType = z.record(z.unknown());
            if (prop.description) zodType = zodType.describe(prop.description);
            break;
          default:
            // Unknown type, accept anything
            zodType = z.unknown();
            if (prop.description) zodType = zodType.describe(prop.description);
        }

        // Make optional if not in required array
        if (!required || !required.includes(key)) {
          zodType = zodType.optional();
        }

        shape[key] = zodType;
      }

      return z.object(shape);
    } catch (error) {
      console.warn('Failed to convert MCP schema to Zod, using fallback:', error);
      // Fallback: accept any object
      return z.record(z.unknown());
    }
  }

  /**
   * Invoke a tool by name
   */
  async invokeTool(toolName: string, params: any): Promise<any> {
    const tool = this.tools.get(toolName);
    if (!tool) {
      throw new Error(`Tool not found: ${toolName}`);
    }

    if (tool.source === 'mcp') {
      return this.invokeMCPTool(toolName, params, tool.serverName!);
    }

    throw new Error(`Unknown tool source: ${tool.source}`);
  }

  /**
   * Invoke an MCP tool
   */
  private async invokeMCPTool(toolName: string, params: any, serverName: string): Promise<any> {
    // Find the MCP client for this tool
    const client = Array.from(this.mcpClients.values()).find(
      c => c.getTools().some(t => t.name === toolName)
    );

    if (!client) {
      throw new Error(`No MCP client found for tool: ${toolName}`);
    }

    const result = await client.callTool({
      name: toolName,
      arguments: params,
    });

    if (result.isError) {
      throw new Error(result.content[0]?.text || 'Unknown error');
    }

    return result;
  }

  /**
   * Get all registered tools
   */
  getAllTools(): RegisteredTool[] {
    return Array.from(this.tools.values());
  }

  /**
   * Get tools by source
   */
  getToolsBySource(source: 'mcp' | 'builtin'): RegisteredTool[] {
    return this.getAllTools().filter(t => t.source === source);
  }

  /**
   * Get tool by name
   */
  getTool(name: string): RegisteredTool | undefined {
    return this.tools.get(name);
  }

  /**
   * Shutdown all MCP clients
   */
  async shutdown(): Promise<void> {
    console.log('🛑 Shutting down MCP clients...');

    for (const [id, client] of this.mcpClients.entries()) {
      try {
        await client.stop();
      } catch (error: any) {
        console.error(`Failed to stop MCP client ${id}:`, error.message);
      }
    }

    this.mcpClients.clear();
    this.tools.clear();
  }
}
