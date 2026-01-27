/**
 * Common Types
 *
 * Shared type definitions used across the application
 */

/**
 * File error types
 */
export enum FileErrorType {
  READ_ERROR = 'READ_ERROR',
  WRITE_ERROR = 'WRITE_ERROR',
  PARSE_ERROR = 'PARSE_ERROR',
  NOT_FOUND = 'NOT_FOUND',
  PERMISSION_DENIED = 'PERMISSION_DENIED',
  UNKNOWN = 'UNKNOWN',
  // File management errors
  START_SERVER_FAILED = 'START_SERVER_FAILED',
  STOP_SERVER_FAILED = 'STOP_SERVER_FAILED',
  UPLOAD_FAILED = 'UPLOAD_FAILED',
  DOWNLOAD_FAILED = 'DOWNLOAD_FAILED',
  LIST_FILES_FAILED = 'LIST_FILES_FAILED',
  SHARE_CONTAINER_FAILED = 'SHARE_CONTAINER_FAILED',
  STOP_REGISTRY_FAILED = 'STOP_REGISTRY_FAILED',
  SSH_UPLOAD_FAILED = 'SSH_UPLOAD_FAILED',
  SSH_DOWNLOAD_FAILED = 'SSH_DOWNLOAD_FAILED',
  SSH_COMMAND_FAILED = 'SSH_COMMAND_FAILED',
  KADI_PROTOCOL_ERROR = 'KADI_PROTOCOL_ERROR',
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
 * Database error types
 */
export enum DatabaseErrorType {
  CONNECTION_ERROR = 'CONNECTION_ERROR',
  QUERY_ERROR = 'QUERY_ERROR',
  AUTH_ERROR = 'AUTH_ERROR',
  NOT_CONNECTED = 'NOT_CONNECTED',
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