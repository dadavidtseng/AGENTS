/**
 * MCP (Model Context Protocol) Type Definitions
 *
 * These types define the structure for MCP server configuration,
 * tool definitions, and JSON-RPC communication.
 */

// ============================================================================
// MCP Server Configuration
// ============================================================================

export interface MCPServerConfig {
  id: string;
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  enabled: boolean;
}

// ============================================================================
// MCP Tool Definition
// ============================================================================

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
}

// ============================================================================
// MCP Tool Invocation
// ============================================================================

export interface MCPToolCallRequest {
  name: string;
  arguments: Record<string, any>;
}

export interface MCPToolCallResult {
  content: Array<{
    type: string;
    text: string;
  }>;
  isError?: boolean;
}

// ============================================================================
// MCP JSON-RPC Messages
// ============================================================================

export interface MCPMessage {
  jsonrpc: '2.0';
  id?: number;
  method?: string;
  params?: any;
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

export interface MCPInitializeParams {
  protocolVersion: string;
  capabilities: {
    tools?: Record<string, any>;
  };
  clientInfo: {
    name: string;
    version: string;
  };
}

export interface MCPInitializeResult {
  protocolVersion: string;
  capabilities: {
    tools?: Record<string, any>;
  };
  serverInfo: {
    name: string;
    version: string;
  };
}
