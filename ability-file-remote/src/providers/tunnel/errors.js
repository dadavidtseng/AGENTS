/**
 * @fileoverview Error classes for tunnel operations
 * Based on TunnelRefactorErrorHandling.md specification
 */

/**
 * Base class for all tunnel-related errors
 */
export class TunnelError extends Error {
  constructor(message, originalError = null, code = null) {
    super(message);
    this.name = 'TunnelError';
    this.originalError = originalError;
    this.code = code;
    this.timestamp = new Date().toISOString();
  }
}

/**
 * Transient errors that should trigger fallback to other services
 * Examples: connection timeouts, network unreachable, temporary service unavailability
 */
export class TransientTunnelError extends TunnelError {
  constructor(message, originalError = null, code = null) {
    super(message, originalError, code);
    this.name = 'TransientTunnelError';
    this.isTransient = true;
    this.shouldFallback = true;
  }
}

/**
 * Permanent errors that should NOT trigger fallback
 * Examples: SSH not available, invalid configuration, permission denied
 */
export class PermanentTunnelError extends TunnelError {
  constructor(message, originalError = null, code = null) {
    super(message, originalError, code);
    this.name = 'PermanentTunnelError';
    this.isTransient = false;
    this.shouldFallback = false;
  }
}

/**
 * Critical errors that should stop all operations
 * Examples: system resource exhaustion, security violations, corrupted configuration
 */
export class CriticalTunnelError extends TunnelError {
  constructor(message, originalError = null, code = null) {
    super(message, originalError, code);
    this.name = 'CriticalTunnelError';
    this.isTransient = false;
    this.shouldFallback = false;
    this.isCritical = true;
  }
}

/**
 * Configuration validation error
 */
export class ConfigurationError extends PermanentTunnelError {
  constructor(message, field = null, value = null) {
    super(message);
    this.name = 'ConfigurationError';
    this.field = field;
    this.value = value;
  }
}

/**
 * Service not available error
 */
export class ServiceUnavailableError extends TransientTunnelError {
  constructor(service, message = null) {
    super(message || `Service ${service} is not available`);
    this.name = 'ServiceUnavailableError';
    this.service = service;
  }
}

/**
 * Connection timeout error
 */
export class ConnectionTimeoutError extends TransientTunnelError {
  constructor(service, timeout = 30000) {
    super(`Connection to ${service} timed out after ${timeout}ms`);
    this.name = 'ConnectionTimeoutError';
    this.service = service;
    this.timeout = timeout;
  }
}

/**
 * SSH not available error
 */
export class SSHUnavailableError extends PermanentTunnelError {
  constructor() {
    super('SSH command not found in system PATH. SSH is required for tunnel services.');
    this.name = 'SSHUnavailableError';
    this.code = 'SSH_MISSING';
  }
}

/**
 * Authentication failed error
 */
export class AuthenticationFailedError extends PermanentTunnelError {
  constructor(service, message = null) {
    super(message || `Authentication failed for ${service}`);
    this.name = 'AuthenticationFailedError';
    this.service = service;
    this.code = 'AUTH_FAILED';
  }
}
