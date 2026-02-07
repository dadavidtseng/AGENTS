/**
 * Unit Tests for Engine Manager
 *
 * Tests container engine (Docker/Podman) verification, auto-start,
 * and version detection functionality.
 *
 * @module tests/unit/engine-manager
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  checkEngineRunning,
  ensureEngineRunning,
  getEngineVersion,
  type EngineInfo,
} from '../../src/targets/local/engine-manager.js';
import { DeploymentError } from '../../src/errors/index.js';
import {
  expectSuccess,
  expectFailure,
  expectErrorCode,
  expectSuggestion,
  expectProperties,
} from '../helpers/assertions.js';
import {
  mockCommandResponses,
  createMockCommandSuccess,
  createMockCommandFailure,
} from '../helpers/mocks.js';
import { success, failure } from '../../src/types/index.js';
import * as commandRunner from '../../src/utils/command-runner.js';

describe('Engine Manager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('checkEngineRunning', () => {
    it('should return success when Docker is running', async () => {
      // Mock successful docker info command
      vi.spyOn(commandRunner, 'runCommand').mockResolvedValue(
        success(createMockCommandSuccess(mockCommandResponses.dockerInfoSuccess))
      );

      const result = await checkEngineRunning('docker');

      expectSuccess(result);
      expect(result.data.engine).toBe('docker');
      expect(result.data.running).toBe(true);
      expect(result.data.version).toBe('24.0.7');
      expect(result.data.autoStarted).toBe(false);
      expect(result.data.platform).toBeDefined();
    });

    it('should return success when Podman is running', async () => {
      vi.spyOn(commandRunner, 'runCommand').mockResolvedValue(
        success(createMockCommandSuccess(mockCommandResponses.podmanInfoSuccess))
      );

      const result = await checkEngineRunning('podman');

      expectSuccess(result);
      expect(result.data.engine).toBe('podman');
      expect(result.data.running).toBe(true);
      expect(result.data.version).toBe('4.8.0');
      expect(result.data.autoStarted).toBe(false);
    });

    it('should return failure when Docker is not running', async () => {
      const mockError = new DeploymentError(
        'Docker is not running',
        'COMMAND_FAILED',
        { stderr: mockCommandResponses.dockerNotRunning }
      );

      vi.spyOn(commandRunner, 'runCommand').mockResolvedValue(failure(mockError));

      const result = await checkEngineRunning('docker');

      expectFailure(result);
      expectErrorCode(result, 'ENGINE_NOT_RUNNING');
      expectSuggestion(result.error, 'Docker Desktop');
    });

    it('should return failure when Podman is not running', async () => {
      const mockError = new DeploymentError(
        'Podman not running',
        'COMMAND_FAILED',
        { stderr: mockCommandResponses.podmanSocketError }
      );

      vi.spyOn(commandRunner, 'runCommand').mockResolvedValue(failure(mockError));

      const result = await checkEngineRunning('podman');

      expectFailure(result);
      expectErrorCode(result, 'ENGINE_NOT_RUNNING');
      expectSuggestion(result.error, 'podman machine start');
    });

    it('should handle invalid JSON in info response', async () => {
      vi.spyOn(commandRunner, 'runCommand').mockResolvedValue(
        success(createMockCommandSuccess('invalid json'))
      );

      const result = await checkEngineRunning('docker');

      // Should still succeed, just without version info
      expectSuccess(result);
      expect(result.data.running).toBe(true);
      expect(result.data.version).toBeUndefined();
    });

    it('should respect timeout option', async () => {
      const runCommandSpy = vi
        .spyOn(commandRunner, 'runCommand')
        .mockResolvedValue(
          success(createMockCommandSuccess(mockCommandResponses.dockerInfoSuccess))
        );

      await checkEngineRunning('docker', { timeout: 5000 });

      expect(runCommandSpy).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ timeout: 5000 })
      );
    });
  });

  describe('ensureEngineRunning', () => {
    it('should return existing engine if already running', async () => {
      vi.spyOn(commandRunner, 'runCommand').mockResolvedValue(
        success(createMockCommandSuccess(mockCommandResponses.dockerInfoSuccess))
      );

      const result = await ensureEngineRunning('docker');

      expectSuccess(result);
      expect(result.data.running).toBe(true);
      expect(result.data.autoStarted).toBe(false);
    });

    it('should auto-start Podman VM when not running', async () => {
      const runCommandMock = vi.spyOn(commandRunner, 'runCommand');

      // First call: podman info fails with connection error
      runCommandMock.mockResolvedValueOnce(
        failure(
          new DeploymentError(
            mockCommandResponses.podmanSocketError, // Error message must contain connection keywords
            'COMMAND_FAILED',
            { stderr: mockCommandResponses.podmanSocketError }
          )
        )
      );

      // Second call: podman machine start succeeds
      runCommandMock.mockResolvedValueOnce(
        success(
          createMockCommandSuccess(mockCommandResponses.podmanMachineStartSuccess)
        )
      );

      // Third call: podman info succeeds (wait for socket in startPodmanVM)
      runCommandMock.mockResolvedValueOnce(
        success(createMockCommandSuccess(mockCommandResponses.podmanInfoSuccess))
      );

      // Fourth call: podman info succeeds (final verification)
      runCommandMock.mockResolvedValueOnce(
        success(createMockCommandSuccess(mockCommandResponses.podmanInfoSuccess))
      );

      const result = await ensureEngineRunning('podman', { autoStart: true });

      expectSuccess(result);
      expect(result.data.running).toBe(true);
      expect(result.data.autoStarted).toBe(true);
      expect(runCommandMock).toHaveBeenCalledTimes(4);
    });

    it('should return failure for Docker when not running (cannot auto-start)', async () => {
      const mockError = new DeploymentError(
        'Docker not running',
        'COMMAND_FAILED',
        { stderr: mockCommandResponses.dockerNotRunning }
      );

      vi.spyOn(commandRunner, 'runCommand').mockResolvedValue(failure(mockError));

      const result = await ensureEngineRunning('docker', { autoStart: true });

      expectFailure(result);
      expectErrorCode(result, 'ENGINE_NOT_RUNNING');
      expectSuggestion(result.error, 'Docker Desktop');
    });

    it('should respect autoStart=false option', async () => {
      const runCommandMock = vi.spyOn(commandRunner, 'runCommand');

      runCommandMock.mockResolvedValue(
        failure(
          new DeploymentError('Not running', 'COMMAND_FAILED', {
            error: mockCommandResponses.podmanSocketError,
          })
        )
      );

      const result = await ensureEngineRunning('podman', { autoStart: false });

      expectFailure(result);
      // Should only call podman info once, not attempt to start
      expect(runCommandMock).toHaveBeenCalledTimes(1);
    });

    it('should handle Podman machine start failure', async () => {
      const runCommandMock = vi.spyOn(commandRunner, 'runCommand');

      // First call: podman info fails with connection error
      runCommandMock.mockResolvedValueOnce(
        failure(
          new DeploymentError(
            mockCommandResponses.podmanSocketError, // Error message must contain connection keywords
            'COMMAND_FAILED',
            { stderr: mockCommandResponses.podmanSocketError }
          )
        )
      );

      // Second call: podman machine start fails
      runCommandMock.mockResolvedValueOnce(
        failure(
          new DeploymentError('Start failed', 'COMMAND_FAILED', {
            stderr: 'machine not initialized',
          })
        )
      );

      const result = await ensureEngineRunning('podman');

      expectFailure(result);
      expectErrorCode(result, 'PODMAN_VM_START_FAILED');
      expectSuggestion(result.error, 'podman machine init');
    });

    it('should distinguish connection errors from other errors', async () => {
      const runCommandMock = vi.spyOn(commandRunner, 'runCommand');

      // Non-connection error (e.g., permission denied)
      runCommandMock.mockResolvedValue(
        failure(
          new DeploymentError('Permission denied', 'COMMAND_FAILED', {
            error: 'permission denied accessing podman',
          })
        )
      );

      const result = await ensureEngineRunning('podman');

      expectFailure(result);
      expectErrorCode(result, 'ENGINE_NOT_RUNNING');
      // Should not attempt auto-start for non-connection errors
      expect(runCommandMock).toHaveBeenCalledTimes(1);
    });

    it('should verify engine is running after successful auto-start', async () => {
      const runCommandMock = vi.spyOn(commandRunner, 'runCommand');

      // Initial check: not running (connection error)
      runCommandMock.mockResolvedValueOnce(
        failure(
          new DeploymentError(
            mockCommandResponses.podmanSocketError, // Error message must contain connection keywords
            'COMMAND_FAILED',
            { stderr: mockCommandResponses.podmanSocketError }
          )
        )
      );

      // Start command succeeds
      runCommandMock.mockResolvedValueOnce(
        success(
          createMockCommandSuccess(mockCommandResponses.podmanMachineStartSuccess)
        )
      );

      // Wait for socket check: still not available (edge case)
      runCommandMock.mockResolvedValueOnce(
        failure(
          new DeploymentError('Still not running', 'COMMAND_FAILED', {
            error: 'socket unavailable',
          })
        )
      );

      const result = await ensureEngineRunning('podman');

      expectFailure(result);
      expect(runCommandMock).toHaveBeenCalledTimes(3);
    });
  });

  describe('getEngineVersion', () => {
    it('should extract version from running Docker', async () => {
      vi.spyOn(commandRunner, 'runCommand').mockResolvedValue(
        success(createMockCommandSuccess(mockCommandResponses.dockerInfoSuccess))
      );

      const result = await getEngineVersion('docker');

      expectSuccess(result);
      expect(result.data).toBe('24.0.7');
    });

    it('should extract version from running Podman', async () => {
      vi.spyOn(commandRunner, 'runCommand').mockResolvedValue(
        success(createMockCommandSuccess(mockCommandResponses.podmanInfoSuccess))
      );

      const result = await getEngineVersion('podman');

      expectSuccess(result);
      expect(result.data).toBe('4.8.0');
    });

    it('should return failure when engine is not running', async () => {
      const mockError = new DeploymentError('Not running', 'COMMAND_FAILED', {});

      vi.spyOn(commandRunner, 'runCommand').mockResolvedValue(failure(mockError));

      const result = await getEngineVersion('docker');

      expectFailure(result);
    });

    it('should return failure when version is unavailable', async () => {
      // Info succeeds but no version field
      vi.spyOn(commandRunner, 'runCommand').mockResolvedValue(
        success(createMockCommandSuccess('{}'))
      );

      const result = await getEngineVersion('docker');

      expectFailure(result);
      expectErrorCode(result, 'ENGINE_VERSION_UNKNOWN');
    });
  });

  describe('EngineInfo structure', () => {
    it('should have all required fields', async () => {
      vi.spyOn(commandRunner, 'runCommand').mockResolvedValue(
        success(createMockCommandSuccess(mockCommandResponses.dockerInfoSuccess))
      );

      const result = await checkEngineRunning('docker');

      expectSuccess(result);
      expectProperties(result.data, ['engine', 'running', 'autoStarted']);
    });

    it('should have optional version and platform fields', async () => {
      vi.spyOn(commandRunner, 'runCommand').mockResolvedValue(
        success(createMockCommandSuccess(mockCommandResponses.dockerInfoSuccess))
      );

      const result = await checkEngineRunning('docker');

      expectSuccess(result);
      expect(result.data).toHaveProperty('version');
      expect(result.data).toHaveProperty('platform');
    });
  });
});
