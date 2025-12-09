# Agent_TypeScript Unit Tests

This directory contains comprehensive unit tests for the Agent_TypeScript Slack bot functionality.

## Test Files

### 1. `slack-mention-reply.test.ts`

Tests the Slack mention reply functionality, ensuring that:
- Agent polls MCP_Slack_Client for @mentions
- Mentions are processed with Claude API
- Tool calls are executed via KADI broker
- Replies are sent back to Slack threads

**Test Coverage:**
- ✅ Basic mention retrieval and reply
- ✅ Claude tool use (count_words example)
- ✅ Multiple mentions in queue
- ✅ Error handling and recovery
- ✅ Empty queue handling

### 2. `agent-send-slack-message.test.ts`

Tests the `agent_send_slack_message` tool invocation from external sources (like Claude Desktop):
- Tool registration on KADI client
- Message sending to Slack channels
- Thread reply functionality
- Integration with MCP_Slack_Server

**Test Coverage:**
- ✅ Send message to channel
- ✅ Send message to thread
- ✅ Handle long messages
- ✅ Handle formatted messages (Slack markdown)
- ✅ Multiple sequential sends
- ✅ Complete Claude Desktop workflow
- ✅ Timeout configuration

## Running Tests

### Run All Tests
```bash
npm test
```

### Run Specific Test File
```bash
npm test slack-mention-reply.test.ts
```

### Run with Coverage
```bash
npm test -- --coverage
```

### Watch Mode (auto-run on file changes)
```bash
npm test -- --watch
```

### UI Mode (interactive test runner)
```bash
npm test -- --ui
```

## Test Structure

Each test file follows this structure:

1. **Mock Setup** - Mock KADI client, Anthropic SDK, and broker protocol
2. **Test Suite** - Describe block grouping related tests
3. **Setup/Teardown** - beforeEach/afterEach for test isolation
4. **Individual Tests** - it() blocks testing specific scenarios

## Mocking Strategy

### KADI Client
- Mock `getBrokerProtocol()` to return controlled protocol
- Mock `invokeTool()` to simulate broker calls
- Track tool registrations

### Anthropic SDK
- Mock `messages.create()` to simulate Claude API responses
- Control tool_use vs end_turn stop reasons
- Simulate different response scenarios

### SlackBot
- Real instance with mocked dependencies
- Tests actual implementation logic
- Verifies correct broker interactions

## Test Data

### Example Slack Mention
```typescript
{
  id: 'msg-1',
  user: 'test-user',
  text: 'Hello bot!',
  channel: 'C123456',
  thread_ts: '1234567890.123456',
  ts: '1234567890.123456'
}
```

### Example Claude Response
```typescript
{
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
  stop_reason: 'end_turn'
}
```

## Verification Points

Each test verifies:
1. **Correct broker calls** - Right targetAgent, toolName, toolInput
2. **Proper sequencing** - Calls made in correct order
3. **Data flow** - Input transformed correctly to output
4. **Error handling** - Graceful failure and error messages
5. **Return values** - Expected results returned to caller

## Continuous Integration

These tests are designed to run in CI/CD pipelines:
- No external dependencies (all mocked)
- Fast execution (< 1 second per test)
- Deterministic results
- Clear failure messages

## Debugging Tests

### Enable Verbose Logging
```bash
npm test -- --reporter=verbose
```

### Run Single Test
```bash
npm test -- -t "should poll MCP_Slack_Client"
```

### Debug in VS Code
Add breakpoint and use "Debug Test" in VS Code test explorer.

## Adding New Tests

When adding new tests:

1. **Create descriptive test name** - Clearly state what is being tested
2. **Setup mocks** - Configure all required mocks in beforeEach
3. **Execute code** - Call the function/method under test
4. **Verify results** - Use expect() assertions
5. **Clean up** - Reset mocks in afterEach

Example:
```typescript
it('should handle new scenario', async () => {
  // Setup
  mockProtocol.invokeTool.mockResolvedValue(mockData);

  // Execute
  const result = await slackBot.someMethod();

  // Verify
  expect(result).toEqual(expectedValue);
  expect(mockProtocol.invokeTool).toHaveBeenCalledWith(expectedArgs);
});
```

## Test Maintenance

- **Update tests** when implementation changes
- **Add tests** for new features
- **Remove tests** for deprecated functionality
- **Refactor tests** to reduce duplication
- **Keep mocks simple** - Only mock what's necessary

## Known Limitations

1. **Integration Tests** - These are unit tests with mocks, not integration tests
2. **Real Slack API** - Not testing actual Slack API behavior
3. **Real Claude API** - Not testing actual Claude API responses
4. **Network Issues** - Not testing network failures or timeouts

For integration testing, use separate test suite with real broker and MCP servers.

## Coverage Goals

Target coverage metrics:
- **Lines**: > 80%
- **Functions**: > 80%
- **Branches**: > 70%
- **Statements**: > 80%

Current coverage:
```bash
npm test -- --coverage
```

## Troubleshooting

### "Module not found" errors
- Ensure all imports use `.js` extension for ES modules
- Check file paths are correct

### "Mock not working" errors
- Verify mock is set up before test execution
- Check mock.mockClear() is called between tests

### "Test timeout" errors
- Increase timeout in vitest.config.ts
- Check for unresolved promises

### "Type errors" in tests
- Ensure test files use same TypeScript config
- Use `as unknown as Type` for complex mocks

## Resources

- [Vitest Documentation](https://vitest.dev/)
- [Vitest Mocking Guide](https://vitest.dev/guide/mocking.html)
- [Testing Best Practices](https://github.com/goldbergyoni/javascript-testing-best-practices)
