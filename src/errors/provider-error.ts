/**
 * Provider-related error classes
 *
 * Errors specific to Akash provider communication and operations
 *
 * @module errors/provider-error
 */

import { DeploymentError, type ErrorContext, type ErrorSeverity } from './deployment-error.js';

/**
 * Provider error codes
 */
export const ProviderErrorCodes = {
  /** Provider unreachable or offline */
  PROVIDER_UNREACHABLE: 'PROVIDER_UNREACHABLE',

  /** Provider rejected the manifest */
  MANIFEST_REJECTED: 'MANIFEST_REJECTED',

  /** Failed to send manifest to provider */
  MANIFEST_SEND_FAILED: 'MANIFEST_SEND_FAILED',

  /** Provider returned error status */
  PROVIDER_STATUS_ERROR: 'PROVIDER_STATUS_ERROR',

  /** Container failed to start on provider */
  CONTAINER_START_FAILED: 'CONTAINER_START_FAILED',

  /** Timeout waiting for containers to run */
  CONTAINER_TIMEOUT: 'CONTAINER_TIMEOUT',

  /** Provider certificate validation failed */
  PROVIDER_CERT_INVALID: 'PROVIDER_CERT_INVALID',

  /** No providers responded to the deployment */
  NO_BIDS_RECEIVED: 'NO_BIDS_RECEIVED',

  /** All providers are blacklisted */
  ALL_PROVIDERS_BLACKLISTED: 'ALL_PROVIDERS_BLACKLISTED',

  /** Provider communication timeout */
  PROVIDER_TIMEOUT: 'PROVIDER_TIMEOUT',

  /** Generic provider error */
  PROVIDER_ERROR: 'PROVIDER_ERROR',
} as const;

export type ProviderErrorCode =
  (typeof ProviderErrorCodes)[keyof typeof ProviderErrorCodes];

/**
 * Provider communication or operation error
 *
 * Thrown when provider-related operations fail, including:
 * - Provider unreachable
 * - Manifest rejection
 * - Container startup failures
 * - Communication timeouts
 *
 * @example
 * throw new ProviderError(
 *   'Provider rejected manifest',
 *   ProviderErrorCodes.MANIFEST_REJECTED,
 *   { provider: 'akash1...', reason: 'Invalid image reference' },
 *   true,
 *   'Check your image name and try again'
 * );
 */
export class ProviderError extends DeploymentError {
  constructor(
    message: string,
    code: ProviderErrorCode = ProviderErrorCodes.PROVIDER_ERROR,
    context: ErrorContext = {},
    recoverable: boolean = false,
    suggestion?: string,
    severity: ErrorSeverity = 'error',
    cause?: Error
  ) {
    super(message, code, context, recoverable, suggestion, severity, cause);

    // Maintain proper prototype chain
    Object.setPrototypeOf(this, ProviderError.prototype);

    this.name = 'ProviderError';
  }
}

/**
 * Create a provider unreachable error
 *
 * @param providerUri - URI of unreachable provider
 * @param cause - Original error
 * @returns ProviderError instance
 */
export function providerUnreachableError(
  providerUri: string,
  cause?: Error
): ProviderError {
  return new ProviderError(
    `Provider ${providerUri} is unreachable`,
    ProviderErrorCodes.PROVIDER_UNREACHABLE,
    { providerUri },
    true,
    'The provider may be temporarily offline. Try selecting a different provider.',
    'error',
    cause
  );
}

/**
 * Create a manifest rejected error
 *
 * @param provider - Provider address
 * @param reason - Rejection reason
 * @returns ProviderError instance
 */
export function manifestRejectedError(
  provider: string,
  reason?: string
): ProviderError {
  return new ProviderError(
    `Provider ${provider} rejected the manifest${reason ? `: ${reason}` : ''}`,
    ProviderErrorCodes.MANIFEST_REJECTED,
    { provider, reason },
    true,
    'Review your deployment configuration and try again with a different provider',
    'error'
  );
}

/**
 * Create a no bids received error
 *
 * @param timeout - How long we waited
 * @returns ProviderError instance
 */
export function noBidsReceivedError(timeout: number): ProviderError {
  return new ProviderError(
    `No bids received after waiting ${timeout}ms`,
    ProviderErrorCodes.NO_BIDS_RECEIVED,
    { timeout },
    true,
    'Try increasing your max price or adjusting resource requirements',
    'warning'
  );
}

/**
 * Create a container timeout error
 *
 * @param service - Service that timed out
 * @param timeout - Timeout duration
 * @returns ProviderError instance
 */
export function containerTimeoutError(
  service: string,
  timeout: number
): ProviderError {
  return new ProviderError(
    `Container '${service}' failed to start within ${timeout}ms`,
    ProviderErrorCodes.CONTAINER_TIMEOUT,
    { service, timeout },
    false,
    'Check container logs for startup errors. The image may be too large or have configuration issues.',
    'error'
  );
}

/**
 * Create a container start failed error
 *
 * @param service - Service that failed
 * @param reason - Failure reason
 * @returns ProviderError instance
 */
export function containerStartFailedError(
  service: string,
  reason?: string
): ProviderError {
  return new ProviderError(
    `Container '${service}' failed to start${reason ? `: ${reason}` : ''}`,
    ProviderErrorCodes.CONTAINER_START_FAILED,
    { service, reason },
    true,
    'Check the container image and environment configuration',
    'error'
  );
}

/**
 * Type guard to check if an error is a ProviderError
 *
 * @param error - The error to check
 * @returns True if error is a ProviderError
 */
export function isProviderError(error: unknown): error is ProviderError {
  return error instanceof ProviderError;
}
