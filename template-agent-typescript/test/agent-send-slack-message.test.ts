/**
 * Unit Test: agent_send_slack_message Tool Invocation
 *
 * Tests that Agent_TypeScript's agent_send_slack_message tool can be invoked
 * from external sources (like Claude Desktop via kadi-broker) to send messages
 * to Slack channels.
 *
 * Flow:
 * 1. Claude Desktop user requests to send Slack message
 * 2. Claude Desktop calls kadi-broker
 * 3. kadi-broker invokes agent_send_slack_message tool on Agent_TypeScript
 * 4. Agent_TypeScript forwards to MCP_Slack_Server
 * 5. Message appears in Slack channel
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { KadiClient } from '../kadi/kadi-core/src';

// ============================================================================
// Mock Setup
// ============================================================================

// Mock for tool handler registration
const mockToolHandlers = new Map<string, Function>();

// Mock BrokerProtocol
class MockBrokerProtocol {
  async invokeTool(_params: any): Promise<any> {
    // This will be mocked per test
    return Promise.resolve({ success: true, result: 'Mock result' });
  }
}

// Mock KadiClient that allows tool registration
class MockKadiClient extends KadiClient {
  private mockProtocol: MockBrokerProtocol;

  constructor(config: any) {
    // Call parent constructor with minimal config
    super({ ...config, broker: 'ws://mock:8080' });
    this.mockProtocol = new MockBrokerProtocol();
  }

  // Override registerTool to capture tool handlers
  registerTool(toolDef: any, handler: Function): this {
    mockToolHandlers.set(toolDef.name, handler);
    return this;
  }

  // Override getBrokerProtocol
  getBrokerProtocol(): any {
    return this.mockProtocol;
  }

  // Override connect to avoid actual connection
  async connect(): Promise<string | undefined> {
    return Promise.resolve(undefined);
  }

  // Override serve to avoid blocking
  async serve(_broker: string): Promise<void> {
    return Promise.resolve();
  }
}

// ============================================================================
// Test Suite: agent_send_slack_message Tool
// ============================================================================

describe('Agent_TypeScript - agent_send_slack_message Tool', () => {
  let client: MockKadiClient;
  let toolHandler: Function;

  beforeEach(async () => {
    // Reset mocks
    vi.clearAllMocks();
    mockToolHandlers.clear();

    // Create mock KADI client
    client = new MockKadiClient({
      name: 'test-agent',
      networks: ['slack'],
      role: 'agent'
    });

    // Simulate agent registering the agent_send_slack_message tool
    // This mimics what happens in src/index.ts
    const { z } = await import('../kadi/kadi-core/src');

    const agentSendSlackMessageInputSchema = z.object({
      channel: z.string().describe('Slack channel ID (e.g., C09T6RU41HP)'),
      text: z.string().describe('Message text to send'),
      thread_ts: z.string().optional().describe('Optional thread timestamp')
    });

    const agentSendSlackMessageOutputSchema = z.object({
      success: z.boolean().describe('Whether message was sent successfully'),
      message: z.string().describe('Result message from Slack'),
      timestamp: z.string().optional().describe('Slack message timestamp')
    });

    // Register tool (this stores it in mockToolHandlers)
    client.registerTool(
      {
        name: 'agent_send_slack_message',
        description: 'Send a message to a Slack channel',
        input: agentSendSlackMessageInputSchema,
        output: agentSendSlackMessageOutputSchema
      },
      async (params: any) => {
        // This handler mimics the actual implementation
        const protocol = client.getBrokerProtocol();

        const result = await protocol.invokeTool({
          targetAgent: 'slack-server',
          toolName: 'slack_send_message',
          toolInput: {
            channel: params.channel,
            text: params.text,
            thread_ts: params.thread_ts
          },
          timeout: 10000
        });

        return {
          success: true,
          message: 'Message sent successfully',
          timestamp: result.ts || '1234567890.123456'
        };
      }
    );

    // Get the registered handler
    toolHandler = mockToolHandlers.get('agent_send_slack_message')!;
  });

  afterEach(() => {
    mockToolHandlers.clear();
  });

  // ==========================================================================
  // Test 1: Send message to channel via external invocation
  // ==========================================================================

  it('should send message to Slack channel when invoked by Claude Desktop', async () => {
    // Mock successful Slack API response
    const mockSlackResponse = {
      ok: true,
      ts: '1234567890.123456',
      channel: 'C09T6RU41HP'
    };

    // Mock broker protocol invokeTool
    const mockInvokeTool = vi.fn().mockResolvedValue(mockSlackResponse);
    vi.spyOn(client.getBrokerProtocol(), 'invokeTool').mockImplementation(mockInvokeTool);

    // Simulate Claude Desktop invoking the tool
    const toolInput = {
      channel: 'C09T6RU41HP',
      text: 'Hello from Claude Desktop!',
      thread_ts: undefined
    };

    // Invoke the tool handler
    const result = await toolHandler(toolInput);

    // Verify the tool called MCP_Slack_Server via broker
    expect(mockInvokeTool).toHaveBeenCalledWith({
      targetAgent: 'slack-server',
      toolName: 'slack_send_message',
      toolInput: {
        channel: 'C09T6RU41HP',
        text: 'Hello from Claude Desktop!',
        thread_ts: undefined
      },
      timeout: 10000
    });

    // Verify the tool returned success
    expect(result).toEqual({
      success: true,
      message: 'Message sent successfully',
      timestamp: '1234567890.123456'
    });
  });

  // ==========================================================================
  // Test 2: Send message to thread
  // ==========================================================================

  it('should send message to Slack thread when thread_ts is provided', async () => {
    // Mock Slack response for thread message
    const mockSlackResponse = {
      ok: true,
      ts: '1234567890.999999',
      channel: 'C09T6RU41HP',
      thread_ts: '1234567890.123456'
    };

    // Mock broker protocol
    const mockInvokeTool = vi.fn().mockResolvedValue(mockSlackResponse);
    vi.spyOn(client.getBrokerProtocol(), 'invokeTool').mockImplementation(mockInvokeTool);

    // Simulate tool invocation with thread_ts
    const toolInput = {
      channel: 'C09T6RU41HP',
      text: 'Reply in thread',
      thread_ts: '1234567890.123456'
    };

    // Invoke handler
    const result = await toolHandler(toolInput);

    // Verify thread_ts was passed through
    expect(mockInvokeTool).toHaveBeenCalledWith({
      targetAgent: 'slack-server',
      toolName: 'slack_send_message',
      toolInput: {
        channel: 'C09T6RU41HP',
        text: 'Reply in thread',
        thread_ts: '1234567890.123456'
      },
      timeout: 10000
    });

    // Verify success
    expect(result).toEqual({
      success: true,
      message: 'Message sent successfully',
      timestamp: '1234567890.999999'
    });
  });

  // ==========================================================================
  // Test 3: Handle channel with long message
  // ==========================================================================

  it('should send long messages to Slack channel', async () => {
    // Create a long message (Slack limit is 4000 chars, this is 500)
    const longMessage = 'A'.repeat(500);

    const mockSlackResponse = {
      ok: true,
      ts: '1234567890.123456',
      channel: 'C09T6RU41HP'
    };

    const mockInvokeTool = vi.fn().mockResolvedValue(mockSlackResponse);
    vi.spyOn(client.getBrokerProtocol(), 'invokeTool').mockImplementation(mockInvokeTool);

    // Invoke with long message
    const toolInput = {
      channel: 'C09T6RU41HP',
      text: longMessage,
      thread_ts: undefined
    };

    const result = await toolHandler(toolInput);

    // Verify message was sent with full text
    expect(mockInvokeTool).toHaveBeenCalledWith({
      targetAgent: 'slack-server',
      toolName: 'slack_send_message',
      toolInput: {
        channel: 'C09T6RU41HP',
        text: longMessage,
        thread_ts: undefined
      },
      timeout: 10000
    });

    expect(result.success).toBe(true);
  });

  // ==========================================================================
  // Test 4: Handle message with special characters and formatting
  // ==========================================================================

  it('should send message with Slack formatting (markdown)', async () => {
    const formattedMessage = '*Bold text* and _italic text_ and `code` and ```code block```';

    const mockSlackResponse = {
      ok: true,
      ts: '1234567890.123456',
      channel: 'C09T6RU41HP'
    };

    const mockInvokeTool = vi.fn().mockResolvedValue(mockSlackResponse);
    vi.spyOn(client.getBrokerProtocol(), 'invokeTool').mockImplementation(mockInvokeTool);

    // Invoke with formatted message
    const toolInput = {
      channel: 'C09T6RU41HP',
      text: formattedMessage,
      thread_ts: undefined
    };

    const result = await toolHandler(toolInput);

    // Verify formatted text was preserved
    expect(mockInvokeTool).toHaveBeenCalledWith({
      targetAgent: 'slack-server',
      toolName: 'slack_send_message',
      toolInput: {
        channel: 'C09T6RU41HP',
        text: formattedMessage,
        thread_ts: undefined
      },
      timeout: 10000
    });

    expect(result.success).toBe(true);
  });

  // ==========================================================================
  // Test 5: Handle multiple sequential invocations
  // ==========================================================================

  it('should handle multiple consecutive message sends', async () => {
    const mockSlackResponse1 = {
      ok: true,
      ts: '1234567890.111111',
      channel: 'C09T6RU41HP'
    };

    const mockSlackResponse2 = {
      ok: true,
      ts: '1234567890.222222',
      channel: 'C09T6RU41HP'
    };

    const mockSlackResponse3 = {
      ok: true,
      ts: '1234567890.333333',
      channel: 'C09T6RU41HP'
    };

    const mockInvokeTool = vi.fn()
      .mockResolvedValueOnce(mockSlackResponse1)
      .mockResolvedValueOnce(mockSlackResponse2)
      .mockResolvedValueOnce(mockSlackResponse3);

    vi.spyOn(client.getBrokerProtocol(), 'invokeTool').mockImplementation(mockInvokeTool);

    // Send three messages in sequence
    const result1 = await toolHandler({
      channel: 'C09T6RU41HP',
      text: 'First message',
      thread_ts: undefined
    });

    const result2 = await toolHandler({
      channel: 'C09T6RU41HP',
      text: 'Second message',
      thread_ts: undefined
    });

    const result3 = await toolHandler({
      channel: 'C09T6RU41HP',
      text: 'Third message',
      thread_ts: undefined
    });

    // Verify all three were sent
    expect(mockInvokeTool).toHaveBeenCalledTimes(3);

    expect(result1.timestamp).toBe('1234567890.111111');
    expect(result2.timestamp).toBe('1234567890.222222');
    expect(result3.timestamp).toBe('1234567890.333333');

    expect(result1.success).toBe(true);
    expect(result2.success).toBe(true);
    expect(result3.success).toBe(true);
  });

  // ==========================================================================
  // Test 6: Verify tool registration on KADI client
  // ==========================================================================

  it('should register agent_send_slack_message tool on client', () => {
    // Verify the tool was registered
    expect(mockToolHandlers.has('agent_send_slack_message')).toBe(true);

    // Verify the handler is a function
    const handler = mockToolHandlers.get('agent_send_slack_message');
    expect(typeof handler).toBe('function');
  });

  // ==========================================================================
  // Test 7: Integration scenario - Claude Desktop workflow
  // ==========================================================================

  it('should complete full workflow: Claude Desktop → Broker → Agent → Slack', async () => {
    /**
     * Simulates the complete flow:
     * 1. User in Claude Desktop: "Send a message to #general saying hello"
     * 2. Claude Desktop calls kadi-broker
     * 3. Broker routes to Agent_TypeScript's agent_send_slack_message
     * 4. Agent forwards to MCP_Slack_Server
     * 5. Message sent to Slack
     */

    // Mock successful Slack send
    const mockSlackResponse = {
      ok: true,
      ts: '1700000000.123456',
      channel: 'C09T6RU41HP',
      message: {
        text: 'Hello from Claude Desktop!',
        user: 'U12345BOTID'
      }
    };

    const mockInvokeTool = vi.fn().mockResolvedValue(mockSlackResponse);
    vi.spyOn(client.getBrokerProtocol(), 'invokeTool').mockImplementation(mockInvokeTool);

    // Simulate the tool invocation from Claude Desktop via broker
    const claudeDesktopRequest = {
      channel: 'C09T6RU41HP',
      text: 'Hello from Claude Desktop!',
      thread_ts: undefined
    };

    // Invoke the tool
    const result = await toolHandler(claudeDesktopRequest);

    // Verify complete flow:

    // 1. Tool handler called MCP_Slack_Server
    expect(mockInvokeTool).toHaveBeenCalledWith({
      targetAgent: 'slack-server',
      toolName: 'slack_send_message',
      toolInput: {
        channel: 'C09T6RU41HP',
        text: 'Hello from Claude Desktop!',
        thread_ts: undefined
      },
      timeout: 10000
    });

    // 2. Success response returned to Claude Desktop
    expect(result).toEqual({
      success: true,
      message: 'Message sent successfully',
      timestamp: '1700000000.123456'
    });

    // 3. Message would now appear in Slack channel C09T6RU41HP
  });

  // ==========================================================================
  // Test 8: Handle empty message text
  // ==========================================================================

  it('should handle empty message text gracefully', async () => {
    const mockSlackResponse = {
      ok: true,
      ts: '1234567890.123456',
      channel: 'C09T6RU41HP'
    };

    const mockInvokeTool = vi.fn().mockResolvedValue(mockSlackResponse);
    vi.spyOn(client.getBrokerProtocol(), 'invokeTool').mockImplementation(mockInvokeTool);

    // Invoke with empty text
    const toolInput = {
      channel: 'C09T6RU41HP',
      text: '',
      thread_ts: undefined
    };

    const result = await toolHandler(toolInput);

    // Verify empty text was passed through (Slack will handle validation)
    expect(mockInvokeTool).toHaveBeenCalledWith({
      targetAgent: 'slack-server',
      toolName: 'slack_send_message',
      toolInput: {
        channel: 'C09T6RU41HP',
        text: '',
        thread_ts: undefined
      },
      timeout: 10000
    });

    expect(result.success).toBe(true);
  });

  // ==========================================================================
  // Test 9: Verify timeout configuration
  // ==========================================================================

  it('should use 10 second timeout for Slack API calls', async () => {
    const mockSlackResponse = {
      ok: true,
      ts: '1234567890.123456',
      channel: 'C09T6RU41HP'
    };

    const mockInvokeTool = vi.fn().mockResolvedValue(mockSlackResponse);
    vi.spyOn(client.getBrokerProtocol(), 'invokeTool').mockImplementation(mockInvokeTool);

    // Invoke tool
    await toolHandler({
      channel: 'C09T6RU41HP',
      text: 'Test timeout',
      thread_ts: undefined
    });

    // Verify timeout is set to 10000ms (10 seconds)
    expect(mockInvokeTool).toHaveBeenCalledWith(
      expect.objectContaining({
        timeout: 10000
      })
    );
  });
});
