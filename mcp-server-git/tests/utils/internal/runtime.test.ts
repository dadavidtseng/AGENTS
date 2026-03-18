/**
 * @fileoverview Unit tests for runtime capability detection.
 * @module tests/utils/internal/runtime.test
 */
import { describe, expect, it } from 'vitest';

import { runtimeCaps } from '../../../src/utils/internal/runtime.js';

describe('Runtime Capabilities', () => {
  it('should detect the current runtime environment', () => {
    // This test runs via `bun test`, so Bun runtime is detected
    // In CI or when running via Node.js directly, Node would be detected
    const detectedBun = runtimeCaps.isBun;
    const detectedNode = runtimeCaps.isNode;

    // At least one should be true
    expect(detectedBun || detectedNode).toBe(true);

    // If Bun is detected, Node should not be (mutually exclusive)
    if (detectedBun) {
      expect(runtimeCaps.isNode).toBe(false);
    }

    // If Node is detected, Bun should not be (mutually exclusive)
    if (detectedNode) {
      expect(runtimeCaps.isBun).toBe(false);
    }

    // Both have process and Buffer
    expect(runtimeCaps.hasProcess).toBe(true);
    expect(runtimeCaps.hasBuffer).toBe(true);
  });

  it('should correctly identify not being a worker or browser', () => {
    expect(runtimeCaps.isWorkerLike).toBe(false);
    expect(runtimeCaps.isBrowserLike).toBe(false);
  });

  it('should detect TextEncoder availability', () => {
    expect(runtimeCaps.hasTextEncoder).toBe(true);
  });

  it('should detect performance.now availability', () => {
    expect(runtimeCaps.hasPerformanceNow).toBe(true);
  });

  it('should export a valid RuntimeCapabilities object', () => {
    expect(runtimeCaps).toHaveProperty('isNode');
    expect(runtimeCaps).toHaveProperty('isWorkerLike');
    expect(runtimeCaps).toHaveProperty('isBrowserLike');
    expect(runtimeCaps).toHaveProperty('hasProcess');
    expect(runtimeCaps).toHaveProperty('hasBuffer');
    expect(runtimeCaps).toHaveProperty('hasTextEncoder');
    expect(runtimeCaps).toHaveProperty('hasPerformanceNow');
  });
});
