/**
 * @fileoverview Custom test assertions for git tool testing.
 * @module tests/mcp-server/tools/definitions/helpers/assertions
 */
import { expect } from 'vitest';
import type { ContentBlock } from '@modelcontextprotocol/sdk/types.js';
import { McpError, JsonRpcErrorCode } from '@/types-global/errors.js';

/**
 * Assert that a value is a valid McpError with expected properties
 */
export function assertMcpError(
  error: unknown,
  expectedCode: JsonRpcErrorCode,
  messagePattern?: string | RegExp,
): asserts error is McpError {
  expect(error).toBeInstanceOf(McpError);
  const mcpError = error as McpError;
  expect(mcpError.code).toBe(expectedCode);

  if (messagePattern) {
    if (typeof messagePattern === 'string') {
      expect(mcpError.message).toContain(messagePattern);
    } else {
      expect(mcpError.message).toMatch(messagePattern);
    }
  }
}

/**
 * Assert that content blocks contain text content
 */
export function assertTextContent(
  content: ContentBlock[],
  expectedPattern: string | RegExp,
): void {
  expect(content).toHaveLength(1);
  expect(content[0]).toHaveProperty('type', 'text');
  const textContent = (content[0] as { type: 'text'; text: string }).text;

  if (typeof expectedPattern === 'string') {
    expect(textContent).toContain(expectedPattern);
  } else {
    expect(textContent).toMatch(expectedPattern);
  }
}

/**
 * Assert that content blocks contain properly formatted markdown
 */
export function assertMarkdownContent(
  content: ContentBlock[],
  expectedSections: string[],
): void {
  expect(content).toHaveLength(1);
  expect(content[0]).toHaveProperty('type', 'text');
  const textContent = (content[0] as { type: 'text'; text: string }).text;

  // Check for markdown sections
  for (const section of expectedSections) {
    expect(textContent).toContain(section);
  }
}

/**
 * Assert that a tool output has the expected structure
 */
export function assertToolOutput<T extends Record<string, unknown>>(
  output: unknown,
  expectedFields: (keyof T)[],
): asserts output is T {
  expect(output).toBeDefined();
  expect(typeof output).toBe('object');
  expect(output).not.toBeNull();

  for (const field of expectedFields) {
    expect(output).toHaveProperty(field as string);
  }
}

/**
 * Assert that provider was called with expected context
 */
export function assertProviderCalledWithContext(
  providerCall: unknown[],
  expectedWorkingDir: string,
  expectedTenantId: string,
): void {
  expect(providerCall).toHaveLength(2);

  const [_options, context] = providerCall;
  expect(context).toMatchObject({
    workingDirectory: expectedWorkingDir,
    tenantId: expectedTenantId,
  });
  expect(context).toHaveProperty('requestContext');
}

/**
 * Assert that an error contains specific data fields
 */
export function assertErrorData(
  error: McpError,
  expectedData: Record<string, unknown>,
): void {
  expect(error.data).toBeDefined();
  expect(error.data).toMatchObject(expectedData);
}

/**
 * Assert that content is properly escaped/sanitized
 */
export function assertSanitizedContent(content: ContentBlock[]): void {
  expect(content).toHaveLength(1);
  const textContent = (content[0] as { type: 'text'; text: string }).text;

  // Check for common XSS patterns that should be escaped
  expect(textContent).not.toMatch(/<script>/i);
  expect(textContent).not.toMatch(/javascript:/i);
  expect(textContent).not.toMatch(/onerror=/i);
}

/**
 * Assert that response formatter output is LLM-friendly
 * Now supports both JSON and Markdown formats
 */
export function assertLlmFriendlyFormat(
  content: ContentBlock[],
  minLength = 50,
): void {
  expect(content).toHaveLength(1);
  const textContent = (content[0] as { type: 'text'; text: string }).text;

  // Should have meaningful content
  expect(textContent.length).toBeGreaterThan(minLength);

  // Check if it's JSON or Markdown
  const isJsonOnly =
    textContent.trim().startsWith('{') && textContent.trim().endsWith('}');

  if (isJsonOnly) {
    // If it's JSON, it should be formatted (pretty-printed)
    expect(textContent).toMatch(/\n/);

    // Should be valid JSON
    expect(() => JSON.parse(textContent)).not.toThrow();
  } else {
    // If it's Markdown, should have headers
    expect(textContent).toMatch(/^#\s+/m);
  }
}

/**
 * Assert that content blocks contain valid JSON with expected structure
 */
export function assertJsonContent(
  content: ContentBlock[],
  expectedStructure: Record<string, unknown>,
): void {
  expect(content).toHaveLength(1);
  expect(content[0]).toHaveProperty('type', 'text');
  const textContent = (content[0] as { type: 'text'; text: string }).text;

  // Should be valid JSON
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(textContent);
  } catch (error) {
    throw new Error(`Content is not valid JSON: ${textContent}`);
  }

  // Should match expected structure
  expect(parsedJson).toMatchObject(expectedStructure);
}

/**
 * Assert that content blocks contain valid JSON and return parsed object
 */
export function parseJsonContent(content: ContentBlock[]): unknown {
  expect(content).toHaveLength(1);
  expect(content[0]).toHaveProperty('type', 'text');
  const textContent = (content[0] as { type: 'text'; text: string }).text;

  try {
    return JSON.parse(textContent);
  } catch (error) {
    throw new Error(`Content is not valid JSON: ${textContent}`);
  }
}

/**
 * Assert that JSON content has specific field with expected value
 */
export function assertJsonField(
  content: ContentBlock[],
  fieldPath: string,
  expectedValue: unknown,
): void {
  const parsed = parseJsonContent(content) as Record<string, unknown>;

  // Support nested paths like "status.current_branch"
  const pathParts = fieldPath.split('.');
  let value: unknown = parsed;

  for (const part of pathParts) {
    if (value && typeof value === 'object' && part in value) {
      value = (value as Record<string, unknown>)[part];
    } else {
      throw new Error(`Field path "${fieldPath}" not found in JSON`);
    }
  }

  if (typeof expectedValue === 'function') {
    // Allow for expect matchers like expect.any(Array)
    expect(value).toEqual(expectedValue);
  } else {
    expect(value).toEqual(expectedValue);
  }
}
