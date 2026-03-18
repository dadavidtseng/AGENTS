/**
 * @fileoverview Tool definition interface — same structure as mcp-server-git.
 */
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import type {
  ContentBlock,
  Request as McpRequest,
  Notification,
} from '@modelcontextprotocol/sdk/types.js';
import type { ZodObject, ZodRawShape, z } from 'zod';

import type { RequestContext } from '@/utils/index.js';

export interface ToolAnnotations {
  [key: string]: unknown;
  title?: string;
  readOnlyHint?: boolean;
  openWorldHint?: boolean;
}

export type SdkContext = RequestHandlerExtra<McpRequest, Notification>;

export interface ToolDefinition<
  TInputSchema extends ZodObject<ZodRawShape>,
  TOutputSchema extends ZodObject<ZodRawShape>,
> {
  name: string;
  title?: string;
  description: string;
  inputSchema: TInputSchema;
  outputSchema: TOutputSchema;
  annotations?: ToolAnnotations;
  logic: (
    input: z.infer<TInputSchema>,
    appContext: RequestContext,
    sdkContext: SdkContext,
  ) => Promise<z.infer<TOutputSchema>>;
  responseFormatter?: (result: z.infer<TOutputSchema>) => ContentBlock[];
}
