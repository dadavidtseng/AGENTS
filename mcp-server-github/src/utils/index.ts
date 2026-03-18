/**
 * @fileoverview Lightweight logger and request context utilities.
 */
import pino from 'pino';

// ── Logger ──────────────────────────────────────────────────────────────────
const isStdio =
  !process.env.MCP_TRANSPORT_TYPE ||
  process.env.MCP_TRANSPORT_TYPE === 'stdio';

export const logger = pino(
  {
    level: process.env.MCP_LOG_LEVEL || 'info',
    transport: isStdio
      ? undefined
      : { target: 'pino-pretty', options: { colorize: true } },
  },
  // In STDIO mode, write to stderr so stdout stays clean for MCP protocol
  isStdio ? pino.destination({ fd: 2 }) : undefined,
);

// ── Request Context ─────────────────────────────────────────────────────────
export interface RequestContext {
  requestId: string;
  sessionId?: string;
  tenantId?: string;
  operation?: string;
  [key: string]: unknown;
}

let requestCounter = 0;

export const requestContextService = {
  createRequestContext(opts: {
    parentContext?: unknown;
    operation?: string;
    additionalContext?: Record<string, unknown>;
  }): RequestContext {
    return {
      requestId: `req-${++requestCounter}-${Date.now()}`,
      operation: opts.operation,
      ...opts.additionalContext,
    };
  },
};

// ── Error Handler ───────────────────────────────────────────────────────────
import { McpError, JsonRpcErrorCode } from '@/types-global/errors.js';

export const ErrorHandler = {
  handleError(
    error: unknown,
    context?: { operation?: string; context?: RequestContext; input?: unknown },
  ): McpError {
    if (error instanceof McpError) return error;

    const message =
      error instanceof Error ? error.message : String(error);

    // Map Octokit errors
    if (error && typeof error === 'object' && 'status' in error) {
      const status = (error as { status: number }).status;
      if (status === 401)
        return new McpError(JsonRpcErrorCode.Unauthorized, `GitHub API: ${message}`);
      if (status === 403)
        return new McpError(JsonRpcErrorCode.Forbidden, `GitHub API: ${message}`);
      if (status === 404)
        return new McpError(JsonRpcErrorCode.NotFound, `GitHub API: ${message}`);
      if (status === 422)
        return new McpError(JsonRpcErrorCode.ValidationError, `GitHub API: ${message}`);
      if (status === 429)
        return new McpError(JsonRpcErrorCode.RateLimited, `GitHub API: Rate limited`);
    }

    return new McpError(JsonRpcErrorCode.InternalError, message);
  },
};

// ── Performance Measurement ─────────────────────────────────────────────────
export async function measureToolExecution<T>(
  fn: () => Promise<T>,
  context: RequestContext & { toolName?: string },
  _input?: unknown,
): Promise<T> {
  const start = performance.now();
  try {
    const result = await fn();
    const duration = Math.round(performance.now() - start);
    logger.debug({ ...context, duration_ms: duration }, `Tool ${context.toolName} completed`);
    return result;
  } catch (error) {
    const duration = Math.round(performance.now() - start);
    logger.error({ ...context, duration_ms: duration }, `Tool ${context.toolName} failed`);
    throw error;
  }
}
