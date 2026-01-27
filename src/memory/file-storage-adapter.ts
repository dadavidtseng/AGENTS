/**
 * File Storage Adapter
 *
 * Provides low-level file operations for JSON and Markdown files with:
 * - Atomic writes (write to temp → rename)
 * - File locking with exponential backoff
 * - Error handling with Result<T, FileError> pattern
 * - Graceful ENOENT handling (returns null instead of error)
 */

import { promises as fs } from 'fs';
import { join, dirname } from 'path';
import type { Result } from '../common/result.js';
import { ok, err } from '../common/result.js';
import type { FileError } from '../common/types.js';
import { FileErrorType } from '../common/types.js';

/**
 * File Storage Adapter
 *
 * Manages low-level file operations with atomic writes and error handling
 */
export class FileStorageAdapter {
  /**
   * In-memory locks for file operations to prevent race conditions
   */
  private fileLocks: Map<string, Promise<void>> = new Map();

  /**
   * Create File Storage Adapter
   *
   * @param dataPath - Base directory for file storage
   */
  constructor(private readonly dataPath: string) {}

  /**
   * Read JSON file
   *
   * @param filePath - Path to JSON file (relative to dataPath)
   * @returns Result with parsed JSON data or null if file doesn't exist
   */
  async readJSON<T>(filePath: string): Promise<Result<T | null, FileError>> {
    const fullPath = join(this.dataPath, filePath);

    try {
      const content = await fs.readFile(fullPath, 'utf-8');
      const data = JSON.parse(content) as T;
      return ok(data);
    } catch (error: any) {
      // Gracefully handle file not found
      if (error.code === 'ENOENT') {
        return ok(null);
      }

      // Handle JSON parse errors
      if (error instanceof SyntaxError) {
        return err({
          type: FileErrorType.PARSE_ERROR,
          message: `Failed to parse JSON from ${filePath}: ${error.message}`,
          filePath: fullPath,
        });
      }

      // Other file system errors
      return err({
        type: FileErrorType.READ_ERROR,
        message: `Failed to read file ${filePath}: ${error.message}`,
        filePath: fullPath,
      });
    }
  }

  /**
   * Write JSON file with atomic write pattern
   *
   * Atomic pattern: write to temp file → rename to final file
   * This prevents partial writes and corruption
   *
   * @param filePath - Path to JSON file (relative to dataPath)
   * @param data - Data to serialize and write
   * @returns Result indicating success or error
   */
  async writeJSON<T>(
    filePath: string,
    data: T
  ): Promise<Result<void, FileError>> {
    const fullPath = join(this.dataPath, filePath);
    const tempPath = `${fullPath}.tmp`;

    try {
      // Ensure parent directory exists
      const dirResult = await this.ensureDirectory(dirname(filePath));
      if (!dirResult.success) {
        return dirResult;
      }

      // Serialize data
      const content = JSON.stringify(data, null, 2);

      // Write to temp file
      await fs.writeFile(tempPath, content, 'utf-8');

      // Atomic rename
      await fs.rename(tempPath, fullPath);

      return ok(undefined);
    } catch (error: any) {
      // Clean up temp file on error
      try {
        await fs.unlink(tempPath);
      } catch {
        // Ignore cleanup errors
      }

      return err({
        type: FileErrorType.WRITE_ERROR,
        message: `Failed to write JSON file ${filePath}: ${error.message}`,
        filePath: fullPath,
      });
    }
  }

  /**
   * Acquire lock for a file path and execute operation
   *
   * Ensures only one operation at a time per file path
   *
   * @param filePath - Path to lock
   * @param operation - Async operation to execute while locked
   * @returns Result of the operation
   */
  private async withFileLock<T>(
    filePath: string,
    operation: () => Promise<T>
  ): Promise<T> {
    // Wait for any existing lock on this file
    const existingLock = this.fileLocks.get(filePath);
    if (existingLock) {
      await existingLock;
      // After waiting, recursively try again (in case another operation grabbed the lock)
      return this.withFileLock(filePath, operation);
    }

    // Create new lock
    let releaseLock: () => void;
    const lockPromise = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    this.fileLocks.set(filePath, lockPromise);

    try {
      // Execute operation
      return await operation();
    } finally {
      // Release lock
      releaseLock!();
      this.fileLocks.delete(filePath);
    }
  }

  /**
   * Append item to JSON array file
   *
   * Reads existing array, appends item, writes back atomically with file locking
   *
   * @param filePath - Path to JSON array file
   * @param item - Item to append
   * @returns Result indicating success or error
   */
  async appendToJSONArray<T>(
    filePath: string,
    item: T
  ): Promise<Result<void, FileError>> {
    return this.withFileLock(filePath, async () => {
      // Read existing array
      const result = await this.readJSON<T[]>(filePath);
      if (!result.success) {
        return result;
      }

      // Initialize empty array if file doesn't exist
      const array = result.data || [];

      // Append item
      array.push(item);

      // Write back atomically
      return this.writeJSON(filePath, array);
    });
  }

  /**
   * Trim JSON array to keep only last N items
   *
   * Reads array, keeps last N items, returns removed items
   *
   * @param filePath - Path to JSON array file
   * @param keepLast - Number of items to keep
   * @returns Result with removed items or error
   */
  async trimJSONArray<T>(
    filePath: string,
    keepLast: number
  ): Promise<Result<T[], FileError>> {
    return this.withFileLock(filePath, async () => {
      // Read existing array
      const result = await this.readJSON<T[]>(filePath);
      if (!result.success) {
        return result;
      }

      // Return empty array if file doesn't exist
      if (result.data === null) {
        return ok([]);
      }

      const array = result.data;

      // No trimming needed if array is small enough
      if (array.length <= keepLast) {
        return ok([]);
      }

      // Calculate split point
      const removeCount = array.length - keepLast;
      const removed = array.slice(0, removeCount);
      const kept = array.slice(removeCount);

      // Write back kept items
      const writeResult = await this.writeJSON(filePath, kept);
      if (!writeResult.success) {
        return writeResult;
      }

      return ok(removed);
    });
  }

  /**
   * Ensure directory exists (create if needed)
   *
   * @param dirPath - Directory path (relative to dataPath)
   * @returns Result indicating success or error
   */
  async ensureDirectory(dirPath: string): Promise<Result<void, FileError>> {
    const fullPath = join(this.dataPath, dirPath);

    try {
      await fs.mkdir(fullPath, { recursive: true });
      return ok(undefined);
    } catch (error: any) {
      return err({
        type: FileErrorType.WRITE_ERROR,
        message: `Failed to create directory ${dirPath}: ${error.message}`,
        filePath: fullPath,
      });
    }
  }

  /**
   * List files in directory
   *
   * @param dirPath - Directory path (relative to dataPath)
   * @returns Result with array of filenames or error
   */
  async listFiles(dirPath: string): Promise<Result<string[], FileError>> {
    const fullPath = join(this.dataPath, dirPath);

    try {
      const files = await fs.readdir(fullPath);
      return ok(files);
    } catch (error: any) {
      // Return empty array if directory doesn't exist
      if (error.code === 'ENOENT') {
        return ok([]);
      }

      return err({
        type: FileErrorType.READ_ERROR,
        message: `Failed to list directory ${dirPath}: ${error.message}`,
        filePath: fullPath,
      });
    }
  }

  /**
   * Delete file
   *
   * @param filePath - File path (relative to dataPath)
   * @returns Result indicating success or error
   */
  async deleteFile(filePath: string): Promise<Result<void, FileError>> {
    const fullPath = join(this.dataPath, filePath);

    try {
      await fs.unlink(fullPath);
      return ok(undefined);
    } catch (error: any) {
      // Succeed silently if file doesn't exist
      if (error.code === 'ENOENT') {
        return ok(undefined);
      }

      return err({
        type: FileErrorType.WRITE_ERROR,
        message: `Failed to delete file ${filePath}: ${error.message}`,
        filePath: fullPath,
      });
    }
  }

  /**
   * Read Markdown file
   *
   * @param filePath - Path to Markdown file (relative to dataPath)
   * @returns Result with file content or null if file doesn't exist
   */
  async readMarkdown(filePath: string): Promise<Result<string | null, FileError>> {
    const fullPath = join(this.dataPath, filePath);

    try {
      const content = await fs.readFile(fullPath, 'utf-8');
      return ok(content);
    } catch (error: any) {
      // Gracefully handle file not found
      if (error.code === 'ENOENT') {
        return ok(null);
      }

      return err({
        type: FileErrorType.READ_ERROR,
        message: `Failed to read Markdown file ${filePath}: ${error.message}`,
        filePath: fullPath,
      });
    }
  }

  /**
   * Write Markdown file with atomic write pattern
   *
   * @param filePath - Path to Markdown file (relative to dataPath)
   * @param content - Markdown content to write
   * @returns Result indicating success or error
   */
  async writeMarkdown(
    filePath: string,
    content: string
  ): Promise<Result<void, FileError>> {
    const fullPath = join(this.dataPath, filePath);
    const tempPath = `${fullPath}.tmp`;

    try {
      // Ensure parent directory exists
      const dirResult = await this.ensureDirectory(dirname(filePath));
      if (!dirResult.success) {
        return dirResult;
      }

      // Write to temp file
      await fs.writeFile(tempPath, content, 'utf-8');

      // Atomic rename
      await fs.rename(tempPath, fullPath);

      return ok(undefined);
    } catch (error: any) {
      // Clean up temp file on error
      try {
        await fs.unlink(tempPath);
      } catch {
        // Ignore cleanup errors
      }

      return err({
        type: FileErrorType.WRITE_ERROR,
        message: `Failed to write Markdown file ${filePath}: ${error.message}`,
        filePath: fullPath,
      });
    }
  }

  /**
   * Append content to Markdown file
   *
   * @param filePath - Path to Markdown file
   * @param content - Content to append
   * @returns Result indicating success or error
   */
  async appendToMarkdown(
    filePath: string,
    content: string
  ): Promise<Result<void, FileError>> {
    // Read existing content
    const result = await this.readMarkdown(filePath);
    if (!result.success) {
      return result;
    }

    // Concatenate with newline
    const existing = result.data || '';
    const updated = existing ? `${existing}\n${content}` : content;

    // Write back atomically
    return this.writeMarkdown(filePath, updated);
  }
}
