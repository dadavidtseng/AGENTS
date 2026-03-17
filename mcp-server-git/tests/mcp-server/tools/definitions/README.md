# Git MCP Server - Tool Testing Guide

This directory contains comprehensive test suites for all git MCP tool definitions. The tests ensure that tools behave correctly, handle errors gracefully, and provide LLM-friendly output.

## Directory Structure

```
tests/mcp-server/tools/definitions/
├── README.md                          # This file - testing guidelines
├── helpers/                           # Shared test utilities
│   ├── testContext.ts                # RequestContext factory
│   ├── mockGitProvider.ts            # Mock IGitProvider implementation
│   ├── mockStorageService.ts         # Mock StorageService implementation
│   ├── assertions.ts                 # Custom test assertions
│   └── index.ts                      # Barrel export
├── unit/                              # Unit tests (one per tool)
│   ├── git-status.tool.test.ts       # ✅ Completed (example)
│   ├── git-commit.tool.test.ts       # 🔜 Pending
│   ├── git-log.tool.test.ts          # 🔜 Pending
│   └── ... (27 files total)
└── integration/                       # Integration tests
    ├── git-workflow.int.test.ts      # 🔜 Pending
    └── ... (planned)
```

## Testing Philosophy

### Core Principles

1. **Isolation**: Unit tests use mocks for all external dependencies (GitProvider, StorageService)
2. **Realism**: Integration tests use real git repositories in temporary directories
3. **Coverage**: Each tool has comprehensive tests for happy paths, error cases, and edge cases
4. **Consistency**: All tests follow the same structure and patterns

### What to Test

For each tool, we test:

1. **Input Schema Validation**
   - Valid inputs are accepted
   - Invalid inputs are rejected
   - Default values are applied correctly
   - Optional parameters work as expected

2. **Tool Logic**
   - Happy path: Valid inputs produce expected outputs
   - Provider interaction: Correct methods called with correct arguments
   - Path resolution: Handles both '.' (session) and absolute paths
   - Tenant isolation: Uses correct tenantId from context
   - Error handling: Provider errors are propagated correctly
   - Graceful degradation: Missing tenantId defaults to 'default-tenant'

3. **Response Formatters**
   - Successful results are formatted with summaries and details
   - Output is LLM-friendly (markdown, complete data)
   - Edge cases handled: empty results, very long output
   - Consistency across tools

4. **Authorization**
   - Tools require correct scopes (tool:git:read or tool:git:write)
   - Unauthorized access is blocked

5. **Tool Metadata**
   - Correct tool name, title, description
   - Read-only annotation set correctly
   - Schemas are valid

## Test Helpers

### Test Context Creation

```typescript
import { createTestContext, createTestSdkContext } from '../helpers/index.js';

// Basic context
const appContext = createTestContext();

// Context with tenantId
const appContext = createTestContext({ tenantId: 'test-tenant' });

// SDK context
const sdkContext = createTestSdkContext();
```

### Mock Dependencies

```typescript
import {
  createMockGitProvider,
  createMockStorageService,
} from '../helpers/index.js';

const mockProvider = createMockGitProvider();
const mockStorage = createMockStorageService();

// Configure mock responses
mockProvider.status.mockResolvedValue({
  currentBranch: 'main',
  isClean: true,
  // ... rest of status result
});

// Set up session storage
mockStorage.set(`session:workingDir:${tenantId}`, '/test/repo', context);
```

### Custom Assertions

```typescript
import {
  assertTextContent,
  assertMarkdownContent,
  assertProviderCalledWithContext,
  assertLlmFriendlyFormat,
} from '../helpers/index.js';

// Assert content contains text
assertTextContent(content, 'Expected text or /regex/');

// Assert markdown sections are present
assertMarkdownContent(content, ['# Header', '## Section']);

// Assert provider was called with correct context
assertProviderCalledWithContext(
  mockProvider.status.mock.calls[0] as unknown[],
  '/expected/path',
  'expected-tenant-id',
);

// Assert output is LLM-friendly
assertLlmFriendlyFormat(content);
```

## Standard Test Pattern

Every tool test follows this structure:

```typescript
/**
 * @fileoverview Unit tests for git-<operation> tool
 * @module tests/mcp-server/tools/definitions/unit/git-<operation>.tool.test
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { container } from 'tsyringe';

import { git<Operation>Tool } from '@/mcp-server/tools/definitions/git-<operation>.tool.js';
import {
  GitProviderFactory as GitProviderFactoryToken,
  StorageService as StorageServiceToken,
} from '@/container/tokens.js';
import {
  createTestContext,
  createTestSdkContext,
  createMockGitProvider,
  createMockStorageService,
  assertTextContent,
  assertMarkdownContent,
  assertProviderCalledWithContext,
  assertLlmFriendlyFormat,
} from '../helpers/index.js';
import type { Git<Operation>Result } from '@/services/git/types.js';
import { GitProviderFactory } from '@/services/git/core/GitProviderFactory.js';

describe('git_<operation> tool', () => {
  const mockProvider = createMockGitProvider();
  const mockStorage = createMockStorageService();
  const mockFactory = {
    getProvider: vi.fn(async () => mockProvider),
  } as unknown as GitProviderFactory;

  beforeEach(() => {
    // Reset mocks
    mockProvider.resetMocks();
    mockStorage.clearAll();

    // Register mock dependencies
    container.clearInstances();
    container.register(GitProviderFactoryToken, { useValue: mockFactory });
    container.register(StorageServiceToken, { useValue: mockStorage });

    // Set up default session working directory
    const tenantId = 'test-tenant';
    const context = createTestContext({ tenantId });
    mockStorage.set(`session:workingDir:${tenantId}`, '/test/repo', context);
  });

  describe('Input Schema', () => {
    it('validates correct input with default values', () => {
      // Test schema validation
    });

    it('rejects invalid input', () => {
      // Test schema rejection
    });
  });

  describe('Tool Logic', () => {
    it('executes operation successfully', async () => {
      // Set up mock response
      const mockResult: Git<Operation>Result = { /* ... */ };
      mockProvider.<operation>.mockResolvedValue(mockResult);

      // Parse input through schema to get defaults
      const parsedInput = git<Operation>Tool.inputSchema.parse({ /* ... */ });
      const appContext = createTestContext({ tenantId: 'test-tenant' });
      const sdkContext = createTestSdkContext();

      // Execute tool logic
      const result = await git<Operation>Tool.logic(parsedInput, appContext, sdkContext);

      // Verify provider was called correctly
      expect(mockProvider.<operation>).toHaveBeenCalledTimes(1);
      assertProviderCalledWithContext(
        mockProvider.<operation>.mock.calls[0] as unknown[],
        '/test/repo',
        'test-tenant',
      );

      // Verify output structure
      expect(result).toMatchObject({ /* expected output */ });
    });

    it('handles absolute path', async () => {
      // Test with absolute path instead of '.'
    });

    it('applies graceful tenantId default when missing', async () => {
      // Test without tenantId in context
    });
  });

  describe('Response Formatter', () => {
    it('formats result correctly', () => {
      const result = { /* tool output */ };
      const content = git<Operation>Tool.responseFormatter!(result);

      assertTextContent(content, 'expected text');
      assertMarkdownContent(content, ['# Header', '## Section']);
      assertLlmFriendlyFormat(content);
    });

    it('handles empty results', () => {
      // Test formatter with empty/minimal data
    });

    it('handles edge cases', () => {
      // Test very long output, special characters, etc.
    });
  });

  describe('Tool Metadata', () => {
    it('has correct tool name', () => {
      expect(git<Operation>Tool.name).toBe('git_<operation>');
    });

    it('has correct read-only annotation', () => {
      // For read-only tools
      expect(git<Operation>Tool.annotations?.readOnlyHint).toBe(true);

      // For write tools
      expect(git<Operation>Tool.annotations?.readOnlyHint).toBe(false);
    });

    it('has descriptive title and description', () => {
      expect(git<Operation>Tool.title).toBeTruthy();
      expect(git<Operation>Tool.description).toBeTruthy();
      expect(git<Operation>Tool.description.length).toBeGreaterThan(20);
    });

    it('has valid input and output schemas', () => {
      expect(git<Operation>Tool.inputSchema).toBeDefined();
      expect(git<Operation>Tool.outputSchema).toBeDefined();
    });
  });
});
```

## Running Tests

### Run All Tool Tests

```bash
bun test tests/mcp-server/tools/definitions/
```

### Run Specific Tool Test

```bash
bun test tests/mcp-server/tools/definitions/unit/git-status.tool.test.ts
```

### Run with Coverage

```bash
bun test:coverage tests/mcp-server/tools/definitions/
```

### Watch Mode (for development)

```bash
bun test --watch tests/mcp-server/tools/definitions/unit/git-status.tool.test.ts
```

## Common Patterns & Gotchas

### 1. Input Schema Parsing

Always parse inputs through the schema to get default values:

```typescript
// ❌ BAD: Missing default values
const input = { path: '.' };
await toolLogic(input, appContext, sdkContext);

// ✅ GOOD: Schema applies defaults
const parsedInput = gitStatusTool.inputSchema.parse({ path: '.' });
await toolLogic(parsedInput, appContext, sdkContext);
```

### 2. StorageService API

The MockStorageService mirrors the real StorageService API exactly:

```typescript
// ❌ BAD: Old provider API (3 params)
mockStorage.set(tenantId, key, value, context);

// ✅ GOOD: StorageService API (extracts tenantId from context)
mockStorage.set(key, value, context);
```

### 3. Mock Provider Calls

Provider methods receive options and context:

```typescript
// ✅ Correct destructuring
const [options, context] = mockProvider.status.mock.calls[0]!;
expect(options.includeUntracked).toBe(true);
expect(context.workingDirectory).toBe('/test/repo');
```

### 4. Graceful Tenant Defaults

Tests should verify graceful degradation for missing tenantId:

```typescript
it('applies graceful tenantId default when missing', async () => {
  // Context WITHOUT tenantId
  const appContext = createTestContext();

  // Set up storage for default tenant
  mockStorage.set(
    'session:workingDir:default-tenant',
    '/default/repo',
    appContext,
  );

  const result = await toolLogic(input, appContext, sdkContext);

  // Verify 'default-tenant' was used
  const [_options, context] = mockProvider.status.mock.calls[0]!;
  expect(context.tenantId).toBe('default-tenant');
});
```

## Tool Categories

### Read-Only Tools (tool:git:read)

- `git-status`, `git-log`, `git-diff`, `git-show`
- `git-blame`, `git-reflog`
- Set `readOnlyHint: true` in annotations
- Test that no side effects occur

### Write Tools (tool:git:write)

- All other tools
- Set `readOnlyHint: false` in annotations
- Mock providers in unit tests
- Use real git in integration tests

### Session-Dependent Tools

- `git-set-working-dir`, `git-clear-working-dir`
- Test storage service integration thoroughly
- Verify tenant isolation

### Complex Operation Tools

- `git-commit` (amend, sign, atomic stage+commit)
- `git-merge` (strategies, conflicts)
- `git-rebase` (interactive, conflicts)
- `git-worktree` (multiple worktrees)
- Require extensive edge case testing

## Code Coverage Goals

- **Overall**: ≥90% line coverage
- **Per Tool**: ≥15 test cases minimum
- **Critical Paths**: 100% coverage
- **Error Paths**: All error cases tested

## Integration Testing (Future)

Integration tests will:

1. Create temporary git repositories
2. Execute real git operations via CliGitProvider
3. Test complete workflows (commit → push → pull)
4. Validate error scenarios (merge conflicts, permission issues)
5. Clean up temporary repos after tests

## Contributing

When adding a new tool:

1. ✅ Create tool definition in `src/mcp-server/tools/definitions/`
2. ✅ Create test file in `tests/mcp-server/tools/definitions/unit/`
3. ✅ Follow the standard test pattern above
4. ✅ Ensure all test categories are covered
5. ✅ Run `bun devcheck` to verify no errors
6. ✅ Aim for ≥90% coverage for the new tool

## References

- [Vitest Documentation](https://vitest.dev/)
- [CLAUDE.md](/CLAUDE.md) - Project architectural guidelines
- [Git Provider Interface](/src/services/git/core/IGitProvider.ts)
- [Tool Definition Interface](/src/mcp-server/tools/utils/toolDefinition.ts)
- [Example Test](/tests/mcp-server/tools/definitions/unit/git-status.tool.test.ts)
