/**
 * Integration Tests for Local Deployment
 *
 * These tests verify that the deployment orchestration workflow coordinates
 * all components correctly. We mock the internal modules (not external commands)
 * to test ONLY the orchestration logic in deployLocal().
 *
 * What we're testing:
 * - deployLocal() calls the right functions in the right order
 * - Configuration options are passed through correctly
 * - Errors are handled and transformed appropriately
 * - The final result has the expected structure
 *
 * What we're NOT testing:
 * - Actual Docker commands (tested in engine-manager.test.ts)
 * - Compose file generation (tested in compose-generator.test.ts)
 * - File I/O operations (not our concern in integration tests)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { deployLocal } from '../../src/targets/local/deployer.js';
import { success, failure } from '../../src/types/index.js';
import { DeploymentError } from '../../src/errors/index.js';

// Mock all the modules that deployLocal uses
vi.mock('../../src/utils/profile-loader.js');
vi.mock('../../src/targets/local/engine-manager.js');
vi.mock('../../src/targets/local/network-manager.js');
vi.mock('../../src/targets/local/compose-generator.js');
vi.mock('../../src/utils/command-runner.js');

// Mock fs with default export (deployer.ts uses: import fs from 'node:fs/promises')
vi.mock('node:fs/promises', () => ({
  default: {
    writeFile: vi.fn(),
  }
}));

// Sample test data
const mockProfile = {
  name: 'local-dev',
  profile: {
    target: 'local' as const,
    engine: 'docker' as const,
    services: {
      gateway: {
        image: 'test-gateway:latest',
        env: ['PORT=3000'],
        expose: [{ port: 3000, as: 8080, to: ['local'] }],
      },
      database: {
        image: 'postgres:15',
        env: ['POSTGRES_PASSWORD=secret'],
      },
    },
  },
  agent: {
    name: 'test-agent',
    version: '1.0.0',
  },
};

const mockComposeYaml = `
version: "3.9"
services:
  gateway:
    image: test-gateway:latest
    container_name: kadi-gateway
    environment:
      PORT: "3000"
    ports:
      - "8080:3000"
networks:
  kadi-net:
    driver: bridge
`;

describe('Local Deployment Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Successful Deployment', () => {
    it('should coordinate all components for a successful deployment', async () => {
      // Setup mocks for a successful flow
      const { loadProfile } = await import('../../src/utils/profile-loader.js');
      const { ensureEngineRunning } = await import('../../src/targets/local/engine-manager.js');
      const { ensureNetwork } = await import('../../src/targets/local/network-manager.js');
      const { generateComposeYAML } = await import('../../src/targets/local/compose-generator.js');
      const fs = await import('node:fs/promises');

      vi.mocked(loadProfile).mockResolvedValue(mockProfile);
      vi.mocked(ensureEngineRunning).mockResolvedValue(
        success({
          engine: 'docker',
          running: true,
          autoStarted: false,
          version: '24.0.7'
        })
      );
      vi.mocked(ensureNetwork).mockResolvedValue(
        success({
          name: 'kadi-net',
          created: false,
          driver: 'bridge'
        })
      );
      vi.mocked(generateComposeYAML).mockReturnValue(
        success(mockComposeYaml)
      );
      vi.mocked(fs.default.writeFile).mockResolvedValue(undefined);

      // Mock the final docker compose up command
      const { runCommand } = await import('../../src/utils/command-runner.js');
      vi.mocked(runCommand).mockResolvedValue(
        success({
          stdout: 'Containers started',
          stderr: '',
          exitCode: 0
        })
      );

      // Execute deployment
      const result = await deployLocal({
        projectRoot: '/test/project',
        profile: 'local-dev',
      });

      // Verify success
      expect(result.success).toBe(true);
      if (!result.success) throw new Error('Expected success');

      // Verify the deployment result structure
      expect(result.data.profile).toBe('local-dev');
      expect(result.data.engine).toBe('docker');
      expect(result.data.network).toBe('kadi-net');
      expect(result.data.services).toEqual(['gateway', 'database']);
      expect(result.data.endpoints.gateway).toBe('http://localhost:8080');
      expect(result.data.composePath).toBe('/test/project/docker-compose.yml');

      // Verify the orchestration sequence
      expect(loadProfile).toHaveBeenCalledWith('/test/project', 'local-dev', undefined);
      expect(ensureEngineRunning).toHaveBeenCalledWith('docker', expect.anything());
      expect(ensureNetwork).toHaveBeenCalledWith('docker', 'kadi-net', expect.anything());
      expect(generateComposeYAML).toHaveBeenCalledWith(
        mockProfile.profile.services,
        expect.objectContaining({ networkName: 'kadi-net' })
      );
      expect(fs.default.writeFile).toHaveBeenCalledWith(
        '/test/project/docker-compose.yml',
        mockComposeYaml,
        'utf8'
      );
    });

    it('should handle dry run mode without executing commands', async () => {
      const { loadProfile } = await import('../../src/utils/profile-loader.js');
      const { generateComposeYAML } = await import('../../src/targets/local/compose-generator.js');
      const { ensureEngineRunning } = await import('../../src/targets/local/engine-manager.js');
      const fs = await import('node:fs/promises');

      vi.mocked(loadProfile).mockResolvedValue(mockProfile);
      vi.mocked(generateComposeYAML).mockReturnValue(success(mockComposeYaml));

      const result = await deployLocal({
        projectRoot: '/test/project',
        profile: 'local-dev',
        dryRun: true,
      });

      // Verify success and dry run behavior
      expect(result.success).toBe(true);
      if (!result.success) throw new Error('Expected success');

      expect(result.data.dryRun).toBe(true);
      expect(result.data.composeFile).toBe(mockComposeYaml);

      // Verify NO actual deployment happened
      expect(ensureEngineRunning).not.toHaveBeenCalled();
      expect(fs.default.writeFile).not.toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    it('should handle profile loading errors', async () => {
      const { loadProfile } = await import('../../src/utils/profile-loader.js');

      vi.mocked(loadProfile).mockRejectedValue(
        new Error('agent.json not found')
      );

      const result = await deployLocal({
        projectRoot: '/test/project',
        profile: 'missing',
      });

      expect(result.success).toBe(false);
      if (result.success) throw new Error('Expected failure');

      expect(result.error.code).toBe('PROFILE_LOAD_ERROR');
      expect(result.error.message).toContain('Failed to load deployment profile');
    });

    it('should handle engine not running', async () => {
      const { loadProfile } = await import('../../src/utils/profile-loader.js');
      const { ensureEngineRunning } = await import('../../src/targets/local/engine-manager.js');

      vi.mocked(loadProfile).mockResolvedValue(mockProfile);
      vi.mocked(ensureEngineRunning).mockResolvedValue(
        failure(new DeploymentError(
          'Docker is not running',
          'ENGINE_NOT_RUNNING',
          {}
        ))
      );

      const result = await deployLocal({
        projectRoot: '/test/project',
        profile: 'local-dev',
      });

      expect(result.success).toBe(false);
      if (result.success) throw new Error('Expected failure');

      expect(result.error.code).toBe('ENGINE_NOT_RUNNING');
    });

    it('should handle compose generation errors', async () => {
      const { loadProfile } = await import('../../src/utils/profile-loader.js');
      const { ensureEngineRunning } = await import('../../src/targets/local/engine-manager.js');
      const { ensureNetwork } = await import('../../src/targets/local/network-manager.js');
      const { generateComposeYAML } = await import('../../src/targets/local/compose-generator.js');

      vi.mocked(loadProfile).mockResolvedValue(mockProfile);
      vi.mocked(ensureEngineRunning).mockResolvedValue(
        success({ engine: 'docker', running: true, autoStarted: false })
      );
      vi.mocked(ensureNetwork).mockResolvedValue(
        success({ name: 'kadi-net', created: false, driver: 'bridge' })
      );
      vi.mocked(generateComposeYAML).mockReturnValue(
        failure(new DeploymentError(
          'Invalid service configuration',
          'SERVICE_INVALID',
          {}
        ))
      );

      const result = await deployLocal({
        projectRoot: '/test/project',
        profile: 'local-dev',
      });

      expect(result.success).toBe(false);
      if (result.success) throw new Error('Expected failure');

      expect(result.error.code).toBe('SERVICE_INVALID');
    });
  });

  describe('Configuration Options', () => {
    it('should respect engine override', async () => {
      const { loadProfile } = await import('../../src/utils/profile-loader.js');
      const { ensureEngineRunning } = await import('../../src/targets/local/engine-manager.js');

      vi.mocked(loadProfile).mockResolvedValue(mockProfile);
      vi.mocked(ensureEngineRunning).mockResolvedValue(
        success({ engine: 'podman', running: true, autoStarted: false })
      );

      await deployLocal({
        projectRoot: '/test/project',
        profile: 'local-dev',
        engine: 'podman', // Override the profile's docker setting
      });

      // Verify podman was used instead of docker
      expect(ensureEngineRunning).toHaveBeenCalledWith('podman', expect.anything());
    });

    it('should respect custom network name', async () => {
      const { loadProfile } = await import('../../src/utils/profile-loader.js');
      const { ensureEngineRunning } = await import('../../src/targets/local/engine-manager.js');
      const { ensureNetwork } = await import('../../src/targets/local/network-manager.js');
      const { generateComposeYAML } = await import('../../src/targets/local/compose-generator.js');
      const { runCommand } = await import('../../src/utils/command-runner.js');
      const fs = await import('node:fs/promises');

      vi.mocked(loadProfile).mockResolvedValue(mockProfile);
      vi.mocked(ensureEngineRunning).mockResolvedValue(
        success({ engine: 'docker', running: true, autoStarted: false })
      );
      vi.mocked(ensureNetwork).mockResolvedValue(
        success({ name: 'custom-net', created: true, driver: 'bridge' })
      );
      vi.mocked(generateComposeYAML).mockReturnValue(success(mockComposeYaml));
      vi.mocked(fs.default.writeFile).mockResolvedValue(undefined);
      vi.mocked(runCommand).mockResolvedValue(
        success({ stdout: 'Started', stderr: '', exitCode: 0 })
      );

      await deployLocal({
        projectRoot: '/test/project',
        profile: 'local-dev',
        network: 'custom-net',
      });

      // Verify custom network was used
      expect(ensureNetwork).toHaveBeenCalledWith('docker', 'custom-net', expect.anything());
      expect(generateComposeYAML).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ networkName: 'custom-net' })
      );
    });
  });
});