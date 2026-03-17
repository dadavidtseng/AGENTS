/**
 * Unit Tests for Network Manager
 *
 * Tests Docker/Podman network creation, inspection, and management.
 *
 * @module tests/unit/network-manager
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  networkExists,
  getNetworkInfo,
  ensureNetwork,
  removeNetwork,
} from '../../src/targets/local/network-manager.js';
import {
  expectSuccess,
  expectFailure,
  expectErrorCode,
  expectSuggestion,
} from '../helpers/assertions.js';
import {
  mockCommandResponses,
  createMockCommandSuccess,
  createMockCommandFailure,
} from '../helpers/mocks.js';
import { networkNames } from '../helpers/fixtures.js';
import { success, failure } from '../../src/types/index.js';
import { DeploymentError } from '../../src/errors/index.js';
import * as commandRunner from '../../src/utils/command-runner.js';

describe('Network Manager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('networkExists', () => {
    it('should return true when network exists', async () => {
      vi.spyOn(commandRunner, 'runCommand').mockResolvedValue(
        success(
          createMockCommandSuccess(
            mockCommandResponses.networkInspectSuccess('kadi-net')
          )
        )
      );

      const result = await networkExists('docker', networkNames.default);

      expectSuccess(result);
      expect(result.data).toBe(true);
    });

    it('should return false when network does not exist', async () => {
      vi.spyOn(commandRunner, 'runCommand').mockResolvedValue(
        failure(
          new DeploymentError('Not found', 'COMMAND_FAILED', {
            stderr: mockCommandResponses.networkNotFound('nonexistent'),
          })
        )
      );

      const result = await networkExists('docker', 'nonexistent');

      expectSuccess(result);
      expect(result.data).toBe(false);
    });

    it('should distinguish not-found from other errors', async () => {
      // Non-404 error (e.g., permission denied)
      vi.spyOn(commandRunner, 'runCommand').mockResolvedValue(
        failure(
          new DeploymentError('Permission denied', 'COMMAND_FAILED', {
            stderr: 'permission denied',
          })
        )
      );

      const result = await networkExists('docker', 'test-net');

      expectFailure(result);
      expectErrorCode(result, 'NETWORK_CHECK_FAILED');
    });

    it('should handle network inspect command errors', async () => {
      vi.spyOn(commandRunner, 'runCommand').mockResolvedValue(
        failure(
          new DeploymentError('Docker not available', 'COMMAND_FAILED', {
            stderr: 'Cannot connect to Docker daemon',
          })
        )
      );

      const result = await networkExists('docker', 'test-net');

      expectFailure(result);
      expectErrorCode(result, 'NETWORK_CHECK_FAILED');
      expectSuggestion(result.error);
    });
  });

  describe('getNetworkInfo', () => {
    it('should return network information', async () => {
      const networkName = 'kadi-net';

      vi.spyOn(commandRunner, 'runCommand').mockResolvedValue(
        success(
          createMockCommandSuccess(
            mockCommandResponses.networkInspectSuccess(networkName)
          )
        )
      );

      const result = await getNetworkInfo('docker', networkName);

      expectSuccess(result);
      expect(result.data.id).toBe('abc123def456');
      expect(result.data.name).toBe(networkName);
      expect(result.data.driver).toBe('bridge');
      expect(result.data.preexisting).toBe(true);
    });

    it('should parse JSON response correctly', async () => {
      const customResponse = JSON.stringify([
        {
          Id: 'custom-id-123',
          Name: 'custom-network',
          Driver: 'overlay',
        },
      ]);

      vi.spyOn(commandRunner, 'runCommand').mockResolvedValue(
        success(createMockCommandSuccess(customResponse))
      );

      const result = await getNetworkInfo('docker', 'custom-network');

      expectSuccess(result);
      expect(result.data.id).toBe('custom-id-123');
      expect(result.data.driver).toBe('overlay');
    });

    it('should return failure for non-existent network', async () => {
      vi.spyOn(commandRunner, 'runCommand').mockResolvedValue(
        failure(
          new DeploymentError('Not found', 'COMMAND_FAILED', {
            stderr: mockCommandResponses.networkNotFound('nonexistent'),
          })
        )
      );

      const result = await getNetworkInfo('docker', 'nonexistent');

      expectFailure(result);
      expectErrorCode(result, 'NETWORK_NOT_FOUND');
      expectSuggestion(result.error, 'docker network create');
    });

    it('should handle malformed JSON response', async () => {
      vi.spyOn(commandRunner, 'runCommand').mockResolvedValue(
        success(createMockCommandSuccess('invalid json'))
      );

      const result = await getNetworkInfo('docker', 'test-net');

      expectFailure(result);
      expectErrorCode(result, 'NETWORK_PARSE_ERROR');
    });
  });

  describe('ensureNetwork', () => {
    it('should return existing network (idempotent)', async () => {
      const runCommandMock = vi.spyOn(commandRunner, 'runCommand');

      // network exists check
      runCommandMock.mockResolvedValueOnce(
        success(
          createMockCommandSuccess(
            mockCommandResponses.networkInspectSuccess('kadi-net')
          )
        )
      );

      // network info
      runCommandMock.mockResolvedValueOnce(
        success(
          createMockCommandSuccess(
            mockCommandResponses.networkInspectSuccess('kadi-net')
          )
        )
      );

      const result = await ensureNetwork('docker', 'kadi-net');

      expectSuccess(result);
      expect(result.data.preexisting).toBe(true);
      expect(result.data.name).toBe('kadi-net');
      // Should not call create command
      expect(runCommandMock).toHaveBeenCalledTimes(2);
    });

    it('should create network when it does not exist', async () => {
      const runCommandMock = vi.spyOn(commandRunner, 'runCommand');

      // network exists check - returns false
      runCommandMock.mockResolvedValueOnce(
        failure(
          new DeploymentError('Not found', 'COMMAND_FAILED', {
            stderr: mockCommandResponses.networkNotFound('new-net'),
          })
        )
      );

      // network create succeeds
      runCommandMock.mockResolvedValueOnce(
        success(createMockCommandSuccess(mockCommandResponses.networkCreateSuccess))
      );

      const result = await ensureNetwork('docker', 'new-net');

      expectSuccess(result);
      expect(result.data.preexisting).toBe(false);
      expect(result.data.name).toBe('new-net');
      expect(result.data.id).toBe(mockCommandResponses.networkCreateSuccess);
    });

    it('should handle "already exists" race condition', async () => {
      const runCommandMock = vi.spyOn(commandRunner, 'runCommand');

      // Exists check - returns false
      runCommandMock.mockResolvedValueOnce(
        failure(
          new DeploymentError('Not found', 'COMMAND_FAILED', {
            stderr: mockCommandResponses.networkNotFound('race-net'),
          })
        )
      );

      // Create fails with "already exists" (another process created it)
      runCommandMock.mockResolvedValueOnce(
        failure(
          new DeploymentError('Already exists', 'COMMAND_FAILED', {
            stderr: mockCommandResponses.networkAlreadyExists('race-net'),
          })
        )
      );

      // Get info succeeds
      runCommandMock.mockResolvedValueOnce(
        success(
          createMockCommandSuccess(
            mockCommandResponses.networkInspectSuccess('race-net')
          )
        )
      );

      const result = await ensureNetwork('docker', 'race-net');

      expectSuccess(result);
      expect(result.data.preexisting).toBe(true);
    });

    it('should support custom driver options', async () => {
      const runCommandMock = vi.spyOn(commandRunner, 'runCommand');

      // Network doesn't exist
      runCommandMock.mockResolvedValueOnce(
        failure(
          new DeploymentError('Not found', 'COMMAND_FAILED', {
            stderr: mockCommandResponses.networkNotFound('custom-net'),
          })
        )
      );

      // Create with custom driver
      runCommandMock.mockResolvedValueOnce(
        success(createMockCommandSuccess('network-id-123'))
      );

      await ensureNetwork('docker', 'custom-net', {
        driver: 'overlay',
        driverOpts: { 'com.docker.network.driver.mtu': '1450' },
      });

      // Verify create command includes driver options
      const createCall = runCommandMock.mock.calls[1][0];
      expect(createCall).toContain('--driver overlay');
      expect(createCall).toContain('--opt');
      expect(createCall).toContain('com.docker.network.driver.mtu=1450');
    });

    it('should support IPv6 option', async () => {
      const runCommandMock = vi.spyOn(commandRunner, 'runCommand');

      runCommandMock.mockResolvedValueOnce(
        failure(
          new DeploymentError('Not found', 'COMMAND_FAILED', {
            stderr: mockCommandResponses.networkNotFound('ipv6-net'),
          })
        )
      );

      runCommandMock.mockResolvedValueOnce(
        success(createMockCommandSuccess('network-id-456'))
      );

      await ensureNetwork('docker', 'ipv6-net', { ipv6: true });

      const createCall = runCommandMock.mock.calls[1][0];
      expect(createCall).toContain('--ipv6');
    });

    it('should return failure on creation error', async () => {
      const runCommandMock = vi.spyOn(commandRunner, 'runCommand');

      // Doesn't exist
      runCommandMock.mockResolvedValueOnce(
        failure(
          new DeploymentError('Not found', 'COMMAND_FAILED', {
            stderr: mockCommandResponses.networkNotFound('error-net'),
          })
        )
      );

      // Create fails with real error
      runCommandMock.mockResolvedValueOnce(
        failure(
          new DeploymentError('Permission denied', 'COMMAND_FAILED', {
            stderr: 'permission denied creating network',
          })
        )
      );

      const result = await ensureNetwork('docker', 'error-net');

      expectFailure(result);
      expectErrorCode(result, 'NETWORK_CREATE_FAILED');
      expectSuggestion(result.error);
    });

    it('should verify network after creation attempt', async () => {
      const runCommandMock = vi.spyOn(commandRunner, 'runCommand');

      // Doesn't exist
      runCommandMock.mockResolvedValueOnce(
        failure(
          new DeploymentError('Not found', 'COMMAND_FAILED', {
            stderr: mockCommandResponses.networkNotFound('verify-net'),
          })
        )
      );

      // Create succeeds
      runCommandMock.mockResolvedValueOnce(
        success(createMockCommandSuccess('new-network-id'))
      );

      const result = await ensureNetwork('docker', 'verify-net');

      expectSuccess(result);
      expect(result.data.id).toBe('new-network-id');
      expect(result.data.preexisting).toBe(false);
    });
  });

  describe('removeNetwork', () => {
    it('should remove network successfully', async () => {
      vi.spyOn(commandRunner, 'runCommand').mockResolvedValue(
        success(createMockCommandSuccess(''))
      );

      const result = await removeNetwork('docker', 'old-network');

      expectSuccess(result);
    });

    it('should return success if network already removed', async () => {
      vi.spyOn(commandRunner, 'runCommand').mockResolvedValue(
        failure(
          new DeploymentError('Not found', 'COMMAND_FAILED', {
            stderr: mockCommandResponses.networkNotFound('removed-net'),
          })
        )
      );

      const result = await removeNetwork('docker', 'removed-net');

      // Not found is success for removal
      expectSuccess(result);
    });

    it('should return failure if network is in use', async () => {
      vi.spyOn(commandRunner, 'runCommand').mockResolvedValue(
        failure(
          new DeploymentError('In use', 'COMMAND_FAILED', {
            stderr: mockCommandResponses.networkInUse('busy-net'),
          })
        )
      );

      const result = await removeNetwork('docker', 'busy-net');

      expectFailure(result);
      expectErrorCode(result, 'NETWORK_IN_USE');
      expectSuggestion(result.error, 'Stop all containers');
    });

    it('should handle removal errors', async () => {
      vi.spyOn(commandRunner, 'runCommand').mockResolvedValue(
        failure(
          new DeploymentError('Permission denied', 'COMMAND_FAILED', {
            stderr: 'permission denied',
          })
        )
      );

      const result = await removeNetwork('docker', 'protected-net');

      expectFailure(result);
      expectErrorCode(result, 'NETWORK_REMOVE_FAILED');
    });
  });
});
