/**
 * Vitest Setup File
 * 
 * This file runs before all tests and sets up the testing environment.
 * It includes:
 * - Global test utilities
 * - Mock configurations
 * - Test database setup/teardown
 * - Environment variable configuration
 */

import { beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';

// ============================================================================
// Environment Configuration
// ============================================================================

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.QUEST_DATA_DIR = path.join(process.cwd(), '.quest-data-test');

// ============================================================================
// Global Setup/Teardown
// ============================================================================

beforeAll(async () => {
  // Create test data directory if it doesn't exist
  if (!fs.existsSync(process.env.QUEST_DATA_DIR!)) {
    fs.mkdirSync(process.env.QUEST_DATA_DIR!, { recursive: true });
  }
  
  console.log('🧪 Test environment initialized');
});

afterAll(async () => {
  // Clean up test data directory
  if (fs.existsSync(process.env.QUEST_DATA_DIR!)) {
    fs.rmSync(process.env.QUEST_DATA_DIR!, { recursive: true, force: true });
  }
  
  console.log('🧹 Test environment cleaned up');
});

// ============================================================================
// Per-Test Setup/Teardown
// ============================================================================

beforeEach(() => {
  // Reset any global state before each test
  // This ensures test isolation
});

afterEach(() => {
  // Clean up after each test
  // Remove any test files created during the test
});

// ============================================================================
// Global Test Utilities
// ============================================================================

/**
 * Create a temporary test file
 */
export function createTestFile(filename: string, content: string): string {
  const filePath = path.join(process.env.QUEST_DATA_DIR!, filename);
  fs.writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

/**
 * Read a test file
 */
export function readTestFile(filename: string): string {
  const filePath = path.join(process.env.QUEST_DATA_DIR!, filename);
  return fs.readFileSync(filePath, 'utf-8');
}

/**
 * Delete a test file
 */
export function deleteTestFile(filename: string): void {
  const filePath = path.join(process.env.QUEST_DATA_DIR!, filename);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

/**
 * Wait for a specified amount of time (for async operations)
 */
export function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
