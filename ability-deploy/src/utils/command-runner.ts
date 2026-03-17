/**
 * Command execution utilities
 *
 * Provides type-safe command execution with Result types,
 * timeout support, and proper error handling.
 *
 * @module utils/command-runner
 */

import { spawn } from 'node:child_process';
import debug from 'debug';
import { type Result, success, failure } from '../types/index.js';
import { DeploymentError } from '../errors/index.js';

/**
 * Debug logger for command execution
 */
const log = debug('deploy-ability:command');

/**
 * Options for command execution
 */
export interface CommandOptions {
  /**
   * Working directory for command execution
   */
  readonly cwd?: string;

  /**
   * Environment variables to set
   */
  readonly env?: Record<string, string>;

  /**
   * Timeout in milliseconds
   * @default 120000 (2 minutes)
   */
  readonly timeout?: number;

  /**
   * Silent mode - capture output instead of streaming
   * @default false
   */
  readonly silent?: boolean;

  /**
   * Abort signal for cancellation
   */
  readonly signal?: AbortSignal;
}

/**
 * Command execution result data
 */
export interface CommandResult {
  /**
   * Standard output from the command
   */
  readonly stdout: string;

  /**
   * Standard error output from the command
   */
  readonly stderr: string;

  /**
   * Exit code
   */
  readonly exitCode: number;

  /**
   * Execution time in milliseconds
   */
  readonly duration: number;
}

/**
 * Execute a shell command with proper error handling
 *
 * Returns a Result type instead of throwing, making error handling explicit
 * and type-safe.
 *
 * @param command - Command to execute
 * @param options - Execution options
 * @returns Result with command output or error
 *
 * @example
 * ```typescript
 * const result = await runCommand('docker version', { silent: true });
 *
 * if (result.success) {
 *   console.log('Docker version:', result.data.stdout);
 * } else {
 *   console.error('Command failed:', result.error.message);
 * }
 * ```
 *
 * @example With timeout and abort
 * ```typescript
 * const controller = new AbortController();
 * setTimeout(() => controller.abort(), 5000);
 *
 * const result = await runCommand('long-running-command', {
 *   timeout: 10000,
 *   signal: controller.signal
 * });
 * ```
 */
export async function runCommand(
  command: string,
  options: CommandOptions = {}
): Promise<Result<CommandResult, DeploymentError>> {
  const {
    cwd,
    env,
    timeout = 120_000,
    silent = false,
    signal,
  } = options;

  log('Executing command: %s', command);
  if (cwd) log('Working directory: %s', cwd);
  if (timeout) log('Timeout: %dms', timeout);

  const startTime = Date.now();

  return new Promise((resolve) => {
    // Check if already aborted
    if (signal?.aborted) {
      resolve(
        failure(
          new DeploymentError(
            'Command execution was cancelled',
            'COMMAND_CANCELLED',
            { command },
            false,
            undefined,
            'warning'
          )
        )
      );
      return;
    }

    const child = spawn(command, {
      cwd,
      env: env ? { ...process.env, ...env } : undefined,
      shell: true,
      stdio: silent ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    });

    let stdout = '';
    let stderr = '';
    let timeoutId: NodeJS.Timeout | undefined;
    let killed = false;

    // Capture output if in silent mode
    if (silent) {
      child.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });

      child.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });
    }

    // Setup timeout
    if (timeout > 0) {
      timeoutId = setTimeout(() => {
        if (!killed) {
          log('Command timed out after %dms: %s', timeout, command);
          killed = true;
          child.kill('SIGTERM');

          // Force kill after 5 seconds if still running
          setTimeout(() => {
            if (!child.killed) {
              child.kill('SIGKILL');
            }
          }, 5000);
        }
      }, timeout);
    }

    // Setup abort signal handler
    const abortHandler = () => {
      if (!killed && !child.killed) {
        log('Command aborted: %s', command);
        killed = true;
        child.kill('SIGTERM');

        setTimeout(() => {
          if (!child.killed) {
            child.kill('SIGKILL');
          }
        }, 5000);
      }
    };

    signal?.addEventListener('abort', abortHandler);

    // Handle process errors
    child.on('error', (error: Error) => {
      if (timeoutId) clearTimeout(timeoutId);
      signal?.removeEventListener('abort', abortHandler);

      log('Command error: %s', error.message);

      resolve(
        failure(
          new DeploymentError(
            `Failed to execute command: ${error.message}`,
            'COMMAND_EXECUTION_ERROR',
            { command, error: error.message },
            true,
            'Check that the command exists and is executable',
            'error',
            error
          )
        )
      );
    });

    // Handle process exit
    child.on('close', (exitCode) => {
      if (timeoutId) clearTimeout(timeoutId);
      signal?.removeEventListener('abort', abortHandler);

      const duration = Date.now() - startTime;
      log('Command completed in %dms with exit code %d', duration, exitCode);

      // Handle timeout
      if (killed && signal?.aborted) {
        resolve(
          failure(
            new DeploymentError(
              'Command execution was cancelled',
              'COMMAND_CANCELLED',
              { command, duration },
              false,
              undefined,
              'warning'
            )
          )
        );
        return;
      }

      if (killed) {
        resolve(
          failure(
            new DeploymentError(
              `Command timed out after ${timeout}ms`,
              'COMMAND_TIMEOUT',
              { command, timeout, duration },
              true,
              'Try increasing the timeout or check if the command is hanging',
              'error'
            )
          )
        );
        return;
      }

      // Success case
      if (exitCode === 0) {
        resolve(
          success({
            stdout,
            stderr,
            exitCode: 0,
            duration,
          })
        );
        return;
      }

      // Non-zero exit code
      resolve(
        failure(
          new DeploymentError(
            `Command failed with exit code ${exitCode}`,
            'COMMAND_FAILED',
            {
              command,
              exitCode,
              stdout: silent ? stdout : undefined,
              stderr: silent ? stderr : undefined,
              duration,
            },
            true,
            'Check command output for error details',
            'error'
          )
        )
      );
    });
  });
}

/**
 * Execute a command and return only stdout
 *
 * Convenience wrapper that throws on error and returns just the stdout string
 *
 * @param command - Command to execute
 * @param options - Execution options
 * @returns Standard output from the command
 * @throws {DeploymentError} If command fails
 *
 * @example
 * ```typescript
 * try {
 *   const version = await runCommandSimple('docker --version', { silent: true });
 *   console.log(version);
 * } catch (error) {
 *   console.error('Failed:', error.message);
 * }
 * ```
 */
export async function runCommandSimple(
  command: string,
  options: CommandOptions = {}
): Promise<string> {
  const result = await runCommand(command, { ...options, silent: true });

  if (result.success) {
    return result.data.stdout.trim();
  }

  throw result.error;
}

/**
 * Check if a command exists in the system PATH
 *
 * @param command - Command name to check
 * @returns True if command exists
 *
 * @example
 * ```typescript
 * const hasDocker = await commandExists('docker');
 * if (!hasDocker) {
 *   console.error('Docker is not installed');
 * }
 * ```
 */
export async function commandExists(command: string): Promise<boolean> {
  // Validate command is not empty
  if (!command || command.trim().length === 0) {
    log('Command is empty, returning false');
    return false;
  }

  const checkCommand =
    process.platform === 'win32'
      ? `where ${command}`
      : `command -v ${command}`;

  const result = await runCommand(checkCommand, { silent: true });
  return result.success;
}
