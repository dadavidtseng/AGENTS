import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Test file patterns
    include: ['test/**/*.test.ts', 'src/__tests__/**/*.test.ts'],

    // Environment
    environment: 'node',

    // Global test timeout
    testTimeout: 30000,

    // Coverage configuration
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/**',
        'dist/**',
        '**/*.test.ts',
        'vitest.config.ts',
        'test/**'
      ]
    },

    // Mock configuration
    globals: true,
    mockReset: true,
    restoreMocks: true,

    // Reporter
    reporters: ['verbose']
  }
});
