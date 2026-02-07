/**
 * Unit Tests for Command Runner
 *
 * Tests command execution with Result types, timeout, abort signal,
 * and error handling.
 *
 * @module tests/unit/command-runner
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  runCommand,
  runCommandSimple,
  commandExists,
} from '../../src/utils/command-runner.js';
import {
  expectSuccess,
  expectFailure,
  expectErrorCode,
  expectSuggestion,
  expectDurationInRange,
} from '../helpers/assertions.js';
import { createAbortedController, sleep } from '../helpers/mocks.js';
import { durations } from '../helpers/fixtures.js';

describe('Command Runner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('runCommand', () => {
    it('should return success for successful commands', async () => {
      const result = await runCommand('echo "hello"', { silent: true });

      expectSuccess(result);
      expect(result.data.stdout).toContain('hello');
      expect(result.data.exitCode).toBe(0);
      expect(result.data.duration).toBeGreaterThan(0);
    });

    it('should return failure for failed commands', async () => {
      const result = await runCommand('exit 1', { silent: true });

      expectFailure(result);
      expectErrorCode(result, 'COMMAND_FAILED');
      expect(result.error.context.exitCode).toBe(1);
    });

    it('should capture stdout in silent mode', async () => {
      const result = await runCommand('echo "test output"', { silent: true });

      expectSuccess(result);
      expect(result.data.stdout).toContain('test output');
    });

    it('should capture stderr in silent mode', async () => {
      const result = await runCommand('echo "error" >&2', { silent: true });

      expectSuccess(result);
      expect(result.data.stderr).toContain('error');
    });

    it('should respect timeout option', async () => {
      const startTime = Date.now();

      const result = await runCommand('sleep 10', {
        silent: true,
        timeout: 100, // 100ms timeout
      });

      const duration = Date.now() - startTime;

      expectFailure(result);
      expectErrorCode(result, 'COMMAND_TIMEOUT');
      expect(duration).toBeLessThan(2000); // Should timeout quickly
    });

    it('should handle timeout correctly', async () => {
      const result = await runCommand('sleep 5', {
        silent: true,
        timeout: 50,
      });

      expectFailure(result);
      expectErrorCode(result, 'COMMAND_TIMEOUT');
      expectSuggestion(result.error, 'timeout');
      expect(result.error.context.timeout).toBe(50);
    });

    it('should respect abort signal', async () => {
      const controller = createAbortedController();

      const result = await runCommand('sleep 10', {
        silent: true,
        signal: controller.signal,
      });

      expectFailure(result);
      expectErrorCode(result, 'COMMAND_CANCELLED');
    });

    it('should return cancelled error on abort', async () => {
      const controller = new AbortController();

      // Start command and abort immediately
      const resultPromise = runCommand('sleep 10', {
        silent: true,
        signal: controller.signal,
      });

      controller.abort();

      const result = await resultPromise;

      expectFailure(result);
      expectErrorCode(result, 'COMMAND_CANCELLED');
    });

    it('should handle command not found', async () => {
      const result = await runCommand('nonexistent-command-xyz', {
        silent: true,
      });

      expectFailure(result);
      // Command not found returns exit code 127, which is COMMAND_FAILED
      expectErrorCode(result, 'COMMAND_FAILED');
      expect(result.error.context.exitCode).toBe(127);
    });

    it('should measure execution duration', async () => {
      const result = await runCommand('echo "test"', { silent: true });

      expectSuccess(result);
      expect(result.data.duration).toBeGreaterThan(0);
      expect(result.data.duration).toBeLessThan(5000); // Should be fast
    });

    it('should support working directory option', async () => {
      const result = await runCommand('pwd', {
        silent: true,
        cwd: '/tmp',
      });

      expectSuccess(result);
      expect(result.data.stdout).toContain('/tmp');
    });

    it('should support environment variables', async () => {
      const result = await runCommand('echo $TEST_VAR', {
        silent: true,
        env: { TEST_VAR: 'hello' },
      });

      expectSuccess(result);
      expect(result.data.stdout).toContain('hello');
    });

    it('should include error details in context', async () => {
      const result = await runCommand('exit 42', { silent: true });

      expectFailure(result);
      expect(result.error.context.command).toContain('exit 42');
      expect(result.error.context.exitCode).toBe(42);
    });

    it('should handle stderr output for failed commands', async () => {
      const result = await runCommand(
        'echo "error message" >&2 && exit 1',
        { silent: true }
      );

      expectFailure(result);
      expect(result.error.context.stderr).toContain('error message');
    });

    it('should support long-running commands', async () => {
      const result = await runCommand('sleep 0.1 && echo "done"', {
        silent: true,
        timeout: 5000,
      });

      expectSuccess(result);
      expect(result.data.stdout).toContain('done');
      expectDurationInRange(result.data.duration, 100, 1000);
    });

    it('should handle commands with special characters', async () => {
      const result = await runCommand('echo "test & test | test"', {
        silent: true,
      });

      expectSuccess(result);
      expect(result.data.stdout).toContain('test & test | test');
    });

    it('should handle commands with quotes', async () => {
      const result = await runCommand(`echo '"quoted"'`, { silent: true });

      expectSuccess(result);
      expect(result.data.stdout).toContain('"quoted"');
    });

    it('should include duration in result even for failures', async () => {
      const result = await runCommand('exit 1', { silent: true });

      expectFailure(result);
      expect(result.error.context.duration).toBeGreaterThan(0);
    });
  });

  describe('runCommandSimple', () => {
    it('should return stdout for successful commands', async () => {
      const output = await runCommandSimple('echo "test"');

      expect(output).toBe('test');
      expect(typeof output).toBe('string');
    });

    it('should throw for failed commands', async () => {
      await expect(runCommandSimple('exit 1')).rejects.toThrow('Command failed');
    });

    it('should trim whitespace from output', async () => {
      const output = await runCommandSimple('echo "  test  "');

      expect(output).toBe('test');
      expect(output).not.toMatch(/^\s/);
      expect(output).not.toMatch(/\s$/);
    });

    it('should handle multi-line output', async () => {
      const output = await runCommandSimple('echo "line1" && echo "line2"');

      expect(output).toContain('line1');
      expect(output).toContain('line2');
    });

    it('should work with command options', async () => {
      const output = await runCommandSimple('echo $TEST_VAR', {
        env: { TEST_VAR: 'value' },
      });

      expect(output).toBe('value');
    });

    it('should throw DeploymentError with context', async () => {
      try {
        await runCommandSimple('exit 1');
        expect.fail('Should have thrown');
      } catch (error: any) {
        expect(error.code).toBeDefined();
        expect(error.context).toBeDefined();
      }
    });
  });

  describe('commandExists', () => {
    it('should return true for existing commands', async () => {
      const exists = await commandExists('echo');

      expect(exists).toBe(true);
    });

    it('should return false for non-existent commands', async () => {
      const exists = await commandExists('nonexistent-command-xyz-123');

      expect(exists).toBe(false);
    });

    it('should work on different platforms', async () => {
      // These commands should exist on most systems
      const echoExists = await commandExists('echo');
      const lsExists = await commandExists('ls');

      expect(echoExists).toBe(true);
      expect(lsExists).toBe(true);
    });

    it('should handle commands with paths', async () => {
      const shExists = await commandExists('/bin/sh');

      // May vary by system
      expect(typeof shExists).toBe('boolean');
    });

    it('should return false for empty command', async () => {
      const exists = await commandExists('');

      expect(exists).toBe(false);
    });
  });

  describe('timeout handling', () => {
    it('should allow sufficient time for quick commands', async () => {
      const result = await runCommand('echo "fast"', {
        silent: true,
        timeout: 1000,
      });

      expectSuccess(result);
    });

    it('should timeout long commands', async () => {
      const result = await runCommand('sleep 10', {
        silent: true,
        timeout: 100,
      });

      expectFailure(result);
      expectErrorCode(result, 'COMMAND_TIMEOUT');
    });

    it('should include timeout value in error context', async () => {
      const timeout = 200;

      const result = await runCommand('sleep 10', {
        silent: true,
        timeout,
      });

      expectFailure(result);
      expect(result.error.context.timeout).toBe(timeout);
    });

    it('should force kill after grace period', async () => {
      const startTime = Date.now();

      await runCommand('sleep 100', {
        silent: true,
        timeout: 100,
      });

      const duration = Date.now() - startTime;

      // Should timeout + grace period (5s), but less than full sleep
      expect(duration).toBeLessThan(10000);
    });
  });

  describe('abort signal handling', () => {
    it('should abort immediately if signal already aborted', async () => {
      const controller = createAbortedController();

      const result = await runCommand('sleep 10', {
        silent: true,
        signal: controller.signal,
      });

      expectFailure(result);
      expectErrorCode(result, 'COMMAND_CANCELLED');
    });

    it('should abort running command when signal is triggered', async () => {
      const controller = new AbortController();

      const resultPromise = runCommand('sleep 5', {
        silent: true,
        signal: controller.signal,
      });

      // Abort after a short delay
      setTimeout(() => controller.abort(), 50);

      const result = await resultPromise;

      expectFailure(result);
      expectErrorCode(result, 'COMMAND_CANCELLED');
    });

    it('should not abort if signal is not triggered', async () => {
      const controller = new AbortController();

      const result = await runCommand('echo "test"', {
        silent: true,
        signal: controller.signal,
      });

      expectSuccess(result);
    });
  });

  describe('error handling edge cases', () => {
    it('should handle commands that output to both stdout and stderr', async () => {
      const result = await runCommand(
        'echo "out" && echo "err" >&2',
        { silent: true }
      );

      expectSuccess(result);
      expect(result.data.stdout).toContain('out');
      expect(result.data.stderr).toContain('err');
    });

    it('should handle commands with no output', async () => {
      const result = await runCommand('true', { silent: true });

      expectSuccess(result);
      expect(result.data.stdout).toBe('');
      expect(result.data.exitCode).toBe(0);
    });

    it('should handle commands that fail silently', async () => {
      const result = await runCommand('false', { silent: true });

      expectFailure(result);
      expect(result.error.context.exitCode).toBe(1);
    });

    it('should preserve exit codes correctly', async () => {
      for (const code of [0, 1, 2, 127]) {
        const result = await runCommand(`exit ${code}`, { silent: true });

        if (code === 0) {
          expectSuccess(result);
          expect(result.data.exitCode).toBe(0);
        } else {
          expectFailure(result);
          expect(result.error.context.exitCode).toBe(code);
        }
      }
    });

    it('should handle very long output', async () => {
      // Generate ~10KB of output
      const result = await runCommand(
        'for i in {1..1000}; do echo "line $i"; done',
        { silent: true, timeout: 5000 }
      );

      expectSuccess(result);
      expect(result.data.stdout.length).toBeGreaterThan(5000);
    });
  });

  describe('working directory and environment', () => {
    it('should use provided working directory', async () => {
      const result = await runCommand('pwd', {
        silent: true,
        cwd: '/tmp',
      });

      expectSuccess(result);
      const pwd = result.data.stdout.trim();
      expect(pwd).toMatch(/\/tmp|\/private\/tmp/); // macOS may prefix with /private
    });

    it('should merge environment variables with process.env', async () => {
      const result = await runCommand('echo $PATH:$CUSTOM_VAR', {
        silent: true,
        env: { CUSTOM_VAR: 'test' },
      });

      expectSuccess(result);
      // Should have PATH from process.env and CUSTOM_VAR
      expect(result.data.stdout).toContain(':test');
    });

    it('should handle environment variables with special characters', async () => {
      const result = await runCommand('echo "$SPECIAL"', {
        silent: true,
        env: { SPECIAL: 'value with spaces & special | chars' },
      });

      expectSuccess(result);
      expect(result.data.stdout).toContain('value with spaces & special | chars');
    });
  });
});
