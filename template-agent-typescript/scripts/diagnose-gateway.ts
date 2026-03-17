/**
 * Diagnostic Script for Model Manager Gateway
 *
 * Performs detailed diagnostics to troubleshoot connection issues
 */

const GATEWAY_URL = 'https://8ol7dvriehac32jjeiiijms0qg.ingress.computeforge.com';
const API_KEY = 'kadi_live_62e2fe44b367e92498d064bbd3b355b72b04557cde28b322';

async function diagnoseGateway() {
  console.log('='.repeat(60));
  console.log('Model Manager Gateway Diagnostics');
  console.log('='.repeat(60));
  console.log(`Gateway URL: ${GATEWAY_URL}`);
  console.log(`API Key: ${API_KEY.substring(0, 20)}...`);
  console.log('');

  // Test 1: Basic connectivity (no auth)
  console.log('Test 1: Basic Connectivity (HEAD request)');
  console.log('-'.repeat(60));
  try {
    const response = await fetch(GATEWAY_URL, {
      method: 'HEAD',
      signal: AbortSignal.timeout(5000),
    });
    console.log(`✅ URL is reachable`);
    console.log(`   Status: ${response.status} ${response.statusText}`);
    console.log(`   Headers:`, Object.fromEntries(response.headers.entries()));
  } catch (error: any) {
    console.error(`❌ URL unreachable: ${error.message}`);
    if (error.cause) {
      console.error(`   Cause: ${error.cause.message || error.cause}`);
    }
  }
  console.log('');

  // Test 2: Models endpoint with auth
  console.log('Test 2: Models Endpoint (/v1/models)');
  console.log('-'.repeat(60));
  try {
    const response = await fetch(`${GATEWAY_URL}/v1/models`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
      },
      signal: AbortSignal.timeout(10000),
    });

    console.log(`   Status: ${response.status} ${response.statusText}`);
    console.log(`   Content-Type: ${response.headers.get('content-type')}`);

    if (response.ok) {
      const data = await response.json();
      console.log(`✅ Models endpoint successful`);
      console.log(`   Response:`, JSON.stringify(data, null, 2));
    } else {
      console.error(`❌ Models endpoint failed`);
      const text = await response.text();
      console.error(`   Response body:`, text);
    }
  } catch (error: any) {
    console.error(`❌ Models endpoint error: ${error.message}`);
    if (error.cause) {
      console.error(`   Cause: ${error.cause.message || error.cause}`);
    }
  }
  console.log('');

  // Test 3: Chat completions endpoint
  console.log('Test 3: Chat Completions Endpoint (/v1/chat/completions)');
  console.log('-'.repeat(60));
  try {
    const response = await fetch(`${GATEWAY_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'user', content: 'Say "test" and nothing else.' }
        ],
        max_tokens: 10,
      }),
      signal: AbortSignal.timeout(30000),
    });

    console.log(`   Status: ${response.status} ${response.statusText}`);
    console.log(`   Content-Type: ${response.headers.get('content-type')}`);

    if (response.ok) {
      const data = await response.json();
      console.log(`✅ Chat completions successful`);
      console.log(`   Response:`, JSON.stringify(data, null, 2));
    } else {
      console.error(`❌ Chat completions failed`);
      const text = await response.text();
      console.error(`   Response body:`, text);
    }
  } catch (error: any) {
    console.error(`❌ Chat completions error: ${error.message}`);
    if (error.cause) {
      console.error(`   Cause: ${error.cause.message || error.cause}`);
    }
  }
  console.log('');

  console.log('='.repeat(60));
  console.log('Diagnostics Complete');
  console.log('='.repeat(60));
}

diagnoseGateway().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
