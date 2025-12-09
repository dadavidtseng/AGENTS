/**
 * FileStorageAdapter Unit Tests
 *
 * Tests file storage operations with temp directories
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { FileStorageAdapter } from '../../../src/memory/file-storage-adapter.js';

describe('FileStorageAdapter', () => {
  let adapter: FileStorageAdapter;
  let testDir: string;

  beforeEach(async () => {
    // Create unique temp directory for each test
    testDir = join(tmpdir(), `file-storage-test-${Date.now()}-${Math.random().toString(36).substring(7)}`);
    await fs.mkdir(testDir, { recursive: true });
    adapter = new FileStorageAdapter(testDir);
  });

  afterEach(async () => {
    // Clean up temp directory
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('readJSON', () => {
    it('should read existing JSON file', async () => {
      const data = { message: 'Hello', count: 42 };
      const filePath = 'test.json';
      await fs.writeFile(join(testDir, filePath), JSON.stringify(data));

      const result = await adapter.readJSON<typeof data>(filePath);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(data);
      }
    });

    it('should return null for non-existent file', async () => {
      const result = await adapter.readJSON('nonexistent.json');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBeNull();
      }
    });

    it('should return error for invalid JSON', async () => {
      const filePath = 'invalid.json';
      await fs.writeFile(join(testDir, filePath), 'not valid json {');

      const result = await adapter.readJSON(filePath);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('PARSE_ERROR');
      }
    });
  });

  describe('writeJSON', () => {
    it('should write JSON file', async () => {
      const data = { message: 'Hello', count: 42 };
      const filePath = 'test.json';

      const result = await adapter.writeJSON(filePath, data);

      expect(result.success).toBe(true);

      // Verify file was written
      const content = await fs.readFile(join(testDir, filePath), 'utf-8');
      expect(JSON.parse(content)).toEqual(data);
    });

    it('should create parent directories', async () => {
      const data = { test: true };
      const filePath = 'nested/dir/test.json';

      const result = await adapter.writeJSON(filePath, data);

      expect(result.success).toBe(true);

      // Verify file was written in nested directory
      const content = await fs.readFile(join(testDir, filePath), 'utf-8');
      expect(JSON.parse(content)).toEqual(data);
    });

    it('should use atomic write pattern', async () => {
      const data = { atomic: true };
      const filePath = 'atomic.json';
      const fullPath = join(testDir, filePath);
      const tempPath = `${fullPath}.tmp`;

      const result = await adapter.writeJSON(filePath, data);

      expect(result.success).toBe(true);

      // Verify temp file was cleaned up
      try {
        await fs.access(tempPath);
        throw new Error('Temp file should not exist');
      } catch (error: any) {
        expect(error.code).toBe('ENOENT');
      }

      // Verify final file exists
      const content = await fs.readFile(fullPath, 'utf-8');
      expect(JSON.parse(content)).toEqual(data);
    });
  });

  describe('appendToJSONArray', () => {
    it('should append to existing array', async () => {
      const filePath = 'array.json';
      const initial = [1, 2, 3];
      await fs.writeFile(join(testDir, filePath), JSON.stringify(initial));

      const result = await adapter.appendToJSONArray(filePath, 4);

      expect(result.success).toBe(true);

      // Verify array was updated
      const content = await fs.readFile(join(testDir, filePath), 'utf-8');
      expect(JSON.parse(content)).toEqual([1, 2, 3, 4]);
    });

    it('should create new array if file does not exist', async () => {
      const filePath = 'new-array.json';

      const result = await adapter.appendToJSONArray(filePath, 'first');

      expect(result.success).toBe(true);

      // Verify array was created
      const content = await fs.readFile(join(testDir, filePath), 'utf-8');
      expect(JSON.parse(content)).toEqual(['first']);
    });
  });

  describe('trimJSONArray', () => {
    it('should trim array to keep last N items', async () => {
      const filePath = 'trim.json';
      const data = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      await fs.writeFile(join(testDir, filePath), JSON.stringify(data));

      const result = await adapter.trimJSONArray(filePath, 3);

      expect(result.success).toBe(true);
      if (result.success) {
        // Removed items: 1, 2, 3, 4, 5, 6, 7
        expect(result.data).toEqual([1, 2, 3, 4, 5, 6, 7]);
      }

      // Verify kept items: 8, 9, 10
      const content = await fs.readFile(join(testDir, filePath), 'utf-8');
      expect(JSON.parse(content)).toEqual([8, 9, 10]);
    });

    it('should return empty array if nothing to trim', async () => {
      const filePath = 'small.json';
      const data = [1, 2, 3];
      await fs.writeFile(join(testDir, filePath), JSON.stringify(data));

      const result = await adapter.trimJSONArray(filePath, 5);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual([]);
      }

      // Verify array unchanged
      const content = await fs.readFile(join(testDir, filePath), 'utf-8');
      expect(JSON.parse(content)).toEqual([1, 2, 3]);
    });

    it('should return empty array if file does not exist', async () => {
      const result = await adapter.trimJSONArray('nonexistent.json', 5);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual([]);
      }
    });
  });

  describe('ensureDirectory', () => {
    it('should create directory', async () => {
      const dirPath = 'new/nested/dir';

      const result = await adapter.ensureDirectory(dirPath);

      expect(result.success).toBe(true);

      // Verify directory exists
      const stats = await fs.stat(join(testDir, dirPath));
      expect(stats.isDirectory()).toBe(true);
    });

    it('should succeed if directory already exists', async () => {
      const dirPath = 'existing';
      await fs.mkdir(join(testDir, dirPath));

      const result = await adapter.ensureDirectory(dirPath);

      expect(result.success).toBe(true);
    });
  });

  describe('listFiles', () => {
    it('should list files in directory', async () => {
      const dirPath = 'files';
      await fs.mkdir(join(testDir, dirPath));
      await fs.writeFile(join(testDir, dirPath, 'file1.txt'), 'content1');
      await fs.writeFile(join(testDir, dirPath, 'file2.txt'), 'content2');

      const result = await adapter.listFiles(dirPath);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toHaveLength(2);
        expect(result.data).toContain('file1.txt');
        expect(result.data).toContain('file2.txt');
      }
    });

    it('should return empty array for non-existent directory', async () => {
      const result = await adapter.listFiles('nonexistent');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual([]);
      }
    });
  });

  describe('deleteFile', () => {
    it('should delete existing file', async () => {
      const filePath = 'delete-me.txt';
      await fs.writeFile(join(testDir, filePath), 'content');

      const result = await adapter.deleteFile(filePath);

      expect(result.success).toBe(true);

      // Verify file was deleted
      try {
        await fs.access(join(testDir, filePath));
        throw new Error('File should not exist');
      } catch (error: any) {
        expect(error.code).toBe('ENOENT');
      }
    });

    it('should succeed if file does not exist', async () => {
      const result = await adapter.deleteFile('nonexistent.txt');

      expect(result.success).toBe(true);
    });
  });

  describe('readMarkdown', () => {
    it('should read existing Markdown file', async () => {
      const content = '# Hello\n\nThis is **Markdown**';
      const filePath = 'test.md';
      await fs.writeFile(join(testDir, filePath), content);

      const result = await adapter.readMarkdown(filePath);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe(content);
      }
    });

    it('should return null for non-existent file', async () => {
      const result = await adapter.readMarkdown('nonexistent.md');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBeNull();
      }
    });
  });

  describe('writeMarkdown', () => {
    it('should write Markdown file', async () => {
      const content = '# Title\n\nContent';
      const filePath = 'test.md';

      const result = await adapter.writeMarkdown(filePath, content);

      expect(result.success).toBe(true);

      // Verify file was written
      const actual = await fs.readFile(join(testDir, filePath), 'utf-8');
      expect(actual).toBe(content);
    });

    it('should create parent directories', async () => {
      const content = '# Nested';
      const filePath = 'nested/dir/test.md';

      const result = await adapter.writeMarkdown(filePath, content);

      expect(result.success).toBe(true);

      // Verify file was written
      const actual = await fs.readFile(join(testDir, filePath), 'utf-8');
      expect(actual).toBe(content);
    });
  });

  describe('appendToMarkdown', () => {
    it('should append to existing file', async () => {
      const filePath = 'append.md';
      const initial = '# Title\n\nFirst paragraph';
      await fs.writeFile(join(testDir, filePath), initial);

      const result = await adapter.appendToMarkdown(filePath, 'Second paragraph');

      expect(result.success).toBe(true);

      // Verify content was appended
      const content = await fs.readFile(join(testDir, filePath), 'utf-8');
      expect(content).toBe('# Title\n\nFirst paragraph\nSecond paragraph');
    });

    it('should create new file if does not exist', async () => {
      const filePath = 'new.md';

      const result = await adapter.appendToMarkdown(filePath, 'First line');

      expect(result.success).toBe(true);

      // Verify file was created
      const content = await fs.readFile(join(testDir, filePath), 'utf-8');
      expect(content).toBe('First line');
    });
  });
});
