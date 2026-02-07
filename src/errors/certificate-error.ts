/**
 * Certificate-related error classes
 *
 * Errors specific to TLS certificate operations for Akash provider communication
 *
 * @module errors/certificate-error
 */

import { DeploymentError, type ErrorContext, type ErrorSeverity } from './deployment-error.js';

/**
 * Certificate error codes
 */
export const CertificateErrorCodes = {
  /** Certificate file not found */
  CERT_NOT_FOUND: 'CERT_NOT_FOUND',

  /** Certificate file is invalid or corrupted */
  CERT_INVALID: 'CERT_INVALID',

  /** Certificate has expired */
  CERT_EXPIRED: 'CERT_EXPIRED',

  /** Failed to create new certificate */
  CERT_CREATION_FAILED: 'CERT_CREATION_FAILED',

  /** Failed to save certificate to disk */
  CERT_SAVE_FAILED: 'CERT_SAVE_FAILED',

  /** Failed to broadcast certificate to blockchain */
  CERT_BROADCAST_FAILED: 'CERT_BROADCAST_FAILED',

  /** Failed to revoke certificate on blockchain */
  CERT_REVOKE_FAILED: 'CERT_REVOKE_FAILED',

  /** Certificate parsing error */
  CERT_PARSE_ERROR: 'CERT_PARSE_ERROR',

  /** Generic certificate error */
  CERT_ERROR: 'CERT_ERROR',
} as const;

export type CertificateErrorCode =
  (typeof CertificateErrorCodes)[keyof typeof CertificateErrorCodes];

/**
 * Certificate operation error
 *
 * Thrown when certificate-related operations fail, including:
 * - Loading existing certificates
 * - Creating new certificates
 * - Broadcasting certificates to blockchain
 * - Certificate validation
 *
 * @example
 * throw new CertificateError(
 *   'Certificate file not found',
 *   CertificateErrorCodes.CERT_NOT_FOUND,
 *   { path: '/path/to/cert.json' },
 *   true,
 *   'A new certificate will be created automatically'
 * );
 */
export class CertificateError extends DeploymentError {
  constructor(
    message: string,
    code: CertificateErrorCode = CertificateErrorCodes.CERT_ERROR,
    context: ErrorContext = {},
    recoverable: boolean = false,
    suggestion?: string,
    severity: ErrorSeverity = 'error',
    cause?: Error
  ) {
    super(message, code, context, recoverable, suggestion, severity, cause);

    // Maintain proper prototype chain
    Object.setPrototypeOf(this, CertificateError.prototype);

    this.name = 'CertificateError';
  }
}

/**
 * Create a certificate not found error
 *
 * @param path - Path where certificate was expected
 * @returns CertificateError instance
 */
export function certificateNotFoundError(path: string): CertificateError {
  return new CertificateError(
    `Certificate not found at ${path}`,
    CertificateErrorCodes.CERT_NOT_FOUND,
    { path },
    true,
    'A new certificate will be created automatically',
    'warning'
  );
}

/**
 * Create a certificate invalid error
 *
 * @param path - Path to invalid certificate
 * @param reason - Why the certificate is invalid
 * @returns CertificateError instance
 */
export function certificateInvalidError(
  path: string,
  reason: string
): CertificateError {
  return new CertificateError(
    `Certificate at ${path} is invalid: ${reason}`,
    CertificateErrorCodes.CERT_INVALID,
    { path, reason },
    true,
    'A new certificate will be created to replace the invalid one',
    'warning'
  );
}

/**
 * Create a certificate expired error
 *
 * @param expiryDate - When the certificate expired
 * @returns CertificateError instance
 */
export function certificateExpiredError(
  expiryDate: Date
): CertificateError {
  return new CertificateError(
    `Certificate expired on ${expiryDate.toISOString()}`,
    CertificateErrorCodes.CERT_EXPIRED,
    { expiryDate: expiryDate.toISOString() },
    true,
    'A new certificate will be created automatically',
    'warning'
  );
}

/**
 * Create a certificate creation failed error
 *
 * @param cause - Original error
 * @returns CertificateError instance
 */
export function certificateCreationFailedError(
  cause?: Error
): CertificateError {
  return new CertificateError(
    'Failed to create new certificate',
    CertificateErrorCodes.CERT_CREATION_FAILED,
    {},
    false,
    'Check wallet connection and try again',
    'error',
    cause
  );
}

/**
 * Create a certificate broadcast failed error
 *
 * @param cause - Original error
 * @returns CertificateError instance
 */
export function certificateBroadcastFailedError(
  cause?: Error
): CertificateError {
  return new CertificateError(
    'Failed to broadcast certificate to blockchain',
    CertificateErrorCodes.CERT_BROADCAST_FAILED,
    {},
    true,
    'Check your network connection and try again',
    'error',
    cause
  );
}

/**
 * Type guard to check if an error is a CertificateError
 *
 * @param error - The error to check
 * @returns True if error is a CertificateError
 */
export function isCertificateError(error: unknown): error is CertificateError {
  return error instanceof CertificateError;
}
