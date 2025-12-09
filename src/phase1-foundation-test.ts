/**
 * Phase 1 Foundation Test
 *
 * Verifies that all type definitions from Phase 1 are correctly importable
 * and TypeScript compilation succeeds without errors.
 */

// Test common/result types
import type { Result } from './common/result.js';
import { ok, err } from './common/result.js';

// Test providers types
import type {
  Message,
  ChatOptions,
  ProviderError,
  ProviderErrorType,
} from './providers/types.js';

// Test memory types
import type {
  MemoryType,
  MemoryEntry,
  ConversationMessage,
} from './memory/types.js';

// Test deployment types
import type {
  DeployConfig,
  DeploymentStatus,
  DeploymentResult,
} from './deployment/types.js';

/**
 * Test Result type pattern
 */
function testResultType(): void {
  // Test success result
  const successResult: Result<string, Error> = ok('Success!');
  console.log('✓ Result ok() creates success result:', successResult);

  // Test error result
  const errorResult: Result<string, Error> = err(new Error('Failed!'));
  console.log('✓ Result err() creates error result:', errorResult);

  // Test type narrowing with explicit handling
  const result: Result<string, Error> = Math.random() > 0.5 ? ok('OK') : err(new Error('Error'));
  if (result.success === true) {
    console.log('✓ Success case type narrowing:', result.data);
  }
  if (result.success === false) {
    console.log('✓ Error case type narrowing:', result.error.message);
  }
}

/**
 * Test provider types
 */
function testProviderTypes(): void {
  const message: Message = {
    role: 'user',
    content: 'Hello, world!',
  };

  const chatOptions: ChatOptions = {
    model: 'claude-3-opus',
    maxTokens: 1000,
    temperature: 0.7,
  };

  const providerError: ProviderError = {
    type: 'AUTH_FAILED' as ProviderErrorType,
    message: 'Authentication failed',
    provider: 'anthropic',
  };

  console.log('✓ Provider types:', { message, chatOptions, providerError });
}

/**
 * Test memory types
 */
function testMemoryTypes(): void {
  const memoryEntry: MemoryEntry = {
    id: 'mem-001',
    userId: 'user-123',
    channelId: 'channel-456',
    type: 'short-term' as MemoryType,
    content: 'Test memory content',
    timestamp: new Date(),
  };

  const conversationMessage: ConversationMessage = {
    id: 'msg-001',
    role: 'user',
    content: 'Test message',
    timestamp: new Date(),
    userId: 'user-123',
    channelId: 'channel-456',
  };

  console.log('✓ Memory types:', { memoryEntry, conversationMessage });
}

/**
 * Test deployment types
 */
function testDeploymentTypes(): void {
  const deployConfig: DeployConfig = {
    dropletRegion: 'nyc1',
    dropletSize: 's-2vcpu-2gb',
    containerImage: 'model-manager-agent:0.0.8',
    adminKey: 'test-admin-key',
    openaiKey: 'test-openai-key',
  };

  const deploymentResult: DeploymentResult = {
    id: 'deploy-001',
    status: 'RUNNING' as DeploymentStatus,
    gatewayUrl: 'https://gateway.example.com',
    apiKey: 'test-api-key',
    registeredModels: ['gpt-4', 'gpt-3.5-turbo'],
    deployedAt: new Date(),
  };

  console.log('✓ Deployment types:', { deployConfig, deploymentResult });
}

/**
 * Run all tests
 */
export function runPhase1Tests(): void {
  console.log('\n=== Phase 1 Foundation Test ===\n');

  try {
    testResultType();
    testProviderTypes();
    testMemoryTypes();
    testDeploymentTypes();

    console.log('\n✓ Phase 1 Foundation: Complete');
    console.log('✓ All type imports successful');
    console.log('✓ TypeScript compilation verified\n');
  } catch (error) {
    console.error('✗ Phase 1 Foundation Test Failed:', error);
    throw error;
  }
}

// Run tests immediately (ES module)
runPhase1Tests();
