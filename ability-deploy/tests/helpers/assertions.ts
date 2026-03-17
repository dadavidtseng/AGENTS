/**
 * Custom Test Assertions
 *
 * Provides type-safe assertion helpers for Result types and other
 * deploy-ability specific structures. These assertions provide better
 * error messages and TypeScript type narrowing in tests.
 *
 * @module tests/helpers/assertions
 */

import { expect } from 'vitest';
import type { Result, Success, Failure } from '../../src/types/index.js';
import type { DeploymentError } from '../../src/errors/index.js';

/**
 * Asserts that a Result is a success
 *
 * Provides TypeScript type narrowing so you can access result.data safely.
 *
 * @param result - The Result to check
 * @param message - Optional custom error message
 *
 * @example
 * ```typescript
 * const result = await someOperation();
 * expectSuccess(result);
 * // TypeScript now knows result.success === true
 * console.log(result.data.someField); // ✅ Type-safe
 * ```
 */
export function expectSuccess<TData, TError = Error>(
  result: Result<TData, TError>,
  message?: string
): asserts result is Success<TData> {
  if (!result.success) {
    const error = result.error as any;
    const errorDetails = error instanceof Error ? error.message : String(error);

    throw new Error(
      message ||
        `Expected result to be successful, but got failure: ${errorDetails}`
    );
  }

  expect(result.success).toBe(true);
  expect(result).toHaveProperty('data');
}

/**
 * Asserts that a Result is a failure
 *
 * Provides TypeScript type narrowing so you can access result.error safely.
 *
 * @param result - The Result to check
 * @param message - Optional custom error message
 *
 * @example
 * ```typescript
 * const result = await operationThatShouldFail();
 * expectFailure(result);
 * // TypeScript now knows result.success === false
 * console.log(result.error.message); // ✅ Type-safe
 * ```
 */
export function expectFailure<TData, TError = Error>(
  result: Result<TData, TError>,
  message?: string
): asserts result is Failure<TError> {
  if (result.success) {
    throw new Error(
      message ||
        `Expected result to be a failure, but got success with data: ${JSON.stringify(result.data)}`
    );
  }

  expect(result.success).toBe(false);
  expect(result).toHaveProperty('error');
}

/**
 * Asserts that a Result failure has a specific error code
 *
 * Works with DeploymentError and checks the code property.
 *
 * @param result - The Result to check
 * @param expectedCode - The expected error code
 * @param message - Optional custom error message
 *
 * @example
 * ```typescript
 * const result = await loadProfile('/nonexistent');
 * expectErrorCode(result, 'PROFILE_NOT_FOUND');
 * ```
 */
export function expectErrorCode<TData>(
  result: Result<TData, DeploymentError>,
  expectedCode: string,
  message?: string
): void {
  expectFailure(result, message);

  const actualCode = result.error.code;

  if (actualCode !== expectedCode) {
    throw new Error(
      message ||
        `Expected error code "${expectedCode}", but got "${actualCode}". ` +
          `Error message: ${result.error.message}`
    );
  }

  expect(actualCode).toBe(expectedCode);
}

/**
 * Asserts that a Result failure has a specific error message (contains)
 *
 * @param result - The Result to check
 * @param expectedSubstring - Substring that should be in the error message
 * @param message - Optional custom error message
 *
 * @example
 * ```typescript
 * const result = await someOperation();
 * expectErrorMessage(result, 'not found');
 * ```
 */
export function expectErrorMessage<TData, TError = Error>(
  result: Result<TData, TError>,
  expectedSubstring: string,
  message?: string
): void {
  expectFailure(result, message);

  const error = result.error as any;
  const actualMessage = error.message || String(error);

  if (!actualMessage.includes(expectedSubstring)) {
    throw new Error(
      message ||
        `Expected error message to contain "${expectedSubstring}", but got: "${actualMessage}"`
    );
  }

  expect(actualMessage).toContain(expectedSubstring);
}

/**
 * Asserts that a DeploymentError is recoverable
 *
 * @param error - The DeploymentError to check
 * @param message - Optional custom error message
 */
export function expectRecoverable(
  error: DeploymentError,
  message?: string
): void {
  if (!error.recoverable) {
    throw new Error(
      message ||
        `Expected error to be recoverable, but it's not. Error: ${error.message}`
    );
  }

  expect(error.recoverable).toBe(true);
}

/**
 * Asserts that a DeploymentError is not recoverable
 *
 * @param error - The DeploymentError to check
 * @param message - Optional custom error message
 */
export function expectNotRecoverable(
  error: DeploymentError,
  message?: string
): void {
  if (error.recoverable) {
    throw new Error(
      message ||
        `Expected error to be not recoverable, but it is. Error: ${error.message}`
    );
  }

  expect(error.recoverable).toBe(false);
}

/**
 * Asserts that a DeploymentError has a suggestion
 *
 * @param error - The DeploymentError to check
 * @param expectedSubstring - Optional substring to check in suggestion
 * @param message - Optional custom error message
 */
export function expectSuggestion(
  error: DeploymentError,
  expectedSubstring?: string,
  message?: string
): void {
  if (!error.suggestion) {
    throw new Error(
      message ||
        `Expected error to have a suggestion, but it doesn't. Error: ${error.message}`
    );
  }

  expect(error.suggestion).toBeDefined();

  if (expectedSubstring && !error.suggestion.includes(expectedSubstring)) {
    throw new Error(
      message ||
        `Expected suggestion to contain "${expectedSubstring}", but got: "${error.suggestion}"`
    );
  }

  if (expectedSubstring) {
    expect(error.suggestion).toContain(expectedSubstring);
  }
}

/**
 * Asserts that a DeploymentError has specific context field
 *
 * @param error - The DeploymentError to check
 * @param field - The context field name
 * @param expectedValue - Optional expected value for the field
 * @param message - Optional custom error message
 */
export function expectErrorContext(
  error: DeploymentError,
  field: string,
  expectedValue?: any,
  message?: string
): void {
  if (!(field in error.context)) {
    throw new Error(
      message ||
        `Expected error context to have field "${field}", but it doesn't. ` +
          `Context: ${JSON.stringify(error.context)}`
    );
  }

  expect(error.context).toHaveProperty(field);

  if (expectedValue !== undefined) {
    const actualValue = error.context[field];

    if (actualValue !== expectedValue) {
      throw new Error(
        message ||
          `Expected context.${field} to be ${JSON.stringify(expectedValue)}, ` +
            `but got ${JSON.stringify(actualValue)}`
      );
    }

    expect(actualValue).toBe(expectedValue);
  }
}

/**
 * Asserts that a value is a valid port number (1-65535)
 *
 * @param port - The port number to check
 * @param message - Optional custom error message
 */
export function expectValidPort(port: number, message?: string): void {
  if (port < 1 || port > 65535) {
    throw new Error(
      message || `Expected valid port (1-65535), but got: ${port}`
    );
  }

  expect(port).toBeGreaterThanOrEqual(1);
  expect(port).toBeLessThanOrEqual(65535);
}

/**
 * Asserts that an object has all specified properties
 *
 * More specific than toHaveProperty for checking multiple properties at once.
 *
 * @param obj - The object to check
 * @param properties - Array of property names
 * @param message - Optional custom error message
 */
export function expectProperties(
  obj: any,
  properties: readonly string[],
  message?: string
): void {
  const missingProps = properties.filter((prop) => !(prop in obj));

  if (missingProps.length > 0) {
    throw new Error(
      message ||
        `Expected object to have properties [${properties.join(', ')}], ` +
          `but missing: [${missingProps.join(', ')}]`
    );
  }

  properties.forEach((prop) => {
    expect(obj).toHaveProperty(prop);
  });
}

/**
 * Asserts that a duration is within expected range
 *
 * Useful for testing command execution timing.
 *
 * @param duration - Actual duration in milliseconds
 * @param min - Minimum expected duration
 * @param max - Maximum expected duration
 * @param message - Optional custom error message
 */
export function expectDurationInRange(
  duration: number,
  min: number,
  max: number,
  message?: string
): void {
  if (duration < min || duration > max) {
    throw new Error(
      message ||
        `Expected duration to be between ${min}ms and ${max}ms, but got: ${duration}ms`
    );
  }

  expect(duration).toBeGreaterThanOrEqual(min);
  expect(duration).toBeLessThanOrEqual(max);
}

/**
 * Asserts that a progress callback was called with specific phase
 *
 * @param spy - The vitest spy function
 * @param phase - The expected phase
 * @param message - Optional custom error message
 */
export function expectProgressPhase(
  spy: any,
  phase: string,
  message?: string
): void {
  const calls = spy.mock.calls;
  const hasPhase = calls.some((call: any[]) => call[0]?.phase === phase);

  if (!hasPhase) {
    const actualPhases = calls.map((call: any[]) => call[0]?.phase);
    throw new Error(
      message ||
        `Expected progress callback to be called with phase "${phase}", ` +
          `but got phases: [${actualPhases.join(', ')}]`
    );
  }

  expect(hasPhase).toBe(true);
}
