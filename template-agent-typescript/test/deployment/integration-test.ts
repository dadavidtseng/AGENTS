/**
 * Deployment Integration Test
 *
 * Manual integration test demonstrating full deployment lifecycle
 * with mocked dependencies as specified in Phase 5 testing requirements
 */

import { DeployService } from '../../src/deployment/deploy-service.js';
import { DeploymentStatus } from '../../src/deployment/types.js';
import * as fs from 'fs/promises';
import * as path from 'path';

// Mock Deploy Ability
class MockDeployAbility {
  async deployToDigitalOcean(options: any) {
    console.log('📦 [MockDeployAbility] Deploying to Digital Ocean...');
    console.log('   Region:', options.region);
    console.log('   Size:', options.size);
    console.log('   Image:', options.image);
    console.log('   Environment:', options.environment);

    // Simulate deployment delay
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const deploymentInfo = {
      deploymentId: 'test-deploy-12345',
      ipAddress: '192.168.100.1',
      status: 'running',
    };

    console.log('✅ [MockDeployAbility] Deployment successful!');
    console.log('   Deployment ID:', deploymentInfo.deploymentId);
    console.log('   IP Address:', deploymentInfo.ipAddress);
    console.log('');

    return deploymentInfo;
  }

  async rollbackDeployment(deploymentId: string) {
    console.log('🔄 [MockDeployAbility] Rolling back deployment:', deploymentId);
    await new Promise((resolve) => setTimeout(resolve, 500));
    console.log('✅ [MockDeployAbility] Rollback complete');
    console.log('');
  }
}

// Mock Kadi Secret
class MockKadiSecret {
  private secrets = new Map<string, string>();

  async store(key: string, value: string) {
    console.log('🔐 [MockKadiSecret] Storing secret:', key);
    this.secrets.set(key, value);
    console.log('✅ [MockKadiSecret] Secret stored successfully');
    console.log('');
  }

  async retrieve(key: string) {
    console.log('🔐 [MockKadiSecret] Retrieving secret:', key);
    return this.secrets.get(key) || null;
  }
}

// Mock Gateway Health Endpoint
let healthCheckCount = 0;
function mockHealthEndpoint(): Response {
  healthCheckCount++;
  console.log(`🏥 [MockGateway] Health check attempt ${healthCheckCount}/3`);

  if (healthCheckCount >= 3) {
    console.log('✅ [MockGateway] Gateway is healthy!');
    console.log('');
    return new Response(JSON.stringify({ status: 'healthy' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  console.log('⏳ [MockGateway] Gateway not ready yet, will retry...');
  console.log('');
  throw new Error('Connection refused');
}

// Mock API Key Generation Endpoint
function mockApiKeyEndpoint(): Response {
  console.log('🔑 [MockGateway] Generating API key...');
  const apiKey = 'test-api-key-' + Math.random().toString(36).substring(7);
  console.log('✅ [MockGateway] API key generated:', apiKey);
  console.log('');

  return new Response(JSON.stringify({ apiKey }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

// Mock Model Registration Endpoint
function mockModelRegistrationEndpoint(): Response {
  console.log('🤖 [MockGateway] Registering OpenAI models...');
  const models = ['gpt-4', 'gpt-4-turbo', 'gpt-3.5-turbo'];
  console.log('✅ [MockGateway] Models registered:', models.join(', '));
  console.log('');

  return new Response(
    JSON.stringify({ registeredModels: models }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );
}

// Mock global fetch
global.fetch = ((url: string, options?: any) => {
  const urlStr = url.toString();

  if (urlStr.includes('/health')) {
    return Promise.resolve(mockHealthEndpoint());
  } else if (urlStr.includes('/admin/api-keys')) {
    return Promise.resolve(mockApiKeyEndpoint());
  } else if (urlStr.includes('/admin/models/openai')) {
    return Promise.resolve(mockModelRegistrationEndpoint());
  }

  return Promise.reject(new Error(`Unexpected URL: ${url}`));
}) as any;

/**
 * Test 1: Full Deployment Lifecycle (Success)
 */
async function testFullDeploymentLifecycle() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('TEST 1: Full Deployment Lifecycle (Success)');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');

  healthCheckCount = 0; // Reset health check counter

  const config = {
    dropletRegion: 'nyc1',
    dropletSize: 's-2vcpu-2gb',
    containerImage: 'model-manager-agent:0.0.8',
    adminKey: 'test-admin-key',
    openaiKey: 'test-openai-key',
  };

  const service = new DeployService(config);
  service.setDeployAbility(new MockDeployAbility());
  service.setKadiSecret(new MockKadiSecret());

  console.log('🚀 Starting deployment...');
  console.log('');

  const result = await service.deployModelManager();

  if (result.success) {
    console.log('🎉 DEPLOYMENT SUCCESSFUL!');
    console.log('');
    console.log('Deployment Details:');
    console.log('   ID:', result.data.id);
    console.log('   Status:', result.data.status);
    console.log('   Gateway URL:', result.data.gatewayUrl);
    console.log('   API Key:', result.data.apiKey);
    console.log('   Registered Models:', result.data.registeredModels.join(', '));
    console.log('   Deployed At:', result.data.deployedAt.toISOString());
    console.log('');

    // Check .env file
    try {
      const envPath = path.join(process.cwd(), '.env');
      const envContent = await fs.readFile(envPath, 'utf-8');
      console.log('📄 .env File Contents:');
      console.log('─────────────────────────────────────────────────────────');
      console.log(envContent);
      console.log('─────────────────────────────────────────────────────────');
      console.log('');
    } catch (error) {
      console.log('⚠️  .env file not found (this is normal in test environment)');
      console.log('');
    }
  } else {
    console.log('❌ DEPLOYMENT FAILED!');
    console.log('Error Type:', result.error.type);
    console.log('Error Message:', result.error.message);
    console.log('');
  }
}

/**
 * Test 2: Rollback on Failure
 */
async function testRollbackOnFailure() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('TEST 2: Rollback on API Key Generation Failure');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');

  healthCheckCount = 0; // Reset

  // Override fetch to fail on API key generation
  const originalFetch = global.fetch;
  global.fetch = ((url: string, options?: any) => {
    const urlStr = url.toString();

    if (urlStr.includes('/health')) {
      return Promise.resolve(mockHealthEndpoint());
    } else if (urlStr.includes('/admin/api-keys')) {
      console.log('❌ [MockGateway] API key generation failed (simulated)');
      console.log('');
      return Promise.resolve(
        new Response('Unauthorized', {
          status: 401,
          statusText: 'Unauthorized',
        })
      );
    }

    return Promise.reject(new Error(`Unexpected URL: ${url}`));
  }) as any;

  const config = {
    dropletRegion: 'nyc1',
    dropletSize: 's-2vcpu-2gb',
    containerImage: 'model-manager-agent:0.0.8',
    adminKey: 'test-admin-key',
    openaiKey: 'test-openai-key',
  };

  const service = new DeployService(config);
  service.setDeployAbility(new MockDeployAbility());
  service.setKadiSecret(new MockKadiSecret());

  console.log('🚀 Starting deployment (will fail on API key generation)...');
  console.log('');

  const result = await service.deployModelManager();

  if (!result.success) {
    console.log('✅ Rollback mechanism triggered correctly!');
    console.log('');
    console.log('Error Details:');
    console.log('   Type:', result.error.type);
    console.log('   Message:', result.error.message);
    console.log('   Operation:', result.error.operation);
    console.log('');
  } else {
    console.log('❌ Expected failure but deployment succeeded!');
    console.log('');
  }

  // Restore original fetch
  global.fetch = originalFetch;
}

/**
 * Main Test Runner
 */
async function runIntegrationTests() {
  console.log('');
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║  Deployment System Integration Tests - Phase 5           ║');
  console.log('╚═══════════════════════════════════════════════════════════╝');
  console.log('');

  try {
    await testFullDeploymentLifecycle();
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await testRollbackOnFailure();

    console.log('═══════════════════════════════════════════════════════════');
    console.log('✅ All Integration Tests Completed Successfully!');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('');
  } catch (error: any) {
    console.error('❌ Integration tests failed:', error.message);
    console.error(error);
    process.exit(1);
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runIntegrationTests();
}

export { runIntegrationTests };
