/**
 * Quick Test Script for Model Manager Gateway (Insecure Mode)
 *
 * Tests the ComputeForge Model Manager Gateway with self-signed certificate
 * by disabling SSL verification (USE ONLY FOR TESTING)
 *
 * Usage:
 *   npx tsx scripts/test-gateway-insecure.ts
 */

// IMPORTANT: Disable SSL verification for self-signed certificates
// WARNING: This is insecure and should only be used for testing
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import { ModelManagerProvider } from '../src/providers/model-manager-provider.js';

// Gateway credentials
const GATEWAY_URL = 'https://8ol7dvriehac32jjeiiijms0qg.ingress.computeforge.com';
const API_KEY = 'kadi_live_62e2fe44b367e92498d064bbd3b355b72b04557cde28b322';

async function testModelManagerGateway() {
  console.log('='.repeat(60));
  console.log('Model Manager Gateway Quick Test (Insecure Mode)');
  console.log('⚠️  SSL certificate verification DISABLED');
  console.log('='.repeat(60));
  console.log(`Gateway URL: ${GATEWAY_URL}`);
  console.log(`API Key: ${API_KEY.substring(0, 20)}...`);
  console.log('');

  // Create provider instance
  const provider = new ModelManagerProvider(GATEWAY_URL, API_KEY, 30000);

  // Test 1: Health Check
  console.log('Test 1: Health Check');
  console.log('-'.repeat(60));
  try {
    const isHealthy = await provider.isHealthy();
    console.log(`✅ Health check result: ${isHealthy ? 'HEALTHY' : 'UNHEALTHY'}`);
    if (!isHealthy) {
      console.warn('⚠️  Gateway is unhealthy - check credentials and URL');
    }
  } catch (error: any) {
    console.error('❌ Health check failed:', error.message);
  }
  console.log('');

  // Test 2: Get Available Models
  console.log('Test 2: Get Available Models');
  console.log('-'.repeat(60));
  try {
    const modelsResult = await provider.getAvailableModels();
    if (modelsResult.success) {
      console.log(`✅ Found ${modelsResult.data.length} models:`);
      modelsResult.data.slice(0, 10).forEach((model, index) => {
        console.log(`   ${index + 1}. ${model}`);
      });
      if (modelsResult.data.length > 10) {
        console.log(`   ... and ${modelsResult.data.length - 10} more`);
      }
    } else {
      console.error(`❌ Failed to get models: ${modelsResult.error.type} - ${modelsResult.error.message}`);
    }
  } catch (error: any) {
    console.error('❌ Get models failed:', error.message);
  }
  console.log('');

  // Test 3: Simple Chat Request
  console.log('Test 3: Simple Chat Request (gpt-4o-mini)');
  console.log('-'.repeat(60));
  try {
    const chatResult = await provider.chat(
      [
        { role: 'user', content: 'Say "Hello from Model Manager!" and nothing else.' }
      ],
      {
        model: 'gpt-4o-mini',
        maxTokens: 50,
        temperature: 0.7,
      }
    );

    if (chatResult.success) {
      console.log('✅ Chat response received:');
      console.log(`   "${chatResult.data}"`);
    } else {
      console.error(`❌ Chat failed: ${chatResult.error.type} - ${chatResult.error.message}`);
    }
  } catch (error: any) {
    console.error('❌ Chat request failed:', error.message);
  }
  console.log('');

  // Test 4: Streaming Chat Request
  console.log('Test 4: Streaming Chat Request (gpt-4o-mini)');
  console.log('-'.repeat(60));
  try {
    const streamResult = await provider.streamChat(
      [
        { role: 'user', content: 'Count from 1 to 5, one number per line.' }
      ],
      {
        model: 'gpt-4o-mini',
        maxTokens: 100,
        temperature: 0.7,
      }
    );

    if (streamResult.success) {
      console.log('✅ Streaming response:');
      process.stdout.write('   ');

      for await (const chunk of streamResult.data) {
        process.stdout.write(chunk);
      }

      console.log('');
      console.log('✅ Stream completed successfully');
    } else {
      console.error(`❌ Streaming failed: ${streamResult.error.type} - ${streamResult.error.message}`);
    }
  } catch (error: any) {
    console.error('❌ Streaming request failed:', error.message);
  }
  console.log('');

  // Summary
  console.log('='.repeat(60));
  console.log('Test Summary');
  console.log('='.repeat(60));
  console.log('');
  console.log('⚠️  SECURITY WARNING:');
  console.log('   SSL verification was disabled for this test.');
  console.log('   For production use, ensure proper SSL certificates.');
  console.log('');
  console.log('Next steps:');
  console.log('  1. Verify gateway has valid SSL certificate for production');
  console.log('  2. Add MODEL_MANAGER_BASE_URL and MODEL_MANAGER_API_KEY to .env');
  console.log('  3. Continue with Phase 6 implementation (Task 6.3)');
  console.log('');
}

// Run tests
testModelManagerGateway().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
