# Tests Directory

This directory contains all test files for the mcp-server-quest project.

## Structure

```
tests/
├── setup.ts                      # Global test setup and utilities
├── unit/                         # Unit tests for individual components
│   ├── setup.test.ts             # Basic setup validation
│   ├── tool-inventory.test.ts    # Validates all 26 tools are registered
│   └── merged-tools.test.ts      # Schema tests for merged/new tools
├── integration/                  # Integration tests for system workflows
└── fixtures/                     # Test data and mock generators
    └── mock-data.ts              # Mock data generators
```

## Running Tests

### Run all tests
```bash
npm test
```

### Run tests in watch mode
```bash
npm run test:watch
```

### Run tests with coverage
```bash
npm run test:coverage
```

### Run tests with UI
```bash
npm run test:ui
```

## Writing Tests

### Unit Tests

Unit tests should be placed in `tests/unit/` and follow the naming convention `*.test.ts`.

Example:
```typescript
import { describe, it, expect } from 'vitest';

describe('MyComponent', () => {
  it('should do something', () => {
    expect(true).toBe(true);
  });
});
```

### Integration Tests

Integration tests should be placed in `tests/integration/` and test complete workflows.

Example:
```typescript
import { describe, it, expect } from 'vitest';

describe('Quest Workflow', () => {
  it('should create and complete a quest', async () => {
    // Test complete workflow
  });
});
```

## Test Utilities

### Mock Data Generators

Use the mock data generators from `fixtures/mock-data.ts`:

```typescript
import { createMockQuest, createMockTask } from '../fixtures/mock-data';

const quest = createMockQuest({ name: 'My Quest' });
const task = createMockTask({ questId: quest.id });
```

### Test File Utilities

Use the test file utilities from `setup.ts`:

```typescript
import { createTestFile, readTestFile, deleteTestFile } from './setup';

// Create a test file
const filePath = createTestFile('test.json', '{"test": true}');

// Read the file
const content = readTestFile('test.json');

// Clean up
deleteTestFile('test.json');
```

## Coverage Requirements

The project aims for:
- **80% line coverage**
- **80% function coverage**
- **80% branch coverage**
- **80% statement coverage**

## CI/CD Integration

Tests are designed to run in CI/CD environments:
- No external dependencies required
- Isolated test data directory
- Automatic cleanup after tests
- Fast execution time
