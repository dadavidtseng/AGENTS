/**
 * Integration Test - File Operations Native Transport
 *
 * Verifies that FileOperationsProxy works with native file-management-ability:
 * - Direct ES module import (no broker required)
 * - SSH upload/download operations
 * - Error handling for invalid credentials
 * - Error handling for missing files
 *
 * NOTE: These tests require:
 * 1. SSH access to a test server (configured via env vars)
 * 2. Valid SSH credentials (private key or password)
 * 3. Write permissions on remote server
 *
 * Set SKIP_SSH_TESTS=true to skip tests requiring real SSH connection
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FileOperationsProxy } from '../../src/abilities/file-operations-proxy.js';
import { FileErrorCode, AbilityErrorCode } from '../../src/abilities/errors.js';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

// Test configuration from environment
const TEST_SSH_HOST = process.env.TEST_SSH_HOST || 'localhost';
const TEST_SSH_USER = process.env.TEST_SSH_USER || process.env.USER || 'testuser';
const TEST_SSH_KEY = process.env.TEST_SSH_KEY || path.join(os.homedir(), '.ssh/id_rsa');
const SKIP_SSH_TESTS = process.env.SKIP_SSH_TESTS === 'true';

// Test fixtures
const TEST_DIR = path.join(os.tmpdir(), 'file-ops-test');
const TEST_FILE_LOCAL = path.join(TEST_DIR, 'test-upload.txt');
const TEST_FILE_REMOTE = `/tmp/test-upload-${Date.now()}.txt`;
const TEST_FILE_DOWNLOAD = path.join(TEST_DIR, 'test-download.txt');
const TEST_CONTENT = 'Hello from FileOperationsProxy native transport test!';

describe('FileOperationsProxy - Native Transport Integration', () => {
  let fileOps: FileOperationsProxy;

  beforeAll(async () => {
    // Create test directory and file
    await fs.mkdir(TEST_DIR, { recursive: true });
    await fs.writeFile(TEST_FILE_LOCAL, TEST_CONTENT, 'utf-8');
    
    // Initialize FileOperationsProxy
    fileOps = new FileOperationsProxy();
  });

  afterAll(async () => {
    // Clean up local test files
    try {
      await fs.rm(TEST_DIR, { recursive: true, force: true });
    } catch (err) {
      console.warn('Failed to clean up test directory:', err);
    }
  });

  describe('Basic Functionality', () => {
    it('should instantiate FileOperationsProxy without dependencies', () => {
      expect(fileOps).toBeDefined();
      expect(fileOps).toBeInstanceOf(FileOperationsProxy);
    });

    it('should report as loaded (native import always available)', () => {
      const loaded = fileOps.isLoaded();
      expect(loaded).toBe(true);
    });
  });

  describe('SSH Upload Operations', () => {
    it.skipIf(SKIP_SSH_TESTS)('should successfully upload file via SSH with private key', async () => {
      const result = await fileOps.uploadViaSSH({
        host: TEST_SSH_HOST,
        username: TEST_SSH_USER,
        privateKey: TEST_SSH_KEY,
        localPath: TEST_FILE_LOCAL,
        remotePath: TEST_FILE_REMOTE,
      });

      expect(result.success).toBe(true);
      if (!result.success) {
        console.error('Upload failed:', result.error);
      }
    }, { timeout: 30000 });

    it('should handle upload with invalid private key path gracefully', async () => {
      const result = await fileOps.uploadViaSSH({
        host: TEST_SSH_HOST,
        username: TEST_SSH_USER,
        privateKey: '/path/to/nonexistent/key.pem',
        localPath: TEST_FILE_LOCAL,
        remotePath: '/tmp/test-fail.txt',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        // Should fail quickly due to key file not found
        expect(result.error.code).toMatch(/SSH_AUTH_FAILED|TRANSFER_FAILED|NETWORK_ERROR|FILE_NOT_FOUND/);
        expect(result.error.message).toBeDefined();
        expect(result.error.host).toBe(TEST_SSH_HOST);
        expect(result.error.filePath).toBe(TEST_FILE_LOCAL);
      }
    }, { timeout: 10000 });

    it('should handle upload of non-existent file gracefully', async () => {
      const result = await fileOps.uploadViaSSH({
        host: TEST_SSH_HOST,
        username: TEST_SSH_USER,
        privateKey: TEST_SSH_KEY,
        localPath: '/path/to/nonexistent/file.txt',
        remotePath: TEST_FILE_REMOTE,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect([FileErrorCode.FILE_NOT_FOUND, FileErrorCode.TRANSFER_FAILED]).toContain(result.error.code);
        expect(result.error.filePath).toBe('/path/to/nonexistent/file.txt');
        expect(result.error.host).toBe(TEST_SSH_HOST);
      }
    }, { timeout: 10000 });
  });

  describe('SSH Download Operations', () => {
    it.skipIf(SKIP_SSH_TESTS)('should successfully download file via SSH with private key', async () => {
      // First ensure file exists on remote (from previous upload test)
      await fileOps.uploadViaSSH({
        host: TEST_SSH_HOST,
        username: TEST_SSH_USER,
        privateKey: TEST_SSH_KEY,
        localPath: TEST_FILE_LOCAL,
        remotePath: TEST_FILE_REMOTE,
      });

      const result = await fileOps.downloadViaSSH({
        host: TEST_SSH_HOST,
        username: TEST_SSH_USER,
        privateKey: TEST_SSH_KEY,
        remotePath: TEST_FILE_REMOTE,
        localPath: TEST_FILE_DOWNLOAD,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        // Verify downloaded content matches
        const downloadedContent = await fs.readFile(TEST_FILE_DOWNLOAD, 'utf-8');
        expect(downloadedContent).toBe(TEST_CONTENT);
      }
    }, { timeout: 30000 });

    it('should handle download with invalid private key path gracefully', async () => {
      const result = await fileOps.downloadViaSSH({
        host: TEST_SSH_HOST,
        username: TEST_SSH_USER,
        privateKey: '/path/to/nonexistent/key.pem',
        remotePath: TEST_FILE_REMOTE,
        localPath: TEST_FILE_DOWNLOAD,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        // Should fail quickly due to key file not found
        expect(result.error.code).toMatch(/SSH_AUTH_FAILED|TRANSFER_FAILED|NETWORK_ERROR|FILE_NOT_FOUND/);
        expect(result.error.host).toBe(TEST_SSH_HOST);
        expect(result.error.filePath).toBe(TEST_FILE_REMOTE);
      }
    }, { timeout: 10000 });

    it('should handle download of non-existent remote file gracefully', async () => {
      const result = await fileOps.downloadViaSSH({
        host: TEST_SSH_HOST,
        username: TEST_SSH_USER,
        privateKey: TEST_SSH_KEY,
        remotePath: '/tmp/nonexistent-file-12345.txt',
        localPath: TEST_FILE_DOWNLOAD,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect([FileErrorCode.FILE_NOT_FOUND, FileErrorCode.TRANSFER_FAILED]).toContain(result.error.code);
      }
    }, { timeout: 30000 });
  });

  describe('Remote Command Execution', () => {
    it('should return error for executeRemoteCommand (not supported in native mode)', async () => {
      const result = await fileOps.executeRemoteCommand({
        host: TEST_SSH_HOST,
        username: TEST_SSH_USER,
        privateKey: TEST_SSH_KEY,
        command: 'echo "test"',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(AbilityErrorCode.INVOCATION_FAILED);
        expect(result.error.message).toContain('not supported in native transport');
      }
    });
  });

  describe('Error Context Validation', () => {
    it('should include FileError properties in all errors', async () => {
      const result = await fileOps.uploadViaSSH({
        host: 'invalid-host-12345.example.com',
        username: 'testuser',
        privateKey: TEST_SSH_KEY,
        localPath: TEST_FILE_LOCAL,
        remotePath: '/tmp/test.txt',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.operation).toBe('uploadViaSSH');
        expect(result.error.host).toBe('invalid-host-12345.example.com');
        expect(result.error.filePath).toBe(TEST_FILE_LOCAL);
      }
    }, { timeout: 15000 });
  });

  describe('Performance & Reliability', () => {
    it.skipIf(SKIP_SSH_TESTS)('should complete upload/download cycle within reasonable time', async () => {
      const startTime = Date.now();

      // Upload
      const uploadResult = await fileOps.uploadViaSSH({
        host: TEST_SSH_HOST,
        username: TEST_SSH_USER,
        privateKey: TEST_SSH_KEY,
        localPath: TEST_FILE_LOCAL,
        remotePath: TEST_FILE_REMOTE,
      });
      expect(uploadResult.success).toBe(true);

      // Download
      const downloadResult = await fileOps.downloadViaSSH({
        host: TEST_SSH_HOST,
        username: TEST_SSH_USER,
        privateKey: TEST_SSH_KEY,
        remotePath: TEST_FILE_REMOTE,
        localPath: TEST_FILE_DOWNLOAD,
      });
      expect(downloadResult.success).toBe(true);

      const elapsedTime = Date.now() - startTime;
      // Should complete within 10 seconds for localhost
      expect(elapsedTime).toBeLessThan(10000);
    }, { timeout: 30000 });
  });
});

// Helper to print test configuration
if (!SKIP_SSH_TESTS) {
  console.log('\n📋 SSH Test Configuration:');
  console.log(`  Host: ${TEST_SSH_HOST}`);
  console.log(`  User: ${TEST_SSH_USER}`);
  console.log(`  Key: ${TEST_SSH_KEY}`);
  console.log(`  Remote test file: ${TEST_FILE_REMOTE}`);
  console.log('\n💡 Set SKIP_SSH_TESTS=true to skip SSH tests\n');
} else {
  console.log('\n⏭️  Skipping SSH tests (SKIP_SSH_TESTS=true)\n');
}
