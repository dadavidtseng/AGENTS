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
import { SlackBot } from '../bot/slack-bot.js';
import type { KadiClient } from '@kadi.build/core';

// ============================================================================
// Mock Setup
// ============================================================================

// Mock Anthropic SDK
const mockAnthropicCreate = vi.fn();
vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = {
      create: mockAnthropicCreate
    };
  }
}));

// Mock KADI Client
class MockKadiClient {
  private protocol: any;

  constructor() {
    this.protocol = {
      invokeTool: vi.fn()
    };
  }

  getBrokerProtocol() {
    return this.protocol;
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

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();

    // Create mock KADI client
    mockClient = new MockKadiClient();
    mockProtocol = mockClient.getBrokerProtocol();

    // Create SlackBot instance (event-driven, no pollIntervalMs)
    slackBot = new SlackBot({
      client: mockClient as unknown as KadiClient,
      anthropicApiKey: 'test-api-key',
      botUserId: 'U01234ABCD',
    });
  });

  afterEach(() => {
    slackBot.stop();
  });

  // ==========================================================================
  // Test 1: Poll for mentions and retrieve from MCP_Slack_Client
  // ==========================================================================

  it('should poll MCP_Slack_Client and retrieve @mentions', async () => {
    // Mock slack_client_get_slack_mentions response
    const mockMentions = {
      result: JSON.stringify({
        mentions: [
          {
            id: 'msg-1',
            user: 'test-user',
            text: 'Hello bot!',
            channel: 'C123456',
            thread_ts: '1234567890.123456',
            ts: '1234567890.123456'
          }
        ]
      })
    };

    // Mock Claude API response (simple text response, no tool use)
    const mockClaudeResponse = {
      id: 'msg_123',
      type: 'message',
      role: 'assistant',
      content: [
        {
          type: 'text',
          text: 'Hello! How can I help you?'
        }
      ],
      model: 'claude-3-haiku-20240307',
      stop_reason: 'end_turn',
      usage: { input_tokens: 10, output_tokens: 20 }
    };

    // Mock slack_send_reply (for sending response)
    mockProtocol.invokeTool
      .mockResolvedValueOnce(mockMentions)  // First call: get_slack_mentions
      .mockResolvedValueOnce({ result: 'Message sent' });  // Second call: send_reply

    mockAnthropicCreate.mockResolvedValueOnce(mockClaudeResponse);

    // Start bot (begins polling)
    slackBot.start();

    // Wait for polling cycle to complete
    await new Promise(resolve => setTimeout(resolve, 200));

    // Verify get_slack_mentions was called
    expect(mockProtocol.invokeTool).toHaveBeenCalledWith({
      targetAgent: 'slack-client',
      toolName: 'slack_client_get_slack_mentions',
      toolInput: { limit: 5 },
      timeout: 10000
    });

    // Verify Claude API was called with mention text
    expect(mockAnthropicCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'claude-3-haiku-20240307',
        max_tokens: 4096,
        messages: [
          {
            role: 'user',
            content: 'Hello bot!'
          }
        ]
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
  // Test 2: Handle Claude tool use (count_words)
  // ==========================================================================

  it('should process mention with tool use and reply with result', async () => {
    // Mock mention requesting word count
    const mockMentions = {
      result: JSON.stringify({
        mentions: [
          {
            id: 'msg-2',
            user: 'test-user',
            text: 'Count words in this message',
            channel: 'C123456',
            thread_ts: '1234567890.123456',
            ts: '1234567890.123456'
          }
        ]
      })
    };

    // Mock Claude response with tool use
    const mockClaudeToolUse = {
      id: 'msg_123',
      type: 'message',
      role: 'assistant',
      content: [
        {
          type: 'text',
          text: 'I\'ll count the words for you.'
        },
        {
          type: 'tool_use',
          id: 'tool_123',
          name: 'count_words',
          input: {
            text: 'Count words in this message'
          }
        }
      ],
      model: 'claude-3-haiku-20240307',
      stop_reason: 'tool_use',
      usage: { input_tokens: 10, output_tokens: 20 }
    };

    // Mock tool execution result
    const mockToolResult = {
      success: true,
      result: {
        words: 5,
        characters: 29,
        lines: 1
      }
    };

    // Mock Claude final response after tool execution
    const mockClaudeFinalResponse = {
      id: 'msg_124',
      type: 'message',
      role: 'assistant',
      content: [
        {
          type: 'text',
          text: 'The message contains 5 words, 29 characters, and 1 line.'
        }
      ],
      model: 'claude-3-haiku-20240307',
      stop_reason: 'end_turn',
      usage: { input_tokens: 10, output_tokens: 20 }
    };

    // Setup mock call sequence
    mockProtocol.invokeTool
      .mockResolvedValueOnce(mockMentions)          // 1. get_slack_mentions
      .mockResolvedValueOnce(mockToolResult)        // 2. count_words tool
      .mockResolvedValueOnce({ result: 'Message sent' });  // 3. send_reply

    mockAnthropicCreate
      .mockResolvedValueOnce(mockClaudeToolUse)     // 1. Initial response with tool use
      .mockResolvedValueOnce(mockClaudeFinalResponse);  // 2. Final response after tool

    // Start bot
    slackBot.start();

    // Wait for processing
    await new Promise(resolve => setTimeout(resolve, 300));

    // Verify count_words tool was called
    expect(mockProtocol.invokeTool).toHaveBeenCalledWith(
      expect.objectContaining({
        targetAgent: 'template-agent-typescript',
        toolName: 'count_words',
        toolInput: {
          text: 'Count words in this message'
        }
      })
    );

    // Verify final reply was sent
    expect(mockProtocol.invokeTool).toHaveBeenCalledWith({
      targetAgent: 'slack-server',
      toolName: 'slack_send_reply',
      toolInput: {
        channel: 'C123456',
        thread_ts: '1234567890.123456',
        text: 'The message contains 5 words, 29 characters, and 1 line.'
      },
      timeout: 10000
    });
  });

  // ==========================================================================
  // Test 3: Handle multiple mentions in queue
  // ==========================================================================

  it('should process multiple mentions sequentially', async () => {
    // Mock multiple mentions
    const mockMentions = {
      result: JSON.stringify({
        mentions: [
          {
            id: 'msg-1',
            user: 'user1',
            text: 'First message',
            channel: 'C123456',
            thread_ts: '1234567890.111111',
            ts: '1234567890.111111'
          },
          {
            id: 'msg-2',
            user: 'user2',
            text: 'Second message',
            channel: 'C123456',
            thread_ts: '1234567890.222222',
            ts: '1234567890.222222'
          }
        ]
      })
    };

    // Mock Claude responses for both messages
    const mockResponse1 = {
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: 'Reply to first' }],
      model: 'claude-3-haiku-20240307',
      stop_reason: 'end_turn',
      usage: { input_tokens: 10, output_tokens: 20 }
    };

    const mockResponse2 = {
      id: 'msg_2',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: 'Reply to second' }],
      model: 'claude-3-haiku-20240307',
      stop_reason: 'end_turn',
      usage: { input_tokens: 10, output_tokens: 20 }
    };

    // Setup mock sequence
    mockProtocol.invokeTool
      .mockResolvedValueOnce(mockMentions)          // 1. get_slack_mentions
      .mockResolvedValueOnce({ result: 'Sent 1' })  // 2. send_reply for msg-1
      .mockResolvedValueOnce({ result: 'Sent 2' }); // 3. send_reply for msg-2

    mockAnthropicCreate
      .mockResolvedValueOnce(mockResponse1)
      .mockResolvedValueOnce(mockResponse2);

    // Start bot
    slackBot.start();

    // Wait for processing
    await new Promise(resolve => setTimeout(resolve, 300));

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
    // Mock mention
    const mockMentions = {
      result: JSON.stringify({
        mentions: [
          {
            id: 'msg-1',
            user: 'test-user',
            text: 'Hello bot!',
            channel: 'C123456',
            thread_ts: '1234567890.123456',
            ts: '1234567890.123456'
          }
        ]
      })
    };

    // Mock Claude API error
    mockAnthropicCreate.mockRejectedValueOnce(new Error('API rate limit exceeded'));

    // Setup mocks
    mockProtocol.invokeTool
      .mockResolvedValueOnce(mockMentions)          // 1. get_slack_mentions
      .mockResolvedValueOnce({ result: 'Error sent' });  // 2. send_reply with error

    // Start bot
    slackBot.start();

    // Wait for processing
    await new Promise(resolve => setTimeout(resolve, 300));

    // Verify error message was sent
    expect(mockProtocol.invokeTool).toHaveBeenCalledWith({
      targetAgent: 'slack-server',
      toolName: 'slack_send_reply',
      toolInput: {
        channel: 'C123456',
        thread_ts: '1234567890.123456',
        text: 'Sorry, I encountered an error processing your message. Please try again later.'
      },
      timeout: 10000
    });
  });

  // ==========================================================================
  // Test 5: Handle empty mention queue (no mentions)
  // ==========================================================================

  it('should not call Claude API when no mentions are available', async () => {
    // Mock empty mention queue
    const mockEmptyMentions = {
      result: JSON.stringify({
        mentions: []
      })
    };

    mockProtocol.invokeTool.mockResolvedValueOnce(mockEmptyMentions);

    // Start bot
    slackBot.start();

    // Wait for polling cycle
    await new Promise(resolve => setTimeout(resolve, 200));

    // Verify get_slack_mentions was called at least once
    expect(mockProtocol.invokeTool).toHaveBeenCalledWith({
      targetAgent: 'slack-client',
      toolName: 'slack_client_get_slack_mentions',
      toolInput: { limit: 5 },
      timeout: 10000
    });

    // Verify Claude API was NOT called
    expect(mockAnthropicCreate).not.toHaveBeenCalled();

    // Verify only polling happened (no send_reply calls)
    // Note: May be called 1-2 times depending on timing (100ms interval, 200ms wait)
    expect(mockProtocol.invokeTool.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(mockProtocol.invokeTool.mock.calls.length).toBeLessThanOrEqual(2);
  });
});
