/**
 * @fileoverview Runtime capability detection for multi-environment support.
 * Detects presence of Node features, Web/Workers APIs, Bun runtime, and common globals.
 * @module src/utils/internal/runtime
 */

export interface RuntimeCapabilities {
  isNode: boolean;
  isBun: boolean;
  isWorkerLike: boolean;
  isBrowserLike: boolean;
  hasProcess: boolean;
  hasBuffer: boolean;
  hasTextEncoder: boolean;
  hasPerformanceNow: boolean;
}

/**
 * Runtime type discriminator for cross-runtime compatibility.
 */
export type RuntimeType = 'bun' | 'node' | 'worker' | 'browser' | 'unknown';

// Best-effort static detection without throwing in restricted envs
const safeHas = (key: string): boolean => {
  try {
    // @ts-expect-error index access on globalThis
    return typeof globalThis[key] !== 'undefined';
  } catch {
    return false;
  }
};

// Detect Bun runtime (check for Bun global object or process.versions.bun)
const isBun =
  typeof globalThis.Bun !== 'undefined' ||
  typeof (process as unknown as { versions?: { bun?: string } }).versions
    ?.bun === 'string';

const isNode =
  !isBun &&
  typeof process !== 'undefined' &&
  typeof (process as unknown as { versions?: { node?: string } }).versions
    ?.node === 'string';

const hasProcess = typeof process !== 'undefined';
const hasBuffer = typeof Buffer !== 'undefined';
const hasTextEncoder = safeHas('TextEncoder');
const hasPerformanceNow =
  typeof (globalThis as { performance?: { now?: () => number } }).performance
    ?.now === 'function';

// Cloudflare Workers expose "Web Worker"-like environment (self, caches, fetch, etc.)
const isWorkerLike =
  !isNode &&
  !isBun &&
  typeof (globalThis as { WorkerGlobalScope?: unknown }).WorkerGlobalScope !==
    'undefined';
const isBrowserLike = !isNode && !isBun && !isWorkerLike && safeHas('window');

export const runtimeCaps: RuntimeCapabilities = {
  isNode,
  isBun,
  isWorkerLike,
  isBrowserLike,
  hasProcess,
  hasBuffer,
  hasTextEncoder,
  hasPerformanceNow,
};

/**
 * Detects the current JavaScript runtime with priority ordering.
 *
 * Priority order:
 * 1. Bun (native Bun runtime)
 * 2. Node.js (including bunx/npx running in Node.js)
 * 3. Worker (Cloudflare Workers, Service Workers, Web Workers)
 * 4. Browser (window environment)
 * 5. Unknown (fallback)
 *
 * @returns Runtime type identifier
 *
 * @example
 * ```typescript
 * const runtime = detectRuntime();
 * if (runtime === 'bun') {
 *   console.log('Running in native Bun runtime');
 * } else if (runtime === 'node') {
 *   console.log('Running in Node.js (possibly via bunx/npx)');
 * }
 * ```
 */
export function detectRuntime(): RuntimeType {
  if (runtimeCaps.isBun) {
    return 'bun';
  }
  if (runtimeCaps.isNode) {
    return 'node';
  }
  if (runtimeCaps.isWorkerLike) {
    return 'worker';
  }
  if (runtimeCaps.isBrowserLike) {
    return 'browser';
  }
  return 'unknown';
}

/**
 * Gets a human-readable description of the current runtime environment.
 *
 * @returns Runtime description string
 *
 * @example
 * ```typescript
 * console.log(getRuntimeDescription());
 * // Output: "Bun v1.2.21" or "Node.js v20.10.0" or "Cloudflare Workers"
 * ```
 */
export function getRuntimeDescription(): string {
  const runtime = detectRuntime();

  switch (runtime) {
    case 'bun':
      return `Bun ${(process as unknown as { versions?: { bun?: string } }).versions?.bun || 'unknown'}`;
    case 'node':
      return `Node.js ${(process as unknown as { versions?: { node?: string } }).versions?.node || 'unknown'}`;
    case 'worker':
      return 'Cloudflare Workers / Web Worker';
    case 'browser':
      return 'Browser';
    default:
      return 'Unknown runtime';
  }
}
