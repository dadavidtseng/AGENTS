/**
 * DeployService Unit Tests
 *
 * Tests deployment operations with mocked DeployAbility and KadiSecret
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { DeployService } from '../../src/deployment/deploy-service.js';
import { DeployErrorType, DeploymentStatus } from '../../src/deployment/types.js';
import * as fs from 'fs/promises';
import * as path from 'path';

// Mock fetch globally
global.fetch = vi.fn();

// Mock fs module
vi.mock('fs/promises');

describe('DeployService', () => {
  let service: DeployService;
  let mockDeployAbility: any;
  let mockKadiSecret: any;
  let mockFetch: any;

  const testConfig = {
    dropletRegion: 'nyc1',
    dropletSize: 's-2vcpu-2gb',
    containerImage: 'model-manager-agent:0.0.8',
    adminKey: 'test-admin-key',
    openaiKey: 'test-openai-key',
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Create fresh mocks for each test
    mockFetch = global.fetch as any;
    mockFetch.mockReset();

    mockDeployAbility = {
      deployToDigitalOcean: vi.fn(),
      rollbackDeployment: vi.fn(),
    };

    mockKadiSecret = {
      store: vi.fn(),
      retrieve: vi.fn(),
    };

    service = new DeployService(testConfig);
    service.setDeployAbility(mockDeployAbility);
    service.setKadiSecret(mockKadiSecret);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('deployModelManager', () => {
    it('should successfully deploy Model Manager Gateway', async () => {
      // Mock Digital Ocean deployment
      mockDeployAbility.deployToDigitalOcean.mockResolvedValueOnce({
        deploymentId: 'deploy-123',
        ipAddress: '192.168.1.1',
        status: 'running',
      });

      // Mock health check
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'healthy' }),
      });

      // Mock API key generation
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ apiKey: 'test-api-key-123' }),
      });

      // Mock model registration
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          registeredModels: ['gpt-4', 'gpt-4-turbo', 'gpt-3.5-turbo'],
        }),
      });

      // Mock secret storage
      mockKadiSecret.store.mockResolvedValueOnce(undefined);

      // Mock file system
      (fs.readFile as any).mockRejectedValueOnce(new Error('File not found'));
      (fs.writeFile as any).mockResolvedValueOnce(undefined);

      const result = await service.deployModelManager();

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.id).toBe('deploy-123');
        expect(result.data.gatewayUrl).toBe('https://192.168.1.1');
        expect(result.data.apiKey).toBe('test-api-key-123');
        expect(result.data.registeredModels).toEqual(['gpt-4', 'gpt-4-turbo', 'gpt-3.5-turbo']);
        expect(result.data.status).toBe(DeploymentStatus.RUNNING);
      }

      // Verify deployment was called correctly
      expect(mockDeployAbility.deployToDigitalOcean).toHaveBeenCalledWith({
        region: 'nyc1',
        size: 's-2vcpu-2gb',
        image: 'model-manager-agent:0.0.8',
        environment: {
          ADMIN_KEY: 'test-admin-key',
        },
      });

      // Verify API key was stored
      expect(mockKadiSecret.store).toHaveBeenCalledWith('MODEL_MANAGER_API_KEY', 'test-api-key-123');

      // Verify .env was updated
      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('.env'),
        expect.stringContaining('MODEL_MANAGER_BASE_URL=https://192.168.1.1'),
        'utf-8'
      );
    });

    it('should deploy without OpenAI key', async () => {
      const configWithoutOpenAI = { ...testConfig, openaiKey: undefined };
      service = new DeployService(configWithoutOpenAI);
      service.setDeployAbility(mockDeployAbility);
      service.setKadiSecret(mockKadiSecret);

      // Mock Digital Ocean deployment
      mockDeployAbility.deployToDigitalOcean.mockResolvedValueOnce({
        deploymentId: 'deploy-456',
        ipAddress: '192.168.1.2',
        status: 'running',
      });

      // Mock health check
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'healthy' }),
      });

      // Mock API key generation
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ apiKey: 'test-api-key-456' }),
      });

      // Mock secret storage
      mockKadiSecret.store.mockResolvedValueOnce(undefined);

      // Mock file system
      (fs.readFile as any).mockRejectedValueOnce(new Error('File not found'));
      (fs.writeFile as any).mockResolvedValueOnce(undefined);

      const result = await service.deployModelManager();

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.registeredModels).toEqual([]);
      }

      // Verify model registration was NOT called
      expect(mockFetch).toHaveBeenCalledTimes(2); // Only health + API key
    });

    it('should return error when DeployAbility not initialized', async () => {
      const uninitializedService = new DeployService(testConfig);

      const result = await uninitializedService.deployModelManager();

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe(DeployErrorType.DEPLOYMENT_FAILED);
        expect(result.error.message).toContain('Deploy Ability not initialized');
      }
    });

    it('should rollback on gateway health check timeout', async () => {
      // Mock Digital Ocean deployment
      mockDeployAbility.deployToDigitalOcean.mockResolvedValueOnce({
        deploymentId: 'deploy-789',
        ipAddress: '192.168.1.3',
        status: 'running',
      });

      // Mock health check failures (timeout)
      mockFetch.mockRejectedValue(new Error('Connection timeout'));
      mockDeployAbility.rollbackDeployment.mockResolvedValueOnce(undefined);

      const result = await service.deployModelManager();

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe(DeployErrorType.TIMEOUT);
      }

      // Verify rollback was called
      expect(mockDeployAbility.rollbackDeployment).toHaveBeenCalledWith('deploy-789');
    }, 65000); // 65 second timeout for this test

    it('should rollback on API key generation failure', async () => {
      // Mock Digital Ocean deployment
      mockDeployAbility.deployToDigitalOcean.mockResolvedValueOnce({
        deploymentId: 'deploy-abc',
        ipAddress: '192.168.1.4',
        status: 'running',
      });

      // Mock health check success
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'healthy' }),
      });

      // Mock API key generation failure
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
      });

      mockDeployAbility.rollbackDeployment.mockResolvedValueOnce(undefined);

      const result = await service.deployModelManager();

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe(DeployErrorType.API_KEY_GENERATION_FAILED);
      }

      // Verify rollback was called
      expect(mockDeployAbility.rollbackDeployment).toHaveBeenCalledWith('deploy-abc');
    });

    it('should rollback on model registration failure', async () => {
      // Mock Digital Ocean deployment
      mockDeployAbility.deployToDigitalOcean.mockResolvedValueOnce({
        deploymentId: 'deploy-def',
        ipAddress: '192.168.1.5',
        status: 'running',
      });

      // Mock health check
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'healthy' }),
      });

      // Mock API key generation
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ apiKey: 'test-api-key' }),
      });

      // Mock model registration failure
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      mockDeployAbility.rollbackDeployment.mockResolvedValueOnce(undefined);

      const result = await service.deployModelManager();

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe(DeployErrorType.MODEL_REGISTRATION_FAILED);
      }

      // Verify rollback was called
      expect(mockDeployAbility.rollbackDeployment).toHaveBeenCalledWith('deploy-def');
    });
  });

  describe('generateAPIKey', () => {
    it('should generate API key successfully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ apiKey: 'generated-key-123' }),
      });

      const result = await service.generateAPIKey('https://gateway.example.com', 'admin-key');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe('generated-key-123');
      }

      expect(mockFetch).toHaveBeenCalledWith('https://gateway.example.com/admin/api-keys', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer admin-key',
        },
        body: JSON.stringify({
          name: 'agent-api-key',
          description: 'Auto-generated API key for template agent',
        }),
      });
    });

    it('should handle snake_case response format', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ api_key: 'generated-key-456' }),
      });

      const result = await service.generateAPIKey('https://gateway.example.com', 'admin-key');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe('generated-key-456');
      }
    });

    it('should handle alternative key format', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ key: 'generated-key-789' }),
      });

      const result = await service.generateAPIKey('https://gateway.example.com', 'admin-key');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe('generated-key-789');
      }
    });

    it('should return error on HTTP failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
      });

      const result = await service.generateAPIKey('https://gateway.example.com', 'admin-key');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe(DeployErrorType.API_KEY_GENERATION_FAILED);
        expect(result.error.message).toContain('403');
      }
    });

    it('should return error when API key not in response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ message: 'Success but no key' }),
      });

      const result = await service.generateAPIKey('https://gateway.example.com', 'admin-key');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe(DeployErrorType.API_KEY_GENERATION_FAILED);
        expect(result.error.message).toContain('API key not found in response');
      }
    });

    it('should return error on network failure', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await service.generateAPIKey('https://gateway.example.com', 'admin-key');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe(DeployErrorType.API_KEY_GENERATION_FAILED);
        expect(result.error.message).toContain('Network error');
      }
    });
  });

  describe('registerOpenAIModels', () => {
    it('should register OpenAI models successfully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          registeredModels: ['gpt-4', 'gpt-4-turbo', 'gpt-3.5-turbo'],
        }),
      });

      const result = await service.registerOpenAIModels(
        'https://gateway.example.com',
        'admin-key',
        'openai-key'
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(['gpt-4', 'gpt-4-turbo', 'gpt-3.5-turbo']);
      }

      expect(mockFetch).toHaveBeenCalledWith('https://gateway.example.com/admin/models/openai', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer admin-key',
        },
        body: JSON.stringify({
          apiKey: 'openai-key',
          models: ['gpt-4', 'gpt-4-turbo', 'gpt-3.5-turbo'],
        }),
      });
    });

    it('should handle alternative response format', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          models: ['gpt-4'],
        }),
      });

      const result = await service.registerOpenAIModels(
        'https://gateway.example.com',
        'admin-key',
        'openai-key'
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(['gpt-4']);
      }
    });

    it('should return error on HTTP failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
      });

      const result = await service.registerOpenAIModels(
        'https://gateway.example.com',
        'admin-key',
        'openai-key'
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe(DeployErrorType.MODEL_REGISTRATION_FAILED);
        expect(result.error.message).toContain('400');
      }
    });

    it('should return error on network failure', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

      const result = await service.registerOpenAIModels(
        'https://gateway.example.com',
        'admin-key',
        'openai-key'
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe(DeployErrorType.MODEL_REGISTRATION_FAILED);
        expect(result.error.message).toContain('Connection refused');
      }
    });
  });

  describe('updateAgentConfig', () => {
    it('should create new .env file', async () => {
      (fs.readFile as any).mockRejectedValueOnce(new Error('File not found'));
      (fs.writeFile as any).mockResolvedValueOnce(undefined);

      const result = await service.updateAgentConfig('https://gateway.example.com', 'api-key-123');

      expect(result.success).toBe(true);

      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('.env'),
        expect.stringContaining('MODEL_MANAGER_BASE_URL=https://gateway.example.com'),
        'utf-8'
      );

      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('MODEL_MANAGER_API_KEY=api-key-123'),
        'utf-8'
      );
    });

    it('should update existing .env file', async () => {
      const existingContent = `
# Existing config
MODEL_MANAGER_BASE_URL=https://old-url.com
MODEL_MANAGER_API_KEY=old-key
OTHER_CONFIG=value
`.trim();

      (fs.readFile as any).mockResolvedValueOnce(existingContent);
      (fs.writeFile as any).mockResolvedValueOnce(undefined);

      const result = await service.updateAgentConfig('https://new-url.com', 'new-key');

      expect(result.success).toBe(true);

      const writtenContent = (fs.writeFile as any).mock.calls[0][1];
      expect(writtenContent).toContain('MODEL_MANAGER_BASE_URL=https://new-url.com');
      expect(writtenContent).toContain('MODEL_MANAGER_API_KEY=new-key');
      expect(writtenContent).toContain('OTHER_CONFIG=value');
      expect(writtenContent).not.toContain('old-url.com');
      expect(writtenContent).not.toContain('old-key');
    });

    it('should return error on file write failure', async () => {
      (fs.readFile as any).mockRejectedValueOnce(new Error('File not found'));
      (fs.writeFile as any).mockRejectedValueOnce(new Error('Permission denied'));

      const result = await service.updateAgentConfig('https://gateway.example.com', 'api-key-123');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe(DeployErrorType.CONFIG_UPDATE_FAILED);
        expect(result.error.message).toContain('Permission denied');
      }
    });
  });

  describe('waitForGatewayReady', () => {
    it('should return success when gateway becomes ready', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'healthy' }),
      });

      const result = await service.waitForGatewayReady('https://gateway.example.com', 10000);

      expect(result.success).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith('https://gateway.example.com/health', expect.any(Object));
    });

    it('should retry on failure and eventually succeed', async () => {
      // First two calls fail, third succeeds
      mockFetch
        .mockRejectedValueOnce(new Error('Connection refused'))
        .mockRejectedValueOnce(new Error('Connection refused'))
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ status: 'healthy' }),
        });

      const result = await service.waitForGatewayReady('https://gateway.example.com', 10000);

      expect(result.success).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('should return timeout error when gateway never becomes ready', async () => {
      mockFetch.mockRejectedValue(new Error('Connection refused'));

      const result = await service.waitForGatewayReady('https://gateway.example.com', 3000);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe(DeployErrorType.TIMEOUT);
        expect(result.error.message).toContain('did not become ready within 3000ms');
      }
    });
  });
});
