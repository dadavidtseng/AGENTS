/**
 * Unit Test: Slack Mention Reply Functionality
 *
 * Tests that Agent_TypeScript correctly:
 * 1. Polls MCP_Slack_Client for @mentions
 * 2. Processes mention with Claude API
 * 3. Executes tool calls via KADI broker
 * 4. Replies to Slack thread via MCP_Slack_Server
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SlackBot } from '../src/bot/slack-bot.js';
import type { KadiClient } from '../kadi/kadi-core/src';

// ============================================================================
// Mock Setup
// ============================================================================

// Note: Anthropic SDK is not mocked here because SlackBot uses ProviderManager
// which is mocked directly in the test setup

// Mock KADI Client
class MockKadiClient {
  private protocol: any;
  private brokerManager: any;
  public config: any;
  private eventHandlers: Map<string, ((event: unknown) => void)[]>;

  constructor() {
    this.protocol = {
      invokeTool: vi.fn()
    };

    // Mock BrokerManager with EventEmitter-like interface
    this.brokerManager = {
      on: vi.fn(),
      off: vi.fn(),
      emit: vi.fn()
    };

    this.config = {
      networks: []
    };

    this.eventHandlers = new Map();
  }

  getBrokerProtocol() {
    return this.protocol;
  }

  getBrokerManager() {
    return this.brokerManager;
  }

  subscribeToEvent(topic: string, handler: (event: unknown) => void) {
    // Store handler for this topic
    if (!this.eventHandlers.has(topic)) {
      this.eventHandlers.set(topic, []);
    }
    this.eventHandlers.get(topic)!.push(handler);
  }

  publishEvent(topic: string, data: any) {
    // Mock implementation - do nothing
  }

  // Test helper: trigger an event
  triggerEvent(topic: string, event: unknown) {
    const handlers = this.eventHandlers.get(topic);
    if (handlers) {
      handlers.forEach(handler => handler(event));
    }
  }

  getAllRegisteredTools() {
    return [];
  }

  async connect() {
    return Promise.resolve();
  }

  async disconnect() {
    return Promise.resolve();
  }
}

// ============================================================================
// Test Suite: Slack Mention Reply
// ============================================================================

describe('SlackBot - Mention Reply Functionality', () => {
  let slackBot: SlackBot;
  let mockClient: MockKadiClient;
  let mockProtocol: any;
  let mockProviderManager: any;
  let mockMemoryService: any;

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();

    // Create mock KADI client
    mockClient = new MockKadiClient();
    mockProtocol = mockClient.getBrokerProtocol();

    // Create mock ProviderManager
    mockProviderManager = {
      chat: vi.fn().mockResolvedValue({
        success: true,
        data: 'Mock response'
      })
    };

    // Create mock MemoryService
    mockMemoryService = {
      retrieveContext: vi.fn().mockResolvedValue({
        success: true,
        data: []
      }),
      storeMessage: vi.fn().mockResolvedValue({
        success: true
      })
    };

    // Create SlackBot instance (event-driven, no pollIntervalMs)
    slackBot = new SlackBot({
      client: mockClient as unknown as KadiClient,
      anthropicApiKey: 'test-api-key',
      botUserId: 'U01234ABCD',
      providerManager: mockProviderManager,
      memoryService: mockMemoryService,
    });
  });

  afterEach(() => {
    slackBot.stop();
  });

  // ==========================================================================
  // Test 1: Handle Slack mention event and reply
  // ==========================================================================

  it('should handle Slack mention event and send reply', async () => {
    // Mock Slack mention event (event-driven architecture)
    const mockMentionEvent = {
      id: 'msg-1',
      user: 'test-user',
      text: 'Hello bot!',
      channel: 'C123456',
      thread_ts: '1234567890.123456',
      ts: '1234567890.123456',
      bot_id: 'U01234ABCD',
      timestamp: new Date().toISOString()
    };

    // Mock ProviderManager response
    mockProviderManager.chat.mockResolvedValueOnce({
      success: true,
      data: 'Hello! How can I help you?'
    });

    // Mock slack_send_reply (for sending response)
    mockProtocol.invokeTool.mockResolvedValueOnce({ result: 'Message sent' });

    // Start bot (subscribes to events)
    slackBot.start();

    // Trigger mention event
    const topic = `slack.app_mention.U01234ABCD`;
    mockClient.triggerEvent(topic, mockMentionEvent);

    // Wait for async processing
    await new Promise(resolve => setTimeout(resolve, 100));

    // Verify ProviderManager.chat was called with mention text
    expect(mockProviderManager.chat).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'user',
          content: 'Hello bot!'
        })
      ]),
      expect.objectContaining({
        model: undefined  // No model detected in message
      })
    );

    // Verify slack_send_reply was called
    expect(mockProtocol.invokeTool).toHaveBeenCalledWith({
      targetAgent: 'slack-server',
      toolName: 'slack_send_reply',
      toolInput: {
        channel: 'C123456',
        thread_ts: '1234567890.123456',
        text: 'Hello! How can I help you?'
      },
      timeout: 10000
    });
  });

  // ==========================================================================
  // Test 2: Handle mention with tool use (removed - tool use not supported)
  // ==========================================================================

  it.skip('should process mention with tool use and reply with result', async () => {
    // This test is skipped because the current SlackBot implementation
    // uses ProviderManager which doesn't support tool use.
    // Tool use was removed in favor of simpler text-only responses.
  });

  // ==========================================================================
  // Test 3: Handle multiple mention events sequentially
  // ==========================================================================

  it('should process multiple mention events sequentially', async () => {
    // Mock multiple mention events
    const mockMentionEvent1 = {
      id: 'msg-1',
      user: 'user1',
      text: 'First message',
      channel: 'C123456',
      thread_ts: '1234567890.111111',
      ts: '1234567890.111111',
      bot_id: 'U01234ABCD',
      timestamp: new Date().toISOString()
    };

    const mockMentionEvent2 = {
      id: 'msg-2',
      user: 'user2',
      text: 'Second message',
      channel: 'C123456',
      thread_ts: '1234567890.222222',
      ts: '1234567890.222222',
      bot_id: 'U01234ABCD',
      timestamp: new Date(Date.now() + 1000).toISOString()
    };

    // Setup mock responses
    mockProviderManager.chat
      .mockResolvedValueOnce({
        success: true,
        data: 'Reply to first'
      })
      .mockResolvedValueOnce({
        success: true,
        data: 'Reply to second'
      });

    mockProtocol.invokeTool
      .mockResolvedValueOnce({ result: 'Sent 1' })
      .mockResolvedValueOnce({ result: 'Sent 2' });

    // Start bot
    slackBot.start();

    // Trigger both events
    const topic = `slack.app_mention.U01234ABCD`;
    mockClient.triggerEvent(topic, mockMentionEvent1);
    mockClient.triggerEvent(topic, mockMentionEvent2);

    // Wait for processing
    await new Promise(resolve => setTimeout(resolve, 200));

    // Verify both replies were sent
    expect(mockProtocol.invokeTool).toHaveBeenCalledWith({
      targetAgent: 'slack-server',
      toolName: 'slack_send_reply',
      toolInput: {
        channel: 'C123456',
        thread_ts: '1234567890.111111',
        text: 'Reply to first'
      },
      timeout: 10000
    });

    expect(mockProtocol.invokeTool).toHaveBeenCalledWith({
      targetAgent: 'slack-server',
      toolName: 'slack_send_reply',
      toolInput: {
        channel: 'C123456',
        thread_ts: '1234567890.222222',
        text: 'Reply to second'
      },
      timeout: 10000
    });
  });

  // ==========================================================================
  // Test 4: Handle error during mention processing
  // ==========================================================================

  it('should send error message to Slack when processing fails', async () => {
    // Mock mention event
    const mockMentionEvent = {
      id: 'msg-1',
      user: 'test-user',
      text: 'Hello bot!',
      channel: 'C123456',
      thread_ts: '1234567890.123456',
      ts: '1234567890.123456',
      bot_id: 'U01234ABCD',
      timestamp: new Date().toISOString()
    };

    // Mock ProviderManager error result
    mockProviderManager.chat.mockResolvedValueOnce({
      success: false,
      error: {
        type: 'RATE_LIMIT',
        message: 'Rate limit exceeded',
        provider: 'anthropic'
      }
    });

    // Setup mocks
    mockProtocol.invokeTool.mockResolvedValueOnce({ result: 'Error sent' });

    // Start bot
    slackBot.start();

    // Trigger event
    const topic = `slack.app_mention.U01234ABCD`;
    mockClient.triggerEvent(topic, mockMentionEvent);

    // Wait for processing
    await new Promise(resolve => setTimeout(resolve, 150));

    // Verify error message was sent (check for user-friendly error message)
    expect(mockProtocol.invokeTool).toHaveBeenCalledWith(
      expect.objectContaining({
        targetAgent: 'slack-server',
        toolName: 'slack_send_reply',
        toolInput: expect.objectContaining({
          channel: 'C123456',
          thread_ts: '1234567890.123456',
          // Error message should contain 'issue' or 'error' but not include stack traces
          text: expect.stringMatching(/issue|error/i)
        })
      })
    );
  });

  // ==========================================================================
  // Test 5: Handle no events (event-driven architecture)
  // ==========================================================================

  it('should not call ProviderManager when no events are triggered', async () => {
    // Start bot (subscribes to events)
    slackBot.start();

    // Wait without triggering any events
    await new Promise(resolve => setTimeout(resolve, 100));

    // Verify ProviderManager was NOT called
    expect(mockProviderManager.chat).not.toHaveBeenCalled();

    // Verify no send_reply calls
    expect(mockProtocol.invokeTool).not.toHaveBeenCalled();
  });
});
