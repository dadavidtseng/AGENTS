/**
 * @fileoverview Base git provider with shared functionality
 * @module services/git/core/BaseGitProvider
 */

import { JsonRpcErrorCode, McpError } from '@/types-global/errors.js';
import { logger, type RequestContext } from '@/utils/index.js';

import type { GitOperationContext, GitProviderCapabilities } from '../types.js';

/**
 * Abstract base class for git providers.
 *
 * Provides common functionality:
 * - Error transformation to McpError
 * - Logging with context
 * - Capability checking
 * - Validation helpers
 * - Context management
 *
 * Subclasses must implement all IGitProvider methods.
 *
 * @abstract
 */
export abstract class BaseGitProvider {
  abstract readonly name: string;
  abstract readonly version: string;
  abstract readonly capabilities: GitProviderCapabilities;

  /**
   * Check provider health.
   * @param context - Operation context
   * @returns True if provider is healthy
   */
  abstract healthCheck(context: GitOperationContext): Promise<boolean>;

  /**
   * Check if the provider supports a specific capability.
   *
   * @param capability - Capability to check (e.g., 'blame', 'reflog')
   * @throws McpError if capability is not supported
   */
  protected checkCapability(capability: keyof GitProviderCapabilities): void {
    if (!this.capabilities[capability]) {
      throw new McpError(
        JsonRpcErrorCode.MethodNotFound,
        `Git operation '${capability}' is not supported by provider '${this.name}'`,
      );
    }
  }

  /**
   * Log the start of a git operation.
   *
   * @param operation - Operation name
   * @param context - Operation context
   * @param options - Operation options (will be logged)
   */
  protected logOperationStart(
    operation: string,
    context: GitOperationContext,
    options?: unknown,
  ): void {
    logger.debug(`Starting git ${operation}`, {
      ...context.requestContext,
      provider: this.name,
      workingDirectory: context.workingDirectory,
      ...(context.tenantId && { tenantId: context.tenantId }),
      options,
    });
  }

  /**
   * Log the successful completion of a git operation.
   *
   * @param operation - Operation name
   * @param context - Operation context
   * @param result - Operation result (summary only, avoid large data)
   */
  protected logOperationSuccess(
    operation: string,
    context: GitOperationContext,
    result?: Record<string, unknown>,
  ): void {
    logger.info(`Git ${operation} completed successfully`, {
      ...context.requestContext,
      provider: this.name,
      workingDirectory: context.workingDirectory,
      ...(context.tenantId && { tenantId: context.tenantId }),
      result,
    });
  }

  /**
   * Validate that a working directory exists and is a git repository.
   *
   * @param workingDirectory - Directory path to validate
   * @param context - Request context for logging
   * @throws McpError if validation fails
   */
  protected validateWorkingDirectory(
    workingDirectory: string,
    context: RequestContext,
  ): void {
    // This is a base implementation - providers can override with more robust checks
    if (!workingDirectory || workingDirectory.trim() === '') {
      throw new McpError(
        JsonRpcErrorCode.InvalidRequest,
        'Working directory must be specified',
      );
    }

    logger.debug('Validating working directory', {
      ...context,
      workingDirectory,
    });
  }

  /**
   * Create a standardized operation context.
   *
   * @param requestContext - Request context
   * @param workingDirectory - Working directory path
   * @param tenantId - Optional tenant ID
   * @returns Git operation context
   */
  protected createOperationContext(
    requestContext: RequestContext,
    workingDirectory: string,
    tenantId?: string,
  ): GitOperationContext {
    const context: GitOperationContext = {
      requestContext,
      workingDirectory,
    };

    const finalTenantId = tenantId || requestContext.tenantId;
    if (finalTenantId) {
      context.tenantId = finalTenantId;
    }

    return context;
  }

  /**
   * Extract error message from unknown error.
   *
   * @param error - Error to extract message from
   * @returns Error message string
   */
  protected extractErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  }

  /**
   * Check if an error indicates a missing git installation.
   *
   * @param error - Error to check
   * @returns True if error indicates missing git
   */
  protected isGitNotFoundError(error: unknown): boolean {
    const message = this.extractErrorMessage(error).toLowerCase();
    return (
      message.includes('git') &&
      (message.includes('not found') ||
        message.includes('enoent') ||
        message.includes('command not found'))
    );
  }
}
