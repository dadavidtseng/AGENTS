/**
 * @fileoverview Tool handler factories for GitHub MCP tools.
 * Simplified from mcp-server-git: no path resolution, injects GitHubProvider.
 */
import { container } from 'tsyringe';
import { GitHubProviderToken } from '@/container/tokens.js';
import type { SdkContext } from '@/mcp-server/tools/utils/toolDefinition.js';
import type { GitHubProvider } from '@/services/github/GitHubProvider.js';
import { McpError } from '@/types-global/errors.js';
import {
  ErrorHandler,
  logger,
  measureToolExecution,
  requestContextService,
  type RequestContext,
} from '@/utils/index.js';
import type { CallToolResult, ContentBlock } from '@modelcontextprotocol/sdk/types.js';

// ── Default Formatter ───────────────────────────────────────────────────────
const defaultResponseFormatter = (result: unknown): ContentBlock[] => [
  { type: 'text', text: JSON.stringify(result, null, 2) },
];

export function createJsonFormatter<T>() {
  return (result: T): ContentBlock[] => [
    { type: 'text', text: JSON.stringify(result, null, 2) },
  ];
}

// ── GitHub Tool Dependencies ────────────────────────────────────────────────
export interface GitHubToolDependencies {
  provider: GitHubProvider;
  appContext: RequestContext;
  sdkContext: SdkContext;
}

export type CoreGitHubToolLogic<TInput, TOutput> = (
  input: TInput,
  deps: GitHubToolDependencies,
) => Promise<TOutput>;

// ── GitHub Tool Handler Factory ─────────────────────────────────────────────
/**
 * Creates a tool logic handler that resolves GitHubProvider from DI
 * and passes it to the core business logic.
 */
export function createGitHubToolHandler<TInput, TOutput>(
  coreLogic: CoreGitHubToolLogic<TInput, TOutput>,
): (
  input: TInput,
  appContext: RequestContext,
  sdkContext: SdkContext,
) => Promise<TOutput> {
  // Lazy singleton for provider
  let cachedProvider: GitHubProvider | null = null;

  return async (
    input: TInput,
    appContext: RequestContext,
    sdkContext: SdkContext,
  ): Promise<TOutput> => {
    if (!cachedProvider) {
      cachedProvider = container.resolve<GitHubProvider>(
        GitHubProviderToken as unknown as string,
      );
    }

    return coreLogic(input, {
      provider: cachedProvider,
      appContext,
      sdkContext,
    });
  };
}

// ── MCP Tool Handler Wrapper ────────────────────────────────────────────────
export type ToolHandlerFactoryOptions<
  TInput,
  TOutput extends Record<string, unknown>,
> = {
  toolName: string;
  logic: (
    input: TInput,
    appContext: RequestContext,
    sdkContext: SdkContext,
  ) => Promise<TOutput>;
  responseFormatter?: (result: TOutput) => ContentBlock[];
};

/**
 * Creates a standardized MCP tool handler with error handling,
 * context creation, and performance measurement.
 */
export function createMcpToolHandler<
  TInput,
  TOutput extends Record<string, unknown>,
>({
  toolName,
  logic,
  responseFormatter = defaultResponseFormatter,
}: ToolHandlerFactoryOptions<TInput, TOutput>) {
  return async (
    input: TInput,
    callContext: Record<string, unknown>,
  ): Promise<CallToolResult> => {
    const sdkContext = callContext as SdkContext;
    const appContext = requestContextService.createRequestContext({
      parentContext: sdkContext,
      operation: 'HandleToolRequest',
      additionalContext: { toolName },
    });

    try {
      const result = await measureToolExecution(
        () => logic(input, appContext, sdkContext),
        { ...appContext, toolName },
        input,
      );

      return {
        structuredContent: result,
        content: responseFormatter(result),
      };
    } catch (error) {
      logger.error(
        { ...appContext, toolName, error: error instanceof Error ? error.message : String(error) },
        'Tool execution failed',
      );

      const mcpError = ErrorHandler.handleError(error, {
        operation: `tool:${toolName}`,
        context: appContext,
        input,
      }) as McpError;

      return {
        isError: true,
        content: [{ type: 'text', text: JSON.stringify({ success: false, error: mcpError.message, code: mcpError.code }) }],
      };
    }
  };
}
