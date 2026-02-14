/**
 * @fileoverview Error types for the GitHub MCP Server.
 * Mirrors mcp-server-git error patterns for consistency.
 */

export enum JsonRpcErrorCode {
  ParseError = -32700,
  InvalidRequest = -32600,
  MethodNotFound = -32601,
  InvalidParams = -32602,
  InternalError = -32603,
  ServiceUnavailable = -32000,
  NotFound = -32001,
  Unauthorized = -32006,
  ValidationError = -32007,
  RateLimited = -32008,
  Forbidden = -32009,
}

export class McpError extends Error {
  public code: JsonRpcErrorCode;
  public readonly data?: Record<string, unknown>;

  constructor(
    code: JsonRpcErrorCode,
    message?: string,
    data?: Record<string, unknown>,
  ) {
    super(message);
    this.code = code;
    this.data = data;
    this.name = 'McpError';
  }
}
