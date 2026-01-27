/**
 * Memory System Types
 *
 * Defines data models for the hybrid memory system combining file-based
 * short-term storage (JSON/MD files) with ArcadeDB long-term persistence.
 */

/**
 * Memory entry types
 */
export type MemoryType = 'short-term' | 'long-term' | 'private' | 'public';

/**
 * Base memory entry structure
 */
export interface MemoryEntry {
  id: string;
  userId: string;
  channelId?: string;
  type: MemoryType;
  content: string;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

/**
 * Conversation message (stored in short-term memory)
 */
export interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  userId: string;
  channelId: string;
}

/**
 * Conversation summary (stored in long-term memory after archival)
 */
export interface ConversationSummary {
  id: string;
  userId: string;
  channelId: string;
  summary: string;
  messageCount: number;
  startTime: Date;
  endTime: Date;
  keyTopics: string[];
  archived: Date;
}

/**
 * User preference (stored in private memory)
 */
export interface UserPreference {
  userId: string;
  key: string;
  value: unknown;
  updatedAt: Date;
}

/**
 * Public knowledge entry (stored in shared memory)
 */
export interface PublicKnowledge {
  key: string;
  value: unknown;
  source?: string;
  confidence?: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Memory error types
 */
export enum MemoryErrorType {
  FILE_NOT_FOUND = 'FILE_NOT_FOUND',
  FILE_WRITE_ERROR = 'FILE_WRITE_ERROR',
  FILE_READ_ERROR = 'FILE_READ_ERROR',
  DATABASE_ERROR = 'DATABASE_ERROR',
  SERIALIZATION_ERROR = 'SERIALIZATION_ERROR',
  UNKNOWN = 'UNKNOWN',
}

/**
 * Memory operation error
 */
export interface MemoryError {
  type: MemoryErrorType;
  message: string;
  operation: string;
  originalError?: unknown;
}

/**
 * File error types (for FileStorageAdapter)
 */
export enum FileErrorType {
  NOT_FOUND = 'NOT_FOUND',
  PERMISSION_DENIED = 'PERMISSION_DENIED',
  WRITE_FAILED = 'WRITE_FAILED',
  READ_FAILED = 'READ_FAILED',
  PARSE_ERROR = 'PARSE_ERROR',
  UNKNOWN = 'UNKNOWN',
}

/**
 * File operation error
 */
export interface FileError {
  type: FileErrorType;
  message: string;
  filePath: string;
  originalError?: unknown;
}

/**
 * Database error types (for ArcadeDBAdapter)
 */
export enum DatabaseErrorType {
  CONNECTION_FAILED = 'CONNECTION_FAILED',
  QUERY_FAILED = 'QUERY_FAILED',
  TIMEOUT = 'TIMEOUT',
  UNKNOWN = 'UNKNOWN',
}

/**
 * Database operation error
 */
export interface DatabaseError {
  type: DatabaseErrorType;
  message: string;
  query?: string;
  originalError?: unknown;
}
