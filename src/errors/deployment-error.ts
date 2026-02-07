/**
 * Base deployment error class
 *
 * Provides structured error handling with error codes, context, and suggestions
 *
 * @module errors/deployment-error
 */

/**
 * Error context type
 *
 * Additional contextual information about the error
 * Can include any relevant data for debugging or error handling
 */
export type ErrorContext = Readonly<Record<string, unknown>>;

/**
 * Error severity levels
 */
export type ErrorSeverity = 'critical' | 'error' | 'warning' | 'info';

/**
 * Base deployment error class
 *
 * All deployment-related errors extend from this class.
 * Provides rich error information including:
 * - Structured error codes
 * - Contextual data
 * - Actionable suggestions
 * - Recoverability hints
 *
 * @example
 * throw new DeploymentError(
 *   'Failed to create deployment',
 *   'DEPLOY_CREATE_FAILED',
 *   { dseq: 12345, provider: 'akash1...' },
 *   true,
 *   'Check your wallet balance and try again'
 * );
 */
export class DeploymentError extends Error {
  /**
   * Structured error code for programmatic handling
   */
  public readonly code: string;

  /**
   * Additional context about the error
   */
  public readonly context: ErrorContext;

  /**
   * Whether the operation can be retried
   */
  public readonly recoverable: boolean;

  /**
   * Human-readable suggestion for fixing the error
   */
  public readonly suggestion?: string;

  /**
   * Error severity level
   */
  public readonly severity: ErrorSeverity;

  /**
   * Timestamp when error occurred
   */
  public readonly timestamp: Date;

  /**
   * Original error that caused this error (if any)
   */
  public override readonly cause?: Error;

  constructor(
    message: string,
    code: string,
    context: ErrorContext = {},
    recoverable: boolean = false,
    suggestion?: string,
    severity: ErrorSeverity = 'error',
    cause?: Error
  ) {
    super(message);

    // Maintain proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, DeploymentError.prototype);

    this.name = 'DeploymentError';
    this.code = code;
    this.context = context;
    this.recoverable = recoverable;
    this.suggestion = suggestion;
    this.severity = severity;
    this.timestamp = new Date();
    this.cause = cause;

    // Capture stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  /**
   * Convert error to JSON representation
   *
   * Useful for logging or sending error details over the network
   *
   * @returns JSON-serializable error object
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      context: this.context,
      recoverable: this.recoverable,
      suggestion: this.suggestion,
      severity: this.severity,
      timestamp: this.timestamp.toISOString(),
      stack: this.stack,
      cause: this.cause
        ? {
            message: this.cause.message,
            stack: this.cause.stack,
          }
        : undefined,
    };
  }

  /**
   * Get a user-friendly error message
   *
   * Combines the error message with suggestion if available
   *
   * @returns Formatted error message
   */
  getUserMessage(): string {
    if (this.suggestion) {
      return `${this.message}\n\nSuggestion: ${this.suggestion}`;
    }
    return this.message;
  }

  /**
   * Check if error is recoverable
   *
   * @returns True if the operation can be retried
   */
  isRecoverable(): boolean {
    return this.recoverable;
  }

  /**
   * Get formatted context string for logging
   *
   * @returns Formatted context information
   */
  getContextString(): string {
    if (Object.keys(this.context).length === 0) {
      return 'No additional context';
    }

    return Object.entries(this.context)
      .map(([key, value]) => `  ${key}: ${JSON.stringify(value)}`)
      .join('\n');
  }

  /**
   * Create a detailed error report
   *
   * Useful for debugging or error logging
   *
   * @returns Formatted error report
   */
  getDetailedReport(): string {
    const parts: string[] = [
      `Error: ${this.message}`,
      `Code: ${this.code}`,
      `Severity: ${this.severity}`,
      `Recoverable: ${this.recoverable ? 'Yes' : 'No'}`,
      `Timestamp: ${this.timestamp.toISOString()}`,
    ];

    if (this.suggestion) {
      parts.push(`Suggestion: ${this.suggestion}`);
    }

    if (Object.keys(this.context).length > 0) {
      parts.push(`Context:\n${this.getContextString()}`);
    }

    if (this.cause) {
      parts.push(`Caused by: ${this.cause.message}`);
      if (this.cause.stack) {
        parts.push(`Cause Stack:\n${this.cause.stack}`);
      }
    }

    if (this.stack) {
      parts.push(`Stack:\n${this.stack}`);
    }

    return parts.join('\n');
  }
}

/**
 * Type guard to check if an error is a DeploymentError
 *
 * @param error - The error to check
 * @returns True if error is a DeploymentError
 *
 * @example
 * try {
 *   await deploy();
 * } catch (error) {
 *   if (isDeploymentError(error)) {
 *     console.log(error.code);
 *     console.log(error.context);
 *   }
 * }
 */
export function isDeploymentError(error: unknown): error is DeploymentError {
  return error instanceof DeploymentError;
}
