/**
 * Echo Tool Registration
 *
 * Simple placeholder tool that echoes back the input text along with its length.
 * Replace this with your own tools.
 */

import { z } from '@kadi.build/core';
import type { KadiClient } from '@kadi.build/core';
import { logger, MODULE_AGENT, timer } from 'agents-library';

/**
 * Input schema for echo tool
 *
 * @example
 * ```typescript
 * const input: EchoInput = {
 *   text: 'hello world'
 * };
 * ```
 */
export const echoInputSchema = z.object({
  text: z.string().describe('Text to echo back')
});

/**
 * Output schema for echo tool
 *
 * @example
 * ```typescript
 * const output: EchoOutput = {
 *   echo: 'hello world',
 *   length: 11
 * };
 * ```
 */
export const echoOutputSchema = z.object({
  echo: z.string().describe('Echoed text'),
  length: z.number().describe('Length of text')
});

/** Inferred TypeScript type for echo input */
export type EchoInput = z.infer<typeof echoInputSchema>;

/** Inferred TypeScript type for echo output */
export type EchoOutput = z.infer<typeof echoOutputSchema>;

/**
 * Register echo tool
 *
 * @param client - KĀDI client instance
 */
export function registerEchoTool(client: KadiClient): void {
  /**
   * Echo Tool (Placeholder)
   *
   * This is a simple placeholder tool that echoes back the input text
   * along with its length. Replace this with your own tools.
   *
   * @param params - Input parameters matching EchoInput schema
   * @returns Echoed text with length metadata
   *
   * @example
   * ```typescript
   * const result = await client.invokeTool('echo', {
   *   text: 'hello world'
   * });
   * // Returns: { echo: 'hello world', length: 11 }
   * ```
   */
  client.registerTool({
    name: 'echo',
    description: 'Echo back the input text with its length (placeholder tool - replace with your own)',
    input: echoInputSchema,
    output: echoOutputSchema
  }, async (params: EchoInput): Promise<EchoOutput> => {
    logger.info(MODULE_AGENT, `Echoing text: "${params.text}"`, timer.elapsed('main'));

    const result = {
      echo: params.text,
      length: params.text.length
    };

    // TEMPLATE PATTERN: Publish event for operation
    // TODO: Replace 'echo.processed' with your domain-specific event topic
    // TODO: Replace 'template-agent-typescript' with your agent name
    await client.publish('echo.processed', {
      operation: 'echo',
      text_length: result.length,
      agent: 'template-agent-typescript'
    }, { broker: 'default', network: 'global' });

    return result;
  });
}
