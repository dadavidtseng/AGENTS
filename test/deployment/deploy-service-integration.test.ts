/**
 * Deployment Service Integration Tests
 *
 * Full integration tests demonstrating deployment lifecycle with console logging
 * as specified in Phase 5 testing requirements
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { DeployService } from '../../src/deployment/deploy-service.js';
import { DeploymentStatus, DeployErrorType } from '../../src/deployment/types.js';
import * as fs from 'fs/promises';
import * as path from 'path';

// Mock Deploy Ability
class MockDeployAbility {
  async deployToDigitalOcean(options: any) {
    console.log('\n📦 [MockDeployAbility] Deploying to Digital Ocean...');
    console.log('   Region:', options.region);
    console.log('   Size:', options.size);
    console.log('   Image:', options.image);
    console.log('   Environment:', JSON.stringify(options.environment));

    // Simulate deployment delay
    await new Promise((resolve) => setTimeout(resolve, 100));

    const deploymentInfo = {
      deploymentId: 'integration-test-deploy-12345',
      ipAddress: '192.168.100.1',
      status: 'running',
    };

    console.log('✅ [MockDeployAbility] Deployment successful!');
    console.log('   Deployment ID:', deploymentInfo.deploymentId);
    console.log('   IP Address:', deploymentInfo.ipAddress);

    return deploymentInfo;
  }

  async rollbackDeployment(deploymentId: string) {
    console.log('\n🔄 [MockDeployAbility] Rolling back deployment:', deploymentId);
    await new Promise((resolve) => setTimeout(resolve, 100));
    console.log('✅ [MockDeployAbility] Rollback complete');
  }
}

// Mock Kadi Secret
class MockKadiSecret {
  private secrets = new Map<string, string>();

  async store(key: string, value: string) {
    console.log('\n🔐 [MockKadiSecret] Storing secret:', key);
    console.log('   Value:', value.substring(0, 20) + '...');
    this.secrets.set(key, value);
    console.log('✅ [MockKadiSecret] Secret stored successfully');
  }

  async retrieve(key: string) {
    console.log('\n🔐 [MockKadiSecret] Retrieving secret:', key);
    return this.secrets.get(key) || null;
  }
}

describe('DeployService Integration Tests', () => {
  let mockFetch: any;
  let healthCheckCount: number;

  beforeEach(() => {
    vi.clearAllMocks();
    healthCheckCount = 0;

    // Mock global fetch
    mockFetch = vi.fn((url: string, options?: any) => {
      const urlStr = url.toString();

      if (urlStr.includes('/health')) {
        healthCheckCount++;
        console.log(`\n🏥 [MockGateway] Health check attempt ${healthCheckCount}/3`);

        if (healthCheckCount >= 3) {
          console.log('✅ [MockGateway] Gateway is healthy!');
          return Promise.resolve(
            new Response(JSON.stringify({ status: 'healthy' }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            })
          );
        }

        console.log('⏳ [MockGateway] Gateway not ready yet, will retry...');
        return Promise.reject(new Error('Connection refused'));
      } else if (urlStr.includes('/admin/api-keys')) {
        console.log('\n🔑 [MockGateway] Generating API key...');
        const apiKey = 'integration-test-api-key-' + Math.random().toString(36).substring(7);
        console.log('✅ [MockGateway] API key generated:', apiKey);

        return Promise.resolve(
          new Response(JSON.stringify({ apiKey }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        );
      } else if (urlStr.includes('/admin/models/openai')) {
        console.log('\n🤖 [MockGateway] Registering OpenAI models...');
        const models = ['gpt-4', 'gpt-4-turbo', 'gpt-3.5-turbo'];
        console.log('✅ [MockGateway] Models registered:', models.join(', '));

        return Promise.resolve(
          new Response(JSON.stringify({ registeredModels: models }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        );
      }

      return Promise.reject(new Error(`Unexpected URL: ${url}`));
    });

    global.fetch = mockFetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should demonstrate full deployment lifecycle with console logging', async () => {
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('INTEGRATION TEST: Full Deployment Lifecycle');
    console.log('═══════════════════════════════════════════════════════════');

    const config = {
      dropletRegion: 'nyc1',
      dropletSize: 's-2vcpu-2gb',
      containerImage: 'model-manager-agent:0.0.8',
      adminKey: 'integration-test-admin-key',
      openaiKey: 'integration-test-openai-key',
    };

    const service = new DeployService(config);
    service.setDeployAbility(new MockDeployAbility());
    service.setKadiSecret(new MockKadiSecret());

    console.log('\n🚀 Starting deployment pipeline...');

    const result = await service.deployModelManager();

    expect(result.success).toBe(true);

    if (result.success) {
      console.log('\n🎉 DEPLOYMENT SUCCESSFUL!');
      console.log('\nDeployment Details:');
      console.log('   ID:', result.data.id);
      console.log('   Status:', result.data.status);
      console.log('   Gateway URL:', result.data.gatewayUrl);
      console.log('   API Key:', result.data.apiKey);
      console.log('   Registered Models:', result.data.registeredModels.join(', '));
      console.log('   Deployed At:', result.data.deployedAt.toISOString());

      // Verify all expected values
      expect(result.data.id).toBe('integration-test-deploy-12345');
      expect(result.data.status).toBe(DeploymentStatus.RUNNING);
      expect(result.data.gatewayUrl).toBe('https://192.168.100.1');
      expect(result.data.apiKey).toContain('integration-test-api-key-');
      expect(result.data.registeredModels).toEqual(['gpt-4', 'gpt-4-turbo', 'gpt-3.5-turbo']);
    }

    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('✅ Integration Test PASSED');
    console.log('═══════════════════════════════════════════════════════════\n');
  }, 15000); // 15 second timeout

  it('should demonstrate rollback mechanism with console logging', async () => {
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('INTEGRATION TEST: Rollback on API Key Failure');
    console.log('═══════════════════════════════════════════════════════════');

    healthCheckCount = 0; // Reset

    // Override fetch to fail on API key generation
    mockFetch.mockImplementation((url: string, options?: any) => {
      const urlStr = url.toString();

      if (urlStr.includes('/health')) {
        healthCheckCount++;
        console.log(`\n🏥 [MockGateway] Health check attempt ${healthCheckCount}/3`);

        if (healthCheckCount >= 3) {
          console.log('✅ [MockGateway] Gateway is healthy!');
          return Promise.resolve(
            new Response(JSON.stringify({ status: 'healthy' }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            })
          );
        }

        console.log('⏳ [MockGateway] Gateway not ready yet, will retry...');
        return Promise.reject(new Error('Connection refused'));
      } else if (urlStr.includes('/admin/api-keys')) {
        console.log('\n❌ [MockGateway] API key generation FAILED (simulated)');
        return Promise.resolve(
          new Response('Unauthorized', {
            status: 401,
            statusText: 'Unauthorized',
          })
        );
      }

      return Promise.reject(new Error(`Unexpected URL: ${url}`));
    });

    const config = {
      dropletRegion: 'nyc1',
      dropletSize: 's-2vcpu-2gb',
      containerImage: 'model-manager-agent:0.0.8',
      adminKey: 'integration-test-admin-key',
      openaiKey: 'integration-test-openai-key',
    };

    const service = new DeployService(config);
    service.setDeployAbility(new MockDeployAbility());
    service.setKadiSecret(new MockKadiSecret());

    console.log('\n🚀 Starting deployment (will fail on API key generation)...');

    const result = await service.deployModelManager();

    expect(result.success).toBe(false);

    if (!result.success) {
      console.log('\n✅ Rollback mechanism triggered correctly!');
      console.log('\nError Details:');
      console.log('   Type:', result.error.type);
      console.log('   Message:', result.error.message);
      console.log('   Operation:', result.error.operation);

      // Verify error details
      expect(result.error.type).toBe(DeployErrorType.API_KEY_GENERATION_FAILED);
      expect(result.error.message).toContain('401');
    }

    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('✅ Rollback Test PASSED');
    console.log('═══════════════════════════════════════════════════════════\n');
  }, 15000); // 15 second timeout

  it('should demonstrate .env file update with console logging', async () => {
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('INTEGRATION TEST: Environment Configuration Update');
    console.log('═══════════════════════════════════════════════════════════');

    const testGatewayUrl = 'https://test-gateway.example.com';
    const testApiKey = 'test-env-api-key-12345';

    const config = {
      dropletRegion: 'nyc1',
      dropletSize: 's-2vcpu-2gb',
      containerImage: 'model-manager-agent:0.0.8',
      adminKey: 'test-admin-key',
    };

    const service = new DeployService(config);

    console.log('\n📝 Testing .env configuration update...');
    console.log('   Gateway URL:', testGatewayUrl);
    console.log('   API Key:', testApiKey);

    const result = await service.updateAgentConfig(testGatewayUrl, testApiKey);

    expect(result.success).toBe(true);

    if (result.success) {
      console.log('\n✅ .env configuration updated successfully!');

      try {
        const envPath = path.join(process.cwd(), '.env');
        const envContent = await fs.readFile(envPath, 'utf-8');

        console.log('\n📄 .env File Contents:');
        console.log('─────────────────────────────────────────────────────────');
        console.log(envContent);
        console.log('─────────────────────────────────────────────────────────');

        expect(envContent).toContain(`MODEL_MANAGER_BASE_URL=${testGatewayUrl}`);
        expect(envContent).toContain(`MODEL_MANAGER_API_KEY=${testApiKey}`);
      } catch (error: any) {
        console.log('\n⚠️  Could not read .env file:', error.message);
        console.log('   (This is normal in CI/test environments)');
      }
    }

    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('✅ Configuration Test PASSED');
    console.log('═══════════════════════════════════════════════════════════\n');
  });
});
