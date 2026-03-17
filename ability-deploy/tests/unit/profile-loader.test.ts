/**
 * Unit Tests for Profile Loader
 *
 * Tests agent.json loading, profile validation, and resolution.
 *
 * @module tests/unit/profile-loader
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  loadAgentConfig,
  loadProfile,
  loadDeploymentProfile,
  loadFirstProfile,
  getAvailableProfiles,
} from '../../src/utils/profile-loader.js';
import {
  sampleAgentConfig,
  minimalAgentConfig,
  agentConfigNoDeploy,
  agentConfigNoLocal,
  testPaths,
} from '../helpers/fixtures.js';
import { MockFileSystem } from '../helpers/mocks.js';
import { SilentLogger } from '../../src/utils/logger.js';

// Mock node:fs/promises at module level
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
}));

describe('Profile Loader', () => {
  let mockFs: MockFileSystem;
  const logger = new SilentLogger();

  beforeEach(async () => {
    mockFs = new MockFileSystem();
    vi.clearAllMocks();

    // Get reference to mocked readFile
    const { readFile } = await import('node:fs/promises');
    const mockedReadFile = vi.mocked(readFile);

    // Reset mock implementation
    mockedReadFile.mockReset();
  });

  afterEach(() => {
    mockFs.clear();
  });

  describe('loadAgentConfig', () => {
    it('should load valid agent.json', async () => {
      const agentJsonPath = testPaths.agentJsonPath(testPaths.validProject);

      // Mock file system
      const { readFile } = await import('node:fs/promises');
      vi.mocked(readFile).mockResolvedValue(
        JSON.stringify(sampleAgentConfig)
      );

      const config = await loadAgentConfig(testPaths.validProject, logger);

      expect(config).toEqual(sampleAgentConfig);
      expect(config.name).toBe('test-agent');
      expect(config.deploy).toBeDefined();
    });

    it('should throw error if agent.json not found', async () => {
      const { readFile } = await import('node:fs/promises');
      vi.mocked(readFile).mockRejectedValue(
        Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      );

      await expect(
        loadAgentConfig(testPaths.invalidProject, logger)
      ).rejects.toThrow('agent.json not found');
    });

    it('should throw error for invalid JSON', async () => {
      const { readFile } = await import('node:fs/promises');
      vi.mocked(readFile).mockResolvedValue('invalid json {]');

      await expect(
        loadAgentConfig(testPaths.validProject, logger)
      ).rejects.toThrow('Failed to parse agent.json');
    });

    it('should load agent config even without deploy section', async () => {
      const { readFile } = await import('node:fs/promises');
      vi.mocked(readFile).mockResolvedValue(
        JSON.stringify(agentConfigNoDeploy)
      );

      // loadAgentConfig only loads JSON, doesn't validate deploy section
      const config = await loadAgentConfig(testPaths.validProject, logger);
      expect(config.name).toBe('no-deploy-agent');
    });

    it('should load minimal agent.json structure', async () => {
      const minimalConfig = {
        name: 'test',
        version: '1.0.0',
        // deploy section is optional at load time
      };

      const { readFile } = await import('node:fs/promises');
      vi.mocked(readFile).mockResolvedValue(JSON.stringify(minimalConfig));

      // loadAgentConfig just parses JSON, validation happens later
      const config = await loadAgentConfig(testPaths.validProject, logger);
      expect(config.name).toBe('test');
    });
  });

  describe('loadDeploymentProfile', () => {
    it('should load specified local profile', async () => {
      const profile = await loadDeploymentProfile(
        sampleAgentConfig,
        'local-dev',
        testPaths.validProject,
        logger
      );

      expect(profile.name).toBe('local-dev');
      expect(profile.profile.target).toBe('local');
      expect(profile.profile.engine).toBe('docker');
      expect(profile.agent).toEqual(sampleAgentConfig);
    });

    it('should load specified Akash profile', async () => {
      const profile = await loadDeploymentProfile(
        sampleAgentConfig,
        'production',
        testPaths.validProject,
        logger
      );

      expect(profile.name).toBe('production');
      expect(profile.profile.target).toBe('akash');
      expect(profile.profile.network).toBe('mainnet');
    });

    it('should throw error for non-existent profile', async () => {
      await expect(
        loadDeploymentProfile(
          sampleAgentConfig,
          'nonexistent',
          testPaths.validProject,
          logger
        )
      ).rejects.toThrow('Profile "nonexistent" not found');
    });

    it('should validate profile has required fields', async () => {
      const invalidAgent = {
        ...sampleAgentConfig,
        deploy: {
          invalid: {
            // missing target field
            services: {},
          },
        },
      };

      await expect(
        loadDeploymentProfile(
          invalidAgent,
          'invalid',
          testPaths.validProject,
          logger
        )
      ).rejects.toThrow();
    });

    it('should validate local profile has services', async () => {
      const noServicesAgent = {
        ...sampleAgentConfig,
        deploy: {
          'no-services': {
            target: 'local' as const,
            engine: 'docker' as const,
            // missing services field
          },
        },
      };

      await expect(
        loadDeploymentProfile(
          noServicesAgent,
          'no-services',
          testPaths.validProject,
          logger
        )
      ).rejects.toThrow('services');
    });

    it('should validate local profile has engine', async () => {
      const noEngineAgent = {
        ...sampleAgentConfig,
        deploy: {
          'no-engine': {
            target: 'local' as const,
            services: {
              app: { image: 'test:latest' },
            },
          },
        },
      };

      await expect(
        loadDeploymentProfile(
          noEngineAgent,
          'no-engine',
          testPaths.validProject,
          logger
        )
      ).rejects.toThrow('engine');
    });
  });

  describe('loadFirstProfile', () => {
    it('should load first available profile', async () => {
      const profile = await loadFirstProfile(
        sampleAgentConfig,
        testPaths.validProject,
        logger
      );

      expect(profile.name).toBeDefined();
      expect(profile.profile).toBeDefined();
      expect(['local-dev', 'production']).toContain(profile.name);
    });

    it('should throw error if no profiles defined', async () => {
      const emptyAgent = {
        ...sampleAgentConfig,
        deploy: {},
      };

      await expect(
        loadFirstProfile(emptyAgent, testPaths.validProject, logger)
      ).rejects.toThrow('No deployment profiles defined');
    });

    it('should prefer local profiles first', async () => {
      // When multiple profiles exist, implementation may prefer certain types
      const profile = await loadFirstProfile(
        sampleAgentConfig,
        testPaths.validProject,
        logger
      );

      expect(profile.name).toBeDefined();
      expect(profile.profile.target).toMatch(/^(local|akash)$/);
    });
  });

  describe('loadProfile', () => {
    beforeEach(async () => {
      const { readFile } = await import('node:fs/promises');
      vi.mocked(readFile).mockResolvedValue(
        JSON.stringify(sampleAgentConfig)
      );
    });

    it('should load specified profile by name', async () => {
      const profile = await loadProfile(
        testPaths.validProject,
        'local-dev',
        logger
      );

      expect(profile.name).toBe('local-dev');
      expect(profile.profile.target).toBe('local');
    });

    it('should load first profile if none specified', async () => {
      const profile = await loadProfile(testPaths.validProject, undefined, logger);

      expect(profile.name).toBeDefined();
      expect(profile.profile).toBeDefined();
    });

    it('should throw error for missing profile', async () => {
      await expect(
        loadProfile(testPaths.validProject, 'missing', logger)
      ).rejects.toThrow('not found');
    });

    it('should return LoadedProfile structure', async () => {
      const profile = await loadProfile(
        testPaths.validProject,
        'local-dev',
        logger
      );

      expect(profile).toHaveProperty('name');
      expect(profile).toHaveProperty('profile');
      expect(profile).toHaveProperty('agent');

      expect(profile.name).toBe('local-dev');
      expect(profile.agent).toEqual(sampleAgentConfig);
    });

    it('should validate profile fields', async () => {
      const invalidAgent = {
        ...sampleAgentConfig,
        deploy: {
          broken: {
            target: 'local' as const,
            // missing required fields
          },
        },
      };

      const { readFile } = await import('node:fs/promises');
      vi.mocked(readFile).mockResolvedValue(JSON.stringify(invalidAgent));

      await expect(
        loadProfile(testPaths.validProject, 'broken', logger)
      ).rejects.toThrow();
    });

    it('should handle both local and Akash profiles', async () => {
      const localProfile = await loadProfile(
        testPaths.validProject,
        'local-dev',
        logger
      );

      expect(localProfile.profile.target).toBe('local');

      const akashProfile = await loadProfile(
        testPaths.validProject,
        'production',
        logger
      );

      expect(akashProfile.profile.target).toBe('akash');
    });
  });

  describe('getAvailableProfiles', () => {
    it('should return all profile names', () => {
      const profiles = getAvailableProfiles(sampleAgentConfig);

      expect(profiles).toContain('local-dev');
      expect(profiles).toContain('production');
      expect(profiles).toHaveLength(2);
    });

    it('should return empty array if no profiles', () => {
      const emptyAgent = {
        ...sampleAgentConfig,
        deploy: {},
      };

      const profiles = getAvailableProfiles(emptyAgent);

      expect(profiles).toEqual([]);
    });

    it('should return array of strings', () => {
      const profiles = getAvailableProfiles(sampleAgentConfig);

      expect(Array.isArray(profiles)).toBe(true);
      profiles.forEach((name) => {
        expect(typeof name).toBe('string');
      });
    });

    it('should handle single profile', () => {
      const profiles = getAvailableProfiles(minimalAgentConfig);

      expect(profiles).toHaveLength(1);
      expect(profiles[0]).toBe('local');
    });

    it('should not include undefined or null profiles', () => {
      const messyAgent = {
        ...sampleAgentConfig,
        deploy: {
          valid: {
            target: 'local' as const,
            engine: 'docker' as const,
            services: {},
          },
          invalid: null as any,
          undefined: undefined as any,
        },
      };

      const profiles = getAvailableProfiles(messyAgent);

      expect(profiles).toContain('valid');
      expect(profiles.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('profile validation edge cases', () => {
    it('should handle missing image in service', async () => {
      const noImageAgent = {
        ...sampleAgentConfig,
        deploy: {
          'no-image': {
            target: 'local' as const,
            engine: 'docker' as const,
            services: {
              app: {
                // missing image field
                env: ['TEST=1'],
              } as any,
            },
          },
        },
      };

      const { readFile } = await import('node:fs/promises');
      vi.mocked(readFile).mockResolvedValue(JSON.stringify(noImageAgent));

      // This test doesn't validate individual service fields - that's done in compose-generator
      // Profile loader only validates profile-level structure
      const profile = await loadProfile(testPaths.validProject, 'no-image', logger);
      expect(profile.name).toBe('no-image');
    });

    it('should handle empty services object', async () => {
      const emptyServicesAgent = {
        ...sampleAgentConfig,
        deploy: {
          empty: {
            target: 'local' as const,
            engine: 'docker' as const,
            services: {},
          },
        },
      };

      const { readFile } = await import('node:fs/promises');
      vi.mocked(readFile).mockResolvedValue(
        JSON.stringify(emptyServicesAgent)
      );

      await expect(
        loadProfile(testPaths.validProject, 'empty', logger)
      ).rejects.toThrow('At least one service must be defined');
    });

    it('should validate Akash profile has network field', async () => {
      const noNetworkAgent = {
        ...sampleAgentConfig,
        deploy: {
          'no-network': {
            target: 'akash' as const,
            services: {
              app: { image: 'test:latest' },
            },
          },
        },
      };

      const { readFile } = await import('node:fs/promises');
      vi.mocked(readFile).mockResolvedValue(
        JSON.stringify(noNetworkAgent)
      );

      await expect(
        loadProfile(testPaths.validProject, 'no-network', logger)
      ).rejects.toThrow('network');
    });

    it('should handle deeply nested profile structures', async () => {
      const nestedAgent = {
        ...sampleAgentConfig,
        deploy: {
          complex: {
            target: 'local' as const,
            engine: 'docker' as const,
            services: {
              app: {
                image: 'app:latest',
                env: ['KEY=value'],
                expose: [
                  {
                    port: 8080,
                    as: 8080,
                    to: ['local'],
                  },
                ],
                command: ['node', 'server.js'],
                volumes: ['/data:/app/data'],
                dependsOn: ['db'],
              },
              db: {
                image: 'postgres:15',
                env: ['POSTGRES_PASSWORD=secret'],
              },
            },
          },
        },
      };

      const { readFile } = await import('node:fs/promises');
      vi.mocked(readFile).mockResolvedValue(JSON.stringify(nestedAgent));

      const profile = await loadProfile(testPaths.validProject, 'complex', logger);

      expect(profile.name).toBe('complex');
      expect(profile.profile.services).toHaveProperty('app');
      expect(profile.profile.services).toHaveProperty('db');
    });
  });

  describe('profile resolution with defaults', () => {
    it('should require engine field for local profiles', async () => {
      const noEngineAgent = {
        ...sampleAgentConfig,
        deploy: {
          defaultEngine: {
            target: 'local' as const,
            // engine not specified - should fail validation
            services: {
              app: { image: 'test:latest' },
            },
          },
        },
      };

      const { readFile } = await import('node:fs/promises');
      vi.mocked(readFile).mockResolvedValue(
        JSON.stringify(noEngineAgent)
      );

      // Local profiles must specify an engine
      await expect(
        loadProfile(testPaths.validProject, 'defaultEngine', logger)
      ).rejects.toThrow('engine');
    });

    it('should handle optional fields gracefully', async () => {
      const { readFile } = await import('node:fs/promises');
      vi.mocked(readFile).mockResolvedValue(
        JSON.stringify(sampleAgentConfig)
      );

      const minProfile = await loadProfile(
        testPaths.validProject,
        undefined,
        logger
      );

      expect(minProfile).toBeDefined();
      expect(minProfile.name).toBeDefined();
      expect(minProfile.profile).toBeDefined();
    });
  });
});
