/**
 * Test Mocking Utilities
 *
 * Provides mock implementations for external dependencies used in tests.
 * This allows us to test our code in isolation without relying on actual
 * Docker/Podman installations or file system operations.
 *
 * @module tests/helpers/mocks
 */

import { vi } from 'vitest';
import type { CommandResult } from '../../src/utils/command-runner.js';

/**
 * Mock command responses for Docker/Podman operations
 *
 * These represent typical outputs from container engine commands,
 * allowing us to simulate various scenarios without running actual commands.
 */
export const mockCommandResponses = {
  /**
   * Successful docker info response with version
   */
  dockerInfoSuccess: JSON.stringify({
    ServerVersion: '24.0.7',
    OperatingSystem: 'Docker Desktop',
    OSType: 'linux',
    Architecture: 'x86_64',
    host: {
      os: 'darwin',
      arch: 'x86_64',
    },
    version: {
      Version: '24.0.7',
    },
  }),

  /**
   * Successful podman info response
   */
  podmanInfoSuccess: JSON.stringify({
    Version: '4.8.0',
    host: {
      os: 'darwin',
      arch: 'arm64',
    },
  }),

  /**
   * Docker not running error message
   */
  dockerNotRunning: 'Cannot connect to the Docker daemon',

  /**
   * Podman socket unreachable error
   */
  podmanSocketError: 'cannot connect to podman socket',

  /**
   * Podman machine start success
   */
  podmanMachineStartSuccess: 'Machine "podman-machine-default" started successfully',

  /**
   * Network inspect success response
   */
  networkInspectSuccess: (networkName: string) =>
    JSON.stringify([
      {
        Id: 'abc123def456',
        Name: networkName,
        Driver: 'bridge',
        Scope: 'local',
        IPAM: {
          Driver: 'default',
          Config: [
            {
              Subnet: '172.20.0.0/16',
              Gateway: '172.20.0.1',
            },
          ],
        },
      },
    ]),

  /**
   * Network not found error
   */
  networkNotFound: (networkName: string) =>
    `Error: network ${networkName} not found`,

  /**
   * Network already exists error
   */
  networkAlreadyExists: (networkName: string) =>
    `Error response from daemon: network with name ${networkName} already exists`,

  /**
   * Network in use error (can't remove)
   */
  networkInUse: (networkName: string) =>
    `Error response from daemon: network ${networkName} has active endpoints`,

  /**
   * Successful network creation
   */
  networkCreateSuccess: 'abc123def456789',

  /**
   * Successful compose up
   */
  composeUpSuccess: `Container kadi-gateway  Created
Container kadi-database  Created
Container kadi-gateway  Started
Container kadi-database  Started`,

  /**
   * Compose up failure (image not found)
   */
  composeUpImageNotFound: 'Error response from daemon: pull access denied for nonexistent-image',

  /**
   * Command not found error
   */
  commandNotFound: (command: string) => `${command}: command not found`,
};

/**
 * Creates a mock successful command result
 *
 * @param stdout - Standard output string
 * @param stderr - Standard error string (default empty)
 * @param duration - Execution duration in ms (default 100)
 * @returns Mock CommandResult
 */
export function createMockCommandSuccess(
  stdout: string,
  stderr: string = '',
  duration: number = 100
): CommandResult {
  return {
    stdout,
    stderr,
    exitCode: 0,
    duration,
  };
}

/**
 * Creates a mock failed command result
 *
 * @param stderr - Error message
 * @param exitCode - Exit code (default 1)
 * @param duration - Execution duration in ms (default 50)
 * @returns Mock CommandResult
 */
export function createMockCommandFailure(
  stderr: string,
  exitCode: number = 1,
  duration: number = 50
): CommandResult {
  return {
    stdout: '',
    stderr,
    exitCode,
    duration,
  };
}

/**
 * Mock file system operations
 *
 * Provides in-memory file system for testing without touching real disk.
 */
export class MockFileSystem {
  private files: Map<string, string> = new Map();

  /**
   * Mock fs.promises.readFile
   */
  readFile = vi.fn(async (path: string): Promise<string> => {
    const content = this.files.get(path);
    if (!content) {
      throw Object.assign(new Error(`ENOENT: no such file or directory, open '${path}'`), {
        code: 'ENOENT',
      });
    }
    return content;
  });

  /**
   * Mock fs.promises.writeFile
   */
  writeFile = vi.fn(async (path: string, content: string): Promise<void> => {
    this.files.set(path, content);
  });

  /**
   * Mock fs.existsSync
   */
  existsSync = vi.fn((path: string): boolean => {
    return this.files.has(path);
  });

  /**
   * Add a file to the mock file system
   */
  addFile(path: string, content: string): void {
    this.files.set(path, content);
  }

  /**
   * Get file content from mock file system
   */
  getFile(path: string): string | undefined {
    return this.files.get(path);
  }

  /**
   * Check if file exists in mock file system
   */
  hasFile(path: string): boolean {
    return this.files.has(path);
  }

  /**
   * Clear all files
   */
  clear(): void {
    this.files.clear();
    this.readFile.mockClear();
    this.writeFile.mockClear();
    this.existsSync.mockClear();
  }

  /**
   * Get all file paths
   */
  getAllPaths(): string[] {
    return Array.from(this.files.keys());
  }
}

/**
 * Mock process.platform for cross-platform testing
 *
 * @param platform - Platform to mock ('darwin', 'linux', 'win32')
 * @returns Cleanup function to restore original platform
 */
export function mockPlatform(platform: NodeJS.Platform): () => void {
  const originalPlatform = process.platform;

  Object.defineProperty(process, 'platform', {
    value: platform,
    writable: true,
    configurable: true,
  });

  return () => {
    Object.defineProperty(process, 'platform', {
      value: originalPlatform,
      writable: true,
      configurable: true,
    });
  };
}

/**
 * Creates a mock abort controller that's already aborted
 *
 * Useful for testing timeout/cancellation scenarios
 */
export function createAbortedController(): AbortController {
  const controller = new AbortController();
  controller.abort();
  return controller;
}

/**
 * Creates a spy on console methods for testing logger output
 *
 * @returns Object with spy functions and cleanup
 */
export function mockConsole() {
  const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});

  return {
    log: logSpy,
    error: errorSpy,
    warn: warnSpy,
    debug: debugSpy,
    restore: () => {
      logSpy.mockRestore();
      errorSpy.mockRestore();
      warnSpy.mockRestore();
      debugSpy.mockRestore();
    },
  };
}

/**
 * Sleep utility for async testing
 *
 * @param ms - Milliseconds to sleep
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
